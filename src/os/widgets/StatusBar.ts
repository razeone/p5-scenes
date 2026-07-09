/**
 * StatusBar.ts — Full-width top strip: OS identity, operator, and clock.
 *
 * Sits above every desktop window and stamps the state's presence on the
 * whole frame.
 */

import { Entity } from '../core/Entity'
import type { OSContext } from '../core/context'
import { fillHex, strokeHex } from '../core/context'
import { enableGlow, disableGlow } from '../fx/Effects'

export class StatusBar extends Entity {
  private readonly h = 34

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

    fillHex(p, palette.fgDim)
    p.textSize(10)
    p.textAlign(p.CENTER, p.CENTER)
    p.text(
      `${config.agency}  //  ${config.motto}`,
      ctx.width / 2,
      this.h / 2 + 1,
    )

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
