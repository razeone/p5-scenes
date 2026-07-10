/**
 * BoardWindows.ts — Motherboard assembly line for ORÁCULO-1.
 *
 * MotherboardWindow plays a timeline: the PCB appears, copper buses
 * route themselves in, then every component is installed one at a time —
 * fly-in, inspection brackets + spec callout, settle — and when the
 * manifest is complete the board powers on: a bright wave sweeps out
 * from the CPU, traces carry pulses, and everything holds in an
 * energized ambient state ("full bright").
 *
 * BoardManifestWindow is the side checklist: every station with its
 * install status, driven directly from the board's timeline.
 *
 * Director cues: restart the line, skip to the next station, jump to
 * power-on, toggle an x-ray trace view, and a short-circuit fault.
 */

import { OSWindow, type OSWindowOpts } from './OSWindow'
import type { OSContext } from '../core/context'
import { fillHex, strokeHex } from '../core/context'
import type { Rect } from '../core/geometry'
import { enableGlow, disableGlow } from '../fx/Effects'
import type { LogLevel } from './TextStream'

/** Ambient chatter for the assembly-line log column. */
export const BOARD_FEED: { text: string; level: LogLevel }[] = [
  { text: 'PAR DE APRIETE 0.6NM — tornillo 4/9 OK', level: 'dim' },
  { text: 'PASTA TÉRMICA aplicada — 0.32g patrón X', level: 'info' },
  { text: 'CONTINUIDAD verificada — malla GND < 0.2Ω', level: 'ok' },
  { text: 'ORÁCULO-1 asentado — 4471 contactos OK', level: 'ok' },
  { text: 'CÁMARA AOI — inspección óptica sin defectos', level: 'info' },
  { text: 'ROM VIGILANCIA soldada — firma verificada', level: 'warn' },
  { text: 'PERFIL DE HORNO — pico 245°C / 38s', level: 'dim' },
  { text: 'ESD: operario 7 — pulsera conectada', level: 'ok' },
  { text: 'LOTE 0447 — unidad 118/500 en línea', level: 'info' },
  { text: 'CANAL ENCUBIERTO — antena integrada en capa 6', level: 'danger' },
  { text: 'FLUX residual — lavado iónico completo', level: 'dim' },
  { text: 'ETIQUETA RFID adherida — rastreo total', level: 'warn' },
]

// ---------------------------------------------------------------------
// Component stations
// ---------------------------------------------------------------------

/** A station in the assembly timeline. Sites are 0..1 of the board. */
export interface Station {
  name: string
  spec: string
  site: Rect
  /** Danger-tinted (the regime's own additions). */
  spy?: boolean
}

export const STATIONS: Station[] = [
  { name: 'SUSTRATO PCB', spec: 'FR-4 · 8 CAPAS · 305×244MM', site: { x: 0, y: 0, w: 1, h: 1 } },
  { name: 'BUS DE COBRE', spec: '35µM · IMPEDANCIA 90Ω', site: { x: 0, y: 0, w: 1, h: 1 } },
  { name: 'PANEL E/S', spec: 'USB-C ×2 · RJ45 10G · TODO CIFRADO', site: { x: 0.015, y: 0.06, w: 0.055, h: 0.46 } },
  { name: 'VRM 12+2 FASES', spec: 'DRMOS 90A · BOBINAS R30', site: { x: 0.13, y: 0.06, w: 0.31, h: 0.09 } },
  { name: 'ZÓCALO LGA-4471', spec: '4471 CONTACTOS · CARGA 28KG', site: { x: 0.17, y: 0.19, w: 0.22, h: 0.3 } },
  { name: 'CPU ORÁCULO-1', spec: '3NM · 4.31GHZ · NPU 96 TOPS', site: { x: 0.2, y: 0.235, w: 0.16, h: 0.21 } },
  { name: 'DDR5 ×4', spec: '6400MT/S · ECC · DOBLE CANAL', site: { x: 0.46, y: 0.05, w: 0.15, h: 0.5 } },
  { name: 'CHIPSET CENTINELA', spec: 'PCH · DMI ×8 · TELEMETRÍA', site: { x: 0.47, y: 0.6, w: 0.13, h: 0.17 }, spy: true },
  { name: 'M.2 NVME', spec: 'PCIE 5.0 ×4 · 4TB · AUTOCIFRADO', site: { x: 0.17, y: 0.575, w: 0.26, h: 0.055 } },
  { name: 'PCIE 5.0 ×16', spec: 'BIFURCACIÓN ×8/×8 · 128GB/S', site: { x: 0.12, y: 0.7, w: 0.55, h: 0.16 } },
  { name: 'SATA-III ×4', spec: '6GB/S · HOT-SWAP', site: { x: 0.86, y: 0.6, w: 0.1, h: 0.14 } },
  { name: 'ALIMENTACIÓN', spec: 'ATX 24-PIN + EPS 8-PIN', site: { x: 0.68, y: 0.015, w: 0.3, h: 0.5 } },
  { name: 'PILA CR2032', spec: '3V · RELOJ DEL RÉGIMEN', site: { x: 0.71, y: 0.79, w: 0.09, h: 0.14 } },
  { name: 'ROM VIGILANCIA', spec: 'FIRMWARE FIRMADO · CANAL OCULTO', site: { x: 0.655, y: 0.62, w: 0.07, h: 0.1 }, spy: true },
  { name: 'CONDENSADORES', spec: 'SÓLIDOS 12K HORAS · 105°C', site: { x: 0.055, y: 0.62, w: 0.09, h: 0.3 } },
]

// Station pacing (fly-in + dwell) lives in config.scenes.board.

/** Copper traces: Manhattan runs between station centers (by index). */
const TRACES: [number, number][] = [
  [5, 6], // cpu → dimm
  [5, 3], // cpu → vrm
  [5, 9], // cpu → pcie
  [5, 7], // cpu → chipset (dmi)
  [7, 8], // chipset → m.2
  [7, 10], // chipset → sata
  [7, 13], // chipset → rom
  [7, 2], // chipset → i/o
  [11, 3], // power → vrm
  [12, 13], // battery → rom
  [7, 9], // chipset → pcie 2
  [2, 5], // i/o → cpu
]

function center(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

// ---------------------------------------------------------------------
// MotherboardWindow
// ---------------------------------------------------------------------

export class MotherboardWindow extends OSWindow {
  private startAt = -1 // timeline zero (stamped on first update)
  private stepStart = -1
  private idx = 0 // current station being installed
  private powerStart = -1 // >=0 → power-on finale running
  private xray = false
  private fault: { station: number; until: number } | null = null
  private pendingFault = false
  private pendingPower = false
  private pendingSkips = 0

  /** Replay the whole assembly from the bare substrate. */
  restart(): void {
    this.startAt = -1
    this.stepStart = -1
    this.idx = 0
    this.powerStart = -1
    this.fault = null
    this.xray = false
  }

  /** Jump to the next station immediately (queues if clicked fast). */
  skip(): void {
    this.pendingSkips++
  }

  /** Skip the rest of the line and power the board on. */
  powerOn(): void {
    this.pendingPower = true
  }

  /** Toggle x-ray view: copper bright, components ghosted. */
  toggleXray(): boolean {
    this.xray = !this.xray
    return this.xray
  }

  /** Short-circuit on a random installed component. */
  shortCircuit(): void {
    this.pendingFault = true
  }

  /** Index of the station currently on the bench (manifest view). */
  get currentIndex(): number {
    return this.idx
  }

  get powered(): boolean {
    return this.powerStart >= 0
  }

  update(ctx: OSContext): void {
    const bc = ctx.config.scenes.board
    const step = bc.flyInSeconds + bc.dwellSeconds
    if (this.startAt < 0) {
      this.startAt = ctx.t
      this.stepStart = ctx.t
    }
    if (this.pendingSkips > 0) {
      if (this.powerStart < 0) {
        this.idx = Math.min(this.idx + this.pendingSkips, STATIONS.length)
        this.stepStart = ctx.t
        if (this.idx >= STATIONS.length && bc.autoPowerOn) this.powerStart = ctx.t
      }
      this.pendingSkips = 0
    }
    if (this.pendingPower) {
      if (this.powerStart < 0) {
        this.idx = STATIONS.length
        this.powerStart = ctx.t
      }
      this.pendingPower = false
    }
    if (this.pendingFault) {
      const limit = Math.min(this.idx, STATIONS.length - 1)
      if (limit >= 2) {
        // Only physical components (skip substrate/copper).
        const station = 2 + Math.floor(Math.random() * (limit - 1))
        this.fault = { station, until: ctx.t + bc.faultSeconds }
      }
      this.pendingFault = false
    }
    // Auto-advance the line; when the manifest completes, power on
    // (unless the config leaves the finale to the director).
    if (this.powerStart < 0 && this.idx < STATIONS.length && ctx.t - this.stepStart > step) {
      this.idx++
      this.stepStart = ctx.t
      if (this.idx >= STATIONS.length && bc.autoPowerOn) this.powerStart = ctx.t
    }
    if (this.fault && ctx.t > this.fault.until) this.fault = null
  }

  // --- Drawing -----------------------------------------------------------

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    const footerH = 20
    const board: Rect = {
      x: inner.x + 6,
      y: inner.y + 4,
      w: inner.w - 12,
      h: inner.h - footerH - 8,
    }
    const X = (u: number) => board.x + u * board.w
    const Y = (u: number) => board.y + u * board.h
    const R = (r: Rect): Rect => ({ x: X(r.x), y: Y(r.y), w: r.w * board.w, h: r.h * board.h })

    const bc = ctx.config.scenes.board
    const flyIn = bc.flyInSeconds
    const stepT = this.stepStart < 0 ? 0 : ctx.t - this.stepStart
    const powered = this.powerStart >= 0
    const waveT = powered ? ctx.t - this.powerStart : 0
    const cpuC = center(STATIONS[5].site)
    // Power wave radius in board fractions (waveSeconds to cross).
    const waveR = powered ? (waveT / bc.waveSeconds) * 1.5 : 0

    p.push()

    // Per-station visibility/brightness.
    const stationAlpha = (i: number): number => {
      if (i > this.idx) return 0
      let a: number
      if (i === this.idx && !powered) {
        a = Math.min(1, stepT / flyIn) // flying in
      } else {
        a = this.xray ? 0.3 : 0.72 // settled ambient
      }
      if (powered) {
        const d = Math.hypot(center(STATIONS[i].site).x - cpuC.x, center(STATIONS[i].site).y - cpuC.y)
        if (d < waveR) a = 1
      }
      return a
    }

    // 0 — substrate (also the canvas for everything else).
    if (this.idx >= 0) this.drawSubstrate(ctx, board, stationAlpha(0))

    // 1 — copper buses, with a line-drawing reveal on their own step.
    if (this.idx >= 1) {
      const prog =
        this.idx === 1 && !powered
          ? Math.min(1, stepT / ((flyIn + bc.dwellSeconds) * 0.9))
          : 1
      this.drawTraces(ctx, X, Y, prog, waveR, cpuC, powered)
    }

    // 2.. — components.
    for (let i = 2; i <= Math.min(this.idx, STATIONS.length - 1); i++) {
      const a = stationAlpha(i)
      if (a <= 0) continue
      const site = R(STATIONS[i].site)
      // Fly-in: drop from slightly above with a lift-shadow.
      let dy = 0
      if (i === this.idx && !powered) dy = -(1 - Math.min(1, stepT / flyIn)) * 26
      const lit = powered && a >= 1
      if (lit) enableGlow(ctx, STATIONS[i].spy ? palette.danger : palette.fg, 0.45)
      this.drawStation(ctx, i, { ...site, y: site.y + dy }, a * 255, lit)
      if (lit) disableGlow(ctx)
    }

    // Inspection callout on the current station.
    if (!powered && this.idx < STATIONS.length && stepT > flyIn * 0.7) {
      this.drawCallout(ctx, board, R, this.idx, stepT)
    }

    // Fault: sparks + flash over the failed station.
    if (this.fault) this.drawFault(ctx, R(STATIONS[this.fault.station].site))

    // Power-on finale: expanding ring + banner + ambient shimmer.
    if (powered) this.drawPowerOn(ctx, board, X, Y, cpuC, waveT, waveR)

    // Footer: progress bar + state line.
    this.drawFooter(ctx, inner, footerH, powered, waveT)

    p.pop()
  }

  // --- Substrate + copper -------------------------------------------------

  private drawSubstrate(ctx: OSContext, b: Rect, a01: number): void {
    const { p, palette } = ctx
    const A = a01 * 255
    p.noStroke()
    fillHex(p, palette.grid, 0.16 * A)
    p.rect(b.x, b.y, b.w, b.h, 6)
    strokeHex(p, palette.fgDim, 0.75 * A)
    p.strokeWeight(1)
    p.noFill()
    p.rect(b.x, b.y, b.w, b.h, 6)
    // Mounting holes (ATX pattern-ish).
    for (const [ux, uy] of [
      [0.02, 0.03], [0.5, 0.03], [0.975, 0.03],
      [0.02, 0.5], [0.55, 0.5], [0.975, 0.55],
      [0.02, 0.965], [0.5, 0.965], [0.975, 0.965],
    ]) {
      const hx = b.x + ux * b.w
      const hy = b.y + uy * b.h
      strokeHex(p, palette.fgDim, 0.7 * A)
      p.circle(hx, hy, 9)
      strokeHex(p, palette.fgDim, 0.4 * A)
      p.circle(hx, hy, 4)
    }
    // Silkscreen.
    p.noStroke()
    fillHex(p, palette.fgDim, 0.7 * A)
    p.textSize(9)
    p.textAlign(p.LEFT, p.TOP)
    p.text('EBG-ATX 0447 REV C0', b.x + b.w * 0.03, b.y + b.h * 0.945)
    p.textAlign(p.RIGHT, p.TOP)
    p.text('HECHO EN EL DISTRITO 4 — PROPIEDAD DEL ESTADO', b.x + b.w * 0.97, b.y + b.h * 0.945)
  }

  private drawTraces(
    ctx: OSContext,
    X: (u: number) => number,
    Y: (u: number) => number,
    prog: number,
    waveR: number,
    cpuC: { x: number; y: number },
    powered: boolean,
  ): void {
    const { p, palette } = ctx
    const baseA = this.xray ? 230 : 95
    TRACES.forEach(([ai, bi], ti) => {
      const a = center(STATIONS[ai].site)
      const b = center(STATIONS[bi].site)
      const mid = ti % 2 === 0 ? { x: b.x, y: a.y } : { x: a.x, y: b.y }
      // Parallel bus: 3 offset strands per net.
      for (let s = -1; s <= 1; s++) {
        const off = s * 0.006
        const pts = [
          { x: a.x + off, y: a.y + off },
          { x: mid.x + off, y: mid.y + off },
          { x: b.x + off, y: b.y + off },
        ]
        // Line-drawing reveal: cut the polyline at `prog` of total length.
        const l1 = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
        const l2 = Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y)
        const cut = prog * (l1 + l2)
        const lit = powered && Math.hypot(a.x - cpuC.x, a.y - cpuC.y) < waveR
        strokeHex(p, lit ? palette.accent : palette.fgDim, lit ? 170 : baseA)
        p.strokeWeight(s === 0 ? 1.4 : 0.8)
        p.noFill()
        if (cut >= l1) {
          p.line(X(pts[0].x), Y(pts[0].y), X(pts[1].x), Y(pts[1].y))
          const f = l2 === 0 ? 1 : Math.min(1, (cut - l1) / l2)
          p.line(X(pts[1].x), Y(pts[1].y), X(pts[1].x + (pts[2].x - pts[1].x) * f), Y(pts[1].y + (pts[2].y - pts[1].y) * f))
        } else if (l1 > 0) {
          const f = cut / l1
          p.line(X(pts[0].x), Y(pts[0].y), X(pts[0].x + (pts[1].x - pts[0].x) * f), Y(pts[0].y + (pts[1].y - pts[0].y) * f))
        }
      }
      // Via at the bend.
      if (prog >= 1) {
        p.noStroke()
        fillHex(p, palette.fgDim, baseA + 40)
        p.circle(X(mid.x), Y(mid.y), 3.5)
      }
      // Power pulses run the bus once the board is on.
      if (powered && prog >= 1) {
        const l1 = Math.hypot(mid.x - a.x, mid.y - a.y)
        const l2 = Math.hypot(b.x - mid.x, b.y - mid.y)
        const total = l1 + l2 || 1
        const t01 =
          (ctx.t * 0.35 * ctx.config.scenes.board.pulseSpeed + ti * 0.17) % 1
        const d = t01 * total
        let px: number
        let py: number
        if (d <= l1) {
          const f = l1 === 0 ? 0 : d / l1
          px = a.x + (mid.x - a.x) * f
          py = a.y + (mid.y - a.y) * f
        } else {
          const f = l2 === 0 ? 0 : (d - l1) / l2
          px = mid.x + (b.x - mid.x) * f
          py = mid.y + (b.y - mid.y) * f
        }
        enableGlow(ctx, palette.accent, 0.6)
        p.noStroke()
        fillHex(p, palette.accent, 235)
        p.rect(X(px) - 2, Y(py) - 2, 4, 4)
        disableGlow(ctx)
      }
    })
  }

  // --- Component renderers -------------------------------------------------

  private drawStation(ctx: OSContext, i: number, r: Rect, A: number, lit: boolean): void {
    const { p, palette } = ctx
    const st = STATIONS[i]
    const col = st.spy ? palette.danger : palette.fg
    const dim = st.spy ? palette.danger : palette.fgDim
    if (this.xray && !lit) A *= 0.5
    switch (i) {
      case 2: { // I/O panel
        strokeHex(p, dim, 0.8 * A)
        p.strokeWeight(1)
        p.noFill()
        p.rect(r.x, r.y, r.w, r.h, 2)
        const ports = 7
        for (let k = 0; k < ports; k++) {
          const py = r.y + 6 + (k * (r.h - 12)) / ports
          const ph = ((r.h - 12) / ports) * 0.6
          if (k === 2) {
            strokeHex(p, col, A) // RJ45, brighter
            p.rect(r.x + r.w * 0.2, py, r.w * 0.6, ph)
          } else if (k >= 5) {
            p.noStroke()
            fillHex(p, dim, 0.8 * A) // audio jacks
            p.circle(r.x + r.w / 2, py + ph / 2, Math.min(ph, r.w * 0.4))
          } else {
            strokeHex(p, dim, 0.9 * A) // USB stack
            p.noFill()
            p.rect(r.x + r.w * 0.25, py, r.w * 0.5, ph * 0.8)
          }
        }
        break
      }
      case 3: { // VRM row: chokes + fets + caps
        const n = 12
        const cw = r.w / n
        for (let k = 0; k < n; k++) {
          const cx = r.x + k * cw
          strokeHex(p, dim, 0.9 * A)
          p.strokeWeight(1)
          p.noFill()
          p.rect(cx + 2, r.y, cw - 4, r.h * 0.62, 1.5)
          p.noStroke()
          fillHex(p, dim, 0.5 * A)
          p.textSize(6.5)
          p.textAlign(p.CENTER, p.CENTER)
          p.text('R30', cx + cw / 2, r.y + r.h * 0.3)
          fillHex(p, dim, 0.7 * A) // mosfet below
          p.rect(cx + cw * 0.25, r.y + r.h * 0.7, cw * 0.5, r.h * 0.24)
        }
        break
      }
      case 4: { // CPU socket: frame + pin field + lever
        strokeHex(p, col, A)
        p.strokeWeight(1.2)
        p.noFill()
        p.rect(r.x, r.y, r.w, r.h)
        strokeHex(p, dim, 0.6 * A)
        p.strokeWeight(1)
        p.rect(r.x + r.w * 0.1, r.y + r.h * 0.08, r.w * 0.8, r.h * 0.84)
        p.noStroke()
        fillHex(p, dim, 0.45 * A)
        for (let gy = r.y + r.h * 0.14; gy < r.y + r.h * 0.88; gy += 5) {
          for (let gx = r.x + r.w * 0.15; gx < r.x + r.w * 0.85; gx += 5) {
            p.rect(gx, gy, 1.6, 1.6)
          }
        }
        strokeHex(p, col, 0.9 * A) // retention lever
        p.line(r.x + r.w + 3, r.y + r.h * 0.25, r.x + r.w + 3, r.y + r.h * 0.8)
        break
      }
      case 5: { // CPU: lid + substrate edge
        p.noStroke()
        fillHex(p, palette.grid, 0.9 * A)
        p.rect(r.x, r.y, r.w, r.h, 2)
        strokeHex(p, col, A)
        p.strokeWeight(1.2)
        p.noFill()
        p.rect(r.x, r.y, r.w, r.h, 2)
        strokeHex(p, dim, 0.8 * A)
        p.strokeWeight(1)
        p.rect(r.x + r.w * 0.14, r.y + r.h * 0.16, r.w * 0.72, r.h * 0.68, 2)
        p.noStroke()
        fillHex(p, col, A)
        p.textSize(9)
        p.textAlign(p.CENTER, p.CENTER)
        p.text('ORÁCULO-1', r.x + r.w / 2, r.y + r.h * 0.42)
        fillHex(p, dim, 0.85 * A)
        p.textSize(7)
        p.text('EBG · 3NM · LOTE 0447', r.x + r.w / 2, r.y + r.h * 0.58)
        // Gold triangle pin-1 marker.
        fillHex(p, palette.warn, 0.9 * A)
        p.triangle(r.x + 3, r.y + r.h - 3, r.x + 9, r.y + r.h - 3, r.x + 3, r.y + r.h - 9)
        break
      }
      case 6: { // DIMM ×4 with latches; last one populated
        const n = 4
        const sw = r.w / n
        for (let k = 0; k < n; k++) {
          const sx = r.x + k * sw + sw * 0.3
          const populated = k === n - 1
          strokeHex(p, populated ? col : dim, (populated ? 1 : 0.8) * A)
          p.strokeWeight(populated ? 1.4 : 1)
          p.noFill()
          p.rect(sx, r.y, sw * 0.34, r.h)
          // Key notch + end latches.
          p.line(sx, r.y + r.h * 0.55, sx + sw * 0.34, r.y + r.h * 0.55)
          strokeHex(p, dim, 0.9 * A)
          p.rect(sx - 2, r.y - 4, sw * 0.34 + 4, 4)
          p.rect(sx - 2, r.y + r.h, sw * 0.34 + 4, 4)
          if (populated) {
            // Module with DRAM chips.
            p.noStroke()
            fillHex(p, palette.grid, A)
            p.rect(sx + 3, r.y + 3, sw * 0.34 - 6, r.h - 6)
            fillHex(p, dim, 0.9 * A)
            for (let cy = r.y + 8; cy < r.y + r.h - 12; cy += (r.h - 20) / 5) {
              p.rect(sx + 5, cy, sw * 0.34 - 10, (r.h - 20) / 8)
            }
          }
        }
        break
      }
      case 7: { // Chipset: finned heatsink
        strokeHex(p, col, A)
        p.strokeWeight(1.2)
        p.noFill()
        p.rect(r.x, r.y, r.w, r.h, 3)
        strokeHex(p, dim, 0.75 * A)
        p.strokeWeight(1)
        for (let k = 1; k < 5; k++) {
          const inset = k * Math.min(r.w, r.h) * 0.09
          p.rect(r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2, 2)
        }
        p.noStroke()
        fillHex(p, col, A)
        p.textSize(7.5)
        p.textAlign(p.CENTER, p.CENTER)
        p.text('CENTINELA', r.x + r.w / 2, r.y + r.h / 2)
        break
      }
      case 8: { // M.2: slot rail + SSD stick
        strokeHex(p, dim, 0.8 * A)
        p.strokeWeight(1)
        p.noFill()
        p.rect(r.x, r.y + r.h * 0.25, r.w, r.h * 0.5)
        p.noStroke()
        fillHex(p, palette.grid, 0.95 * A)
        p.rect(r.x + r.w * 0.06, r.y + r.h * 0.12, r.w * 0.86, r.h * 0.76, 2)
        strokeHex(p, col, 0.95 * A)
        p.noFill()
        p.rect(r.x + r.w * 0.06, r.y + r.h * 0.12, r.w * 0.86, r.h * 0.76, 2)
        p.noStroke()
        fillHex(p, dim, 0.9 * A) // controller + nand
        p.rect(r.x + r.w * 0.12, r.y + r.h * 0.22, r.w * 0.14, r.h * 0.56)
        for (let k = 0; k < 3; k++) {
          p.rect(r.x + r.w * (0.34 + k * 0.18), r.y + r.h * 0.22, r.w * 0.14, r.h * 0.56)
        }
        fillHex(p, col, 0.8 * A) // retention screw
        p.circle(r.x + r.w * 0.965, r.y + r.h * 0.5, 5)
        break
      }
      case 9: { // PCIe ×16 ×2
        for (let k = 0; k < 2; k++) {
          const sy = r.y + k * r.h * 0.62
          const sw2 = k === 0 ? r.w : r.w * 0.76
          strokeHex(p, k === 0 ? col : dim, (k === 0 ? 1 : 0.8) * A)
          p.strokeWeight(k === 0 ? 1.3 : 1)
          p.noFill()
          p.rect(r.x, sy, sw2, r.h * 0.24)
          // Key notch + segment divisions.
          p.line(r.x + sw2 * 0.12, sy, r.x + sw2 * 0.12, sy + r.h * 0.24)
          strokeHex(p, dim, 0.5 * A)
          for (let gx = r.x + sw2 * 0.16; gx < r.x + sw2 - 4; gx += 7) {
            p.line(gx, sy + 3, gx, sy + r.h * 0.24 - 3)
          }
          // Retention clip.
          strokeHex(p, dim, 0.9 * A)
          p.rect(r.x + sw2 - 2, sy + r.h * 0.05, 6, r.h * 0.14)
        }
        break
      }
      case 10: { // SATA ×4: L-shaped ports in a 2×2 block
        const cw = r.w / 2
        const ch = r.h / 2
        for (let k = 0; k < 4; k++) {
          const cx = r.x + (k % 2) * cw
          const cy = r.y + Math.floor(k / 2) * ch
          strokeHex(p, dim, 0.9 * A)
          p.strokeWeight(1)
          p.noFill()
          p.rect(cx + 2, cy + 2, cw - 6, ch - 8, 1.5)
          strokeHex(p, col, 0.8 * A)
          p.line(cx + 6, cy + ch * 0.5, cx + cw * 0.6, cy + ch * 0.5)
          p.line(cx + cw * 0.6, cy + ch * 0.5, cx + cw * 0.6, cy + ch * 0.35)
        }
        break
      }
      case 11: { // ATX 24-pin (right edge) + EPS 8-pin (top-left of site)
        const atx: Rect = { x: r.x + r.w * 0.86, y: r.y + r.h * 0.33, w: r.w * 0.11, h: r.h * 0.6 }
        strokeHex(p, col, A)
        p.strokeWeight(1.2)
        p.noFill()
        p.rect(atx.x, atx.y, atx.w, atx.h, 2)
        p.noStroke()
        fillHex(p, dim, 0.8 * A)
        for (let gy = 0; gy < 12; gy++) {
          for (let gx = 0; gx < 2; gx++) {
            p.rect(atx.x + 3 + gx * (atx.w / 2), atx.y + 3 + gy * ((atx.h - 6) / 12), atx.w / 2 - 5, (atx.h - 6) / 12 - 2)
          }
        }
        const eps: Rect = { x: r.x, y: r.y, w: r.w * 0.3, h: r.h * 0.08 }
        strokeHex(p, col, 0.9 * A)
        p.noFill()
        p.rect(eps.x, eps.y, eps.w, eps.h, 2)
        p.noStroke()
        fillHex(p, dim, 0.8 * A)
        for (let gx = 0; gx < 4; gx++) {
          for (let gy = 0; gy < 2; gy++) {
            p.rect(eps.x + 2 + gx * (eps.w / 4), eps.y + 2 + gy * (eps.h / 2), eps.w / 4 - 4, eps.h / 2 - 4)
          }
        }
        break
      }
      case 12: { // CR2032 battery in holder
        const cx = r.x + r.w / 2
        const cy = r.y + r.h / 2
        const d = Math.min(r.w, r.h) * 0.9
        strokeHex(p, dim, 0.8 * A)
        p.strokeWeight(1)
        p.noFill()
        p.circle(cx, cy, d + 6) // holder
        p.noStroke()
        fillHex(p, palette.grid, A)
        p.circle(cx, cy, d)
        strokeHex(p, col, A)
        p.noFill()
        p.circle(cx, cy, d)
        p.noStroke()
        fillHex(p, dim, 0.9 * A)
        p.textSize(7)
        p.textAlign(p.CENTER, p.CENTER)
        p.text('CR2032', cx, cy - 4)
        p.text('+3V', cx, cy + 6)
        // Holder clip.
        strokeHex(p, dim, 0.9 * A)
        p.line(cx - d * 0.3, cy - d * 0.62, cx + d * 0.3, cy - d * 0.62)
        break
      }
      case 13: { // Surveillance ROM: 8-pin chip, danger
        p.noStroke()
        fillHex(p, palette.grid, A)
        p.rect(r.x, r.y, r.w, r.h, 1.5)
        strokeHex(p, col, A)
        p.strokeWeight(1.2)
        p.noFill()
        p.rect(r.x, r.y, r.w, r.h, 1.5)
        strokeHex(p, col, 0.8 * A)
        p.strokeWeight(1)
        for (let k = 0; k < 4; k++) {
          const py = r.y + r.h * (0.2 + k * 0.2)
          p.line(r.x - 4, py, r.x, py)
          p.line(r.x + r.w, py, r.x + r.w + 4, py)
        }
        p.noStroke()
        fillHex(p, col, A)
        p.textSize(6.5)
        p.textAlign(p.CENTER, p.CENTER)
        p.text('ROM-VIG', r.x + r.w / 2, r.y + r.h * 0.36)
        fillHex(p, col, 0.75 * A)
        p.text('W25-EBG', r.x + r.w / 2, r.y + r.h * 0.66)
        // Pin-1 dot.
        fillHex(p, col, A)
        p.circle(r.x + 4, r.y + 4, 3)
        break
      }
      case 14: { // Capacitor bank
        const cols = 3
        const rows = 5
        for (let k = 0; k < cols * rows; k++) {
          const cx = r.x + ((k % cols) + 0.5) * (r.w / cols)
          const cy = r.y + (Math.floor(k / cols) + 0.5) * (r.h / rows)
          const d = Math.min(r.w / cols, r.h / rows) * 0.62
          strokeHex(p, dim, 0.9 * A)
          p.strokeWeight(1)
          p.noFill()
          p.circle(cx, cy, d)
          // Vent cross on top.
          strokeHex(p, dim, 0.6 * A)
          p.line(cx - d * 0.25, cy, cx + d * 0.25, cy)
          p.line(cx, cy - d * 0.25, cx, cy + d * 0.25)
        }
        break
      }
    }
  }

  // --- Inspection callout ---------------------------------------------------

  private drawCallout(
    ctx: OSContext,
    board: Rect,
    R: (r: Rect) => Rect,
    i: number,
    stepT: number,
  ): void {
    const { p, palette } = ctx
    const st = STATIONS[i]
    const site = R(st.site)
    const col = st.spy ? palette.danger : palette.accent
    const blink = Math.floor(ctx.t * 4) % 4 !== 3

    // Bracket corners around the site.
    enableGlow(ctx, col, 0.6)
    strokeHex(p, col, blink ? 235 : 130)
    p.strokeWeight(1.5)
    p.noFill()
    const L = Math.min(14, site.w * 0.3, site.h * 0.3)
    const g = 5
    const corners: [number, number, number, number][] = [
      [site.x - g, site.y - g, 1, 1],
      [site.x + site.w + g, site.y - g, -1, 1],
      [site.x - g, site.y + site.h + g, 1, -1],
      [site.x + site.w + g, site.y + site.h + g, -1, -1],
    ]
    for (const [cx, cy, sx, sy] of corners) {
      p.line(cx, cy, cx + L * sx, cy)
      p.line(cx, cy, cx, cy + L * sy)
    }
    disableGlow(ctx)

    // Scanning ring sweeping the component during the dwell.
    const dwellT = Math.max(0, stepT - ctx.config.scenes.board.flyInSeconds)
    const ring = (dwellT * 0.8) % 1
    strokeHex(p, col, (1 - ring) * 160)
    p.strokeWeight(1)
    const ccx = site.x + site.w / 2
    const ccy = site.y + site.h / 2
    p.circle(ccx, ccy, Math.max(site.w, site.h) * (0.4 + ring * 0.8))

    // Label box with leader line, kept inside the board.
    const bw = 210
    const bh = 34
    const rightSide = ccx < board.x + board.w / 2
    const bx = rightSide
      ? Math.min(site.x + site.w + 26, board.x + board.w - bw - 4)
      : Math.max(site.x - 26 - bw, board.x + 4)
    const by = Math.min(Math.max(ccy - bh / 2, board.y + 4), board.y + board.h - bh - 4)
    strokeHex(p, col, 170)
    p.line(rightSide ? site.x + site.w + g : site.x - g, ccy, rightSide ? bx : bx + bw, by + bh / 2)
    p.noStroke()
    fillHex(p, palette.bg, 225)
    p.rect(bx, by, bw, bh)
    strokeHex(p, col, 210)
    p.strokeWeight(1)
    p.noFill()
    p.rect(bx, by, bw, bh)
    p.noStroke()
    fillHex(p, col, 245)
    p.textSize(10)
    p.textAlign(p.LEFT, p.TOP)
    p.text(`${String(i + 1).padStart(2, '0')} · ${st.name}`, bx + 6, by + 5)
    fillHex(p, palette.fgDim, 220)
    p.textSize(8)
    p.text(st.spec, bx + 6, by + 19)
  }

  // --- Fault + power-on ------------------------------------------------------

  private drawFault(ctx: OSContext, site: Rect): void {
    const { p, palette } = ctx
    const cx = site.x + site.w / 2
    const cy = site.y + site.h / 2
    // Flash pulses continuously; sparks jump every frame.
    const pulse = 0.6 + 0.4 * Math.sin(ctx.t * 18)
    p.noStroke()
    fillHex(p, palette.danger, 45 + pulse * 45)
    p.rect(site.x - 4, site.y - 4, site.w + 8, site.h + 8)
    enableGlow(ctx, palette.danger, 0.9)
    strokeHex(p, palette.danger, 200)
    p.strokeWeight(1.5)
    p.noFill()
    p.rect(site.x - 4, site.y - 4, site.w + 8, site.h + 8)
    for (let k = 0; k < 14; k++) {
      const a1 = p.random(p.TWO_PI)
      const r1 = p.random(4, Math.max(site.w, site.h) * 0.5)
      const r2 = r1 + p.random(8, 26)
      strokeHex(p, k % 2 === 0 ? palette.warn : palette.danger, p.random(160, 255))
      p.strokeWeight(p.random(1, 2.2))
      p.line(cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1, cx + Math.cos(a1) * r2, cy + Math.sin(a1) * r2)
    }
    disableGlow(ctx)
    p.noStroke()
    fillHex(p, palette.danger, 170 + pulse * 85)
    p.textSize(9)
    p.textAlign(p.CENTER, p.BOTTOM)
    p.text('⚠ CORTOCIRCUITO', cx, site.y - 10)
  }

  private drawPowerOn(
    ctx: OSContext,
    board: Rect,
    X: (u: number) => number,
    Y: (u: number) => number,
    cpuC: { x: number; y: number },
    waveT: number,
    waveR: number,
  ): void {
    const { p, palette } = ctx
    // Expanding ring while the wave crosses the board.
    if (waveR < 1.6) {
      const rPx = waveR * Math.max(board.w, board.h)
      enableGlow(ctx, palette.accent, 0.8)
      strokeHex(p, palette.accent, Math.max(0, 220 - waveR * 130))
      p.strokeWeight(2)
      p.noFill()
      p.circle(X(cpuC.x), Y(cpuC.y), rPx * 2)
      disableGlow(ctx)
    }
    // Full-bright shimmer once the wave has passed: soft additive wash
    // pulsing over the whole board.
    const ws = ctx.config.scenes.board.waveSeconds
    if (waveT > ws) {
      const pulse = 0.5 + 0.5 * Math.sin(ctx.t * 2.4)
      p.noStroke()
      fillHex(p, palette.glow, 10 + pulse * 14)
      p.rect(board.x, board.y, board.w, board.h, 6)
    }
    // Banner.
    if (waveT > ws + 0.2 && waveT < ws + 6.3) {
      const blink = Math.floor(ctx.t * 3) % 3 !== 2
      const bw = Math.min(380, board.w * 0.7)
      const bh = 38
      const bx = board.x + (board.w - bw) / 2
      const by = board.y + board.h * 0.44
      p.noStroke()
      fillHex(p, palette.bg, 225)
      p.rect(bx, by, bw, bh)
      enableGlow(ctx, palette.ok, 0.8)
      strokeHex(p, palette.ok, blink ? 255 : 150)
      p.strokeWeight(1.5)
      p.noFill()
      p.rect(bx, by, bw, bh)
      disableGlow(ctx)
      p.noStroke()
      fillHex(p, palette.ok, 245)
      p.textSize(12)
      p.textAlign(p.CENTER, p.CENTER)
      p.text('PLACA OPERATIVA — TENSIÓN NOMINAL', bx + bw / 2, by + bh / 2 + 1)
    }
  }

  private drawFooter(
    ctx: OSContext,
    inner: Rect,
    footerH: number,
    powered: boolean,
    waveT: number,
  ): void {
    const { p, palette } = ctx
    const y = inner.y + inner.h - footerH + 4
    const done = Math.min(this.idx, STATIONS.length)
    const frac = powered ? 1 : Math.min(1, done / STATIONS.length)
    // Progress bar.
    strokeHex(p, palette.grid, 180)
    p.strokeWeight(1)
    p.noFill()
    p.rect(inner.x + 2, y, inner.w * 0.4, 8)
    p.noStroke()
    fillHex(p, powered ? palette.ok : palette.accent, 190)
    p.rect(inner.x + 3, y + 1, (inner.w * 0.4 - 2) * frac, 6)
    // State line.
    fillHex(p, palette.fgDim, 210)
    p.textSize(9)
    p.textAlign(p.LEFT, p.BOTTOM)
    const label = powered
      ? waveT < ctx.config.scenes.board.waveSeconds
        ? 'ENERGIZANDO…'
        : `OPERATIVA · 12V ${(11.98 + p.noise(ctx.t) * 0.05).toFixed(2)} · 3.3V OK · POST 00`
      : this.idx < STATIONS.length
        ? `ENSAMBLAJE ${String(done + 1).padStart(2, '0')}/${STATIONS.length} — ${STATIONS[this.idx].name}`
        : 'MANIFIESTO COMPLETO'
    p.text(label, inner.x + inner.w * 0.4 + 12, y + 9)
    if (this.xray) {
      fillHex(p, palette.accent, 220)
      p.textAlign(p.RIGHT, p.BOTTOM)
      p.text('VISTA RAYOS-X', inner.x + inner.w - 2, y + 9)
    }
  }
}

// ---------------------------------------------------------------------
// BoardManifestWindow — the assembly checklist beside the board.
// ---------------------------------------------------------------------

export class BoardManifestWindow extends OSWindow {
  private board: MotherboardWindow

  constructor(o: OSWindowOpts, board: MotherboardWindow) {
    super(o)
    this.board = board
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    const rowH = Math.min(17, (inner.h - 20) / STATIONS.length)
    const idx = this.board.currentIndex
    const powered = this.board.powered
    p.push()
    p.textSize(9)
    STATIONS.forEach((st, i) => {
      const y = inner.y + i * rowH
      const installed = powered || i < idx
      const active = !powered && i === idx
      const col = st.spy
        ? palette.danger
        : installed
          ? palette.ok
          : active
            ? palette.accent
            : palette.fgDim
      p.noStroke()
      if (active && Math.floor(ctx.t * 3) % 2 === 0) {
        fillHex(p, palette.accent, 26)
        p.rect(inner.x, y, inner.w, rowH)
      }
      fillHex(p, col, installed || active ? 235 : 130)
      p.textAlign(p.LEFT, p.CENTER)
      const glyph = installed ? '■' : active ? '▸' : '·'
      p.text(
        `${glyph} ${String(i + 1).padStart(2, '0')} ${st.name}`,
        inner.x + 2,
        y + rowH / 2,
      )
      p.textAlign(p.RIGHT, p.CENTER)
      fillHex(p, col, installed || active ? 150 : 90)
      p.textSize(7.5)
      p.text(installed ? 'INSTALADO' : active ? 'EN CURSO' : 'PENDIENTE', inner.x + inner.w - 2, y + rowH / 2)
      p.textSize(9)
    })
    // Footer state.
    fillHex(p, powered ? palette.ok : palette.fgDim, 220)
    p.textAlign(p.LEFT, p.BOTTOM)
    p.textSize(9)
    p.text(
      powered
        ? '■ TODAS LAS ESTACIONES OPERATIVAS'
        : `PROGRESO ${Math.min(idx, STATIONS.length)}/${STATIONS.length}`,
      inner.x + 2,
      inner.y + inner.h - 2,
    )
    p.pop()
  }
}
