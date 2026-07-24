/**
 * LoyaltyWindows.ts — The Great Leader's dashboard for citizen 4471.
 *
 * A second view over the implant (the IMPLANTE screen stays untouched):
 * the same BioStateEntity simulates the body, and a LoyaltyStateEntity
 * derives the regime's scores from it —
 *
 *  - PhysioWindow: real-time fear index (cortisol+adrenaline), resting
 *    HR + HRV, sleep quota, caloric intake vs output ("resource
 *    efficiency"), the rationed joy meters, illness onset prediction.
 *  - ConductWindow: Contribution Quotient with a 7-day labor chart,
 *    idle minutes, a movement heatmap, and the social proximity graph.
 *  - LoyaltyWindow: sentiment toward Leadership measured against a
 *    portrait stimulus, micro-expression flags, reaction latency to the
 *    Leader's name, and the Dissent Probability Index — cross the
 *    threshold and a preventive arrest order is issued.
 *  - StateWindow: the national dashboard — published vs REAL happiness,
 *    Social Harmony Coefficient, reproductive quota.
 *
 * Cues: show the portrait, run a dissent evaluation (DPI ramps over the
 * arrest threshold), pardon (the algorithm "was wrong"), curate the
 * national happiness figure. The implant's PÁNICO cue works here too.
 */

import { Entity } from '../core/Entity'
import { OSWindow, type OSWindowOpts } from './OSWindow'
import type { OSContext } from '../core/context'
import { fillHex, strokeHex } from '../core/context'
import type { Rect } from '../core/geometry'
import { enableGlow, disableGlow } from '../fx/Effects'
import type { LogLevel } from './TextStream'
import type { BioStateEntity } from './BioWindows'

export const LOYALTY_FEED: { text: string; level: LogLevel }[] = [
  { text: 'RETRATO DEL LÍDER emitido — respuesta neural archivada', level: 'info' },
  { text: 'CIU-8812 reclasificado: RIESGO MEDIO', level: 'warn' },
  { text: 'CUOTA REPRODUCTIVA sector 4 — 74% del trimestre', level: 'dim' },
  { text: 'MICROEXPRESIÓN de desprecio — tercer aviso', level: 'danger' },
  { text: 'FELICIDAD NACIONAL curada para el boletín matutino', level: 'ok' },
  { text: 'VECINO 2201 reporta conversación — crédito +50', level: 'info' },
  { text: 'LATENCIA AL NOMBRE dentro de rango leal', level: 'ok' },
  { text: 'GRAFO SOCIAL actualizado — 2 aristas nuevas', level: 'dim' },
  { text: 'MINUTOS IMPRODUCTIVOS facturados al sujeto', level: 'warn' },
  { text: 'HIMNO reproducido — seguimiento ocular 96%', level: 'ok' },
  { text: 'PATRÓN DE SUEÑO compatible con obediencia', level: 'dim' },
  { text: 'ALGORITMO DE DISIDENCIA recalibrado v12.4', level: 'warn' },
]

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

// ---------------------------------------------------------------------
// LoyaltyStateEntity — derives the regime's scores from the bio sim.
// ---------------------------------------------------------------------

type MicroExpr = 'DESPRECIO' | 'ASCO' | 'DUDA' | 'TEMOR'

export class LoyaltyStateEntity extends Entity {
  z = -9
  private bio: BioStateEntity

  // Cue plumbing (stamped from ctx.t in update).
  private pendingPortrait = false
  private pendingDissent = false
  private pendingPardon = false
  private pendingCurate = false
  portraitUntil = -1
  private dissentStart = -1
  private dpiTarget = 0

  // Outputs.
  fear = 0.2
  fearHist: number[] = []
  hrv = 58 // ms
  sentiment = 0.62
  sentimentHist: number[] = []
  dpi = 0.12
  arrestIssued = false
  latencyMs = 205
  microExprCount = 2
  lastMicroExpr: MicroExpr | null = null
  private lastExprStamp = -1
  happinessReal = 0.44
  happinessPub = 0.942
  harmony = 0.71
  idleMinutes = 34
  contribution = 0.87

  constructor(bio: BioStateEntity) {
    super()
    this.bio = bio
  }

  /** Cue: flash the Leader's portrait and measure the response. */
  showPortrait(): void {
    this.pendingPortrait = true
  }
  /** Cue: run a dissent evaluation — DPI climbs past the threshold. */
  dissent(): void {
    this.pendingDissent = true
  }
  /** Cue: the algorithm "was wrong" — rescind and settle back down. */
  pardon(): void {
    this.pendingPardon = true
  }
  /** Cue: curate the published national happiness figure. */
  curate(): void {
    this.pendingCurate = true
  }

  get portraitActive(): boolean {
    return this.portraitUntil > 0
  }

  update(ctx: OSContext): void {
    const t = ctx.t
    const cfg = ctx.config.scenes.loyalty
    const bio = this.bio
    const n = (seed: number, speed = 0.3) => ctx.p.noise(seed, t * speed)

    if (this.pendingPortrait) {
      this.portraitUntil = t + cfg.portraitSeconds
      this.pendingPortrait = false
    }
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
    if (this.pendingCurate) {
      this.happinessPub = Math.min(0.989, this.happinessPub + cfg.curateStep)
      this.happinessReal = Math.max(0.2, this.happinessReal - cfg.curateStep * 2.5)
      this.pendingCurate = false
    }
    if (this.portraitUntil > 0 && t > this.portraitUntil) this.portraitUntil = -1

    // Fear index: the regime's favorite number.
    const fearRaw = clamp01(bio.cort * 0.62 + bio.adre * 0.5)
    this.fear += (fearRaw - this.fear) * Math.min(1, ctx.dt * 2)
    if (this.fearHist.length === 0) this.fearHist = new Array<number>(140).fill(this.fear)
    if (ctx.frame % 10 === 0) {
      this.fearHist.push(this.fear)
      if (this.fearHist.length > 140) this.fearHist.shift()
    }

    // HRV collapses under stress (and reads "nervous around the regime").
    this.hrv = Math.max(8, 62 - this.fear * 42 + n(31) * 8)

    // Sentiment toward Leadership: eases toward the measured response
    // while the portrait stimulus is up, drifts at baseline otherwise.
    const measured = clamp01(
      0.74 - this.fear * 0.42 - (bio.inLie ? 0.28 : 0) + n(32) * 0.12,
    )
    const target = this.portraitActive ? measured : 0.6 + n(33) * 0.1
    this.sentiment += (target - this.sentiment) * Math.min(1, ctx.dt * (this.portraitActive ? 2.4 : 0.4))
    if (this.sentimentHist.length === 0) {
      this.sentimentHist = new Array<number>(120).fill(this.sentiment)
    }
    if (ctx.frame % 12 === 0) {
      this.sentimentHist.push(this.sentiment)
      if (this.sentimentHist.length > 120) this.sentimentHist.shift()
    }

    // Micro-expressions get flagged when the portrait catches real feelings.
    if (
      this.portraitActive &&
      (this.fear > 0.5 || bio.inLie) &&
      t - this.lastExprStamp > 2.2
    ) {
      const pool: MicroExpr[] = ['DESPRECIO', 'ASCO', 'DUDA', 'TEMOR']
      this.lastMicroExpr = pool[Math.floor(Math.random() * pool.length)]
      this.microExprCount++
      this.lastExprStamp = t
    }

    // Reaction latency to the Leader's name.
    this.latencyMs = 190 + this.fear * 150 + (bio.inLie ? 210 : 0) + n(34) * 40

    // Dissent Probability Index.
    let dpiBase = 0.1 + n(35) * 0.07 + (bio.inLie ? 0.18 : 0) + this.fear * 0.08
    if (this.dissentStart >= 0) {
      const ramp = Math.min(1, (t - this.dissentStart) / cfg.dissentSeconds)
      dpiBase = dpiBase + (this.dpiTarget - dpiBase) * ramp
    }
    this.dpi += (clamp01(dpiBase) - this.dpi) * Math.min(1, ctx.dt * 1.4)
    // Latch only while an evaluation is running — otherwise a pardon
    // would re-arm during the frames the DPI is still easing down.
    if (this.dissentStart >= 0 && this.dpi >= cfg.dpiThreshold) {
      this.arrestIssued = true
    }

    // Aggregates + conduct.
    this.harmony = clamp01(0.5 + (bio.obed - 0.5) * 0.6 + n(36) * 0.06)
    this.happinessReal = clamp01(this.happinessReal + (0.44 - this.fear * 0.12 - this.happinessReal) * ctx.dt * 0.2)
    this.idleMinutes = 30 + Math.floor(n(37, 0.05) * 25)
    this.contribution = clamp01(0.84 + n(38) * 0.1 - this.fear * 0.08)
  }

  draw(): void {
    // Invisible: derived state only.
  }
}

// ---------------------------------------------------------------------
// PhysioWindow — fear index + rationed biology.
// ---------------------------------------------------------------------

export class PhysioWindow extends OSWindow {
  private bio: BioStateEntity
  private loy: LoyaltyStateEntity

  constructor(o: OSWindowOpts, bio: BioStateEntity, loy: LoyaltyStateEntity) {
    super(o)
    this.bio = bio
    this.loy = loy
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    const bio = this.bio
    const loy = this.loy
    p.push()

    // --- Fear index: headline number + area trend.
    const fearPct = loy.fear * 100
    const fcol = loy.fear > 0.65 ? palette.danger : loy.fear > 0.4 ? palette.warn : palette.ok
    p.noStroke()
    fillHex(p, palette.fgDim, 190)
    p.textSize(8.5)
    p.textAlign(p.LEFT, p.TOP)
    p.text('ÍNDICE DE MIEDO — TIEMPO REAL', inner.x, inner.y)
    enableGlow(ctx, fcol, 0.5)
    fillHex(p, fcol, 245)
    p.textSize(30)
    p.text(`${fearPct.toFixed(1)}%`, inner.x, inner.y + 12)
    disableGlow(ctx)
    const trendR: Rect = { x: inner.x + 108, y: inner.y + 14, w: inner.w - 110, h: 34 }
    strokeHex(p, palette.grid, 120)
    p.noFill()
    p.rect(trendR.x, trendR.y, trendR.w, trendR.h)
    p.noStroke()
    fillHex(p, fcol, 60)
    p.beginShape()
    p.vertex(trendR.x, trendR.y + trendR.h)
    loy.fearHist.forEach((v, i) => {
      p.vertex(trendR.x + (i / 139) * trendR.w, trendR.y + trendR.h - v * trendR.h * 0.94)
    })
    p.vertex(trendR.x + trendR.w, trendR.y + trendR.h)
    p.endShape(p.CLOSE)

    // --- Cardio row: resting HR + HRV.
    let y = inner.y + 58
    const row = (label: string, value: string, col: string, sub?: string) => {
      p.noStroke()
      fillHex(p, palette.fgDim, 190)
      p.textSize(8.5)
      p.textAlign(p.LEFT, p.CENTER)
      p.text(label, inner.x, y + 7)
      fillHex(p, col, 235)
      p.textAlign(p.RIGHT, p.CENTER)
      p.textSize(10)
      p.text(value, inner.x + inner.w, y + 7)
      if (sub) {
        fillHex(p, palette.fgDim, 140)
        p.textSize(7.5)
        p.textAlign(p.RIGHT, p.CENTER)
        p.text(sub, inner.x + inner.w, y + 18)
        y += 10
      }
      y += 17
    }
    row('FC EN REPOSO', `${Math.round(bio.hr)} LPM`, bio.hr > 100 ? palette.warn : palette.fg)
    row(
      'VARIABILIDAD (HRV)',
      `${loy.hrv.toFixed(0)} MS`,
      loy.hrv < 30 ? palette.danger : palette.fg,
      loy.hrv < 30 ? 'NERVIOSO ANTE EL RÉGIMEN' : 'DENTRO DE RANGO',
    )

    // --- Sleep: quota bar + last 7 nights.
    y += 4
    p.noStroke()
    fillHex(p, palette.fgDim, 190)
    p.textSize(8.5)
    p.textAlign(p.LEFT, p.TOP)
    p.text('SUEÑO — CUOTA ESTATAL 8H', inner.x, y)
    const nights = 7
    const bw = (inner.w - (nights - 1) * 3) / nights
    for (let i = 0; i < nights; i++) {
      const hrs = 5.4 + p.noise(41 + i) * 3
      const frac = Math.min(1, hrs / 8)
      const col = hrs < 6 ? palette.danger : hrs < 7.2 ? palette.warn : palette.ok
      const bh = 26 * frac
      p.noStroke()
      fillHex(p, col, 170)
      p.rect(inner.x + i * (bw + 3), y + 12 + (26 - bh), bw, bh)
    }
    y += 46

    // --- Calories: intake vs output = "resource efficiency".
    const intake = 2140 + p.noise(42, ctx.t * 0.05) * 160
    const output = 1980 + p.noise(43, ctx.t * 0.05) * 220
    const eff = output / intake
    p.noStroke()
    fillHex(p, palette.fgDim, 190)
    p.text('EFICIENCIA DE RECURSOS', inner.x, y)
    fillHex(p, eff > 0.98 ? palette.ok : palette.warn, 230)
    p.textAlign(p.RIGHT, p.TOP)
    p.text(`${(eff * 100).toFixed(1)}%`, inner.x + inner.w, y)
    p.textAlign(p.LEFT, p.TOP)
    const calBar = (label: string, v: number, max: number, col: string, yy: number) => {
      fillHex(p, palette.fgDim, 150)
      p.textSize(7.5)
      p.text(label, inner.x, yy)
      strokeHex(p, palette.grid, 130)
      p.noFill()
      p.rect(inner.x + 52, yy, inner.w - 52 - 46, 7)
      p.noStroke()
      fillHex(p, col, 180)
      p.rect(inner.x + 53, yy + 1, (inner.w - 54 - 46) * Math.min(1, v / max), 5)
      fillHex(p, col, 220)
      p.textAlign(p.RIGHT, p.TOP)
      p.text(`${Math.round(v)}`, inner.x + inner.w, yy)
      p.textAlign(p.LEFT, p.TOP)
    }
    calBar('INGESTA', intake, 2600, palette.fg, y + 12)
    calBar('GASTO', output, 2600, palette.accent, y + 23)
    y += 40

    // --- Rationed joy.
    p.textSize(8.5)
    fillHex(p, palette.fgDim, 190)
    p.text('RACIÓN DE ALEGRÍA — SEMANA 27', inner.x, y)
    const joyUsed = clamp01(bio.dopa * 0.9)
    strokeHex(p, palette.grid, 150)
    p.noFill()
    p.rect(inner.x, y + 12, inner.w, 9)
    p.noStroke()
    fillHex(p, joyUsed > 0.85 ? palette.danger : palette.accent, 190)
    p.rect(inner.x + 1, y + 13, (inner.w - 2) * joyUsed, 7)
    strokeHex(p, palette.warn, 170)
    p.line(inner.x + inner.w * 0.85, y + 9, inner.x + inner.w * 0.85, y + 24)
    p.noStroke()
    fillHex(p, palette.fgDim, 160)
    p.textSize(7.5)
    p.text(
      joyUsed > 0.85 ? 'CUOTA EXCEDIDA — DOSIS RETENIDA' : `CONSUMIDA ${(joyUsed * 100).toFixed(0)}% · SEROTONINA ${(bio.sero * 200).toFixed(0)}NG/ML`,
      inner.x,
      y + 26,
    )
    y += 44

    // --- Illness onset prediction.
    const febrile = bio.temp > 37.3
    p.textSize(8.5)
    fillHex(p, palette.fgDim, 190)
    p.text('INICIO DE ENFERMEDAD (PREDICTIVO)', inner.x, y)
    const icol = febrile ? palette.warn : palette.ok
    fillHex(p, icol, 235)
    p.textSize(10)
    p.text(
      febrile
        ? `T° ${bio.temp.toFixed(1)}°C — CUARENTENA EN 14H`
        : `T° ${bio.temp.toFixed(1)}°C — SIN PATÓGENO`,
      inner.x,
      y + 12,
    )
    p.pop()
  }
}

// ---------------------------------------------------------------------
// ConductWindow — productivity + movement + social graph.
// ---------------------------------------------------------------------

export class ConductWindow extends OSWindow {
  private loy: LoyaltyStateEntity

  constructor(o: OSWindowOpts, loy: LoyaltyStateEntity) {
    super(o)
    this.loy = loy
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    const loy = this.loy
    p.push()

    // --- Contribution Quotient + labor bars.
    p.noStroke()
    fillHex(p, palette.fgDim, 190)
    p.textSize(8.5)
    p.textAlign(p.LEFT, p.TOP)
    p.text('COCIENTE DE CONTRIBUCIÓN', inner.x, inner.y)
    enableGlow(ctx, palette.accent, 0.4)
    fillHex(p, palette.accent, 245)
    p.textSize(26)
    p.text(loy.contribution.toFixed(2), inner.x, inner.y + 11)
    disableGlow(ctx)
    fillHex(p, palette.fgDim, 160)
    p.textSize(7.5)
    p.text(`MINUTOS IMPRODUCTIVOS HOY: ${loy.idleMinutes}`, inner.x, inner.y + 40)
    // 7-day labor output.
    const days = 7
    const chart: Rect = { x: inner.x + 118, y: inner.y + 6, w: inner.w - 120, h: 44 }
    const dw = (chart.w - (days - 1) * 3) / days
    for (let i = 0; i < days; i++) {
      const v = 0.5 + p.noise(51 + i) * 0.5
      p.noStroke()
      fillHex(p, i === days - 1 ? palette.accent : palette.fgDim, i === days - 1 ? 220 : 130)
      p.rect(chart.x + i * (dw + 3), chart.y + chart.h * (1 - v), dw, chart.h * v)
    }
    fillHex(p, palette.fgDim, 140)
    p.textAlign(p.RIGHT, p.TOP)
    p.text('PRODUCCIÓN 7 DÍAS', chart.x + chart.w, chart.y + chart.h + 2)
    p.textAlign(p.LEFT, p.TOP)

    // --- Movement heatmap.
    let y = inner.y + 66
    fillHex(p, palette.fgDim, 190)
    p.textSize(8.5)
    p.text('MAPA DE CALOR — MOVIMIENTO 24H · SECTOR 4', inner.x, y)
    const cols = 16
    const rows = 7
    const mapR: Rect = { x: inner.x, y: y + 12, w: inner.w, h: rows * 13 }
    const cw = mapR.w / cols
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        // Two hot lobes: home and assigned workplace.
        const dHome = Math.hypot(gx - 3, gy - 5) / 6
        const dWork = Math.hypot(gx - 12, gy - 1.6) / 6
        const v = clamp01(
          Math.max(1 - dHome, 1 - dWork) * 0.85 + p.noise(gx * 0.7, gy * 0.7, ctx.t * 0.05) * 0.25,
        )
        p.noStroke()
        const col = v > 0.72 ? palette.warn : palette.fg
        fillHex(p, col, 18 + v * 150)
        p.rect(mapR.x + gx * cw + 0.5, mapR.y + gy * 13 + 0.5, cw - 1, 12)
      }
    }
    p.textSize(7)
    fillHex(p, palette.accent, 220)
    p.text('CASA', mapR.x + 3 * cw - 8, mapR.y + 5 * 13 + 3)
    p.text('TRABAJO', mapR.x + 12 * cw - 14, mapR.y + 1 * 13 + 3)
    y = mapR.y + mapR.h + 10

    // --- Social proximity graph.
    fillHex(p, palette.fgDim, 190)
    p.textSize(8.5)
    p.text('GRAFO DE PROXIMIDAD SOCIAL — 7 DÍAS', inner.x, y)
    const gcy = y + (inner.y + inner.h - y) / 2 + 6
    const gcx = inner.x + inner.w / 2
    const rad = Math.min(inner.w * 0.32, inner.y + inner.h - y - 30)
    const contacts = [
      { id: 'CIU-2201', min: 184, sus: false },
      { id: 'CIU-8812', min: 122, sus: true },
      { id: 'CIU-4090', min: 96, sus: false },
      { id: 'CIU-1147', min: 61, sus: false },
      { id: 'CIU-6653', min: 38, sus: false },
      { id: 'CIU-3324', min: 17, sus: false },
    ]
    contacts.forEach((c, i) => {
      const a = (i / contacts.length) * Math.PI * 2 - Math.PI / 2
      const jitter = p.noise(61 + i, ctx.t * 0.12) * 6
      const nx = gcx + Math.cos(a) * (rad + jitter)
      const ny = gcy + Math.sin(a) * (rad * 0.62 + jitter)
      const col = c.sus ? palette.danger : palette.fg
      strokeHex(p, col, 60 + (c.min / 184) * 140)
      p.strokeWeight(0.6 + (c.min / 184) * 2.4)
      p.line(gcx, gcy, nx, ny)
      p.noStroke()
      fillHex(p, col, 220)
      p.circle(nx, ny, c.sus ? 7 : 5)
      p.textSize(6.8)
      p.textAlign(p.CENTER, ny < gcy ? p.BOTTOM : p.TOP)
      fillHex(p, col, 200)
      p.text(`${c.id} · ${c.min}M`, nx, ny + (ny < gcy ? -5 : 5))
    })
    // Subject node.
    enableGlow(ctx, palette.accent, 0.5)
    p.noStroke()
    fillHex(p, palette.accent, 245)
    p.circle(gcx, gcy, 9)
    disableGlow(ctx)
    p.textSize(7.5)
    p.textAlign(p.CENTER, p.TOP)
    fillHex(p, palette.accent, 230)
    p.text('SUJ-4471', gcx, gcy + 8)
    const sus = contacts.find((c) => c.sus)
    if (sus && Math.floor(ctx.t * 2) % 2 === 0) {
      fillHex(p, palette.danger, 220)
      p.textAlign(p.RIGHT, p.BOTTOM)
      p.text(`⚠ ${sus.id} BAJO SOSPECHA`, inner.x + inner.w, inner.y + inner.h)
    }
    p.pop()
  }
}

// ---------------------------------------------------------------------
// LoyaltyWindow — sentiment, portrait stimulus, latency, and the DPI.
// ---------------------------------------------------------------------

export class LoyaltyWindow extends OSWindow {
  private loy: LoyaltyStateEntity

  constructor(o: OSWindowOpts, loy: LoyaltyStateEntity) {
    super(o)
    this.loy = loy
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    const loy = this.loy
    const cfg = ctx.config.scenes.loyalty
    p.push()

    // --- Portrait stimulus panel (left) + sentiment (right).
    const portW = Math.min(96, inner.w * 0.3)
    const portR: Rect = { x: inner.x, y: inner.y + 12, w: portW, h: 108 }
    p.noStroke()
    fillHex(p, palette.fgDim, 190)
    p.textSize(8.5)
    p.textAlign(p.LEFT, p.TOP)
    p.text('ESTÍMULO', inner.x, inner.y)
    const active = loy.portraitActive
    strokeHex(p, active ? palette.warn : palette.fgDim, active ? 230 : 130)
    p.strokeWeight(active ? 1.5 : 1)
    p.noFill()
    p.rect(portR.x, portR.y, portR.w, portR.h)
    // Stylized bust: head + shoulders silhouette.
    const bx = portR.x + portR.w / 2
    const scol = active ? palette.warn : palette.fgDim
    p.noStroke()
    fillHex(p, scol, active ? 120 : 60)
    p.ellipse(bx, portR.y + portR.h * 0.34, portR.w * 0.42, portR.h * 0.4)
    p.rect(bx - portR.w * 0.34, portR.y + portR.h * 0.6, portR.w * 0.68, portR.h * 0.36, 4)
    // Peaked cap silhouette.
    fillHex(p, scol, active ? 160 : 80)
    p.rect(bx - portR.w * 0.26, portR.y + portR.h * 0.15, portR.w * 0.52, portR.h * 0.09)
    p.rect(bx - portR.w * 0.19, portR.y + portR.h * 0.07, portR.w * 0.38, portR.h * 0.09)
    if (active) {
      // Scan lines over the stimulus.
      strokeHex(p, palette.warn, 90)
      p.strokeWeight(1)
      const sy = portR.y + ((ctx.t * 60) % portR.h)
      p.line(portR.x + 2, sy, portR.x + portR.w - 2, sy)
    }
    p.noStroke()
    fillHex(p, active ? palette.warn : palette.fgDim, active ? 240 : 150)
    p.textSize(7.5)
    p.textAlign(p.CENTER, p.TOP)
    p.text(active ? '◉ RETRATO EN PANTALLA' : 'EL LÍDER — EN ESPERA', bx, portR.y + portR.h + 3)

    // Sentiment score + trend.
    const sx = inner.x + portW + 12
    const scw = inner.w - portW - 12
    const scol2 = loy.sentiment < 0.45 ? palette.danger : loy.sentiment < 0.6 ? palette.warn : palette.ok
    p.textAlign(p.LEFT, p.TOP)
    fillHex(p, palette.fgDim, 190)
    p.textSize(8.5)
    p.text('SENTIMIENTO HACIA EL LIDERAZGO', sx, inner.y)
    enableGlow(ctx, scol2, 0.4)
    fillHex(p, scol2, 245)
    p.textSize(24)
    p.text(`${(loy.sentiment * 100).toFixed(1)}`, sx, inner.y + 11)
    disableGlow(ctx)
    fillHex(p, palette.fgDim, 150)
    p.textSize(7.5)
    p.text(active ? 'MIDIENDO RESPUESTA NEURAL…' : 'BASE HISTÓRICA', sx + 62, inner.y + 24)
    const st: Rect = { x: sx, y: inner.y + 44, w: scw, h: 30 }
    strokeHex(p, palette.grid, 120)
    p.noFill()
    p.rect(st.x, st.y, st.w, st.h)
    strokeHex(p, scol2, 210)
    p.strokeWeight(1.2)
    p.beginShape()
    loy.sentimentHist.forEach((v, i) => {
      p.vertex(st.x + (i / 119) * st.w, st.y + st.h - v * st.h * 0.92 - 1)
    })
    p.endShape()

    // Micro-expressions + latency rows.
    let y = inner.y + 84
    p.noStroke()
    fillHex(p, palette.fgDim, 190)
    p.textSize(8.5)
    p.text('MICROEXPRESIONES EN PROPAGANDA', sx, y)
    fillHex(p, loy.microExprCount > 3 ? palette.danger : palette.fg, 235)
    p.textAlign(p.RIGHT, p.TOP)
    p.text(
      loy.lastMicroExpr ? `${loy.microExprCount} · ÚLT: ${loy.lastMicroExpr}` : String(loy.microExprCount),
      sx + scw,
      y,
    )
    p.textAlign(p.LEFT, p.TOP)
    y += 16
    fillHex(p, palette.fgDim, 190)
    p.text('LATENCIA AL NOMBRE DEL LÍDER', sx, y)
    const lcol = loy.latencyMs > 400 ? palette.danger : loy.latencyMs > 300 ? palette.warn : palette.ok
    fillHex(p, lcol, 235)
    p.textAlign(p.RIGHT, p.TOP)
    p.text(`${Math.round(loy.latencyMs)} MS`, sx + scw, y)
    p.textAlign(p.LEFT, p.TOP)

    // --- Dissent Probability Index gauge.
    const gy = inner.y + 150
    const gaugeH = inner.h - (gy - inner.y) - 58
    const gcx = inner.x + inner.w / 2
    const gcy = gy + Math.min(gaugeH, inner.w * 0.42)
    const gr = Math.min(gaugeH * 0.92, inner.w * 0.4)
    fillHex(p, palette.fgDim, 200)
    p.textSize(9)
    p.textAlign(p.CENTER, p.TOP)
    p.text('ÍNDICE DE PROBABILIDAD DE DISIDENCIA', gcx, gy - 6)
    const a0 = Math.PI * 0.75
    const a1 = Math.PI * 2.25
    // Zone arcs: ok → warn → danger past threshold.
    const zone = (from: number, to: number, col: string, alpha: number) => {
      strokeHex(p, col, alpha)
      p.strokeWeight(7)
      p.noFill()
      p.arc(gcx, gcy, gr * 2, gr * 2, a0 + (a1 - a0) * from, a0 + (a1 - a0) * to)
    }
    zone(0, 0.5, palette.ok, 70)
    zone(0.5, cfg.dpiThreshold, palette.warn, 80)
    zone(cfg.dpiThreshold, 1, palette.danger, 110)
    // Threshold tick.
    const ta = a0 + (a1 - a0) * cfg.dpiThreshold
    strokeHex(p, palette.danger, 230)
    p.strokeWeight(2)
    p.line(
      gcx + Math.cos(ta) * (gr - 9),
      gcy + Math.sin(ta) * (gr - 9),
      gcx + Math.cos(ta) * (gr + 9),
      gcy + Math.sin(ta) * (gr + 9),
    )
    // Needle.
    const na = a0 + (a1 - a0) * loy.dpi
    const ncol = loy.dpi >= cfg.dpiThreshold ? palette.danger : loy.dpi > 0.5 ? palette.warn : palette.fg
    enableGlow(ctx, ncol, 0.6)
    strokeHex(p, ncol, 245)
    p.strokeWeight(2)
    p.line(gcx, gcy, gcx + Math.cos(na) * (gr - 14), gcy + Math.sin(na) * (gr - 14))
    disableGlow(ctx)
    p.noStroke()
    fillHex(p, ncol, 245)
    p.circle(gcx, gcy, 6)
    p.textSize(20)
    p.textAlign(p.CENTER, p.TOP)
    enableGlow(ctx, ncol, 0.4)
    p.text(`${(loy.dpi * 100).toFixed(1)}%`, gcx, gcy + 10)
    disableGlow(ctx)
    p.textSize(7.5)
    fillHex(p, palette.fgDim, 160)
    p.text(`UMBRAL DE ARRESTO PREVENTIVO ${(cfg.dpiThreshold * 100).toFixed(0)}%`, gcx, gcy + 34)

    // Verdict / arrest banner.
    const vy = inner.y + inner.h - 26
    if (loy.arrestIssued) {
      const blink = Math.floor(ctx.t * 4) % 2 === 0
      p.noStroke()
      fillHex(p, palette.bg, 210)
      p.rect(inner.x, vy - 6, inner.w, 30)
      enableGlow(ctx, palette.danger, 0.9)
      strokeHex(p, palette.danger, blink ? 255 : 140)
      p.strokeWeight(1.5)
      p.noFill()
      p.rect(inner.x, vy - 6, inner.w, 30)
      disableGlow(ctx)
      p.noStroke()
      fillHex(p, palette.danger, blink ? 255 : 170)
      p.textSize(10.5)
      p.textAlign(p.CENTER, p.CENTER)
      p.text('⚠ ORDEN DE ARRESTO PREVENTIVO EMITIDA — UNIDAD EN CAMINO', gcx, vy + 9)
    } else {
      p.noStroke()
      fillHex(p, loy.dpi > 0.5 ? palette.warn : palette.ok, 220)
      p.textSize(9)
      p.textAlign(p.CENTER, p.CENTER)
      p.text(
        loy.dpi > 0.5 ? 'VEREDICTO: VIGILANCIA REFORZADA' : 'VEREDICTO: CIUDADANO ESTABLE',
        gcx,
        vy + 9,
      )
    }
    p.pop()
  }
}

// ---------------------------------------------------------------------
// StateWindow — the national dashboard (the curated lie).
// ---------------------------------------------------------------------

export class StateWindow extends OSWindow {
  private loy: LoyaltyStateEntity

  constructor(o: OSWindowOpts, loy: LoyaltyStateEntity) {
    super(o)
    this.loy = loy
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    const loy = this.loy
    p.push()

    // National happiness: published (the brag) vs real (classified).
    p.noStroke()
    fillHex(p, palette.fgDim, 190)
    p.textSize(8.5)
    p.textAlign(p.LEFT, p.TOP)
    p.text('FELICIDAD NACIONAL PROMEDIO', inner.x, inner.y)
    enableGlow(ctx, palette.ok, 0.5)
    fillHex(p, palette.ok, 245)
    p.textSize(26)
    p.text(`${(loy.happinessPub * 100).toFixed(1)}%`, inner.x, inner.y + 11)
    disableGlow(ctx)
    fillHex(p, palette.fgDim, 150)
    p.textSize(7.5)
    p.text('PUBLICADO — BOLETÍN 27', inner.x + 88, inner.y + 18)
    fillHex(p, palette.danger, 200)
    p.textSize(8.5)
    p.text(`REAL: ${(loy.happinessReal * 100).toFixed(1)}% · CLASIFICADO OMEGA`, inner.x, inner.y + 42)

    // Social harmony coefficient.
    let y = inner.y + 62
    fillHex(p, palette.fgDim, 190)
    p.text('COEFICIENTE DE ARMONÍA SOCIAL', inner.x, y)
    const hcol = loy.harmony > 0.6 ? palette.ok : palette.warn
    fillHex(p, hcol, 235)
    p.textAlign(p.RIGHT, p.TOP)
    p.text(loy.harmony.toFixed(3), inner.x + inner.w, y)
    p.textAlign(p.LEFT, p.TOP)
    strokeHex(p, palette.grid, 150)
    p.noFill()
    p.rect(inner.x, y + 11, inner.w, 7)
    p.noStroke()
    fillHex(p, hcol, 180)
    p.rect(inner.x + 1, y + 12, (inner.w - 2) * loy.harmony, 5)
    y += 30

    // Reproductive quota.
    const births = 4471 + Math.floor(p.noise(71, ctx.t * 0.02) * 40)
    const quota = 6000
    fillHex(p, palette.fgDim, 190)
    p.text('CUOTA REPRODUCTIVA — TRIMESTRE 3', inner.x, y)
    fillHex(p, palette.fg, 230)
    p.textAlign(p.RIGHT, p.TOP)
    p.text(`${births}/${quota}`, inner.x + inner.w, y)
    p.textAlign(p.LEFT, p.TOP)
    strokeHex(p, palette.grid, 150)
    p.noFill()
    p.rect(inner.x, y + 11, inner.w, 7)
    p.noStroke()
    fillHex(p, palette.accent, 180)
    p.rect(inner.x + 1, y + 12, (inner.w - 2) * (births / quota), 5)
    y += 30

    // Population inventory lines.
    const stats: [string, string][] = [
      ['CIUDADANOS BAJO IMPLANTE', '12 401 962'],
      ['EN VIGILANCIA REFORZADA', '84 112'],
      ['ARRESTOS PREVENTIVOS HOY', String(17 + (loy.arrestIssued ? 1 : 0))],
      ['ÍNDICE DE NATALIDAD OBJETIVO', '2.4 / MUJER'],
    ]
    p.textSize(8)
    stats.forEach(([label, value], i) => {
      const sy = y + i * 15
      if (sy + 12 > inner.y + inner.h) return
      fillHex(p, palette.fgDim, 180)
      p.textAlign(p.LEFT, p.CENTER)
      p.text(label, inner.x, sy + 6)
      fillHex(p, i === 2 && loy.arrestIssued ? palette.danger : palette.fg, 220)
      p.textAlign(p.RIGHT, p.CENTER)
      p.text(value, inner.x + inner.w, sy + 6)
    })
    p.pop()
  }
}
