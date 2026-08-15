/**
 * Slate.ts — In-frame clapperboard burned into the first moments of a
 * recorded take: production title, scene, take number, and a wall-clock
 * stamp, so a clip is identifiable in the edit without scrubbing it.
 * Self-hides after its lifetime; the next phase change clears the entity.
 */

import { Entity } from '../core/Entity'
import type { OSContext } from '../core/context'
import { fillHex, strokeHex } from '../core/context'
import { enableGlow, disableGlow } from '../fx/Effects'

export class Slate extends Entity {
  z = 100
  private born = -1

  private take: number
  private lifetime: number
  /** Scene name (PHASE_LABELS), shown under the take number. */
  private scene: string

  constructor(take: number, scene = '', lifetime = 1.6) {
    super()
    this.take = take
    this.scene = scene
    this.lifetime = lifetime
  }

  draw(ctx: OSContext): void {
    if (this.born < 0) this.born = ctx.t
    const el = ctx.t - this.born
    if (el > this.lifetime) {
      this.visible = false
      return
    }
    const { p, palette } = ctx
    const w = 380
    const h = 168
    const x = (ctx.width - w) / 2
    const y = (ctx.height - h) / 2
    // Snap in bright, then settle.
    const flash = el < 0.12
    const fade = Math.min(1, (this.lifetime - el) / 0.25)

    p.push()
    p.noStroke()
    fillHex(p, palette.bg, 235 * fade)
    p.rect(x, y, w, h)
    enableGlow(ctx, palette.fg, flash ? 1 : 0.6)
    strokeHex(p, palette.fg, (flash ? 255 : 200) * fade)
    p.strokeWeight(flash ? 2 : 1)
    p.noFill()
    p.rect(x, y, w, h)
    disableGlow(ctx)

    p.noStroke()
    p.textAlign(p.CENTER, p.CENTER)

    // Production title — what this footage belongs to.
    fillHex(p, palette.accent, 235 * fade)
    p.textSize(13)
    p.text(ctx.config.movieTitle.toUpperCase(), x + w / 2, y + 26)

    fillHex(p, palette.fg, 255 * fade)
    p.textSize(34)
    p.text(`TOMA ${String(this.take).padStart(2, '0')}`, x + w / 2, y + 64)

    // Scene name: the editorial hook that used to be missing.
    if (this.scene) {
      fillHex(p, palette.fg, 225 * fade)
      p.textSize(14)
      p.text(`ESC. ${this.scene}`, x + w / 2, y + 96)
    }

    fillHex(p, palette.fgDim, 220 * fade)
    p.textSize(11)
    const now = new Date()
    p.text(
      `${ctx.config.osName}  ·  ${now.toLocaleDateString()} ${now.toTimeString().slice(0, 8)}`,
      x + w / 2,
      y + 122,
    )
    // REC dot.
    fillHex(p, palette.danger, 255 * fade)
    p.circle(x + w / 2 - 52, y + 144, 6)
    fillHex(p, palette.danger, 220 * fade)
    p.textSize(10)
    p.text('GRABANDO', x + w / 2 + 8, y + 144)
    p.pop()
  }
}
