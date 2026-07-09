/**
 * RadarWindow.ts — Rotating-sweep radar with fading contact blips.
 *
 * Contacts drift slowly via noise; each lights up as the sweep passes and
 * decays until the next revolution — the classic sector-scan look. Range
 * rings and bearing spokes fill the dial, with a contact count readout.
 */

import { OSWindow, type OSWindowOpts } from './OSWindow'
import type { OSContext } from '../core/context'
import { fillHex, strokeHex } from '../core/context'
import type { Rect } from '../core/geometry'
import { enableGlow, disableGlow } from '../fx/Effects'

interface Contact {
  seed: number
  hostile: boolean
}

export class RadarWindow extends OSWindow {
  private contacts: Contact[] = []
  private sweepSpeed = 1.4 // radians/sec

  constructor(o: OSWindowOpts, contactCount = 7) {
    super(o)
    for (let i = 0; i < contactCount; i++) {
      this.contacts.push({
        seed: Math.random() * 1000,
        hostile: Math.random() < 0.35,
      })
    }
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    const cx = inner.x + inner.w / 2
    const cy = inner.y + inner.h / 2
    const R = Math.min(inner.w, inner.h) / 2 - 8
    if (R < 10) return // no room for a dial; arc() throws on negative radii
    const sweep = (ctx.t * this.sweepSpeed) % (Math.PI * 2)

    p.push()

    // Rings + spokes.
    p.noFill()
    strokeHex(p, palette.grid, 220)
    p.strokeWeight(1)
    for (let i = 1; i <= 4; i++) p.circle(cx, cy, (R * 2 * i) / 4)
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
      p.line(cx, cy, cx + Math.cos(a) * R, cy + Math.sin(a) * R)
    }

    // Sweep wedge — a fading trail behind the beam.
    const dc = p.drawingContext as CanvasRenderingContext2D
    const trail = 1.1
    dc.save()
    dc.beginPath()
    dc.moveTo(cx, cy)
    dc.arc(cx, cy, R, sweep - trail, sweep)
    dc.closePath()
    const grad = dc.createRadialGradient(cx, cy, 0, cx, cy, R)
    const glowCol = p.color(palette.fg)
    glowCol.setAlpha(46)
    grad.addColorStop(0, glowCol.toString())
    glowCol.setAlpha(10)
    grad.addColorStop(1, glowCol.toString())
    dc.fillStyle = grad
    dc.fill()
    dc.restore()

    // Beam line.
    enableGlow(ctx, palette.fg, 0.7)
    strokeHex(p, palette.fg, 230)
    p.strokeWeight(1.5)
    p.line(cx, cy, cx + Math.cos(sweep) * R, cy + Math.sin(sweep) * R)
    disableGlow(ctx)

    // Contacts: light up when the sweep passes, decay after.
    let hostiles = 0
    for (const c of this.contacts) {
      const ang =
        (p.noise(c.seed, ctx.t * 0.03) * Math.PI * 4) % (Math.PI * 2)
      const rad = (0.25 + p.noise(c.seed + 9, ctx.t * 0.05) * 0.7) * R
      const bx = cx + Math.cos(ang) * rad
      const by = cy + Math.sin(ang) * rad
      // Angular distance behind the sweep (0 = just hit).
      let behind = sweep - ang
      if (behind < 0) behind += Math.PI * 2
      const fade = Math.max(0, 1 - behind / (Math.PI * 1.6))
      if (fade <= 0.02) continue
      const col = c.hostile ? palette.danger : palette.accent
      if (c.hostile) hostiles++
      p.noStroke()
      fillHex(p, col, fade * 255)
      p.circle(bx, by, 5 + fade * 3)
      if (fade > 0.6 && c.hostile) {
        strokeHex(p, col, fade * 200)
        p.noFill()
        p.circle(bx, by, 14)
      }
    }

    // Readout.
    p.noStroke()
    p.textSize(9)
    p.textAlign(p.LEFT, p.TOP)
    fillHex(p, palette.fgDim)
    p.text(`CONTACTOS: ${this.contacts.length}`, inner.x + 2, inner.y + 2)
    fillHex(p, palette.danger)
    p.text(`HOSTILES: ${hostiles}`, inner.x + 2, inner.y + 14)
    fillHex(p, palette.fgDim)
    p.textAlign(p.RIGHT, p.TOP)
    p.text(
      `BARRIDO ${((sweep / (Math.PI * 2)) * 360).toFixed(0)}°`,
      inner.x + inner.w - 2,
      inner.y + 2,
    )

    p.pop()
  }
}
