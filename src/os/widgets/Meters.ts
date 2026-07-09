/**
 * Meters.ts — Small data-readout widgets: BarMeter, Waveform, RadialGauge.
 *
 * These are the "instrument" shapes that fill dead space in the OS with
 * plausible telemetry. Each wanders on its own using p5 noise so nothing
 * needs to be driven by hand during a take.
 */

import type { OSContext } from '../core/context'
import { fillHex, strokeHex, clamp } from '../core/context'
import type { Rect } from '../core/geometry'

export class BarMeter {
  label: string
  /** Director-applied offset (alarms). Added to the noise walk. */
  bias = 0
  private seed: number
  private value = 0.5

  constructor(label: string, seed = Math.random() * 1000) {
    this.label = label
    this.seed = seed
  }

  update(ctx: OSContext): void {
    // Random walk in [0,1] via noise.
    this.value = clamp(ctx.p.noise(this.seed, ctx.t * 0.35) + this.bias, 0, 1)
  }

  draw(ctx: OSContext, r: Rect): void {
    const { p } = ctx
    const v = clamp(this.value, 0, 1)
    const col =
      v > 0.85 ? ctx.palette.danger : v > 0.6 ? ctx.palette.warn : ctx.palette.fg
    p.push()
    p.textSize(10)
    p.noStroke()
    fillHex(p, ctx.palette.fgDim)
    p.textAlign(p.LEFT, p.CENTER)
    p.text(this.label.toUpperCase(), r.x, r.y + r.h / 2)

    const barX = r.x + r.w * 0.42
    const barW = r.w * 0.5
    strokeHex(p, ctx.palette.grid, 200)
    p.noFill()
    p.rect(barX, r.y + r.h * 0.3, barW, r.h * 0.4)
    // Segmented fill.
    p.noStroke()
    fillHex(p, col)
    const segs = 20
    const on = Math.round(v * segs)
    const segW = barW / segs
    for (let i = 0; i < on; i++) {
      p.rect(barX + i * segW + 1, r.y + r.h * 0.3 + 1, segW - 2, r.h * 0.4 - 2)
    }
    fillHex(p, col)
    p.textAlign(p.RIGHT, p.CENTER)
    p.text(`${Math.round(v * 100)}%`, r.x + r.w, r.y + r.h / 2)
    p.pop()
  }
}

export class Waveform {
  private buf: number[] = []
  private seed: number
  constructor(seed = Math.random() * 1000) {
    this.seed = seed
  }

  update(ctx: OSContext): void {
    const n =
      Math.sin(ctx.t * 6 + this.seed) * 0.4 +
      (ctx.p.noise(this.seed, ctx.t * 2) - 0.5) * 1.2
    this.buf.push(n)
    if (this.buf.length > 240) this.buf.shift()
  }

  draw(ctx: OSContext, r: Rect): void {
    const { p } = ctx
    p.push()
    strokeHex(p, ctx.palette.accent)
    p.strokeWeight(1)
    p.noFill()
    p.beginShape()
    const n = this.buf.length
    for (let i = 0; i < n; i++) {
      const x = r.x + (i / Math.max(1, n - 1)) * r.w
      const y = r.y + r.h / 2 - this.buf[i] * (r.h / 2) * 0.9
      p.vertex(x, y)
    }
    p.endShape()
    // Center reference line.
    strokeHex(p, ctx.palette.grid, 160)
    p.line(r.x, r.y + r.h / 2, r.x + r.w, r.y + r.h / 2)
    p.pop()
  }
}

export class RadialGauge {
  label: string
  /** Director-applied offset (alarms). Added to the noise walk. */
  bias = 0
  private seed: number
  private value = 0.5
  constructor(label: string, seed = Math.random() * 1000) {
    this.label = label
    this.seed = seed
  }
  update(ctx: OSContext): void {
    this.value = clamp(
      ctx.p.noise(this.seed + 10, ctx.t * 0.3) + this.bias,
      0,
      1,
    )
  }
  draw(ctx: OSContext, r: Rect): void {
    const { p } = ctx
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    const rad = Math.min(r.w, r.h) / 2 - 6
    const start = Math.PI * 0.75
    const end = Math.PI * 2.25
    p.push()
    p.noFill()
    strokeHex(p, ctx.palette.grid, 200)
    p.strokeWeight(3)
    p.arc(cx, cy, rad * 2, rad * 2, start, end)
    strokeHex(p, ctx.palette.accent)
    p.arc(cx, cy, rad * 2, rad * 2, start, start + (end - start) * this.value)
    p.noStroke()
    fillHex(p, ctx.palette.fg)
    p.textAlign(p.CENTER, p.CENTER)
    p.textSize(rad * 0.6)
    p.text(Math.round(this.value * 100).toString(), cx, cy - 2)
    fillHex(p, ctx.palette.fgDim)
    p.textSize(9)
    p.text(this.label.toUpperCase(), cx, cy + rad * 0.55)
    p.pop()
  }
}
