/**
 * ChipWindows.ts — The state's silicon design bureau ("ORÁCULO-1").
 *
 * Three widgets for the chip-design scene:
 *  - DieMapWindow: physical-design floorplan of the surveillance SoC —
 *    pad ring, power straps, functional blocks (cores, NPU, SRAM, and
 *    the in-fiction "MÓDULO ESPÍA"), animated routing pulses per metal
 *    layer, a DRC sweep, and director cues (violation storm, thermal
 *    hotspot, layer cycling, re-route, tapeout sign-off).
 *  - LogicAnalyzerWindow: scrolling digital waveforms — clock, control
 *    bits, hex buses with X-transitions — plus a BIST test-pattern cue.
 *  - FabStatsWindow: wafer map with per-die pass/fail, timing-closure
 *    numbers (FMAX, slack, power, junction temp) and a slack histogram.
 *
 * Like MapWindow, anything static is baked into an offscreen buffer per
 * size/theme; geometry is seeded so retakes show the same chip.
 */

import type p5 from 'p5'
import { OSWindow, type OSWindowOpts } from './OSWindow'
import type { OSContext } from '../core/context'
import { fillHex, strokeHex } from '../core/context'
import type { Rect } from '../core/geometry'
import { enableGlow, disableGlow } from '../fx/Effects'
import type { LogLevel } from './TextStream'

/** Deterministic PRNG so the same die comes back take after take. */
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

/** Stateless integer hash → [0,1). Stable per (seed, index). */
function hash01(seed: number, i: number): number {
  let h = (seed ^ Math.imul(i, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0
  h = (h ^ (h >>> 13)) >>> 0
  return h / 4294967296
}

/** '#rrggbb' → 'rgba(r,g,b,a)' for canvas gradients. */
function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** Ambient chatter for the scene's EDA/foundry log column. */
export const CHIP_FEED: { text: string; level: LogLevel }[] = [
  { text: 'SÍNTESIS RTL — 4.2M celdas mapeadas a 3nm', level: 'info' },
  { text: 'RUTEO GLOBAL — congestión 3.1% / 6 capas', level: 'dim' },
  { text: 'STA esquina SS 0.72V — WNS +12ps', level: 'ok' },
  { text: 'CELDA ESPÍA insertada en NÚCLEO-2 — indetectable', level: 'warn' },
  { text: 'BIST SRAM L2 — 0 fallas / 32MB', level: 'ok' },
  { text: 'ECO aplicado — 214 celdas re-dimensionadas', level: 'info' },
  { text: 'LVS limpio — 0 discrepancias esquemático/layout', level: 'ok' },
  { text: 'CANAL ENCUBIERTO verificado — telemetría a NODO-0', level: 'danger' },
  { text: 'OSCILADOR DE ANILLO — 4.31GHz @ 0.85V', level: 'dim' },
  { text: 'ANÁLISIS IR — caída 18mV en malla VDD', level: 'warn' },
  { text: 'DENSIDAD DE METAL M5 — relleno automático OK', level: 'dim' },
  { text: 'ROM DE VIGILANCIA — huella cifrada grabada', level: 'warn' },
  { text: 'EXTRACCIÓN RC — 12.4M redes anotadas', level: 'info' },
  { text: 'OBLEA 0447 — 91.3% rendimiento proyectado', level: 'ok' },
]

// ---------------------------------------------------------------------
// DieMapWindow
// ---------------------------------------------------------------------

type BlockKind = 'core' | 'npu' | 'sram' | 'crypto' | 'spy' | 'io' | 'pmu'

interface DieBlock {
  x: number // 0..1 of core area
  y: number
  w: number
  h: number
  name: string
  kind: BlockKind
  areaMm: string
}

interface Net {
  ax: number
  ay: number
  bx: number
  by: number
  layer: number // 0..4 → M1..M5
  speed: number
  phase: number
}

interface DrcMarker {
  x: number
  y: number
  rule: string
  until: number
}

const LAYERS = ['M1', 'M2', 'M3', 'M4', 'M5'] as const

const DRC_RULES = ['ESP.M3', 'ANCHO.M1', 'VIA.ENC', 'DENS.M5', 'ANT.RATIO', 'EM.I²']

// Hand-placed floorplan (0..1 of the core area): readable like a real
// SoC die shot instead of random partitions.
const BLOCKS: DieBlock[] = [
  { x: 0.03, y: 0.03, w: 0.27, h: 0.2, name: 'NÚCLEO-0', kind: 'core', areaMm: '2.41' },
  { x: 0.32, y: 0.03, w: 0.27, h: 0.2, name: 'NÚCLEO-1', kind: 'core', areaMm: '2.41' },
  { x: 0.03, y: 0.25, w: 0.27, h: 0.2, name: 'NÚCLEO-2', kind: 'core', areaMm: '2.41' },
  { x: 0.32, y: 0.25, w: 0.27, h: 0.2, name: 'NÚCLEO-3', kind: 'core', areaMm: '2.41' },
  { x: 0.61, y: 0.03, w: 0.36, h: 0.42, name: 'NPU // INFERENCIA', kind: 'npu', areaMm: '8.87' },
  { x: 0.03, y: 0.47, w: 0.43, h: 0.25, name: 'SRAM L2 — 32MB', kind: 'sram', areaMm: '6.02' },
  { x: 0.48, y: 0.47, w: 0.24, h: 0.25, name: 'CRIPTO', kind: 'crypto', areaMm: '3.10' },
  { x: 0.74, y: 0.47, w: 0.23, h: 0.25, name: 'MÓDULO ESPÍA', kind: 'spy', areaMm: '2.96' },
  { x: 0.03, y: 0.74, w: 0.31, h: 0.23, name: 'PHY DDR5', kind: 'io', areaMm: '3.84' },
  { x: 0.36, y: 0.74, w: 0.24, h: 0.23, name: 'SERDES 112G', kind: 'io', areaMm: '2.95' },
  { x: 0.62, y: 0.74, w: 0.17, h: 0.23, name: 'PMU', kind: 'pmu', areaMm: '2.08' },
  { x: 0.81, y: 0.74, w: 0.16, h: 0.23, name: 'ROM VIG.', kind: 'spy', areaMm: '1.97' },
]

export class DieMapWindow extends OSWindow {
  private base: p5.Graphics | null = null
  private baseKey = ''
  private seed: number
  private nets: Net[] = []
  private activeLayer = 2 // M3
  private markers: DrcMarker[] = []
  private pendingDrc = 0
  private drcUntil = -1
  private pendingThermal = false
  private thermal: { x: number; y: number; block: string; until: number } | null = null
  private boostUntil = -1 // re-route burst
  private pendingTapeout = false
  private tapeoutStart = -1
  private bannerUntil = -1

  constructor(o: OSWindowOpts, seed = 20260709) {
    super(o)
    this.seed = seed
  }

  // --- Director cues -----------------------------------------------------

  /** Physical verification blows up: red rule markers all over the die. */
  drcStorm(): void {
    this.pendingDrc = 10 + Math.floor(Math.random() * 8)
  }

  /** A block runs hot: radial bloom + temperature callout. */
  thermalEvent(): void {
    this.pendingThermal = true
  }

  /** Cycle the highlighted routing layer. Returns the new layer name. */
  cycleLayer(): string {
    this.activeLayer = (this.activeLayer + 1) % LAYERS.length
    return LAYERS[this.activeLayer]
  }

  /** Autorouter reruns: nets pick new endpoints, pulses sprint briefly. */
  reroute(): void {
    for (const n of this.nets) this.assignEndpoints(n)
    this.boostUntil = -2 // stamped from ctx.t on next draw
  }

  /** Sign-off sweep + "GDSII FIRMADO" banner. */
  tapeout(): void {
    this.pendingTapeout = true
  }

  // --- Layout ------------------------------------------------------------

  private assignEndpoints(n: Net): void {
    const a = BLOCKS[Math.floor(Math.random() * BLOCKS.length)]
    let b = a
    while (b === a) b = BLOCKS[Math.floor(Math.random() * BLOCKS.length)]
    n.ax = a.x + a.w * (0.2 + Math.random() * 0.6)
    n.ay = a.y + a.h * (0.2 + Math.random() * 0.6)
    n.bx = b.x + b.w * (0.2 + Math.random() * 0.6)
    n.by = b.y + b.h * (0.2 + Math.random() * 0.6)
  }

  private ensureNets(): void {
    if (this.nets.length > 0) return
    const rnd = mulberry32(this.seed)
    for (let i = 0; i < 14; i++) {
      const a = BLOCKS[Math.floor(rnd() * BLOCKS.length)]
      let b = a
      while (b === a) b = BLOCKS[Math.floor(rnd() * BLOCKS.length)]
      this.nets.push({
        ax: a.x + a.w * (0.2 + rnd() * 0.6),
        ay: a.y + a.h * (0.2 + rnd() * 0.6),
        bx: b.x + b.w * (0.2 + rnd() * 0.6),
        by: b.y + b.h * (0.2 + rnd() * 0.6),
        layer: i % LAYERS.length,
        speed: 0.12 + rnd() * 0.2,
        phase: rnd(),
      })
    }
  }

  /** Bake substrate, pad ring, power straps, and block textures. */
  private ensureBase(ctx: OSContext, r: Rect): p5.Graphics {
    const key = `${Math.round(r.w)}x${Math.round(r.h)}:${ctx.palette.label}`
    if (this.base && this.baseKey === key) return this.base
    this.base?.remove()
    this.baseKey = key
    const g = ctx.p.createGraphics(Math.max(2, r.w), Math.max(2, r.h))
    this.base = g
    const rnd = mulberry32(this.seed + 3)
    const pal = ctx.palette
    const PAD = 16 // pad-ring depth in px
    const core = { x: PAD + 6, y: PAD + 6, w: r.w - (PAD + 6) * 2, h: r.h - (PAD + 6) * 2 }
    const X = (u: number) => core.x + u * core.w
    const Y = (u: number) => core.y + u * core.h

    g.background(0, 0)
    g.push()

    // Substrate wash + seal ring.
    const sub = g.color(pal.grid)
    sub.setAlpha(34)
    g.noStroke()
    g.fill(sub)
    g.rect(0, 0, r.w, r.h)
    const seal = g.color(pal.fgDim)
    seal.setAlpha(150)
    g.noFill()
    g.stroke(seal)
    g.strokeWeight(1)
    g.rect(PAD + 2, PAD + 2, r.w - (PAD + 2) * 2, r.h - (PAD + 2) * 2)

    // Pad ring: bond pads on all four edges.
    const padStep = 14
    const padCol = g.color(pal.fgDim)
    g.noStroke()
    for (let x = PAD + padStep; x < r.w - PAD - padStep; x += padStep) {
      padCol.setAlpha(90 + rnd() * 90)
      g.fill(padCol)
      g.rect(x, 3, 8, PAD - 6)
      g.rect(x, r.h - PAD + 3, 8, PAD - 6)
    }
    for (let y = PAD + padStep; y < r.h - PAD - padStep; y += padStep) {
      padCol.setAlpha(90 + rnd() * 90)
      g.fill(padCol)
      g.rect(3, y, PAD - 6, 8)
      g.rect(r.w - PAD + 3, y, PAD - 6, 8)
    }

    // Power straps: faint wide verticals across the whole core (VDD mesh).
    const strap = g.color(pal.fgDim)
    strap.setAlpha(26)
    g.fill(strap)
    for (let u = 0.06; u < 1; u += 0.12) g.rect(X(u) - 2.5, core.y, 5, core.h)

    // Functional blocks.
    for (const b of BLOCKS) {
      const bx = X(b.x)
      const by = Y(b.y)
      const bw = b.w * core.w
      const bh = b.h * core.h
      const spy = b.kind === 'spy'
      const edge = g.color(spy ? pal.danger : pal.fgDim)

      // Fill + per-kind texture.
      const fillCol = g.color(spy ? pal.danger : pal.grid)
      fillCol.setAlpha(spy ? 26 : 60)
      g.noStroke()
      g.fill(fillCol)
      g.rect(bx, by, bw, bh)
      this.blockTexture(g, pal, b.kind, bx, by, bw, bh, rnd)

      // Border + pin stubs on the block edges.
      edge.setAlpha(spy ? 200 : 160)
      g.stroke(edge)
      g.strokeWeight(1)
      g.noFill()
      g.rect(bx, by, bw, bh)
      edge.setAlpha(110)
      g.stroke(edge)
      const pins = Math.floor(bw / 18)
      for (let i = 1; i < pins; i++) {
        const px = bx + (bw / pins) * i
        g.line(px, by, px, by - 3)
        g.line(px, by + bh, px, by + bh + 3)
      }

      // Label + area.
      const label = g.color(spy ? pal.danger : pal.fg)
      label.setAlpha(spy ? 235 : 200)
      g.noStroke()
      g.fill(label)
      g.textFont('Courier New')
      g.textSize(9)
      g.textAlign(g.LEFT, g.TOP)
      g.text(b.name, bx + 4, by + 4)
      label.setAlpha(120)
      g.fill(label)
      g.text(`${b.areaMm}mm²`, bx + 4, by + 15)
    }

    // Corner alignment crosses (mask fiducials).
    const fid = g.color(pal.accent)
    fid.setAlpha(150)
    g.stroke(fid)
    g.strokeWeight(1)
    for (const [cx, cy] of [
      [X(0.015), Y(0.015)],
      [X(0.985), Y(0.015)],
      [X(0.015), Y(0.985)],
      [X(0.985), Y(0.985)],
    ]) {
      g.line(cx - 5, cy, cx + 5, cy)
      g.line(cx, cy - 5, cx, cy + 5)
    }

    g.pop()
    return g
  }

  /** Per-kind fills: std-cell rows, SRAM grids, MAC arrays, hatches. */
  private blockTexture(
    g: p5.Graphics,
    pal: OSContext['palette'],
    kind: BlockKind,
    bx: number,
    by: number,
    bw: number,
    bh: number,
    rnd: () => number,
  ): void {
    const tex = g.color(kind === 'spy' ? pal.danger : pal.fgDim)
    const top = by + 24 // leave room for the label
    const innerH = bh - 28
    if (innerH < 8) return
    switch (kind) {
      case 'core': {
        // Standard-cell rows: dashed horizontal strips.
        tex.setAlpha(60)
        g.stroke(tex)
        g.strokeWeight(1)
        for (let y = top; y < top + innerH; y += 5) {
          let x = bx + 4
          while (x < bx + bw - 6) {
            const len = 3 + rnd() * 9
            g.line(x, y, Math.min(x + len, bx + bw - 4), y)
            x += len + 2 + rnd() * 4
          }
        }
        break
      }
      case 'sram': {
        // Memory macro: dense grid + subarray dividers.
        tex.setAlpha(40)
        g.stroke(tex)
        g.strokeWeight(1)
        for (let y = top; y < top + innerH; y += 3.5) g.line(bx + 4, y, bx + bw - 4, y)
        tex.setAlpha(90)
        g.stroke(tex)
        for (let i = 1; i < 4; i++) {
          const x = bx + (bw / 4) * i
          g.line(x, top - 2, x, top + innerH)
        }
        break
      }
      case 'npu': {
        // Systolic MAC array: lattice of small filled squares.
        tex.setAlpha(70)
        g.noStroke()
        g.fill(tex)
        for (let y = top; y < top + innerH - 5; y += 9) {
          for (let x = bx + 6; x < bx + bw - 10; x += 9) {
            if (rnd() > 0.12) g.rect(x, y, 5, 5)
          }
        }
        break
      }
      case 'crypto':
      case 'spy': {
        // Diagonal hatch (restricted logic).
        tex.setAlpha(kind === 'spy' ? 70 : 50)
        g.stroke(tex)
        g.strokeWeight(1)
        for (let d = 0; d < bw + innerH; d += 8) {
          const x1 = bx + Math.min(d, bw)
          const y1 = top + Math.max(0, d - bw)
          const x2 = bx + Math.max(0, d - innerH)
          const y2 = top + Math.min(d, innerH)
          g.line(x1, y1, x2, y2)
        }
        break
      }
      case 'io': {
        // PHY lanes: vertical stripes.
        tex.setAlpha(55)
        g.stroke(tex)
        g.strokeWeight(2)
        for (let x = bx + 6; x < bx + bw - 6; x += 8) g.line(x, top, x, top + innerH)
        break
      }
      case 'pmu': {
        // Regulator banks: sparse fat dots.
        tex.setAlpha(80)
        g.noStroke()
        g.fill(tex)
        for (let y = top + 4; y < top + innerH - 4; y += 12) {
          for (let x = bx + 8; x < bx + bw - 8; x += 12) g.circle(x, y, 4)
        }
        break
      }
    }
  }

  // --- Drawing -----------------------------------------------------------

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    this.ensureNets()

    const footerH = 16
    const die: Rect = { x: inner.x, y: inner.y, w: inner.w, h: inner.h - footerH }
    p.image(this.ensureBase(ctx, die), die.x, die.y)

    const PAD = 22
    const core: Rect = {
      x: die.x + PAD,
      y: die.y + PAD,
      w: die.w - PAD * 2,
      h: die.h - PAD * 2,
    }
    const X = (u: number) => core.x + u * core.w
    const Y = (u: number) => core.y + u * core.h

    // Stamp pending cue timers now that we have ctx.t. Durations come
    // from the scene config so the director can retime everything.
    const chipCfg = ctx.config.scenes.chip
    if (this.pendingDrc > 0) {
      for (let i = 0; i < this.pendingDrc; i++) {
        this.markers.push({
          x: 0.04 + Math.random() * 0.92,
          y: 0.04 + Math.random() * 0.92,
          rule: DRC_RULES[Math.floor(Math.random() * DRC_RULES.length)],
          until: ctx.t + chipCfg.drcSeconds * (0.7 + Math.random() * 0.55),
        })
      }
      this.drcUntil = ctx.t + chipCfg.drcSeconds
      this.pendingDrc = 0
    }
    if (this.pendingThermal) {
      const b = BLOCKS[Math.floor(Math.random() * BLOCKS.length)]
      this.thermal = {
        x: b.x + b.w / 2,
        y: b.y + b.h / 2,
        block: b.name,
        until: ctx.t + chipCfg.thermalSeconds,
      }
      this.pendingThermal = false
    }
    if (this.boostUntil === -2) this.boostUntil = ctx.t + 3
    if (this.pendingTapeout) {
      this.tapeoutStart = ctx.t
      this.bannerUntil = ctx.t + chipCfg.tapeoutSweepSeconds + 4.5
      this.pendingTapeout = false
    }
    this.markers = this.markers.filter((m) => ctx.t < m.until)

    p.push()

    // --- Routing: static L-paths faint, pulses bright on active layer.
    const boost = ctx.t < this.boostUntil
    for (const n of this.nets) {
      const active = n.layer === this.activeLayer
      // Even layers route horizontal-first, odd vertical-first.
      const mid: [number, number] =
        n.layer % 2 === 0 ? [n.bx, n.ay] : [n.ax, n.by]
      strokeHex(p, active ? palette.accent : palette.fgDim, active ? 90 : 34)
      p.strokeWeight(1)
      p.noFill()
      p.line(X(n.ax), Y(n.ay), X(mid[0]), Y(mid[1]))
      p.line(X(mid[0]), Y(mid[1]), X(n.bx), Y(n.by))
      // Via marker at the bend.
      p.noStroke()
      fillHex(p, active ? palette.accent : palette.fgDim, active ? 120 : 50)
      p.circle(X(mid[0]), Y(mid[1]), 3)

      // Pulse + trail along the two segments.
      const l1 = Math.hypot(mid[0] - n.ax, mid[1] - n.ay)
      const l2 = Math.hypot(n.bx - mid[0], n.by - mid[1])
      const total = l1 + l2 || 1
      const speed = n.speed * chipCfg.pulseSpeed * (boost ? 4 : 1)
      for (let k = 0; k < 4; k++) {
        const t01 = ((ctx.t * speed + n.phase - k * 0.015) % 1 + 1) % 1
        const d = t01 * total
        let ux: number
        let uy: number
        if (d <= l1) {
          const f = l1 === 0 ? 0 : d / l1
          ux = n.ax + (mid[0] - n.ax) * f
          uy = n.ay + (mid[1] - n.ay) * f
        } else {
          const f = l2 === 0 ? 0 : (d - l1) / l2
          ux = mid[0] + (n.bx - mid[0]) * f
          uy = mid[1] + (n.by - mid[1]) * f
        }
        const a = (active ? 235 : 90) * (1 - k / 4)
        if (k === 0 && active) enableGlow(ctx, palette.accent, 0.6)
        fillHex(p, active ? palette.accent : palette.fg, a)
        p.noStroke()
        p.rect(X(ux) - 1.5, Y(uy) - 1.5, 3, 3)
        if (k === 0 && active) disableGlow(ctx)
      }
    }

    // --- DRC raster sweep: a scanline crawling down the core.
    const drcActive = ctx.t < this.drcUntil
    const sweepSpeed = (drcActive ? 0.3 : 0.045) * chipCfg.sweepSpeed
    const sy = Y((ctx.t * sweepSpeed) % 1)
    strokeHex(p, drcActive ? palette.warn : palette.fgDim, drcActive ? 150 : 70)
    p.strokeWeight(1)
    p.line(core.x, sy, core.x + core.w, sy)
    fillHex(p, drcActive ? palette.warn : palette.fgDim, drcActive ? 220 : 120)
    p.noStroke()
    p.textSize(8)
    p.textAlign(p.RIGHT, p.BOTTOM)
    p.text('DRC', core.x + core.w, sy - 2)

    // --- DRC violation markers.
    const blink = Math.floor(ctx.t * 4) % 3 !== 2
    if (this.markers.length > 0 && blink) {
      enableGlow(ctx, palette.danger, 0.5)
      for (const m of this.markers) {
        const mx = X(m.x)
        const my = Y(m.y)
        strokeHex(p, palette.danger, 230)
        p.strokeWeight(1.4)
        p.noFill()
        p.line(mx - 4, my - 4, mx + 4, my + 4)
        p.line(mx - 4, my + 4, mx + 4, my - 4)
        p.rect(mx - 7, my - 7, 14, 14)
        p.noStroke()
        fillHex(p, palette.danger, 190)
        p.textSize(7)
        p.textAlign(p.LEFT, p.CENTER)
        p.text(m.rule, mx + 10, my)
      }
      disableGlow(ctx)
    }

    // --- Thermal hotspot bloom.
    if (this.thermal && ctx.t < this.thermal.until) {
      const th = this.thermal
      const flick = 0.75 + p.noise(ctx.t * 6) * 0.25
      const cx = X(th.x)
      const cy = Y(th.y)
      const rad = Math.min(core.w, core.h) * 0.22 * flick
      const dc = p.drawingContext as CanvasRenderingContext2D
      const grad = dc.createRadialGradient(cx, cy, 0, cx, cy, rad)
      grad.addColorStop(0, rgba(palette.danger, 0.5 * flick))
      grad.addColorStop(0.55, rgba(palette.warn, 0.22 * flick))
      grad.addColorStop(1, rgba(palette.danger, 0))
      dc.save()
      dc.fillStyle = grad
      dc.fillRect(cx - rad, cy - rad, rad * 2, rad * 2)
      dc.restore()
      const temp = (96 + p.noise(ctx.t * 3) * 12).toFixed(1)
      fillHex(p, palette.danger, 240)
      p.textSize(10)
      p.textAlign(p.CENTER, p.CENTER)
      p.text(`▲ ${temp}°C`, cx, cy - rad - 8)
    } else if (this.thermal && ctx.t >= this.thermal.until) {
      this.thermal = null
    }

    // --- Tapeout: sign-off sweep, then the banner.
    if (this.tapeoutStart >= 0 && ctx.t < this.bannerUntil) {
      const sweep = Math.min(
        1,
        (ctx.t - this.tapeoutStart) / chipCfg.tapeoutSweepSeconds,
      )
      const wy = core.y + core.h * (1 - sweep)
      p.noStroke()
      fillHex(p, palette.ok, 26)
      p.rect(core.x, wy, core.w, core.y + core.h - wy)
      enableGlow(ctx, palette.ok, 0.7)
      strokeHex(p, palette.ok, 220)
      p.strokeWeight(1.5)
      p.line(core.x, wy, core.x + core.w, wy)
      disableGlow(ctx)
      if (sweep >= 1) {
        const bw = Math.min(360, core.w * 0.85)
        const bh = 40
        const bx = core.x + (core.w - bw) / 2
        const by = core.y + core.h * 0.44
        p.noStroke()
        fillHex(p, palette.bg, 220)
        p.rect(bx, by, bw, bh)
        enableGlow(ctx, palette.ok, 0.8)
        strokeHex(p, palette.ok, blink ? 255 : 150)
        p.strokeWeight(1.5)
        p.noFill()
        p.rect(bx, by, bw, bh)
        disableGlow(ctx)
        p.noStroke()
        fillHex(p, palette.ok, 245)
        p.textSize(11)
        p.textAlign(p.CENTER, p.CENTER)
        p.text('GDSII FIRMADO — LOTE 0447 → FUNDICIÓN NACIONAL', bx + bw / 2, by + bh / 2 + 1)
      }
    }

    // --- Footer strip.
    const mode =
      this.tapeoutStart >= 0 && ctx.t < this.bannerUntil
        ? 'TAPEOUT'
        : drcActive
          ? 'VERIFICACIÓN'
          : 'RUTEO'
    p.noStroke()
    fillHex(p, palette.fgDim, 200)
    p.textSize(9)
    p.textAlign(p.LEFT, p.BOTTOM)
    p.text(
      `NODO 3NM · 4200M TRANS · UTIL 87.4% · CAPA ${LAYERS[this.activeLayer]} · DRC ${this.markers.length} · MODO: ${mode}`,
      inner.x + 4,
      inner.y + inner.h - 2,
    )
    p.textAlign(p.RIGHT, p.BOTTOM)
    p.text(`RETÍCULA 26×33MM · Y ${((ctx.t * sweepSpeed) % 1).toFixed(3)}`, inner.x + inner.w - 4, inner.y + inner.h - 2)

    p.pop()
  }
}

// ---------------------------------------------------------------------
// LogicAnalyzerWindow
// ---------------------------------------------------------------------

interface Lane {
  name: string
  kind: 'clock' | 'bit' | 'bus' | 'sparse'
  seed: number
  density?: number
}

const LANES: Lane[] = [
  { name: 'CLK', kind: 'clock', seed: 11 },
  { name: 'RST_N', kind: 'sparse', seed: 23, density: 0.04 },
  { name: 'DATOS[7:0]', kind: 'bus', seed: 37 },
  { name: 'DIR[15:0]', kind: 'bus', seed: 41 },
  { name: 'VÁLIDO', kind: 'bit', seed: 53, density: 0.55 },
  { name: 'LISTO', kind: 'bit', seed: 67, density: 0.75 },
  { name: 'IRQ', kind: 'sparse', seed: 79, density: 0.08 },
  { name: 'EXPLORACIÓN', kind: 'bit', seed: 97, density: 0.4 },
]

export class LogicAnalyzerWindow extends OSWindow {
  private bistFor = 0
  private bistUntil = -1

  /** Director cue: inject a marching BIST test pattern for a while. */
  bist(seconds = 5): void {
    this.bistFor = seconds
    this.bistUntil = -1
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    if (this.bistFor > 0) {
      this.bistUntil = ctx.t + this.bistFor
      this.bistFor = 0
    }
    const bistOn = ctx.t < this.bistUntil

    const headH = 16
    const labelW = 92
    const waveX = inner.x + labelW
    const waveW = inner.w - labelW - 4
    const laneH = (inner.h - headH) / LANES.length
    const cellW = 9
    const scroll = ctx.t * ctx.config.scenes.chip.scrollSpeed // px/s
    const baseCell = Math.floor(scroll / cellW)
    const offset = scroll % cellW
    const cells = Math.ceil(waveW / cellW) + 2

    p.push()

    // Header.
    p.noStroke()
    fillHex(p, palette.fgDim, 210)
    p.textSize(9)
    p.textAlign(p.LEFT, p.TOP)
    p.text('MUESTREO 2.0GS/S · VENTANA 512NS · DISPARO: FLANCO ↑ CLK', inner.x, inner.y)
    if (bistOn && Math.floor(ctx.t * 3) % 2 === 0) {
      fillHex(p, palette.warn, 240)
      p.textAlign(p.RIGHT, p.TOP)
      p.text('◉ PATRÓN BIST ACTIVO', inner.x + inner.w, inner.y)
    }

    const laneTop = (i: number) => inner.y + headH + i * laneH
    const hi = (i: number) => laneTop(i) + laneH * 0.22
    const lo = (i: number) => laneTop(i) + laneH * 0.78

    // Value of a lane at an absolute cell index.
    const bitAt = (lane: Lane, li: number, idx: number): number => {
      if (bistOn && lane.kind !== 'clock') return (idx + li) % 4 < 2 ? 1 : 0
      switch (lane.kind) {
        case 'clock':
          return idx % 2
        case 'bit':
          return hash01(lane.seed, idx >> 1) < (lane.density ?? 0.5) ? 1 : 0
        case 'sparse':
          return hash01(lane.seed, idx >> 2) < (lane.density ?? 0.06) ? 1 : 0
        default:
          return 0
      }
    }

    LANES.forEach((lane, i) => {
      const yh = hi(i)
      const yl = lo(i)
      // Lane label + separator.
      strokeHex(p, palette.grid, 120)
      p.strokeWeight(1)
      p.line(inner.x, laneTop(i) + laneH, inner.x + inner.w, laneTop(i) + laneH)
      p.noStroke()
      fillHex(p, lane.kind === 'bus' ? palette.accent : palette.fg, 200)
      p.textSize(9)
      p.textAlign(p.LEFT, p.CENTER)
      p.text(lane.name, inner.x + 2, (yh + yl) / 2)

      const col = bistOn && lane.kind !== 'clock' ? palette.warn : palette.fg

      if (lane.kind === 'bus') {
        // Bus: segments with X-transitions and hex values (change every 4 cells).
        const segCells = 4
        const firstSeg = Math.floor(baseCell / segCells)
        const segW = segCells * cellW
        const startX = waveX - offset - (baseCell % segCells) * cellW
        let sx = startX
        let seg = firstSeg
        strokeHex(p, palette.accent, 170)
        p.strokeWeight(1)
        while (sx < waveX + waveW) {
          const x1 = Math.max(sx, waveX)
          const x2 = Math.min(sx + segW, waveX + waveW)
          if (x2 > x1 + 5) {
            // Top/bottom rails with a 4px X-crossing at the left edge.
            p.line(x1 + 4, yh, x2 - 1, yh)
            p.line(x1 + 4, yl, x2 - 1, yl)
            if (sx >= waveX) {
              p.line(sx, (yh + yl) / 2, sx + 4, yh)
              p.line(sx, (yh + yl) / 2, sx + 4, yl)
              p.line(sx - 4, yh, sx, (yh + yl) / 2)
              p.line(sx - 4, yl, sx, (yh + yl) / 2)
            }
            const val = bistOn
              ? (seg % 2 === 0 ? 'AA' : '55')
              : Math.floor(hash01(lane.seed, seg) * 256)
                  .toString(16)
                  .toUpperCase()
                  .padStart(2, '0')
            if (x2 - x1 > 24) {
              p.noStroke()
              fillHex(p, palette.accent, 220)
              p.textSize(8)
              p.textAlign(p.CENTER, p.CENTER)
              p.text(`0X${val}`, (x1 + x2) / 2, (yh + yl) / 2)
              strokeHex(p, palette.accent, 170)
            }
          }
          sx += segW
          seg++
        }
      } else {
        // Digital square wave with edges.
        strokeHex(p, col, lane.kind === 'clock' ? 220 : 180)
        p.strokeWeight(1.2)
        let prev = bitAt(lane, i, baseCell - 1)
        for (let k = 0; k < cells; k++) {
          const idx = baseCell + k
          const v = bitAt(lane, i, idx)
          const x1 = Math.max(waveX, waveX + k * cellW - offset)
          const x2 = Math.min(waveX + waveW, waveX + (k + 1) * cellW - offset)
          if (x2 <= x1) {
            prev = v
            continue
          }
          const y = v ? yh : yl
          p.line(x1, y, x2, y)
          if (v !== prev && x1 > waveX) p.line(x1, yh, x1, yl)
          prev = v
        }
      }
    })

    // Measurement cursor.
    const cx = waveX + waveW * 0.62
    enableGlow(ctx, palette.accent, 0.5)
    strokeHex(p, palette.accent, 190)
    p.strokeWeight(1)
    p.line(cx, inner.y + headH, cx, inner.y + inner.h - 2)
    disableGlow(ctx)
    p.noStroke()
    fillHex(p, palette.accent, 220)
    p.textSize(8)
    p.textAlign(p.LEFT, p.TOP)
    p.text(`T+${(142.6 + (ctx.t % 1) * 0.4).toFixed(1)}NS`, cx + 4, inner.y + headH + 2)

    p.pop()
  }
}

// ---------------------------------------------------------------------
// FabStatsWindow
// ---------------------------------------------------------------------

export class FabStatsWindow extends OSWindow {
  private seed: number
  private wafer: { gx: number; gy: number; pass: boolean }[] = []
  private yieldPct = 0
  private drcFor = 0
  private drcUntil = -1
  private heatFor = 0
  private heatUntil = -1
  private frozen = false

  constructor(o: OSWindowOpts, seed = 447) {
    super(o)
    this.seed = seed
  }

  /** Timing collapses while physical verification is failing. */
  drcAlarm(seconds = 7): void {
    this.drcFor = seconds
    this.drcUntil = -1
  }

  /** Junction temperature ramps into the red. */
  heatUp(seconds = 8): void {
    this.heatFor = seconds
    this.heatUntil = -1
  }

  /** Tapeout: database is signed and frozen. */
  freeze(): void {
    this.frozen = true
  }

  private ensureWafer(): void {
    if (this.wafer.length > 0) return
    const rnd = mulberry32(this.seed)
    const R = 7
    let pass = 0
    for (let gy = -R; gy <= R; gy++) {
      for (let gx = -R; gx <= R; gx++) {
        if (Math.hypot(gx, gy) > R - 0.35) continue
        if (gy === R - 1 && Math.abs(gx) < 2) continue // notch
        const ok = rnd() > 0.085
        this.wafer.push({ gx, gy, pass: ok })
        if (ok) pass++
      }
    }
    this.yieldPct = (pass / this.wafer.length) * 100
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    this.ensureWafer()
    if (this.drcFor > 0) {
      this.drcUntil = ctx.t + this.drcFor
      this.drcFor = 0
    }
    if (this.heatFor > 0) {
      this.heatUntil = ctx.t + this.heatFor
      this.heatFor = 0
    }
    const drcOn = ctx.t < this.drcUntil
    const heatOn = ctx.t < this.heatUntil

    p.push()

    // --- Left: wafer map.
    const waferW = Math.min(inner.w * 0.42, inner.h)
    const cx = inner.x + waferW / 2
    const cy = inner.y + (inner.h - 14) / 2
    const waferR = Math.min(waferW, inner.h - 18) / 2 - 4
    const cell = (waferR * 2) / 15

    strokeHex(p, palette.fgDim, 150)
    p.strokeWeight(1)
    p.noFill()
    p.circle(cx, cy, waferR * 2 + 6)
    p.noStroke()
    for (const d of this.wafer) {
      const col = d.pass ? palette.ok : palette.danger
      fillHex(p, col, d.pass ? 95 : 210)
      p.rect(cx + d.gx * cell - cell / 2 + 0.5, cy + d.gy * cell - cell / 2 + 0.5, cell - 1, cell - 1)
    }
    fillHex(p, palette.fgDim, 210)
    p.textSize(8)
    p.textAlign(p.CENTER, p.BOTTOM)
    p.text(
      `OBLEA #0447 · RENDIMIENTO ${this.yieldPct.toFixed(1)}%`,
      cx,
      inner.y + inner.h - 2,
    )

    // --- Right: timing/power readouts.
    const sx = inner.x + waferW + 14
    const sw = inner.w - waferW - 18
    const slack = drcOn
      ? -(28 + p.noise(ctx.t * 2) * 14)
      : 10 + p.noise(ctx.t * 0.8) * 6
    const temp = heatOn ? 96 + p.noise(ctx.t * 3) * 10 : 74 + p.noise(ctx.t * 0.6) * 5
    const rows: { label: string; value: string; level: LogLevel; frac: number }[] = [
      {
        label: 'FMAX',
        value: `${(4.29 + p.noise(1, ctx.t * 0.5) * 0.06).toFixed(2)} GHZ`,
        level: 'info',
        frac: 0.86,
      },
      {
        label: 'SLACK WNS',
        value: `${slack >= 0 ? '+' : ''}${slack.toFixed(0)} PS`,
        level: slack >= 0 ? 'ok' : 'danger',
        frac: Math.max(0.05, Math.min(1, 0.5 + slack / 80)),
      },
      {
        label: 'POTENCIA',
        value: `${(37.4 + (heatOn ? 9 : 0) + p.noise(2, ctx.t) * 2.2).toFixed(1)} W`,
        level: heatOn ? 'warn' : 'info',
        frac: heatOn ? 0.92 : 0.62,
      },
      {
        label: 'T° UNIÓN',
        value: `${temp.toFixed(1)} °C`,
        level: heatOn ? 'danger' : 'ok',
        frac: temp / 120,
      },
      {
        label: 'FUGA',
        value: `${(4.05 + p.noise(3, ctx.t * 0.4) * 0.4).toFixed(2)} W`,
        level: 'dim',
        frac: 0.3,
      },
    ]
    const rowH = Math.min(20, (inner.h - 40) / rows.length)
    p.textSize(9)
    rows.forEach((row, i) => {
      const y = inner.y + 2 + i * rowH
      const col =
        row.level === 'ok'
          ? palette.ok
          : row.level === 'warn'
            ? palette.warn
            : row.level === 'danger'
              ? palette.danger
              : row.level === 'dim'
                ? palette.fgDim
                : palette.fg
      p.noStroke()
      fillHex(p, palette.fgDim, 200)
      p.textAlign(p.LEFT, p.CENTER)
      p.text(row.label, sx, y + rowH / 2)
      fillHex(p, col, 235)
      p.textAlign(p.RIGHT, p.CENTER)
      p.text(row.value, sx + sw * 0.55, y + rowH / 2)
      // Mini bar.
      const bx = sx + sw * 0.6
      const bw = sw * 0.4
      strokeHex(p, palette.grid, 160)
      p.noFill()
      p.rect(bx, y + rowH / 2 - 4, bw, 8)
      p.noStroke()
      fillHex(p, col, 170)
      p.rect(bx + 1, y + rowH / 2 - 3, (bw - 2) * Math.min(1, row.frac), 6)
    })

    // --- Slack histogram along the bottom of the right side.
    const histY = inner.y + 2 + rows.length * rowH + 10
    const histH = inner.y + inner.h - 16 - histY
    if (histH > 12) {
      const bins = 14
      const bw = (sw - 4) / bins
      for (let b = 0; b < bins; b++) {
        // Gaussian-ish pile centered right of zero; DRC pushes mass negative.
        const center = drcOn ? 4 : 9
        const base = Math.exp(-Math.pow((b - center) / 3.2, 2))
        const hgt = histH * (0.15 + 0.85 * base * (0.7 + p.noise(b, ctx.t * 0.7) * 0.3))
        const neg = b < 5
        fillHex(p, neg ? palette.danger : palette.ok, neg && !drcOn ? 70 : 160)
        p.noStroke()
        p.rect(sx + b * bw, histY + histH - hgt, bw - 1.5, hgt)
      }
      // Zero marker.
      strokeHex(p, palette.fgDim, 170)
      p.line(sx + 5 * bw, histY, sx + 5 * bw, histY + histH)
      p.noStroke()
      fillHex(p, palette.fgDim, 190)
      p.textSize(8)
      p.textAlign(p.LEFT, p.TOP)
      p.text('HISTOGRAMA DE SLACK · 0PS', sx, histY + histH + 2)
    }

    // --- Frozen banner after tapeout.
    if (this.frozen) {
      fillHex(p, palette.ok, 230)
      p.textSize(9)
      p.textAlign(p.RIGHT, p.TOP)
      p.text('■ GDSII CONGELADO — REV C0', inner.x + inner.w - 2, inner.y + 2)
    }

    p.pop()
  }
}
