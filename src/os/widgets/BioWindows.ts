/**
 * BioWindows.ts — Implant telemetry: what the state reads out of a chip
 * sewn into citizen 4471.
 *
 * A shared BioStateEntity simulates the subject each frame — heart rate
 * with a proper PQRST beat, blood pressure, SpO2, respiration,
 * neurotransmitters (dopamine, serotonin, cortisol, adrenaline,
 * oxytocin) and the regime's behavioral scores (obedience, deception,
 * cognitive load, emotional state). Four windows render views of it:
 *
 *  - BodyMapWindow: scanner-slice hologram of the subject with live
 *    sensor nodes and the implant ping.
 *  - VitalsWindow: ECG/pleth/resp traces + numeric vitals, alarms.
 *  - NeuroChemWindow: neurotransmitter bars + dopamine trend.
 *  - BehaviorWindow: obedience/deception meters and the emotion
 *    classifier ("PENSAMIENTO DISIDENTE: NO DETECTADO").
 *
 * Director cues: panic attack, remote sedation, dopamine reward,
 * deception flag, and a cardiac arrest with auto-resuscitation.
 */

import type p5 from 'p5'
import { Entity } from '../core/Entity'
import { OSWindow, type OSWindowOpts } from './OSWindow'
import type { OSContext } from '../core/context'
import { fillHex, strokeHex } from '../core/context'
import type { Rect } from '../core/geometry'
import { enableGlow, disableGlow } from '../fx/Effects'
import type { LogLevel } from './TextStream'

/** Ambient chatter for the implant log column. */
export const IMPLANT_FEED: { text: string; level: LogLevel }[] = [
  { text: 'MICRODOSIS 0.2MG liberada — lote ansiolítico', level: 'warn' },
  { text: 'SUEÑO REM interrumpido — marcador archivado', level: 'dim' },
  { text: 'GEOVALLA respetada — sector 4 / 11h42', level: 'ok' },
  { text: 'CONSUMO CALÓRICO 2140KCAL — dentro de cuota', level: 'info' },
  { text: 'PICO DE CORTISOL archivado — expediente 4471', level: 'warn' },
  { text: 'AUDIO SUBVOCAL — transcripción en cola', level: 'danger' },
  { text: 'HIDRATACIÓN 82% — recordatorio emitido', level: 'dim' },
  { text: 'CICLO CIRCADIANO sincronizado con turno estatal', level: 'info' },
  { text: 'CONTACTO FÍSICO detectado — registro social +1', level: 'info' },
  { text: 'BATERÍA DEL IMPLANTE 96% — piezo recarga OK', level: 'ok' },
  { text: 'UMBRAL DE IRA no alcanzado — sin intervención', level: 'ok' },
  { text: 'PUBLICIDAD DIRIGIDA calibrada con glucosa baja', level: 'warn' },
]

const G = (t: number, mu: number, sig: number): number =>
  Math.exp(-Math.pow((t - mu) / sig, 2))

export type Emotion = 'NEUTRO' | 'DÓCIL' | 'EUFORIA' | 'MIEDO' | 'ENGAÑO' | 'CRÍTICO'

const EMOTION_KEY: Record<Emotion, 'fg' | 'ok' | 'accent' | 'warn' | 'danger'> = {
  NEUTRO: 'fg',
  DÓCIL: 'ok',
  EUFORIA: 'accent',
  MIEDO: 'warn',
  ENGAÑO: 'danger',
  CRÍTICO: 'danger',
}

// ---------------------------------------------------------------------
// BioStateEntity — invisible simulator all bio windows read from.
// ---------------------------------------------------------------------

export class BioStateEntity extends Entity {
  z = -10

  // Cue windows (stamped from ctx.t in update).
  private panicUntil = -1
  private sedateUntil = -1
  private rewardUntil = -1
  private lieUntil = -1
  private arrestUntil = -1
  private recoverUntil = -1
  private pending: ('panic' | 'sedate' | 'reward' | 'lie' | 'arrest')[] = []

  // Continuous outputs (read by the windows every frame).
  hr = 72
  sys = 121
  dia = 79
  spo2 = 98
  resp = 14
  temp = 36.8
  /** Neurotransmitters, 0..1 of display range. */
  dopa = 0.45
  sero = 0.55
  cort = 0.3
  adre = 0.2
  oxy = 0.4
  /** Behavioral scores, 0..1. */
  obed = 0.87
  stress = 0.25
  decep = 0.08
  load = 0.4
  fatigue = 0.35
  emotion: Emotion = 'NEUTRO'
  emotionConf = 0.9
  /** 0..1 position inside the current heartbeat. */
  beatPhase = 0

  panic(): void {
    this.pending.push('panic')
  }
  sedate(): void {
    this.pending.push('sedate')
  }
  reward(): void {
    this.pending.push('reward')
  }
  flagLie(): void {
    this.pending.push('lie')
  }
  cardiacArrest(): void {
    this.pending.push('arrest')
  }

  get inArrest(): boolean {
    return this.arrestUntil >= 0 && this.recoverUntil < 0
  }
  get inPanic(): boolean {
    return this.panicUntil > 0
  }
  get inLie(): boolean {
    return this.lieUntil > 0
  }
  /** Short mode label for footers. */
  get modeLabel(): string {
    if (this.inArrest) return 'PARO — REANIMANDO'
    if (this.recoverUntil > 0) return 'POST-REANIMACIÓN'
    if (this.panicUntil > 0) return 'CRISIS DE PÁNICO'
    if (this.lieUntil > 0) return 'INTERROGATORIO'
    if (this.sedateUntil > 0) return 'SEDACIÓN REMOTA'
    if (this.rewardUntil > 0) return 'RECOMPENSA'
    return 'MONITOREO PASIVO'
  }

  update(ctx: OSContext): void {
    const t = ctx.t
    const cfg = ctx.config.scenes.implant
    for (const cue of this.pending) {
      switch (cue) {
        case 'panic':
          this.panicUntil = t + cfg.panicSeconds
          break
        case 'sedate':
          this.sedateUntil = t + cfg.sedateSeconds
          this.panicUntil = -1
          this.lieUntil = -1
          break
        case 'reward':
          this.rewardUntil = t + cfg.rewardSeconds
          break
        case 'lie':
          this.lieUntil = t + cfg.lieSeconds
          break
        case 'arrest':
          this.arrestUntil = t + cfg.arrestSeconds
          this.recoverUntil = -1
          this.panicUntil = -1
          this.sedateUntil = -1
          break
      }
    }
    this.pending = []
    // Expire windows.
    if (this.panicUntil > 0 && t > this.panicUntil) this.panicUntil = -1
    if (this.sedateUntil > 0 && t > this.sedateUntil) this.sedateUntil = -1
    if (this.rewardUntil > 0 && t > this.rewardUntil) this.rewardUntil = -1
    if (this.lieUntil > 0 && t > this.lieUntil) this.lieUntil = -1
    if (this.arrestUntil > 0 && this.recoverUntil < 0 && t > this.arrestUntil) {
      this.recoverUntil = t + cfg.recoverySeconds // resuscitated
    }
    if (this.recoverUntil > 0 && t > this.recoverUntil) {
      this.arrestUntil = -1
      this.recoverUntil = -1
    }

    const n = (seed: number, speed = 0.4) => ctx.p.noise(seed, t * speed)
    const arrest = this.inArrest
    const recovering = this.recoverUntil > 0
    const panic = this.panicUntil > 0
    const sedated = this.sedateUntil > 0
    const reward = this.rewardUntil > 0
    const lying = this.lieUntil > 0

    // --- Vitals -----------------------------------------------------------
    let hrTarget = cfg.baseHr + n(1) * 8
    if (sedated) hrTarget = cfg.sedateHr + n(1) * 4
    if (panic) hrTarget = cfg.panicHr + n(1) * 14
    if (lying) hrTarget = cfg.baseHr + 24 + n(1) * 10
    if (recovering) {
      hrTarget =
        cfg.baseHr +
        44 -
        Math.min(1, (t - this.arrestUntil) / cfg.recoverySeconds) * 34
    }
    if (arrest) hrTarget = 0
    // Ease toward target (fast collapse, slower recovery).
    this.hr += (hrTarget - this.hr) * Math.min(1, ctx.dt * (arrest ? 6 : 1.6))

    this.sys = 118 + (this.hr - cfg.baseHr) * 0.5 + n(2) * 6
    this.dia = 78 + (this.hr - cfg.baseHr) * 0.3 + n(3) * 4
    if (arrest) {
      this.sys = Math.max(40, this.sys - 60)
      this.dia = Math.max(20, this.dia - 50)
    }
    this.spo2 = arrest ? 74 + n(4) * 3 : sedated ? 96 : 97.5 + n(4) * 1.5
    this.resp = arrest ? 0 : panic ? 26 + n(5) * 4 : sedated ? 9 : 13 + n(5) * 3
    this.temp = 36.7 + n(6, 0.1) * 0.5 + (panic ? 0.4 : 0)

    // Heartbeat phase for the ECG + body-map pulse.
    if (this.hr > 5) this.beatPhase = (this.beatPhase + (this.hr / 60) * ctx.dt) % 1

    // --- Neurochemistry -----------------------------------------------------
    this.dopa = reward ? 0.9 + n(7) * 0.09 : sedated ? 0.55 : 0.4 + n(7) * 0.15
    this.sero = sedated ? 0.8 + n(8) * 0.1 : 0.5 + n(8) * 0.15
    this.cort = panic || arrest ? 0.85 + n(9) * 0.12 : lying ? 0.65 : 0.28 + n(9) * 0.12
    this.adre = panic || arrest ? 0.9 + n(10) * 0.09 : lying ? 0.55 : 0.18 + n(10) * 0.1
    this.oxy = reward ? 0.7 : sedated ? 0.6 : 0.38 + n(11) * 0.12

    // --- Behavior -----------------------------------------------------------
    this.stress = Math.min(1, this.cort * 0.7 + this.adre * 0.4)
    this.obed = sedated ? 0.98 : lying ? 0.42 : panic ? 0.6 : reward ? 0.95 : 0.85 + n(12) * 0.08
    this.decep = lying ? 0.93 + n(13) * 0.06 : 0.05 + n(13) * 0.09
    this.load = lying ? 0.85 : panic ? 0.75 : 0.35 + n(14) * 0.2
    this.fatigue = 0.3 + n(15, 0.1) * 0.25 + (recovering ? 0.3 : 0)

    this.emotion = arrest || recovering
      ? 'CRÍTICO'
      : panic
        ? 'MIEDO'
        : lying
          ? 'ENGAÑO'
          : reward
            ? 'EUFORIA'
            : sedated
              ? 'DÓCIL'
              : 'NEUTRO'
    this.emotionConf = 0.82 + n(16) * 0.17
  }

  draw(): void {
    // Invisible: pure simulation.
  }
}

// ---------------------------------------------------------------------
// BodyMapWindow — scanner-slice hologram with sensor nodes.
// ---------------------------------------------------------------------

/** Half-width of the body at height y (0 head → 1 feet), in body units. */
function bodyHalfWidth(y: number): number {
  if (y < 0.13) return 0.075 * Math.sin(((y - 0.0) / 0.13) * Math.PI) + 0.01 // head
  if (y < 0.16) return 0.035 // neck
  if (y < 0.21) return 0.035 + ((y - 0.16) / 0.05) * 0.105 // shoulders
  if (y < 0.4) return 0.14 - ((y - 0.21) / 0.19) * 0.045 // torso → waist
  if (y < 0.52) return 0.095 + ((y - 0.4) / 0.12) * 0.02 // hips
  return 0 // legs drawn separately
}

interface BioNode {
  x: number // body units from centerline
  y: number
  name: string
  read: (s: BioStateEntity) => string
  side: -1 | 1
}

const NODES: BioNode[] = [
  { x: 0.01, y: 0.06, name: 'N-1 CORTEZA', read: (s) => `EEG ${(11 + s.load * 14).toFixed(1)}µV`, side: 1 },
  { x: -0.03, y: 0.27, name: 'N-2 MIOCARDIO', read: (s) => `FC ${Math.round(s.hr)} LPM`, side: -1 },
  { x: 0.05, y: 0.25, name: 'N-3 PULMONAR', read: (s) => `SPO₂ ${s.spo2.toFixed(1)}%`, side: 1 },
  { x: 0.0, y: 0.38, name: 'N-4 GÁSTRICO', read: (s) => `PH ${(2.1 + s.stress).toFixed(2)}`, side: 1 },
  { x: -0.05, y: 0.45, name: 'N-5 RADIAL', read: (s) => `PA ${Math.round(s.sys)}/${Math.round(s.dia)}`, side: -1 },
  { x: 0.028, y: 0.62, name: 'N-6 FEMORAL', read: (s) => `FLUJO ${(0.9 + s.hr / 200).toFixed(2)}L/M`, side: 1 },
]

export class BodyMapWindow extends OSWindow {
  private bio: BioStateEntity
  private base: p5.Graphics | null = null
  private baseKey = ''

  constructor(o: OSWindowOpts, bio: BioStateEntity) {
    super(o)
    this.bio = bio
  }

  /** Bake the scan-slice mannequin per size/theme. */
  private ensureBase(ctx: OSContext, r: Rect): p5.Graphics {
    const key = `${Math.round(r.w)}x${Math.round(r.h)}:${ctx.palette.label}`
    if (this.base && this.baseKey === key) return this.base
    this.base?.remove()
    this.baseKey = key
    const g = ctx.p.createGraphics(Math.max(2, r.w), Math.max(2, r.h))
    this.base = g
    const pal = ctx.palette
    const cx = r.w / 2
    const S = r.h // body units → px
    const col = g.color(pal.fgDim)

    g.background(0, 0)
    // Torso + head: stacked elliptical scan slices.
    g.noFill()
    for (let y = 0.02; y < 0.53; y += 0.016) {
      const hw = bodyHalfWidth(y)
      if (hw <= 0.001) continue
      col.setAlpha(70 + Math.sin(y * 40) * 25)
      g.stroke(col)
      g.strokeWeight(1)
      g.ellipse(cx, y * S, hw * 2 * S, 0.014 * S)
    }
    // Legs: two slice columns.
    for (let y = 0.53; y < 0.97; y += 0.016) {
      const hw = 0.048 - (y - 0.53) * 0.055
      for (const sgn of [-1, 1]) {
        col.setAlpha(70 + Math.sin(y * 40) * 25)
        g.stroke(col)
        g.ellipse(cx + sgn * 0.052 * S * 0.9, y * S, hw * 2 * S, 0.013 * S)
      }
    }
    // Arms: thin slice columns along the torso.
    for (let y = 0.22; y < 0.5; y += 0.016) {
      const hw = 0.022 - (y - 0.22) * 0.02
      for (const sgn of [-1, 1]) {
        col.setAlpha(60)
        g.stroke(col)
        g.ellipse(cx + sgn * (bodyHalfWidth(0.22) + 0.045) * S, y * S, hw * 2 * S, 0.012 * S)
      }
    }
    // Axis + calibration ticks.
    col.setAlpha(40)
    g.stroke(col)
    g.line(cx, 0, cx, r.h)
    for (let y = 0; y < 1; y += 0.1) {
      g.line(4, y * S, 10, y * S)
    }
    return g
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    const s = this.bio
    const footerH = 14
    const body: Rect = { x: inner.x, y: inner.y, w: inner.w, h: inner.h - footerH }
    p.image(this.ensureBase(ctx, body), body.x, body.y)
    const cx = body.x + body.w / 2
    const S = body.h
    const px = (nx: number) => cx + nx * S
    const py = (ny: number) => body.y + ny * S

    p.push()

    // Slow scan line running down the subject.
    const scanY = (ctx.t * 0.07) % 1
    strokeHex(p, palette.accent, 90)
    p.strokeWeight(1)
    p.line(body.x + 8, py(scanY), body.x + body.w - 8, py(scanY))

    // Implant: chip at the sternum with expanding ping.
    const ix = px(0)
    const iy = py(0.225)
    const ping = (ctx.t * 0.8) % 1
    enableGlow(ctx, palette.accent, 0.7)
    strokeHex(p, palette.accent, (1 - ping) * 200)
    p.noFill()
    p.circle(ix, iy, 6 + ping * S * 0.16)
    p.noStroke()
    fillHex(p, palette.accent, 240)
    p.rect(ix - 4, iy - 4, 8, 8)
    disableGlow(ctx)
    strokeHex(p, palette.accent, 150)
    for (const [dx, dy] of [[-6, 0], [6, 0], [0, -6], [0, 6]] as const) {
      p.line(ix + dx, iy + dy, ix + dx * 1.6, iy + dy * 1.6)
    }
    p.noStroke()
    fillHex(p, palette.accent, 220)
    p.textSize(7)
    p.textAlign(p.CENTER, p.TOP)
    p.text('ORÁCULO-1', ix, iy + 10)

    // Heartbeat pulse on the myocardium node.
    const beat = Math.max(0, 1 - ((s.beatPhase + 0.7) % 1) * 3)

    // Sensor nodes with leader lines + live readouts.
    p.textSize(7.5)
    for (const node of NODES) {
      const nx = px(node.x)
      const ny = py(node.y)
      const isHeart = node.name.includes('MIOCARDIO')
      const col = isHeart && (s.inArrest || s.inPanic) ? palette.danger : palette.ok
      const pulse = isHeart ? 1 + beat * 1.6 : 1
      if (s.inArrest && isHeart && Math.floor(ctx.t * 4) % 2 === 0) {
        strokeHex(p, palette.danger, 255)
        p.strokeWeight(1.4)
        p.line(nx - 5, ny - 5, nx + 5, ny + 5)
        p.line(nx - 5, ny + 5, nx + 5, ny - 5)
      } else {
        p.noStroke()
        fillHex(p, col, 230)
        p.circle(nx, ny, 4 * pulse)
        strokeHex(p, col, 120)
        p.noFill()
        p.circle(nx, ny, 8 * pulse)
      }
      // Leader to the margin.
      const lx = node.side < 0 ? body.x + 6 : body.x + body.w - 6
      strokeHex(p, palette.fgDim, 110)
      p.strokeWeight(1)
      p.line(nx, ny, lx + (node.side < 0 ? 30 : -30), ny)
      p.line(lx + (node.side < 0 ? 30 : -30), ny, lx, ny)
      p.noStroke()
      fillHex(p, palette.fg, 210)
      p.textAlign(node.side < 0 ? p.LEFT : p.RIGHT, p.BOTTOM)
      p.text(node.name, lx, ny - 1)
      fillHex(p, palette.fgDim, 200)
      p.textAlign(node.side < 0 ? p.LEFT : p.RIGHT, p.TOP)
      p.text(node.read(s), lx, ny + 1)
    }

    // Footer.
    p.noStroke()
    fillHex(p, palette.fgDim, 200)
    p.textSize(8)
    p.textAlign(p.LEFT, p.BOTTOM)
    p.text(`SUJETO 4471 · IMPLANTE V9 · ${s.modeLabel}`, inner.x + 2, inner.y + inner.h - 1)
    p.pop()
  }
}

// ---------------------------------------------------------------------
// VitalsWindow — ECG / pleth / resp traces + numerics.
// ---------------------------------------------------------------------

/** PQRST complex sampled at beat-phase t01 (0..1). */
function ecgSample(t01: number): number {
  return (
    0.16 * G(t01, 0.16, 0.03) - // P
    0.14 * G(t01, 0.285, 0.012) + // Q
    1.0 * G(t01, 0.31, 0.011) - // R
    0.28 * G(t01, 0.335, 0.013) + // S
    0.32 * G(t01, 0.55, 0.045) // T
  )
}

export class VitalsWindow extends OSWindow {
  private bio: BioStateEntity
  private ecg: number[] = []
  private pleth: number[] = []
  private resp: number[] = []

  constructor(o: OSWindowOpts, bio: BioStateEntity) {
    super(o)
    this.bio = bio
  }

  update(ctx: OSContext): void {
    const s = this.bio
    const flat = s.hr < 8
    this.ecg.push(flat ? (ctx.p.noise(ctx.t * 12) - 0.5) * 0.05 : ecgSample(s.beatPhase))
    this.pleth.push(flat ? 0.02 : Math.pow(Math.max(0, Math.sin(s.beatPhase * Math.PI)), 2) * (0.8 + 0.2 * Math.sin(s.beatPhase * 6)))
    this.resp.push(s.resp < 1 ? 0 : Math.sin(ctx.t * (s.resp / 60) * Math.PI * 2) * 0.8)
    for (const buf of [this.ecg, this.pleth, this.resp]) {
      if (buf.length > 340) buf.shift()
    }
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    const s = this.bio
    const numW = Math.min(150, inner.w * 0.3)
    const traceW = inner.w - numW - 10
    const laneH = inner.h / 3

    p.push()

    const lanes: { buf: number[]; label: string; colKey: 'fg' | 'accent' | 'ok'; scale: number }[] = [
      { buf: this.ecg, label: 'ECG II', colKey: 'fg', scale: 0.75 },
      { buf: this.pleth, label: 'PLET', colKey: 'accent', scale: 0.65 },
      { buf: this.resp, label: 'RESP', colKey: 'ok', scale: 0.5 },
    ]
    lanes.forEach((lane, li) => {
      const ly = inner.y + li * laneH
      const mid = ly + laneH * 0.58
      strokeHex(p, palette.grid, 90)
      p.strokeWeight(1)
      if (li > 0) p.line(inner.x, ly, inner.x + traceW, ly)
      p.noStroke()
      fillHex(p, palette[lane.colKey], 190)
      p.textSize(8)
      p.textAlign(p.LEFT, p.TOP)
      p.text(lane.label, inner.x + 2, ly + 3)

      const col = palette[lane.colKey]
      enableGlow(ctx, col, 0.4)
      strokeHex(p, col, 230)
      p.strokeWeight(1.3)
      p.noFill()
      p.beginShape()
      const n = lane.buf.length
      for (let i = 0; i < n; i++) {
        p.vertex(inner.x + (i / 339) * traceW, mid - lane.buf[i] * laneH * lane.scale)
      }
      p.endShape()
      disableGlow(ctx)
    })

    // Sweep cursor.
    const cx2 = inner.x + ((this.ecg.length - 1) / 339) * traceW
    strokeHex(p, palette.fgDim, 120)
    p.line(cx2 + 3, inner.y, cx2 + 3, inner.y + inner.h)

    // --- Numeric column.
    const nx = inner.x + traceW + 10
    const rows: { label: string; value: string; unit: string; level: 'ok' | 'warn' | 'danger' }[] = [
      {
        label: 'FC',
        value: s.hr < 8 ? '--' : String(Math.round(s.hr)),
        unit: 'LPM',
        level: s.hr < 8 || s.hr > 130 ? 'danger' : s.hr > 100 || s.hr < 55 ? 'warn' : 'ok',
      },
      {
        label: 'PA',
        value: `${Math.round(s.sys)}/${Math.round(s.dia)}`,
        unit: 'MMHG',
        level: s.sys < 80 ? 'danger' : s.sys > 150 ? 'warn' : 'ok',
      },
      {
        label: 'SPO₂',
        value: s.spo2.toFixed(0),
        unit: '%',
        level: s.spo2 < 85 ? 'danger' : s.spo2 < 94 ? 'warn' : 'ok',
      },
      {
        label: 'RESP',
        value: s.resp < 1 ? '--' : String(Math.round(s.resp)),
        unit: '/MIN',
        level: s.resp < 1 ? 'danger' : s.resp > 22 ? 'warn' : 'ok',
      },
      { label: 'T°', value: s.temp.toFixed(1), unit: '°C', level: s.temp > 37.4 ? 'warn' : 'ok' },
    ]
    const rh = inner.h / rows.length
    rows.forEach((row, i) => {
      const ry = inner.y + i * rh
      const col = palette[row.level]
      p.noStroke()
      fillHex(p, palette.fgDim, 190)
      p.textSize(8)
      p.textAlign(p.LEFT, p.TOP)
      p.text(`${row.label} ${row.unit}`, nx, ry + 2)
      fillHex(p, col, 245)
      p.textSize(Math.min(21, rh * 0.52))
      p.textAlign(p.RIGHT, p.BOTTOM)
      p.text(row.value, inner.x + inner.w - 2, ry + rh - 2)
    })

    // Arrest alarm banner.
    if (s.inArrest || (s.hr < 8 && s.modeLabel.startsWith('PARO'))) {
      const blink = Math.floor(ctx.t * 4) % 2 === 0
      if (blink) {
        p.noStroke()
        fillHex(p, palette.bg, 200)
        p.rect(inner.x + traceW * 0.12, inner.y + inner.h * 0.36, traceW * 0.76, 26)
        enableGlow(ctx, palette.danger, 0.9)
        strokeHex(p, palette.danger, 255)
        p.strokeWeight(1.5)
        p.noFill()
        p.rect(inner.x + traceW * 0.12, inner.y + inner.h * 0.36, traceW * 0.76, 26)
        disableGlow(ctx)
        p.noStroke()
        fillHex(p, palette.danger, 255)
        p.textSize(11)
        p.textAlign(p.CENTER, p.CENTER)
        p.text('⚠ ASISTOLIA — REANIMACIÓN REMOTA EN CURSO ⚠', inner.x + traceW * 0.5, inner.y + inner.h * 0.36 + 13)
      }
    }
    p.pop()
  }
}

// ---------------------------------------------------------------------
// NeuroChemWindow — neurotransmitter bars + dopamine trend.
// ---------------------------------------------------------------------

export class NeuroChemWindow extends OSWindow {
  private bio: BioStateEntity
  private dopaHist: number[] = []

  constructor(o: OSWindowOpts, bio: BioStateEntity) {
    super(o)
    this.bio = bio
  }

  update(ctx: OSContext): void {
    // Seed a flat history so the trend never starts empty on camera.
    if (this.dopaHist.length === 0) {
      this.dopaHist = new Array<number>(120).fill(this.bio.dopa)
    }
    // ~4 samples/s is plenty for the trend.
    if (ctx.frame % 15 === 0) {
      this.dopaHist.push(this.bio.dopa)
      if (this.dopaHist.length > 120) this.dopaHist.shift()
    }
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    const s = this.bio
    const rows: { label: string; v: number; range: string; danger: number }[] = [
      { label: 'DOPAMINA', v: s.dopa, range: `${(s.dopa * 52).toFixed(1)} PG/ML`, danger: 0.85 },
      { label: 'SEROTONINA', v: s.sero, range: `${(s.sero * 200).toFixed(0)} NG/ML`, danger: 0.9 },
      { label: 'CORTISOL', v: s.cort, range: `${(s.cort * 28).toFixed(1)} µG/DL`, danger: 0.7 },
      { label: 'ADRENALINA', v: s.adre, range: `${(s.adre * 110).toFixed(0)} PG/ML`, danger: 0.65 },
      { label: 'OXITOCINA', v: s.oxy, range: `${(s.oxy * 18).toFixed(1)} PG/ML`, danger: 0.95 },
    ]
    const trendH = Math.min(64, inner.h * 0.32)
    const barsH = inner.h - trendH - 14
    const rh = barsH / rows.length

    p.push()
    rows.forEach((row, i) => {
      const ry = inner.y + i * rh
      const hot = row.v > row.danger
      const col = hot ? palette.danger : palette.fg
      p.noStroke()
      fillHex(p, palette.fgDim, 200)
      p.textSize(8.5)
      p.textAlign(p.LEFT, p.CENTER)
      p.text(row.label, inner.x, ry + rh / 2)
      fillHex(p, col, 235)
      p.textAlign(p.RIGHT, p.CENTER)
      p.text(row.range, inner.x + inner.w, ry + rh / 2)
      // Bar with danger threshold tick.
      const bx = inner.x + 78
      const bw = inner.w - 78 - 84
      strokeHex(p, palette.grid, 150)
      p.strokeWeight(1)
      p.noFill()
      p.rect(bx, ry + rh / 2 - 5, bw, 10)
      p.noStroke()
      if (hot) enableGlow(ctx, palette.danger, 0.5)
      fillHex(p, col, 180)
      p.rect(bx + 1, ry + rh / 2 - 4, (bw - 2) * Math.min(1, row.v), 8)
      if (hot) disableGlow(ctx)
      strokeHex(p, palette.warn, 170)
      p.line(bx + bw * row.danger, ry + rh / 2 - 7, bx + bw * row.danger, ry + rh / 2 + 7)
    })

    // Dopamine trend sparkline.
    const ty = inner.y + barsH + 12
    p.noStroke()
    fillHex(p, palette.fgDim, 190)
    p.textSize(8)
    p.textAlign(p.LEFT, p.BOTTOM)
    p.text('TENDENCIA DOPAMINA — 30S', inner.x, ty - 2)
    strokeHex(p, palette.grid, 120)
    p.noFill()
    p.rect(inner.x, ty, inner.w, trendH)
    strokeHex(p, palette.accent, 220)
    p.strokeWeight(1.2)
    p.beginShape()
    this.dopaHist.forEach((v, i) => {
      p.vertex(inner.x + (i / 119) * inner.w, ty + trendH - v * trendH * 0.92 - 2)
    })
    p.endShape()
    // Reward zone marker.
    strokeHex(p, palette.warn, 100)
    p.line(inner.x, ty + trendH - 0.85 * trendH * 0.92 - 2, inner.x + inner.w, ty + trendH - 0.85 * trendH * 0.92 - 2)
    p.pop()
  }
}

// ---------------------------------------------------------------------
// BehaviorWindow — the regime's scores + emotion classifier.
// ---------------------------------------------------------------------

export class BehaviorWindow extends OSWindow {
  private bio: BioStateEntity
  private obedHist: number[] = []

  constructor(o: OSWindowOpts, bio: BioStateEntity) {
    super(o)
    this.bio = bio
  }

  update(ctx: OSContext): void {
    if (this.obedHist.length === 0) {
      this.obedHist = new Array<number>(90).fill(this.bio.obed)
    }
    if (ctx.frame % 20 === 0) {
      this.obedHist.push(this.bio.obed)
      if (this.obedHist.length > 90) this.obedHist.shift()
    }
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    const s = this.bio

    p.push()

    // --- Emotion classifier box.
    const eh = 46
    const ecol = palette[EMOTION_KEY[s.emotion]]
    strokeHex(p, ecol, 220)
    p.strokeWeight(1.2)
    p.noFill()
    p.rect(inner.x, inner.y, inner.w, eh)
    p.noStroke()
    fillHex(p, palette.fgDim, 190)
    p.textSize(8)
    p.textAlign(p.LEFT, p.TOP)
    p.text('CLASIFICADOR EMOCIONAL V4', inner.x + 6, inner.y + 5)
    enableGlow(ctx, ecol, 0.4)
    fillHex(p, ecol, 245)
    p.textSize(17)
    p.textAlign(p.LEFT, p.BOTTOM)
    p.text(s.emotion, inner.x + 6, inner.y + eh - 5)
    disableGlow(ctx)
    fillHex(p, palette.fgDim, 210)
    p.textSize(9)
    p.textAlign(p.RIGHT, p.BOTTOM)
    p.text(`CONF ${(s.emotionConf * 100).toFixed(0)}%`, inner.x + inner.w - 6, inner.y + eh - 5)

    // --- Score meters.
    const rows: { label: string; v: number; invert?: boolean }[] = [
      { label: 'OBEDIENCIA', v: s.obed },
      { label: 'ESTRÉS', v: s.stress, invert: true },
      { label: 'ÍNDICE DE ENGAÑO', v: s.decep, invert: true },
      { label: 'CARGA COGNITIVA', v: s.load, invert: true },
      { label: 'FATIGA', v: s.fatigue, invert: true },
    ]
    const top = inner.y + eh + 10
    const dissH = 22
    const rh = Math.min(40, (inner.h - eh - 10 - dissH - 90) / rows.length)
    rows.forEach((row, i) => {
      const ry = top + i * rh
      // Good when high (obedience) vs good when low (everything else).
      const bad = row.invert ? row.v > 0.7 : row.v < 0.6
      const warnZone = row.invert ? row.v > 0.5 : row.v < 0.75
      const col = bad ? palette.danger : warnZone ? palette.warn : palette.ok
      p.noStroke()
      fillHex(p, palette.fgDim, 200)
      p.textSize(8.5)
      p.textAlign(p.LEFT, p.TOP)
      p.text(row.label, inner.x, ry)
      fillHex(p, col, 240)
      p.textAlign(p.RIGHT, p.TOP)
      p.text(`${(row.v * 100).toFixed(0)}%`, inner.x + inner.w, ry)
      strokeHex(p, palette.grid, 150)
      p.strokeWeight(1)
      p.noFill()
      p.rect(inner.x, ry + 11, inner.w, 7)
      p.noStroke()
      fillHex(p, col, 190)
      p.rect(inner.x + 1, ry + 12, (inner.w - 2) * Math.min(1, row.v), 5)
    })

    // --- Dissident-thought line.
    const dy = top + rows.length * rh + 4
    const dissident = s.inLie
    const dcol = dissident ? palette.danger : palette.ok
    const blink = !dissident || Math.floor(ctx.t * 4) % 2 === 0
    p.noStroke()
    if (blink) {
      fillHex(p, dcol, 235)
      p.textSize(9)
      p.textAlign(p.LEFT, p.CENTER)
      p.text(
        dissident
          ? '⚠ PENSAMIENTO DISIDENTE: PATRÓN DETECTADO'
          : 'PENSAMIENTO DISIDENTE: NO DETECTADO',
        inner.x,
        dy + dissH / 2,
      )
    }

    // --- Obedience history.
    const hy = dy + dissH + 10
    const hh = 62
    fillHex(p, palette.fgDim, 190)
    p.textSize(8)
    p.textAlign(p.LEFT, p.BOTTOM)
    p.text('HISTORIAL DE OBEDIENCIA — 30 DÍAS', inner.x, hy - 1)
    strokeHex(p, palette.grid, 120)
    p.noFill()
    p.rect(inner.x, hy, inner.w, hh)
    strokeHex(p, palette.ok, 200)
    p.strokeWeight(1.2)
    p.beginShape()
    this.obedHist.forEach((v, i) => {
      p.vertex(inner.x + (i / 89) * inner.w, hy + hh - v * hh * 0.9 - 1)
    })
    p.endShape()

    // --- Daily surveillance metrics fill the rest of the column.
    const my = hy + hh + 14
    p.noStroke()
    fillHex(p, palette.fgDim, 190)
    p.textSize(8)
    p.textAlign(p.LEFT, p.BOTTOM)
    p.text('MÉTRICAS DIARIAS DEL SUJETO', inner.x, my - 2)
    const nz = (seed: number) => p.noise(seed, ctx.t * 0.05)
    const stats: [string, string, LogLevel][] = [
      ['PASOS HOY', String(8200 + Math.floor(nz(21) * 500)), 'info'],
      ['INTERACCIONES SOCIALES', String(11 + Math.floor(nz(22) * 8)), 'info'],
      ['TIEMPO DE PANTALLA', `${(5.4 + nz(23) * 2).toFixed(1)} H`, 'warn'],
      ['NOTICIAS ESTATALES', `${(91 + nz(24) * 8).toFixed(1)} %`, 'ok'],
      ['QUEJAS SUBVOCALES', String(s.inLie ? 4 : 1 + Math.floor(nz(25) * 2)), s.inLie ? 'danger' : 'dim'],
      ['PUNTUALIDAD LABORAL', `${(98.4 + nz(26)).toFixed(1)} %`, 'ok'],
      ['CUOTA DE SUEÑO', `${(6.1 + nz(27) * 1.4).toFixed(1)} H / 8H`, 'warn'],
    ]
    const srh = Math.min(17, (inner.y + inner.h - my - 4) / stats.length)
    p.textSize(8.5)
    stats.forEach(([label, value, lvl], i) => {
      const sy = my + i * srh
      if (sy + srh > inner.y + inner.h) return
      const col =
        lvl === 'ok' ? palette.ok : lvl === 'warn' ? palette.warn : lvl === 'danger' ? palette.danger : lvl === 'dim' ? palette.fgDim : palette.fg
      fillHex(p, palette.fgDim, 190)
      p.textAlign(p.LEFT, p.CENTER)
      p.text(label, inner.x, sy + srh / 2)
      fillHex(p, col, 230)
      p.textAlign(p.RIGHT, p.CENTER)
      p.text(value, inner.x + inner.w, sy + srh / 2)
    })
    p.pop()
  }
}
