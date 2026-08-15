/**
 * HypervigilanceScene.ts — The opening cinematic over the video wall.
 *
 * Three beats: the montage (the wall plays underneath, this draws
 * nothing), a white flare, then the title card before handing off to the
 * desktop. It runs on its own accumulator fed by the director clock, so
 * PAUSA freezes the beat and VEL stretches it.
 *
 * Two director cues bend the timeline: BUCLE holds the montage open
 * indefinitely (a folder of clips outlasts the scripted 12 seconds), and
 * TÍTULO cuts straight to the flare when the take has what it needs.
 */

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
  /** Scene-local time, so a hold can stall it without touching ctx.t. */
  private elapsed = 0
  private held = false

  constructor(options: HypervigilanceSceneOptions) {
    super()
    this.title = options.title
    this.montageSeconds = options.montageSeconds
    this.flareSeconds = options.flareSeconds
    this.titleSeconds = options.titleSeconds
    this.onComplete = options.onComplete
  }

  setTitle(title: string): void {
    this.title = title.trim() || 'HYPERVIGILANCIA'
  }

  get movieTitle(): string {
    return this.title
  }

  get holding(): boolean {
    return this.held
  }

  /**
   * Hold the montage open. Only the montage beat stalls — once the flare
   * has started the title has to land, or the cut would sit on white.
   */
  setHold(on: boolean): boolean {
    this.held = on
    return this.held
  }

  /** Cut to the flare + title now, whatever the montage clock says. */
  fireTitle(): void {
    this.held = false
    this.elapsed = Math.max(this.elapsed, this.montageSeconds)
  }

  /** Back to frame one of the montage (retake without a scene rebuild). */
  restartMontage(): void {
    this.elapsed = 0
    this.completed = false
  }

  update(ctx: OSContext): void {
    const stalled = this.held && this.elapsed < this.montageSeconds
    if (!stalled) this.elapsed += ctx.dt
    const end = this.montageSeconds + this.flareSeconds + this.titleSeconds
    if (!this.completed && this.elapsed >= end) {
      this.completed = true
      this.onComplete()
    }
  }

  draw(ctx: OSContext): void {
    const { p } = ctx
    const elapsed = this.elapsed - this.montageSeconds
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
