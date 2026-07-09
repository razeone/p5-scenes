/**
 * SensorWindows.ts — Instrument windows for the SENSORES screen.
 *
 * ScopeWindow: multi-channel oscilloscope (seismic / acoustic / RF
 * personalities via composable wave functions) with a graticule and
 * per-channel readouts.
 *
 * SpectrogramWindow: scrolling frequency waterfall drawn into an
 * offscreen buffer (one column per frame, shifted left) with occasional
 * "transmission" bands so it reads as live SIGINT.
 *
 * GaugeArrayWindow: RadialGauges + BarMeters packed in a grid — ambient
 * environmental readouts (radiación, químico, presión...).
 */

import type p5 from 'p5'
import { OSWindow, type OSWindowOpts } from './OSWindow'
import type { OSContext } from '../core/context'
import { fillHex, strokeHex } from '../core/context'
import type { Rect } from '../core/geometry'
import { BarMeter, RadialGauge } from './Meters'

// ---------------------------------------------------------------------
// ScopeWindow
// ---------------------------------------------------------------------

export type ScopeKind = 'seismic' | 'acoustic' | 'rf'

interface Channel {
  label: string
  accentKey: 'fg' | 'accent' | 'warn' | 'danger' | 'ok'
  buf: number[]
  seed: number
}

const SCOPE_PRESETS: Record<ScopeKind, { labels: string[]; gen: (p: p5, t: number, seed: number) => number }> = {
  seismic: {
    labels: ['GEO-N', 'GEO-E'],
    gen: (p, t, seed) => {
      // Mostly quiet with sharp arrival bursts.
      const burst = p.noise(seed + 40, t * 0.23) > 0.72 ? 1 : 0.12
      return (p.noise(seed, t * 3.7) - 0.5) * 2 * burst
    },
  },
  acoustic: {
    labels: ['MIC-CALLE', 'MIC-PLAZA'],
    gen: (p, t, seed) =>
      Math.sin(t * 9 + seed) * 0.25 * (0.4 + p.noise(seed, t * 1.3)) +
      (p.noise(seed + 5, t * 6) - 0.5) * 0.9,
  },
  rf: {
    labels: ['RF-88MHZ', 'RF-421MHZ'],
    gen: (p, t, seed) => {
      // Carrier + drop-outs.
      const carrier = Math.sin(t * 14 + seed) * 0.55
      const gate = p.noise(seed + 9, t * 0.8) > 0.35 ? 1 : 0.1
      return carrier * gate + (p.noise(seed, t * 8) - 0.5) * 0.35
    },
  },
}

export class ScopeWindow extends OSWindow {
  private channels: Channel[]
  private kind: ScopeKind

  constructor(o: OSWindowOpts, kind: ScopeKind) {
    super(o)
    this.kind = kind
    const accents: Channel['accentKey'][] = ['fg', 'accent']
    this.channels = SCOPE_PRESETS[kind].labels.map((label, i) => ({
      label,
      accentKey: accents[i % accents.length],
      buf: [],
      seed: i * 137.3 + kind.length * 31,
    }))
  }

  update(ctx: OSContext): void {
    const gen = SCOPE_PRESETS[this.kind].gen
    for (const ch of this.channels) {
      ch.buf.push(gen(ctx.p, ctx.t, ch.seed))
      if (ch.buf.length > 260) ch.buf.shift()
    }
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    p.push()
    // Graticule.
    strokeHex(p, palette.grid, 140)
    p.strokeWeight(1)
    for (let i = 1; i < 4; i++) {
      p.line(inner.x, inner.y + (inner.h * i) / 4, inner.x + inner.w, inner.y + (inner.h * i) / 4)
    }
    for (let i = 1; i < 8; i++) {
      p.line(inner.x + (inner.w * i) / 8, inner.y, inner.x + (inner.w * i) / 8, inner.y + inner.h)
    }

    // Traces, stacked lanes.
    const laneH = inner.h / this.channels.length
    this.channels.forEach((ch, li) => {
      const mid = inner.y + laneH * li + laneH / 2
      strokeHex(p, palette[ch.accentKey], 235)
      p.strokeWeight(1.2)
      p.noFill()
      p.beginShape()
      const n = ch.buf.length
      for (let i = 0; i < n; i++) {
        p.vertex(
          inner.x + (i / Math.max(1, n - 1)) * inner.w,
          mid - ch.buf[i] * laneH * 0.42,
        )
      }
      p.endShape()
      // Channel readout.
      p.noStroke()
      fillHex(p, palette[ch.accentKey], 220)
      p.textSize(9)
      p.textAlign(p.LEFT, p.TOP)
      const last = ch.buf[ch.buf.length - 1] ?? 0
      p.text(
        `${ch.label}  ${(last * 100).toFixed(0).padStart(4, ' ')}dB`,
        inner.x + 4,
        inner.y + laneH * li + 3,
      )
    })
    p.pop()
  }
}

// ---------------------------------------------------------------------
// SpectrogramWindow
// ---------------------------------------------------------------------

export class SpectrogramWindow extends OSWindow {
  private buf: p5.Graphics | null = null
  private bufKey = ''

  private ensureBuf(ctx: OSContext, r: Rect): p5.Graphics {
    const key = `${Math.round(r.w)}x${Math.round(r.h)}`
    if (this.buf && this.bufKey === key) return this.buf
    this.buf?.remove()
    this.bufKey = key
    this.buf = ctx.p.createGraphics(Math.max(2, r.w), Math.max(2, r.h))
    this.buf.background(0)
    return this.buf
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    const g = this.ensureBuf(ctx, inner)

    // Scroll one column left, then paint the newest column at the right.
    g.copy(g, 1, 0, g.width - 1, g.height, 0, 0, g.width - 1, g.height)
    g.noStroke()
    const x = g.width - 1
    const bins = 48
    const binH = g.height / bins
    const hot = g.color(palette.fg)
    const warm = g.color(palette.accent)
    for (let b = 0; b < bins; b++) {
      // Base noise floor falls off with frequency; transmissions are
      // narrow persistent bands that fade in and out.
      const f = b / bins
      let v = p.noise(b * 0.35, ctx.t * 2.2) * (1 - f * 0.55) * 0.5
      const band =
        Math.exp(-Math.pow((f - 0.22) * 22, 2)) * (p.noise(3.3, ctx.t * 0.5) > 0.4 ? 1 : 0) +
        Math.exp(-Math.pow((f - 0.61) * 30, 2)) * (p.noise(8.8, ctx.t * 0.35) > 0.55 ? 1 : 0)
      v = Math.min(1, v + band * (0.55 + 0.45 * p.noise(b, ctx.t * 4)))
      const col = v > 0.55 ? hot : warm
      col.setAlpha(Math.pow(v, 1.4) * 255)
      g.fill(0, 0, 0, 255)
      g.rect(x, g.height - (b + 1) * binH, 1, binH)
      g.fill(col)
      g.rect(x, g.height - (b + 1) * binH, 1, binH)
    }
    p.image(g, inner.x, inner.y)

    // Frequency ruler + cursor line.
    p.push()
    p.noStroke()
    fillHex(p, palette.fgDim, 200)
    p.textSize(8)
    p.textAlign(p.LEFT, p.CENTER)
    for (const [f, label] of [[0.22, '88.1 MHZ'], [0.61, '421.6 MHZ']] as const) {
      p.text(label, inner.x + 4, inner.y + inner.h - f * inner.h)
    }
    strokeHex(p, palette.fg, 90)
    p.line(inner.x + inner.w - 1, inner.y, inner.x + inner.w - 1, inner.y + inner.h)
    p.pop()
  }
}

// ---------------------------------------------------------------------
// GaugeArrayWindow
// ---------------------------------------------------------------------

export class GaugeArrayWindow extends OSWindow {
  private gauges: RadialGauge[]
  private bars: BarMeter[]

  constructor(o: OSWindowOpts) {
    super(o)
    this.gauges = [
      new RadialGauge('radiación', 11),
      new RadialGauge('químico', 22),
      new RadialGauge('presión', 33),
    ]
    this.bars = [
      new BarMeter('partículas', 44),
      new BarMeter('co²', 55),
      new BarMeter('ruido', 66),
      new BarMeter('campo em', 77),
    ]
  }

  update(ctx: OSContext): void {
    for (const gauge of this.gauges) gauge.update(ctx)
    for (const bar of this.bars) bar.update(ctx)
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const gaugeH = Math.min(inner.h * 0.5, inner.w / 3)
    const gw = inner.w / this.gauges.length
    this.gauges.forEach((gauge, i) => {
      gauge.draw(ctx, {
        x: inner.x + i * gw,
        y: inner.y + 4,
        w: gw,
        h: gaugeH,
      })
    })
    const barTop = inner.y + gaugeH + 12
    const barH = Math.min(26, (inner.y + inner.h - barTop) / this.bars.length)
    this.bars.forEach((bar, i) => {
      bar.draw(ctx, {
        x: inner.x + 4,
        y: barTop + i * barH,
        w: inner.w - 8,
        h: barH,
      })
    })
  }
}
