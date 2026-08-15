import { Entity } from '../core/Entity'
import type { OSContext } from '../core/context'
import { fillHex, strokeHex } from '../core/context'
import type { FeedSource } from '../media/FeedSource'
import { StaticFeed } from '../media/FeedSource'
import { VideoFeed } from '../media/VideoSource'

export class SilenceScene extends Entity {
  feed: FeedSource = new StaticFeed()
  private silencedAt: number | null = null
  private readonly resetSeconds: number

  constructor(resetSeconds: number) {
    super()
    this.resetSeconds = resetSeconds
  }

  get silenced(): boolean {
    return this.silencedAt !== null
  }

  setFeed(feed: FeedSource): void {
    this.feed = feed
    this.reset()
  }

  click(ctx: OSContext): void {
    if (this.silencedAt === null) {
      this.silencedAt = ctx.t
      if (this.feed instanceof VideoFeed) this.feed.pause()
      return
    }
    this.reset()
  }

  update(ctx: OSContext): void {
    if (
      this.silencedAt !== null &&
      ctx.t - this.silencedAt >= this.resetSeconds
    ) {
      this.reset()
    }
  }

  draw(ctx: OSContext): void {
    const { p, width, height } = ctx
    p.push()
    this.feed.draw(ctx, { x: 0, y: 0, w: width, h: height })
    p.noFill()
    strokeHex(p, ctx.palette.fgDim, 180)
    p.strokeWeight(1)
    p.rect(14, 14, width - 28, height - 28)
    p.line(width / 2, 14, width / 2, 34)
    p.line(width / 2, height - 14, width / 2, height - 34)

    p.noStroke()
    p.textAlign(p.LEFT, p.TOP)
    p.textSize(13)
    fillHex(p, ctx.palette.fg, 230)
    p.text('PROTOCOLO SILENCE // OBJETIVO EN CUADRO', 28, 28)
    p.textAlign(p.RIGHT, p.TOP)
    fillHex(p, ctx.palette.fgDim, 210)
    p.text(this.feed.label, width - 28, 28)

    if (this.silencedAt === null) {
      p.textAlign(p.CENTER, p.BOTTOM)
      p.textSize(15)
      fillHex(p, ctx.palette.fg, 230)
      p.text('CLIC SOBRE EL OBJETIVO PARA SILENCIAR', width / 2, height - 30)
    } else {
      p.noStroke()
      p.fill(0, 0, 0, 168)
      p.rect(0, 0, width, height)
      p.textAlign(p.CENTER, p.CENTER)
      p.textSize(Math.min(96, width * 0.14))
      fillHex(p, ctx.palette.danger, 255)
      p.text('SILENCED', width / 2, height / 2 - 14)
      p.textSize(14)
      fillHex(p, ctx.palette.fg, 235)
      p.text(
        `OBJETIVO INHABILITADO // RESTABLECIMIENTO EN ${Math.max(0, Math.ceil(this.resetSeconds - (ctx.t - this.silencedAt)))}S`,
        width / 2,
        height / 2 + 52,
      )
      p.textSize(12)
      fillHex(p, ctx.palette.fgDim, 210)
      p.text('CLIC PARA RESTABLECER', width / 2, height / 2 + 80)
    }
    p.pop()
  }

  private reset(): void {
    this.silencedAt = null
    if (this.feed instanceof VideoFeed) this.feed.play()
  }
}
