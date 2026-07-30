import { Entity } from '../core/Entity'
import type { OSContext } from '../core/context'
import { fillHex, strokeHex } from '../core/context'

interface HypervigilanceSceneOptions {
  title: string
  montageSeconds: number
  flareSeconds: number
  titleSeconds: number
  onComplete: () => void
}

export class HypervigilanceScene extends Entity {
  private title: string
  private readonly montageSeconds: number
  private readonly flareSeconds: number
  private readonly titleSeconds: number
  private readonly onComplete: () => void
  private completed = false

  constructor(options: HypervigilanceSceneOptions) {
    super()
    this.title = options.title
    this.montageSeconds = options.montageSeconds
    this.flareSeconds = options.flareSeconds
    this.titleSeconds = options.titleSeconds
    this.onComplete = options.onComplete
  }

  setTitle(title: string): void {
    this.title = title.trim() || 'HYPERVIGILANCE'
  }

  get movieTitle(): string {
    return this.title
  }

  update(ctx: OSContext): void {
    const end = this.montageSeconds + this.flareSeconds + this.titleSeconds
    if (!this.completed && ctx.t >= end) {
      this.completed = true
      this.onComplete()
    }
  }

  draw(ctx: OSContext): void {
    const { p } = ctx
    const elapsed = ctx.t - this.montageSeconds
    if (elapsed < 0) return

    if (elapsed < this.flareSeconds) {
      const progress = elapsed / this.flareSeconds
      const intensity = Math.sin(progress * Math.PI)
      p.push()
      p.noStroke()
      p.fill(255, 255, 255, intensity * 255)
      p.rect(0, 0, ctx.width, ctx.height)
      p.pop()
      return
    }

    const titleElapsed = elapsed - this.flareSeconds
    const titleProgress = Math.min(1, titleElapsed / Math.max(0.1, this.titleSeconds * 0.35))
    const titleAlpha = Math.min(255, titleProgress * 255)
    p.push()
    p.noStroke()
    p.fill(0, 0, 0, 215)
    p.rect(0, 0, ctx.width, ctx.height)
    fillHex(p, ctx.palette.accent, titleAlpha)
    p.textAlign(p.CENTER, p.CENTER)
    p.textSize(Math.min(72, ctx.width * 0.08))
    p.text(this.title.toUpperCase(), ctx.width / 2, ctx.height / 2)
    strokeHex(p, ctx.palette.fgDim, titleAlpha * 0.45)
    p.strokeWeight(1)
    p.line(
      ctx.width * 0.25,
      ctx.height / 2 + 48,
      ctx.width * 0.75,
      ctx.height / 2 + 48,
    )
    p.pop()
  }
}
