/**
 * AnalysisWindows.ts — LEALTAD with real eyes: the loyalty metrics
 * derived from actual footage by the vision module.
 *
 * The scene pairs a SurveillancePanel (slot 'cam-a', so the director's
 * ARCHIVO→A / WEBCAM→A buttons pipe video straight in) with a
 * LiveMetricsEntity that reads the MediaPipe tracks every frame and
 * computes what the regime wants to know about whoever is on camera:
 *
 *  - subjects in frame, dwell time, attention ratio
 *  - agitation (normalized track velocity → the fear estimate)
 *  - micro-jitter (speed variance → the deception estimate)
 *  - social proximity between subjects (contact events)
 *  - a real movement heatmap accumulated from track centers
 *  - object inventory (what the camera has seen, in Spanish)
 *  - and the Dissent Probability Index, boosted by live behavior
 *
 * With no video loaded the entity runs a noise simulation so the scene
 * still performs by itself; the mode line says which one you're seeing.
 */

import { Entity } from '../core/Entity'
import { OSWindow, type OSWindowOpts } from './OSWindow'
import type { OSContext } from '../core/context'
import { fillHex, strokeHex } from '../core/context'
import type { Rect } from '../core/geometry'
import { enableGlow, disableGlow } from '../fx/Effects'
import type { LogLevel } from './TextStream'
import type { SurveillancePanel } from './SurveillancePanel'
import { VideoFeed } from '../media/VideoSource'
import { labelEs } from '../vision/labels'

export const ANALYSIS_FEED: { text: string; level: LogLevel }[] = [
  { text: 'FOTOGRAMA archivado — resolución probatoria', level: 'dim' },
  { text: 'PISADA GAIT-ID cotejada contra 12M perfiles', level: 'info' },
  { text: 'AGITACIÓN sobre línea base — marcador temporal', level: 'warn' },
  { text: 'ROSTRO parcial — reconstrucción en cola', level: 'info' },
  { text: 'CONTACTO FÍSICO registrado — grafo actualizado', level: 'warn' },
  { text: 'OBJETO NO AUTORIZADO en cuadro — revisar', level: 'danger' },
  { text: 'ILUMINACIÓN corregida — ganancia nocturna', level: 'dim' },
  { text: 'PERMANENCIA excede el umbral del sector', level: 'warn' },
  { text: 'EXPEDIENTE 4471 — evidencia visual anexada', level: 'info' },
  { text: 'MODELO EFFICIENTDET v0 — 10Hz nominal', level: 'ok' },
  { text: 'CADENA DE CUSTODIA firmada por el nodo', level: 'ok' },
]

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

const HEAT_COLS = 16
const HEAT_ROWS = 9

// ---------------------------------------------------------------------
// LiveMetricsEntity — reads the vision tracks, derives the scores.
// ---------------------------------------------------------------------

export class LiveMetricsEntity extends Entity {
  z = -9
  private panel: SurveillancePanel

  // Cue plumbing.
  private pendingDissent = false
  private pendingPardon = false
  private pendingReset = false
  private dissentStart = -1
  private dpiTarget = 0

  // Outputs.
  /** 'live' = model active on real video; 'sim' = noise fallback. */
  mode: 'live' | 'loading' | 'sim' = 'sim'
  persons = 0
  objects = 0
  agitation = 0.15
  agitHist: number[] = []
  /** Seconds the primary subject has been tracked. */
  dwell = 0
  /** Fraction of recent frames with a subject in frame. */
  attention = 0
  /** Nearest distance between two subjects (0..1 of frame diag). */
  proximity = 1
  contact = false
  heat = new Float32Array(HEAT_COLS * HEAT_ROWS)
  inventory = new Map<string, number>()
  fear = 0.15
  decep = 0.08
  dpi = 0.1
  arrestIssued = false

  private attnBuf: number[] = []
  private speedBuf: number[] = []

  constructor(panel: SurveillancePanel) {
    super()
    this.panel = panel
  }

  dissent(): void {
    this.pendingDissent = true
  }
  pardon(): void {
    this.pendingPardon = true
  }
  /** Recalibrate: wipe heatmap, histories, and baselines. */
  reset(): void {
    this.pendingReset = true
  }

  update(ctx: OSContext): void {
    const t = ctx.t
    const cfg = ctx.config.scenes.analysis

    if (this.pendingDissent) {
      this.dissentStart = t
      this.dpiTarget = cfg.dpiThreshold + 0.05 + Math.random() * 0.1
      this.pendingDissent = false
    }
    if (this.pendingPardon) {
      this.dissentStart = -1
      this.dpiTarget = 0
      this.arrestIssued = false
      this.pendingPardon = false
    }
    if (this.pendingReset) {
      this.heat.fill(0)
      this.agitHist = []
      this.attnBuf = []
      this.speedBuf = []
      this.pendingReset = false
    }

    // --- Read the vision tracks (the panel runs the engine each draw).
    const feed = this.panel.feed
    const vision = feed instanceof VideoFeed ? feed.vision : null
    const el = feed instanceof VideoFeed ? feed.element : null
    const live =
      vision !== null && el !== null && el.videoWidth > 0 && vision.status === 'active'
    this.mode = live ? 'live' : vision && vision.status === 'loading' ? 'loading' : 'sim'

    let agitRaw: number
    let decepRaw: number
    if (live && vision && el) {
      const vw = el.videoWidth
      const vh = el.videoHeight
      const diag = Math.hypot(vw, vh)
      const tracks = vision.tracks.filter((tr) => tr.confirmed)
      const people = tracks.filter((tr) => tr.label === 'person')
      // No people in frame → analyze whatever the camera does see, so
      // any footage animates the metrics.
      const persons = people.length > 0 ? people : tracks
      this.persons = people.length
      this.objects = tracks.length

      // Inventory of everything the camera is seeing.
      this.inventory.clear()
      for (const tr of tracks) {
        this.inventory.set(tr.label, (this.inventory.get(tr.label) ?? 0) + 1)
      }

      // Agitation: mean normalized speed of subjects.
      const speeds = persons.map((p) => Math.hypot(p.vx, p.vy) / diag)
      const meanSpeed = speeds.length
        ? speeds.reduce((a, b) => a + b, 0) / speeds.length
        : 0
      agitRaw = clamp01(meanSpeed * cfg.agitationGain)

      // Primary subject: the largest person box.
      const subject = persons.reduce<(typeof persons)[number] | null>(
        (best, p) => (best === null || p.w * p.h > best.w * best.h ? p : best),
        null,
      )
      this.dwell = subject?.age ?? 0

      // Deception estimate: variance of the subject's recent speed
      // (micro-jitter reads as nerves to the algorithm).
      if (subject) {
        this.speedBuf.push(Math.hypot(subject.vx, subject.vy) / diag)
        if (this.speedBuf.length > 60) this.speedBuf.shift()
      }
      const mean = this.speedBuf.length
        ? this.speedBuf.reduce((a, b) => a + b, 0) / this.speedBuf.length
        : 0
      const variance = this.speedBuf.length
        ? this.speedBuf.reduce((a, b) => a + (b - mean) ** 2, 0) / this.speedBuf.length
        : 0
      decepRaw = clamp01(Math.sqrt(variance) * cfg.agitationGain * 3)

      // Proximity between subjects.
      this.proximity = 1
      for (let i = 0; i < persons.length; i++) {
        for (let j = i + 1; j < persons.length; j++) {
          const a = persons[i]
          const b = persons[j]
          const d =
            Math.hypot(
              a.x + a.w / 2 - (b.x + b.w / 2),
              a.y + a.h / 2 - (b.y + b.h / 2),
            ) / diag
          if (d < this.proximity) this.proximity = d
        }
      }
      this.contact = persons.length >= 2 && this.proximity < 0.12

      // Movement heatmap from real centers.
      for (const p of persons) {
        const gx = Math.min(HEAT_COLS - 1, Math.max(0, Math.floor(((p.x + p.w / 2) / vw) * HEAT_COLS)))
        const gy = Math.min(HEAT_ROWS - 1, Math.max(0, Math.floor(((p.y + p.h / 2) / vh) * HEAT_ROWS)))
        this.heat[gy * HEAT_COLS + gx] += ctx.dt * 1.6
      }
      this.attnBuf.push(subject ? 1 : 0)
    } else {
      // --- Simulation fallback: the screen performs without footage.
      const n = (seed: number, speed = 0.3) => ctx.p.noise(seed, t * speed)
      this.persons = 1 + Math.floor(n(81) * 2.4)
      this.objects = this.persons + Math.floor(n(82) * 2)
      agitRaw = clamp01(0.12 + n(83) * 0.3)
      decepRaw = clamp01(0.05 + n(84) * 0.18)
      this.dwell += ctx.dt
      this.proximity = 0.2 + n(85) * 0.5
      this.contact = this.proximity < 0.24 && this.persons >= 2
      this.inventory.clear()
      this.inventory.set('person', this.persons)
      if (n(86) > 0.55) this.inventory.set('cell phone', 1)
      // Wandering blob on the heatmap.
      const gx = Math.floor(n(87, 0.15) * HEAT_COLS)
      const gy = Math.floor(n(88, 0.15) * HEAT_ROWS)
      this.heat[Math.min(HEAT_ROWS - 1, gy) * HEAT_COLS + Math.min(HEAT_COLS - 1, gx)] += ctx.dt * 1.2
      this.attnBuf.push(1)
    }

    // Shared post-processing.
    for (let i = 0; i < this.heat.length; i++) {
      this.heat[i] *= 1 - cfg.heatDecay * ctx.dt
    }
    if (this.attnBuf.length > 300) this.attnBuf.shift()
    this.attention = this.attnBuf.length
      ? this.attnBuf.reduce((a, b) => a + b, 0) / this.attnBuf.length
      : 0

    this.agitation += (agitRaw - this.agitation) * Math.min(1, ctx.dt * 3)
    this.decep += (decepRaw - this.decep) * Math.min(1, ctx.dt * 2)
    if (this.agitHist.length === 0) this.agitHist = new Array<number>(140).fill(this.agitation)
    if (ctx.frame % 8 === 0) {
      this.agitHist.push(this.agitation)
      if (this.agitHist.length > 140) this.agitHist.shift()
    }

    // Fear estimate + DPI, boosted by what the camera actually sees.
    this.fear = clamp01(this.agitation * 0.85 + (this.contact ? 0.1 : 0))
    let dpiBase = clamp01(
      0.08 + this.agitation * 0.3 + this.decep * 0.25 + (this.contact ? 0.08 : 0),
    )
    if (this.dissentStart >= 0) {
      const ramp = Math.min(1, (t - this.dissentStart) / cfg.dissentSeconds)
      dpiBase = dpiBase + (this.dpiTarget - dpiBase) * ramp
    }
    this.dpi += (dpiBase - this.dpi) * Math.min(1, ctx.dt * 1.4)
    if (this.dissentStart >= 0 && this.dpi >= cfg.dpiThreshold) {
      this.arrestIssued = true
    }
  }

  draw(): void {
    // Invisible: derived state only.
  }
}

// ---------------------------------------------------------------------
// LiveAnalysisWindow — the raw numbers the camera produces.
// ---------------------------------------------------------------------

export class LiveAnalysisWindow extends OSWindow {
  private live: LiveMetricsEntity

  constructor(o: OSWindowOpts, live: LiveMetricsEntity) {
    super(o)
    this.live = live
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    const lv = this.live
    p.push()

    // Mode line.
    const modeCol =
      lv.mode === 'live' ? palette.ok : lv.mode === 'loading' ? palette.warn : palette.fgDim
    p.noStroke()
    fillHex(p, modeCol, 235)
    p.textSize(9)
    p.textAlign(p.LEFT, p.TOP)
    p.text(
      lv.mode === 'live'
        ? '● IA EN VIVO — EFFICIENTDET 10HZ'
        : lv.mode === 'loading'
          ? '◌ CARGANDO MODELO…'
          : '○ SIMULACIÓN — CARGUE VIDEO (ARCHIVO→A / WEBCAM→A)',
      inner.x,
      inner.y,
    )

    // Counters: subjects + objects.
    let y = inner.y + 16
    fillHex(p, palette.fgDim, 190)
    p.textSize(8.5)
    p.text('SUJETOS EN CUADRO', inner.x, y)
    enableGlow(ctx, palette.accent, 0.4)
    fillHex(p, palette.accent, 245)
    p.textSize(26)
    p.text(String(lv.persons), inner.x, y + 11)
    disableGlow(ctx)
    fillHex(p, palette.fgDim, 190)
    p.textSize(8.5)
    p.text('OBJETOS RASTREADOS', inner.x + inner.w * 0.5, y)
    fillHex(p, palette.fg, 235)
    p.textSize(26)
    p.text(String(lv.objects), inner.x + inner.w * 0.5, y + 11)
    y += 48

    // Agitation trend.
    const acol = lv.agitation > 0.6 ? palette.danger : lv.agitation > 0.35 ? palette.warn : palette.ok
    fillHex(p, palette.fgDim, 190)
    p.textSize(8.5)
    p.text('AGITACIÓN — VELOCIDAD NORMALIZADA', inner.x, y)
    fillHex(p, acol, 235)
    p.textAlign(p.RIGHT, p.TOP)
    p.text(`${(lv.agitation * 100).toFixed(1)}%`, inner.x + inner.w, y)
    p.textAlign(p.LEFT, p.TOP)
    const tr: Rect = { x: inner.x, y: y + 12, w: inner.w, h: 34 }
    strokeHex(p, palette.grid, 120)
    p.noFill()
    p.rect(tr.x, tr.y, tr.w, tr.h)
    p.noStroke()
    fillHex(p, acol, 60)
    p.beginShape()
    p.vertex(tr.x, tr.y + tr.h)
    lv.agitHist.forEach((v, i) => {
      p.vertex(tr.x + (i / 139) * tr.w, tr.y + tr.h - v * tr.h * 0.94)
    })
    p.vertex(tr.x + tr.w, tr.y + tr.h)
    p.endShape(p.CLOSE)
    y += 56

    // Dwell / attention / proximity rows.
    const row = (label: string, value: string, col: string) => {
      p.noStroke()
      fillHex(p, palette.fgDim, 190)
      p.textSize(8.5)
      p.textAlign(p.LEFT, p.CENTER)
      p.text(label, inner.x, y + 6)
      fillHex(p, col, 235)
      p.textAlign(p.RIGHT, p.CENTER)
      p.text(value, inner.x + inner.w, y + 6)
      y += 16
    }
    row('PERMANENCIA DEL SUJETO', `${lv.dwell.toFixed(1)} S`, lv.dwell > 60 ? palette.warn : palette.fg)
    row('ATENCIÓN (EN CUADRO)', `${(lv.attention * 100).toFixed(0)}%`, palette.fg)
    row(
      'PROXIMIDAD MÍNIMA',
      lv.persons >= 2 ? `${(lv.proximity * 100).toFixed(0)}% DIAG` : '—',
      lv.contact ? palette.danger : palette.fg,
    )
    if (lv.contact && Math.floor(ctx.t * 3) % 2 === 0) {
      fillHex(p, palette.danger, 235)
      p.textSize(8.5)
      p.textAlign(p.LEFT, p.CENTER)
      p.text('⚠ CONTACTO ENTRE SUJETOS — GRAFO ACTUALIZADO', inner.x, y + 4)
    }
    y += 18

    // Real movement heatmap.
    fillHex(p, palette.fgDim, 190)
    p.textSize(8.5)
    p.textAlign(p.LEFT, p.TOP)
    p.text('MAPA DE CALOR — POSICIONES REALES', inner.x, y)
    const hm: Rect = { x: inner.x, y: y + 12, w: inner.w, h: 92 }
    const cw = hm.w / HEAT_COLS
    const chh = hm.h / HEAT_ROWS
    let maxHeat = 0.001
    for (let i = 0; i < lv.heat.length; i++) maxHeat = Math.max(maxHeat, lv.heat[i])
    for (let gy = 0; gy < HEAT_ROWS; gy++) {
      for (let gx = 0; gx < HEAT_COLS; gx++) {
        const v = lv.heat[gy * HEAT_COLS + gx] / maxHeat
        if (v < 0.02) continue
        p.noStroke()
        fillHex(p, v > 0.7 ? palette.warn : palette.fg, 20 + v * 170)
        p.rect(hm.x + gx * cw + 0.5, hm.y + gy * chh + 0.5, cw - 1, chh - 1)
      }
    }
    strokeHex(p, palette.grid, 120)
    p.noFill()
    p.rect(hm.x, hm.y, hm.w, hm.h)
    y = hm.y + hm.h + 10

    // Object inventory.
    fillHex(p, palette.fgDim, 190)
    p.noStroke()
    p.textSize(8.5)
    p.text('INVENTARIO DEL CUADRO', inner.x, y)
    y += 13
    p.textSize(8)
    const entries = [...lv.inventory.entries()].slice(0, 8)
    if (entries.length === 0) {
      fillHex(p, palette.fgDim, 130)
      p.text('— SIN DETECCIONES —', inner.x, y)
    }
    for (const [label, count] of entries) {
      if (y + 12 > inner.y + inner.h) break
      fillHex(p, label === 'person' ? palette.accent : palette.fg, 210)
      p.textAlign(p.LEFT, p.TOP)
      p.text(labelEs(label), inner.x, y)
      fillHex(p, palette.fgDim, 200)
      p.textAlign(p.RIGHT, p.TOP)
      p.text(`×${count}`, inner.x + inner.w, y)
      p.textAlign(p.LEFT, p.TOP)
      y += 13
    }
    p.pop()
  }
}

// ---------------------------------------------------------------------
// LiveVerdictWindow — the regime's read of what the camera sees.
// ---------------------------------------------------------------------

export class LiveVerdictWindow extends OSWindow {
  private live: LiveMetricsEntity

  constructor(o: OSWindowOpts, live: LiveMetricsEntity) {
    super(o)
    this.live = live
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    const lv = this.live
    const cfg = ctx.config.scenes.analysis
    p.push()

    // Fear + deception estimates.
    const fcol = lv.fear > 0.6 ? palette.danger : lv.fear > 0.35 ? palette.warn : palette.ok
    p.noStroke()
    fillHex(p, palette.fgDim, 190)
    p.textSize(8.5)
    p.textAlign(p.LEFT, p.TOP)
    p.text('MIEDO ESTIMADO (VISUAL)', inner.x, inner.y)
    enableGlow(ctx, fcol, 0.4)
    fillHex(p, fcol, 245)
    p.textSize(24)
    p.text(`${(lv.fear * 100).toFixed(1)}%`, inner.x, inner.y + 11)
    disableGlow(ctx)

    const dcol = lv.decep > 0.6 ? palette.danger : lv.decep > 0.35 ? palette.warn : palette.ok
    fillHex(p, palette.fgDim, 190)
    p.textSize(8.5)
    p.text('ENGAÑO (MICROMOVIMIENTO)', inner.x + inner.w * 0.52, inner.y)
    fillHex(p, dcol, 245)
    p.textSize(24)
    p.text(`${(lv.decep * 100).toFixed(1)}%`, inner.x + inner.w * 0.52, inner.y + 11)

    // DPI gauge.
    const gy = inner.y + 62
    const gaugeH = inner.h - (gy - inner.y) - 56
    const gcx = inner.x + inner.w / 2
    const gr = Math.min(gaugeH * 0.8, inner.w * 0.38)
    const gcy = gy + gr + 14
    fillHex(p, palette.fgDim, 200)
    p.textSize(9)
    p.textAlign(p.CENTER, p.TOP)
    p.text('PROBABILIDAD DE DISIDENCIA — EN VIVO', gcx, gy - 4)
    const a0 = Math.PI * 0.75
    const a1 = Math.PI * 2.25
    const zone = (from: number, to: number, col: string, alpha: number) => {
      strokeHex(p, col, alpha)
      p.strokeWeight(7)
      p.noFill()
      p.arc(gcx, gcy, gr * 2, gr * 2, a0 + (a1 - a0) * from, a0 + (a1 - a0) * to)
    }
    zone(0, 0.5, palette.ok, 70)
    zone(0.5, cfg.dpiThreshold, palette.warn, 80)
    zone(cfg.dpiThreshold, 1, palette.danger, 110)
    const ta = a0 + (a1 - a0) * cfg.dpiThreshold
    strokeHex(p, palette.danger, 230)
    p.strokeWeight(2)
    p.line(
      gcx + Math.cos(ta) * (gr - 9),
      gcy + Math.sin(ta) * (gr - 9),
      gcx + Math.cos(ta) * (gr + 9),
      gcy + Math.sin(ta) * (gr + 9),
    )
    const na = a0 + (a1 - a0) * lv.dpi
    const ncol = lv.dpi >= cfg.dpiThreshold ? palette.danger : lv.dpi > 0.5 ? palette.warn : palette.fg
    enableGlow(ctx, ncol, 0.6)
    strokeHex(p, ncol, 245)
    p.strokeWeight(2)
    p.line(gcx, gcy, gcx + Math.cos(na) * (gr - 14), gcy + Math.sin(na) * (gr - 14))
    disableGlow(ctx)
    p.noStroke()
    fillHex(p, ncol, 245)
    p.circle(gcx, gcy, 6)
    p.textSize(18)
    p.textAlign(p.CENTER, p.TOP)
    p.text(`${(lv.dpi * 100).toFixed(1)}%`, gcx, gcy + 10)
    p.textSize(7.5)
    fillHex(p, palette.fgDim, 160)
    p.text(`UMBRAL ${(cfg.dpiThreshold * 100).toFixed(0)}% · ALIMENTADO POR CONDUCTA VISUAL`, gcx, gcy + 32)

    // Verdict / arrest banner.
    const vy = inner.y + inner.h - 24
    if (lv.arrestIssued) {
      const blink = Math.floor(ctx.t * 4) % 2 === 0
      p.noStroke()
      fillHex(p, palette.bg, 210)
      p.rect(inner.x, vy - 6, inner.w, 28)
      enableGlow(ctx, palette.danger, 0.9)
      strokeHex(p, palette.danger, blink ? 255 : 140)
      p.strokeWeight(1.5)
      p.noFill()
      p.rect(inner.x, vy - 6, inner.w, 28)
      disableGlow(ctx)
      p.noStroke()
      fillHex(p, palette.danger, blink ? 255 : 170)
      p.textSize(9.5)
      p.textAlign(p.CENTER, p.CENTER)
      p.text('⚠ ARRESTO PREVENTIVO — EVIDENCIA VISUAL ANEXADA', gcx, vy + 8)
    } else {
      p.noStroke()
      fillHex(p, lv.dpi > 0.5 ? palette.warn : palette.ok, 220)
      p.textSize(9)
      p.textAlign(p.CENTER, p.CENTER)
      p.text(
        lv.dpi > 0.5 ? 'VEREDICTO: VIGILANCIA REFORZADA' : 'VEREDICTO: CONDUCTA DENTRO DE NORMA',
        gcx,
        vy + 8,
      )
    }
    p.pop()
  }
}
