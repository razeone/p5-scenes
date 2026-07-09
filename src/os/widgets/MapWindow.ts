/**
 * MapWindow.ts — Tactical city map: procedural street grid, sector
 * boundaries, a restricted zone, patrol units moving block to block,
 * and an expanding-ring ping on the current target.
 *
 * The static base map (streets, blocks, river) is rendered once into an
 * offscreen buffer per size/palette so the per-frame cost is just the
 * animated overlay. Geometry is seeded, so retakes show the same city.
 */

import type p5 from 'p5'
import { OSWindow, type OSWindowOpts } from './OSWindow'
import type { OSContext } from '../core/context'
import { fillHex, strokeHex } from '../core/context'
import type { Rect } from '../core/geometry'
import { enableGlow, disableGlow } from '../fx/Effects'

/** Deterministic PRNG so the same city comes back take after take. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Unit {
  x: number
  y: number
  tx: number
  ty: number
  speed: number
  label: string
  hostile: boolean
}

export type MapMode = 'patrol' | 'chase'

export class MapWindow extends OSWindow {
  private base: p5.Graphics | null = null
  private baseKey = ''
  private units: Unit[] = []
  private vLines: number[] = [] // street positions (0..1 of map space)
  private hLines: number[] = []
  private target = { x: 0.62, y: 0.38 }
  private seed: number
  /** patrol: wander the grid. chase: converge on the target. */
  mode: MapMode = 'patrol'

  constructor(o: OSWindowOpts, seed = 20260708) {
    super(o)
    this.seed = seed
  }

  /** Relocate the target ping (director: "the subject moved"). */
  newTarget(): void {
    this.target = {
      x: 0.1 + Math.random() * 0.8,
      y: 0.1 + Math.random() * 0.8,
    }
    if (this.mode === 'chase') this.retask()
  }

  addUnit(): void {
    if (this.units.length >= 14) return
    const i = this.units.length
    this.units.push({
      x: Math.random(),
      y: Math.random(),
      tx: Math.random(),
      ty: Math.random(),
      speed: 0.008 + Math.random() * 0.014,
      label: `UNIDAD-${i + 3}`,
      hostile: false,
    })
    if (this.mode === 'chase') this.retask()
  }

  removeUnit(): void {
    // Keep at least the two suspects on the board.
    const i = this.units.map((u) => u.hostile).lastIndexOf(false)
    if (i >= 0) this.units.splice(i, 1)
  }

  setMode(mode: MapMode): void {
    this.mode = mode
    if (mode === 'chase') this.retask()
  }

  /** Point every friendly unit's waypoint near the target. */
  private retask(): void {
    for (const u of this.units) {
      if (u.hostile) continue
      u.tx = this.target.x + (Math.random() - 0.5) * 0.08
      u.ty = this.target.y + (Math.random() - 0.5) * 0.08
    }
  }

  /** Streets + units derive from the seed; geometry is size-agnostic. */
  private ensureLayout(): void {
    if (this.vLines.length > 0) return
    const rnd = mulberry32(this.seed)
    let x = 0.04
    while (x < 0.97) {
      this.vLines.push(x)
      x += 0.05 + rnd() * 0.09
    }
    let y = 0.05
    while (y < 0.96) {
      this.hLines.push(y)
      y += 0.06 + rnd() * 0.1
    }
    for (let i = 0; i < 7; i++) {
      const hostile = i < 2
      this.units.push({
        x: rnd(),
        y: rnd(),
        tx: rnd(),
        ty: rnd(),
        speed: 0.008 + rnd() * 0.014,
        label: hostile ? `SOSP-${i + 1}` : `UNIDAD-${i + 3}`,
        hostile,
      })
    }
  }

  /** Render the static city into an offscreen buffer once per size/theme. */
  private ensureBase(ctx: OSContext, r: Rect): p5.Graphics {
    const key = `${Math.round(r.w)}x${Math.round(r.h)}:${ctx.palette.label}`
    if (this.base && this.baseKey === key) return this.base
    this.base?.remove()
    this.baseKey = key
    const g = ctx.p.createGraphics(Math.max(2, r.w), Math.max(2, r.h))
    this.base = g
    const rnd = mulberry32(this.seed + 7)
    const pal = ctx.palette
    const X = (u: number) => u * r.w
    const Y = (u: number) => u * r.h

    g.background(0, 0)
    g.push()

    // City blocks: faint building clusters inside the street grid.
    g.noStroke()
    for (let vi = 0; vi < this.vLines.length - 1; vi++) {
      for (let hi = 0; hi < this.hLines.length - 1; hi++) {
        const bx = X(this.vLines[vi])
        const by = Y(this.hLines[hi])
        const bw = X(this.vLines[vi + 1]) - bx
        const bh = Y(this.hLines[hi + 1]) - by
        const density = rnd()
        if (density < 0.15) continue // plazas / empty lots
        const buildings = Math.floor(density * 6) + 1
        const col = g.color(pal.grid)
        for (let b = 0; b < buildings; b++) {
          col.setAlpha(50 + rnd() * 60)
          g.fill(col)
          const pw = (0.15 + rnd() * 0.3) * bw
          const ph = (0.15 + rnd() * 0.3) * bh
          g.rect(bx + 3 + rnd() * (bw - pw - 6), by + 3 + rnd() * (bh - ph - 6), pw, ph)
        }
      }
    }

    // River: a soft meandering band. Sampled as a polyline — p5 v2's
    // bezierVertex path converter chokes inside offscreen Graphics.
    const river = g.color(pal.accent)
    river.setAlpha(26)
    g.noStroke()
    g.fill(river)
    const riverY = (t: number) =>
      0.64 + Math.sin(t * Math.PI * 1.4 + 0.6) * 0.09 + t * 0.04
    g.beginShape()
    for (let t = 0; t <= 1.001; t += 0.05) g.vertex(X(t), Y(riverY(t)))
    for (let t = 1; t >= -0.001; t -= 0.05) g.vertex(X(t), Y(riverY(t) + 0.1))
    g.endShape(g.CLOSE)

    // Street grid.
    const street = g.color(pal.fgDim)
    street.setAlpha(120)
    g.stroke(street)
    g.strokeWeight(1)
    for (const u of this.vLines) g.line(X(u), Y(0.02), X(u), Y(0.98))
    for (const u of this.hLines) g.line(X(0.02), Y(u), X(0.98), Y(u))
    // Two arterial avenues, brighter and wider.
    const avenue = g.color(pal.fg)
    avenue.setAlpha(140)
    g.stroke(avenue)
    g.strokeWeight(2)
    g.line(X(0.3), Y(0.02), X(0.3), Y(0.98))
    g.line(X(0.02), Y(0.32), X(0.98), Y(0.32))

    // Sector boundary (dashed) + restricted zone hatching.
    const bound = g.color(pal.warn)
    bound.setAlpha(150)
    g.stroke(bound)
    g.strokeWeight(1)
    const gdc = g.drawingContext as CanvasRenderingContext2D
    gdc.setLineDash([6, 6])
    g.noFill()
    g.rect(X(0.55), Y(0.12), X(0.4), Y(0.34))
    gdc.setLineDash([])
    const hatch = g.color(pal.danger)
    hatch.setAlpha(60)
    g.stroke(hatch)
    for (let d = 0; d < 0.4 + 0.34; d += 0.035) {
      const x1 = X(0.55 + Math.min(d, 0.4))
      const y1 = Y(0.12 + Math.max(0, d - 0.4))
      const x2 = X(0.55 + Math.max(0, d - 0.34))
      const y2 = Y(0.12 + Math.min(d, 0.34))
      g.line(x1, y1, x2, y2)
    }
    g.pop()
    return g
  }

  update(ctx: OSContext): void {
    this.ensureLayout()
    const rnd = () => ctx.p.random()
    for (const u of this.units) {
      const dx = u.tx - u.x
      const dy = u.ty - u.y
      const d = Math.hypot(dx, dy)
      if (d < 0.01) {
        if (this.mode === 'chase' && !u.hostile) {
          // Hold position near the target, adjusting slightly.
          u.tx = this.target.x + (ctx.p.random() - 0.5) * 0.06
          u.ty = this.target.y + (ctx.p.random() - 0.5) * 0.06
        } else {
          // Next waypoint: snap to a random street intersection.
          u.tx = this.vLines[Math.floor(rnd() * this.vLines.length)]
          u.ty = this.hLines[Math.floor(rnd() * this.hLines.length)]
        }
      } else {
        // Manhattan movement: one axis at a time, like street traffic.
        const step = u.speed * ctx.dt * 60 * 0.016
        if (Math.abs(dx) > 0.005) u.x += Math.sign(dx) * Math.min(step, Math.abs(dx))
        else u.y += Math.sign(dy) * Math.min(step, Math.abs(dy))
      }
    }
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    this.ensureLayout()
    const base = this.ensureBase(ctx, inner)
    p.image(base, inner.x, inner.y)

    const X = (u: number) => inner.x + u * inner.w
    const Y = (u: number) => inner.y + u * inner.h

    p.push()
    // Sector labels.
    p.noStroke()
    p.textSize(10)
    p.textAlign(p.LEFT, p.TOP)
    fillHex(p, palette.fgDim, 190)
    p.text('SECTOR-7', X(0.06), Y(0.06))
    p.text('SECTOR-11', X(0.06), Y(0.8))
    fillHex(p, palette.warn, 200)
    p.text('ZONA RESTRINGIDA', X(0.56), Y(0.08))

    // Target ping: expanding rings + crosshair.
    const ping = (ctx.t * 0.6) % 1
    enableGlow(ctx, palette.danger, 0.7)
    strokeHex(p, palette.danger, (1 - ping) * 220)
    p.strokeWeight(1.5)
    p.noFill()
    p.circle(X(this.target.x), Y(this.target.y), 8 + ping * inner.w * 0.12)
    strokeHex(p, palette.danger, 230)
    const cx = X(this.target.x)
    const cy = Y(this.target.y)
    p.line(cx - 14, cy, cx - 5, cy)
    p.line(cx + 5, cy, cx + 14, cy)
    p.line(cx, cy - 14, cx, cy - 5)
    p.line(cx, cy + 5, cx, cy + 14)
    disableGlow(ctx)
    p.noStroke()
    fillHex(p, palette.danger)
    p.textSize(9)
    p.text('OBJETIVO-PRIME', cx + 16, cy - 12)

    // Patrol units.
    p.textSize(8)
    for (const u of this.units) {
      const ux = X(u.x)
      const uy = Y(u.y)
      const col = u.hostile ? palette.danger : palette.ok
      fillHex(p, col, 235)
      p.noStroke()
      if (u.hostile) {
        p.triangle(ux, uy - 4.5, ux - 4, uy + 3.5, ux + 4, uy + 3.5)
      } else {
        p.rect(ux - 3, uy - 3, 6, 6)
      }
      fillHex(p, col, 170)
      p.text(u.label, ux + 6, uy - 6)
      // Heading tick toward the waypoint.
      strokeHex(p, col, 140)
      p.line(ux, uy, ux + Math.sign(u.tx - u.x) * 8, uy)
    }

    // Scale + coordinates strip, bottom of the map.
    p.noStroke()
    fillHex(p, palette.fgDim, 200)
    p.textSize(9)
    p.textAlign(p.LEFT, p.BOTTOM)
    p.text(
      `ESC 1:2500 · MODO: ${this.mode === 'chase' ? 'PERSECUCIÓN' : 'PATRULLA'} · UNIDADES: ${this.units.length}`,
      inner.x + 4,
      inner.y + inner.h - 4,
    )
    p.textAlign(p.RIGHT, p.BOTTOM)
    p.text(
      `${(19.43 + this.target.y).toFixed(4)}N ${(99.13 + this.target.x).toFixed(4)}W`,
      inner.x + inner.w - 4,
      inner.y + inner.h - 4,
    )
    p.pop()
  }
}
