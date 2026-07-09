/**
 * StatusBar.ts — Full-width top strip: OS identity, operator, and clock.
 *
 * Sits above every desktop window and stamps the state's presence on the
 * whole frame. announce() temporarily replaces the center motto with a
 * blinking directive (curfews, alerts) the director sends mid-take.
 */

import { Entity } from '../core/Entity'
import type { OSContext } from '../core/context'
import { fillHex, strokeHex } from '../core/context'
import { enableGlow, disableGlow } from '../fx/Effects'

export class StatusBar extends Entity {
  private readonly h = 34
  private msg: string | null = null
  private msgT0 = -1
  private msgDur = 8

  /** Show a blinking directive in place of the motto for a few seconds. */
  announce(text: string, seconds = 8): void {
    this.msg = text.toUpperCase()
    this.msgDur = seconds
    this.msgT0 = -1 // stamped on next draw
  }

  draw(ctx: OSContext): void {
    const { p, palette, config } = ctx
    p.push()
    p.noStroke()
    fillHex(p, palette.bg, 230)
    p.rect(0, 0, ctx.width, this.h)
    strokeHex(p, palette.fg, 160)
    p.line(0, this.h, ctx.width, this.h)

    p.noStroke()
    enableGlow(ctx, palette.fg, 0.5)
    fillHex(p, palette.fg)
    p.textSize(13)
    p.textAlign(p.LEFT, p.CENTER)
    p.text(`${config.osName} ${config.osVersion}`, 14, this.h / 2 + 1)
    disableGlow(ctx)

    // Center: motto, or an active directive from the director.
    if (this.msg && this.msgT0 < 0) this.msgT0 = ctx.t
    if (this.msg && ctx.t - this.msgT0 > this.msgDur) this.msg = null
    p.textSize(10)
    p.textAlign(p.CENTER, p.CENTER)
    if (this.msg) {
      if (Math.floor(ctx.t * 2.5) % 3 !== 2) {
        enableGlow(ctx, palette.warn, 0.6)
        fillHex(p, palette.warn)
        p.text(`⚠ ${this.msg} ⚠`, ctx.width / 2, this.h / 2 + 1)
        disableGlow(ctx)
      }
    } else {
      fillHex(p, palette.fgDim)
      p.text(
        `${config.agency}  //  ${config.motto}`,
        ctx.width / 2,
        this.h / 2 + 1,
      )
    }

    // Operator + wall clock on the right.
    const now = new Date()
    const clock = now.toTimeString().slice(0, 8)
    p.textAlign(p.RIGHT, p.CENTER)
    fillHex(p, palette.accent)
    p.text(
      `${config.operator.user} [${config.operator.clearance}]   ${clock}`,
      ctx.width - 14,
      this.h / 2 + 1,
    )
    p.pop()
  }
}
