/**
 * TelemetryWindow.ts — A window packed with instrument readouts.
 *
 * Demonstrates composing the small widgets (BarMeter, Waveform,
 * RadialGauge) inside a single OSWindow body with a simple stacked layout.
 */

import { OSWindow, type OSWindowOpts } from './OSWindow'
import { BarMeter, Waveform, RadialGauge } from './Meters'
import type { OSContext } from '../core/context'
import { rect, type Rect } from '../core/geometry'

export class TelemetryWindow extends OSWindow {
  private bars: BarMeter[]
  private wave = new Waveform()
  private gauge = new RadialGauge('LOAD')

  constructor(o: OSWindowOpts) {
    super(o)
    this.bars = [
      new BarMeter('NET LOAD', 1),
      new BarMeter('CPU', 2),
      new BarMeter('SIGNAL', 3),
      new BarMeter('THREAT', 4),
    ]
  }

  update(ctx: OSContext): void {
    for (const b of this.bars) b.update(ctx)
    this.wave.update(ctx)
    this.gauge.update(ctx)
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const rowH = 18
    let y = inner.y
    for (const b of this.bars) {
      b.draw(ctx, rect(inner.x, y, inner.w * 0.62, rowH))
      y += rowH + 6
    }
    // Radial gauge top-right.
    this.gauge.draw(
      ctx,
      rect(inner.x + inner.w * 0.66, inner.y, inner.w * 0.34, 90),
    )
    // Waveform along the bottom.
    this.wave.draw(
      ctx,
      rect(inner.x, inner.y + inner.h - 46, inner.w, 44),
    )
  }
}
