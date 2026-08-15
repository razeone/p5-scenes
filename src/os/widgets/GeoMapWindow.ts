/**
 * GeoMapWindow.ts — Real-world tracking map on OpenStreetMap tiles.
 *
 * Streams raster tiles from tile.openstreetmap.org (CORS-enabled, so
 * canvas recording stays untainted) and restyles them live per palette
 * with a grayscale→invert pass plus a multiply tint — the same street
 * data reads as a tactical dark map in every theme. On top runs the
 * pursuit fiction: a target random-walking at vehicle speed through a
 * real city, pursuit units that converge on command, a fading GPS
 * trail, an operational perimeter ring, ping rings and live lat/lon
 * telemetry. The camera can lock onto the target; zoom is fractional
 * and eased.
 *
 * Tiles are cached in-memory with LRU eviction; a missing tile falls
 * back to any cached ancestor so pans and zooms never flash empty.
 * Offline, the grid placeholder + HUD still sell the scene.
 */

import { OSWindow, type OSWindowOpts } from './OSWindow'
import type { OSContext } from '../core/context'
import { clamp, fillHex, strokeHex } from '../core/context'
import type { Rect } from '../core/geometry'
import { enableGlow, disableGlow } from '../fx/Effects'

const TILE = 256
const MIN_ZOOM = 5
const MAX_ZOOM = 19
const CACHE_MAX = 512
const M_PER_DEG_LAT = 111320

/** Real cities the fiction can "operate" in. */
export interface GeoCity {
  label: string
  lat: number
  lon: number
}

export const GEO_CITIES: GeoCity[] = [
  { label: 'CIUDAD DE MÉXICO', lat: 19.4326, lon: -99.1332 },
  { label: 'MADRID', lat: 40.4168, lon: -3.7038 },
  { label: 'BUENOS AIRES', lat: -34.6037, lon: -58.3816 },
  { label: 'BERLÍN', lat: 52.52, lon: 13.405 },
  { label: 'TOKIO', lat: 35.6812, lon: 139.7671 },
]

// --- Web Mercator: lat/lon → tile units at integer zoom z. -----------

function lonToXt(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z
}

function latToYt(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z
}

// --- Local flat-earth helpers (fine at city scale). -------------------

/** North/east offsets in meters from a → b, plus straight distance. */
function offsetMeters(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): { dn: number; de: number; d: number } {
  const dn = (bLat - aLat) * M_PER_DEG_LAT
  const de = (bLon - aLon) * M_PER_DEG_LAT * Math.cos((aLat * Math.PI) / 180)
  return { dn, de, d: Math.hypot(dn, de) }
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

/** Rotate `heading` toward `desired` by at most `maxTurn` radians. */
function turnToward(heading: number, desired: number, maxTurn: number): number {
  const diff = wrapAngle(desired - heading)
  return heading + clamp(diff, -maxTurn, maxTurn)
}

// --- Tile cache --------------------------------------------------------

interface TileSlot {
  img: HTMLImageElement
  state: 'loading' | 'ok' | 'error'
  stamp: number
}

class TileCache {
  private slots = new Map<string, TileSlot>()
  private stamp = 0
  /** Tiles currently in flight (HUD shows a downlink indicator). */
  pending = 0

  /** Loaded image for z/x/y, or null. Starts the fetch on first ask. */
  get(z: number, x: number, y: number): HTMLImageElement | null {
    const key = `${z}/${x}/${y}`
    let slot = this.slots.get(key)
    if (!slot) {
      if (this.slots.size >= CACHE_MAX) this.evict()
      const img = new Image()
      const s: TileSlot = { img, state: 'loading', stamp: 0 }
      slot = s
      this.slots.set(key, s)
      this.pending++
      // anonymous CORS keeps the canvas untainted → recording still works.
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        s.state = 'ok'
        this.pending--
      }
      img.onerror = () => {
        s.state = 'error'
        this.pending--
      }
      img.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`
    }
    slot.stamp = ++this.stamp
    return slot.state === 'ok' ? slot.img : null
  }

  /** Cached image only — never triggers a fetch (ancestor fallback). */
  peek(z: number, x: number, y: number): HTMLImageElement | null {
    const slot = this.slots.get(`${z}/${x}/${y}`)
    return slot?.state === 'ok' ? slot.img : null
  }

  /** Drop the least-recently-used eighth (skipping in-flight loads). */
  private evict(): void {
    const list = [...this.slots.entries()].sort(
      (a, b) => a[1].stamp - b[1].stamp,
    )
    let toDrop = Math.ceil(list.length / 8)
    for (const [key, slot] of list) {
      if (toDrop <= 0) break
      if (slot.state === 'loading') continue
      this.slots.delete(key)
      toDrop--
    }
  }
}

// --- The window ---------------------------------------------------------

interface Mover {
  lat: number
  lon: number
  /** Compass bearing in radians (0 = north, +east). */
  heading: number
  label: string
}

export type GeoMode = 'patrol' | 'chase'

export class GeoMapWindow extends OSWindow {
  private cache = new TileCache()
  private cityIndex = 0
  private zoom = 16
  private zoomGoal = 16
  private cam = { lat: 0, lon: 0 }
  private target: Mover = { lat: 0, lon: 0, heading: 0, label: 'OBJETIVO-PRIME' }
  private units: Mover[] = []
  private trail: { lat: number; lon: number }[] = []
  private trailTimer = 0
  private started = false
  /** Camera locked onto the target (off = hold over the city center). */
  follow = true
  /** patrol: wander the sector. chase: converge on the target. */
  mode: GeoMode = 'patrol'

  constructor(o: OSWindowOpts, cityIndex = 0) {
    super(o)
    this.cityIndex = ((cityIndex % GEO_CITIES.length) + GEO_CITIES.length) % GEO_CITIES.length
  }

  get city(): GeoCity {
    return GEO_CITIES[this.cityIndex]
  }

  /** Drop a mover at a random offset (meters) from the city center. */
  private scatter(m: Mover, minM: number, maxM: number): void {
    const c = this.city
    const ang = Math.random() * Math.PI * 2
    const d = minM + Math.random() * (maxM - minM)
    m.lat = c.lat + (Math.cos(ang) * d) / M_PER_DEG_LAT
    m.lon =
      c.lon +
      (Math.sin(ang) * d) / (M_PER_DEG_LAT * Math.cos((c.lat * Math.PI) / 180))
    m.heading = Math.random() * Math.PI * 2
  }

  private ensureStart(ctx: OSContext): void {
    if (this.started) return
    this.started = true
    const cfg = ctx.config.scenes.geo
    this.zoom = cfg.zoom
    this.zoomGoal = cfg.zoom
    this.scatter(this.target, 100, cfg.perimeterM * 0.4)
    this.units = []
    for (let i = 0; i < Math.max(1, Math.round(cfg.units)); i++) this.addUnit()
    this.cam = { lat: this.target.lat, lon: this.target.lon }
    this.trail = [{ lat: this.target.lat, lon: this.target.lon }]
  }

  /** The signal was lost and re-acquired somewhere else (director cue). */
  newTarget(): void {
    if (!this.started) return
    this.scatter(this.target, 200, 1200)
    this.trail = [{ lat: this.target.lat, lon: this.target.lon }]
  }

  setMode(mode: GeoMode): void {
    this.mode = mode
  }

  toggleFollow(): boolean {
    this.follow = !this.follow
    return this.follow
  }

  zoomBy(delta: number): void {
    this.zoomGoal = clamp(this.zoomGoal + delta, MIN_ZOOM, MAX_ZOOM)
  }

  /**
   * Point the operation at arbitrary real coordinates (the director types
   * a location instead of cycling the presets). The city list gains the
   * entry so CIUDAD can cycle back to it later in the shoot.
   */
  setLocation(lat: number, lon: number, label?: string): string {
    const name =
      label?.trim().toUpperCase() ||
      `${Math.abs(lat).toFixed(3)}${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(3)}${lon >= 0 ? 'E' : 'W'}`
    const existing = GEO_CITIES.findIndex((c) => c.label === name)
    if (existing >= 0) {
      GEO_CITIES[existing] = { label: name, lat, lon }
      this.cityIndex = existing
    } else {
      GEO_CITIES.push({ label: name, lat, lon })
      this.cityIndex = GEO_CITIES.length - 1
    }
    if (this.started) {
      this.scatter(this.target, 100, 600)
      for (const u of this.units) this.scatter(u, 300, 1200)
      this.cam = { lat: this.target.lat, lon: this.target.lon }
      this.trail = [{ lat: this.target.lat, lon: this.target.lon }]
    }
    return name
  }

  /** Current zoom level, rounded for readouts. */
  get zoomLevel(): number {
    return Math.round(this.zoomGoal * 10) / 10
  }

  /** Jump the whole operation to the next real city. */
  nextCity(): string {
    this.cityIndex = (this.cityIndex + 1) % GEO_CITIES.length
    if (this.started) {
      this.scatter(this.target, 100, 800)
      for (const u of this.units) this.scatter(u, 300, 1200)
      this.cam = { lat: this.target.lat, lon: this.target.lon }
      this.trail = [{ lat: this.target.lat, lon: this.target.lon }]
    }
    return this.city.label
  }

  addUnit(): void {
    if (this.units.length >= 10) return
    const u: Mover = {
      lat: 0,
      lon: 0,
      heading: 0,
      label: `UNIDAD-${this.units.length + 1}`,
    }
    this.scatter(u, 300, 1200)
    this.units.push(u)
  }

  removeUnit(): void {
    if (this.units.length > 1) this.units.pop()
  }

  /** Advance a mover along its compass heading at speed (m/s). */
  private step(m: Mover, speedMps: number, dt: number): void {
    const d = speedMps * dt
    m.lat += (Math.cos(m.heading) * d) / M_PER_DEG_LAT
    m.lon +=
      (Math.sin(m.heading) * d) /
      (M_PER_DEG_LAT * Math.cos((m.lat * Math.PI) / 180))
  }

  update(ctx: OSContext): void {
    this.ensureStart(ctx)
    const cfg = ctx.config.scenes.geo
    const dt = ctx.dt
    if (dt <= 0) return
    const p = ctx.p
    const c = this.city

    // Target: drift the heading, occasionally take a decisive turn, and
    // steer back inside the operational perimeter.
    const t = this.target
    t.heading += (p.random() - 0.5) * 1.7 * dt
    if (p.random() < dt * 0.18) t.heading += p.random(-1.2, 1.2)
    const home = offsetMeters(t.lat, t.lon, c.lat, c.lon)
    if (home.d > cfg.perimeterM * 0.92) {
      t.heading = turnToward(t.heading, Math.atan2(home.de, home.dn), 3 * dt)
    }
    this.step(t, cfg.targetSpeedKmh / 3.6, dt)

    // Units: chase → close on the target; patrol → wander the sector.
    for (const u of this.units) {
      const rel = offsetMeters(u.lat, u.lon, t.lat, t.lon)
      let speed = (cfg.unitSpeedKmh / 3.6) * (this.mode === 'chase' ? 1 : 0.55)
      if (this.mode === 'chase') {
        if (rel.d < 45) {
          // On top of the signal: circle it instead of jittering.
          u.heading = turnToward(
            u.heading,
            Math.atan2(rel.de, rel.dn) + Math.PI / 2,
            2.5 * dt,
          )
          speed *= 0.4
        } else {
          u.heading = turnToward(u.heading, Math.atan2(rel.de, rel.dn), 2.2 * dt)
        }
      } else {
        u.heading += (p.random() - 0.5) * 1.4 * dt
        const back = offsetMeters(u.lat, u.lon, c.lat, c.lon)
        if (back.d > cfg.perimeterM) {
          u.heading = turnToward(u.heading, Math.atan2(back.de, back.dn), 3 * dt)
        }
      }
      this.step(u, speed, dt)
    }

    // Breadcrumb trail behind the target.
    this.trailTimer += dt
    if (this.trailTimer >= 0.4) {
      this.trailTimer = 0
      this.trail.push({ lat: t.lat, lon: t.lon })
      const maxPoints = Math.max(4, Math.round(cfg.trailSeconds / 0.4))
      if (this.trail.length > maxPoints) {
        this.trail.splice(0, this.trail.length - maxPoints)
      }
    }

    // Camera: ease toward the target (or the city center) + eased zoom.
    const goal = this.follow ? t : c
    const k = 1 - Math.exp(-3 * dt)
    this.cam.lat += (goal.lat - this.cam.lat) * k
    this.cam.lon += (goal.lon - this.cam.lon) * k
    this.zoom += (this.zoomGoal - this.zoom) * (1 - Math.exp(-4 * dt))
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    this.ensureStart(ctx)
    const cfg = ctx.config.scenes.geo
    const dc = p.drawingContext as CanvasRenderingContext2D

    // Void behind the tiles (also what shows while the downlink buffers).
    p.push()
    p.noStroke()
    fillHex(p, palette.bg)
    p.rect(inner.x, inner.y, inner.w, inner.h)

    // Fractional zoom: fetch tiles at the integer level, scale to fit.
    const zInt = clamp(Math.floor(this.zoom), MIN_ZOOM, MAX_ZOOM)
    const size = TILE * 2 ** (this.zoom - zInt)
    const n = 2 ** zInt
    const camXt = lonToXt(this.cam.lon, zInt)
    const camYt = latToYt(this.cam.lat, zInt)
    const cx = inner.x + inner.w / 2
    const cy = inner.y + inner.h / 2

    const x0 = Math.floor(camXt - inner.w / 2 / size)
    const x1 = Math.floor(camXt + inner.w / 2 / size)
    const y0 = Math.max(0, Math.floor(camYt - inner.h / 2 / size))
    const y1 = Math.min(n - 1, Math.floor(camYt + inner.h / 2 / size))

    // Tile pass — grayscale + invert turns the standard OSM style into a
    // dark map with light streets; the multiply pass below tints it.
    const missing: { sx: number; sy: number }[] = []
    dc.save()
    dc.filter = 'grayscale(1) invert(1) brightness(0.82) contrast(1.25)'
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const wx = ((tx % n) + n) % n
        const sx = cx + (tx - camXt) * size
        const sy = cy + (ty - camYt) * size
        const img = this.cache.get(zInt, wx, ty)
        if (img) {
          dc.drawImage(img, sx, sy, size + 0.5, size + 0.5)
          continue
        }
        // Fall back to the nearest cached ancestor, scaled up.
        let drawn = false
        for (let up = 1; up <= 5 && zInt - up >= MIN_ZOOM; up++) {
          const f = 2 ** up
          const pimg = this.cache.peek(
            zInt - up,
            Math.floor(wx / f),
            Math.floor(ty / f),
          )
          if (!pimg) continue
          const sub = TILE / f
          dc.drawImage(
            pimg,
            (wx % f) * sub,
            (ty % f) * sub,
            sub,
            sub,
            sx,
            sy,
            size + 0.5,
            size + 0.5,
          )
          drawn = true
          break
        }
        if (!drawn) missing.push({ sx, sy })
      }
    }
    dc.filter = 'none'
    dc.restore()

    // Tint pass: multiply the light streets into the palette color.
    dc.save()
    dc.globalCompositeOperation = 'multiply'
    dc.fillStyle = palette.fg
    dc.fillRect(inner.x, inner.y, inner.w, inner.h)
    dc.restore()

    // Placeholder grid where nothing is cached yet.
    strokeHex(p, palette.grid, 90)
    p.strokeWeight(1)
    p.noFill()
    for (const m of missing) p.rect(m.sx, m.sy, size, size)

    // --- Overlay projection (same world-pixel space as the tiles). ----
    const px = (lon: number) => cx + (lonToXt(lon, zInt) - camXt) * size
    const py = (lat: number) => cy + (latToYt(lat, zInt) - camYt) * size
    const metersPerPx =
      (156543.03392 * Math.cos((this.cam.lat * Math.PI) / 180)) / 2 ** this.zoom
    const c = this.city

    // Operational perimeter (dashed geofence around the city center).
    const perimPx = cfg.perimeterM / metersPerPx
    strokeHex(p, palette.warn, 150)
    p.strokeWeight(1)
    p.noFill()
    dc.setLineDash([7, 7])
    p.circle(px(c.lon), py(c.lat), perimPx * 2)
    dc.setLineDash([])
    p.noStroke()
    fillHex(p, palette.warn, 190)
    p.textSize(9)
    p.textAlign(p.CENTER, p.BOTTOM)
    p.text('PERÍMETRO OPERATIVO', px(c.lon), py(c.lat) - perimPx - 5)

    // GPS trail, fading toward the past.
    if (this.trail.length > 1) {
      p.noFill()
      p.strokeWeight(1.5)
      for (let i = 1; i < this.trail.length; i++) {
        const a = this.trail[i - 1]
        const b = this.trail[i]
        strokeHex(p, palette.accent, 20 + (i / this.trail.length) * 180)
        p.line(px(a.lon), py(a.lat), px(b.lon), py(b.lat))
      }
    }

    // Pursuit units: heading triangles + designators.
    p.textSize(8)
    p.textAlign(p.LEFT, p.BOTTOM)
    for (const u of this.units) {
      const ux = px(u.lon)
      const uy = py(u.lat)
      if (this.mode === 'chase') {
        strokeHex(p, palette.ok, 60)
        p.strokeWeight(1)
        p.line(ux, uy, px(this.target.lon), py(this.target.lat))
      }
      p.push()
      p.translate(ux, uy)
      p.rotate(u.heading)
      p.noStroke()
      fillHex(p, palette.ok, 235)
      p.triangle(0, -6, -4.5, 4.5, 4.5, 4.5)
      p.pop()
      p.noStroke()
      fillHex(p, palette.ok, 170)
      p.text(u.label, ux + 7, uy - 5)
    }

    // Target: expanding ping rings + crosshair + designator.
    const tx = px(this.target.lon)
    const ty = py(this.target.lat)
    const ping = (ctx.t * cfg.pingSpeed) % 1
    enableGlow(ctx, palette.danger, 0.7)
    strokeHex(p, palette.danger, (1 - ping) * 220)
    p.strokeWeight(1.5)
    p.noFill()
    p.circle(tx, ty, 10 + ping * Math.min(inner.w, inner.h) * 0.22)
    strokeHex(p, palette.danger, 230)
    p.line(tx - 15, ty, tx - 5, ty)
    p.line(tx + 5, ty, tx + 15, ty)
    p.line(tx, ty - 15, tx, ty - 5)
    p.line(tx, ty + 5, tx, ty + 15)
    disableGlow(ctx)
    p.noStroke()
    fillHex(p, palette.danger)
    p.textSize(9)
    p.textAlign(p.LEFT, p.BOTTOM)
    p.text(this.target.label, tx + 18, ty - 8)
    fillHex(p, palette.danger, 170)
    p.text(
      `${Math.abs(this.target.lat).toFixed(5)}${this.target.lat >= 0 ? 'N' : 'S'} ${Math.abs(this.target.lon).toFixed(5)}${this.target.lon >= 0 ? 'E' : 'W'}`,
      tx + 18,
      ty + 4,
    )

    // --- HUD ------------------------------------------------------------
    // Top-left: operation + downlink state.
    const buffering = this.cache.pending > 0
    p.textSize(10)
    p.textAlign(p.LEFT, p.TOP)
    fillHex(p, palette.fg, 230)
    p.text(`OP. ${c.label}`, inner.x + 6, inner.y + 6)
    p.textSize(9)
    fillHex(p, palette.fgDim, 200)
    p.text(
      `ENLACE SAT: ${buffering ? 'SINCRONIZANDO' : 'ESTABLE'} · SEGUIMIENTO: ${this.follow ? 'FIJADO' : 'LIBRE'} · UNIDADES: ${this.units.length}`,
      inner.x + 6,
      inner.y + 20,
    )
    if (buffering && Math.sin(ctx.t * 8) > 0) {
      fillHex(p, palette.warn, 220)
      p.text('DESCARGANDO TESELAS…', inner.x + 6, inner.y + 33)
    }

    // Bottom-left: zoom/mode + scale bar.
    const baseY = inner.y + inner.h - 6
    p.textAlign(p.LEFT, p.BOTTOM)
    fillHex(p, palette.fgDim, 200)
    p.text(
      `ZOOM ${this.zoom.toFixed(1)} · MODO: ${this.mode === 'chase' ? 'INTERCEPCIÓN' : 'PATRULLA'}`,
      inner.x + 6,
      baseY - 14,
    )
    const steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]
    let barM = steps[0]
    for (const s of steps) {
      if (s / metersPerPx <= 130) barM = s
      else break
    }
    const barPx = barM / metersPerPx
    strokeHex(p, palette.fgDim, 220)
    p.strokeWeight(1)
    p.line(inner.x + 6, baseY - 4, inner.x + 6 + barPx, baseY - 4)
    p.line(inner.x + 6, baseY - 8, inner.x + 6, baseY)
    p.line(inner.x + 6 + barPx, baseY - 8, inner.x + 6 + barPx, baseY)
    p.noStroke()
    fillHex(p, palette.fgDim, 220)
    p.text(
      barM >= 1000 ? `${barM / 1000} KM` : `${barM} M`,
      inner.x + 12 + barPx,
      baseY,
    )

    // Bottom-right: camera coordinates + required tile attribution.
    p.textAlign(p.RIGHT, p.BOTTOM)
    fillHex(p, palette.fgDim, 200)
    p.text(
      `${Math.abs(this.cam.lat).toFixed(4)}${this.cam.lat >= 0 ? 'N' : 'S'} ${Math.abs(this.cam.lon).toFixed(4)}${this.cam.lon >= 0 ? 'E' : 'W'}`,
      inner.x + inner.w - 6,
      baseY - 12,
    )
    fillHex(p, palette.fgDim, 150)
    p.textSize(8)
    p.text('MAPA © OPENSTREETMAP', inner.x + inner.w - 6, baseY)
    p.pop()
  }
}
