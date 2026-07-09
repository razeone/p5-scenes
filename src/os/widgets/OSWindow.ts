/**
 * OSWindow.ts — Base window chrome for the fictional OS.
 *
 * Every framed panel in the OS (console, login, surveillance, radar)
 * extends this. It draws the bracket-cornered frame, a title bar with
 * the agency code and status dots, and hands subclasses a padded inner
 * Rect via drawBody(). Optional boot-in reveal so windows can animate on.
 */

import { Entity } from '../core/Entity'
import type { OSContext } from '../core/context'
import { fillHex, strokeHex } from '../core/context'
import { inset, right, type Rect } from '../core/geometry'
import { enableGlow, disableGlow } from '../fx/Effects'

export interface OSWindowOpts {
  x: number
  y: number
  w: number
  h: number
  title: string
  /** Small tag on the right of the title bar, e.g. "LIVE" or clearance. */
  tag?: string
  /** Override accent (defaults to palette.accent). */
  accentKey?: 'fg' | 'accent' | 'warn' | 'danger' | 'ok'
  /** Seconds to reveal the window body (0 = instant). */
  revealTime?: number
}

export abstract class OSWindow extends Entity {
  x: number
  y: number
  w: number
  h: number
  title: string
  tag?: string
  accentKey: NonNullable<OSWindowOpts['accentKey']>
  private revealTime: number
  private born = -1

  constructor(o: OSWindowOpts) {
    super()
    this.x = o.x
    this.y = o.y
    this.w = o.w
    this.h = o.h
    this.title = o.title
    this.tag = o.tag
    this.accentKey = o.accentKey ?? 'fg'
    this.revealTime = o.revealTime ?? 0
  }

  protected accent(ctx: OSContext): string {
    return ctx.palette[this.accentKey]
  }

  /** 0..1 reveal progress for boot-in animation. */
  protected reveal(ctx: OSContext): number {
    if (this.revealTime <= 0) return 1
    if (this.born < 0) this.born = ctx.t
    return Math.min(1, (ctx.t - this.born) / this.revealTime)
  }

  get frame(): Rect {
    return { x: this.x, y: this.y, w: this.w, h: this.h }
  }

  /** Subclasses render their content inside this padded rect. */
  protected abstract drawBody(ctx: OSContext, inner: Rect): void

  /** Title-bar height. */
  protected titleBarH = 26

  draw(ctx: OSContext): void {
    const { p } = ctx
    const a = this.accent(ctx)
    const r = this.frame
    const rev = this.reveal(ctx)

    p.push()

    // Panel backing — slightly lifted from the desktop bg.
    p.noStroke()
    fillHex(p, ctx.palette.bg, 220)
    p.rect(r.x, r.y, r.w, r.h)

    // Frame + bracket corners.
    enableGlow(ctx, a, 0.6)
    strokeHex(p, a, 220)
    p.strokeWeight(1)
    p.noFill()
    p.rect(r.x, r.y, r.w, r.h)
    this.brackets(ctx, r, a)
    disableGlow(ctx)

    // Title bar.
    p.noStroke()
    fillHex(p, a, 30)
    p.rect(r.x, r.y, r.w, this.titleBarH)
    strokeHex(p, a, 160)
    p.line(r.x, r.y + this.titleBarH, right(r), r.y + this.titleBarH)

    // Status dots.
    const dotY = r.y + this.titleBarH / 2
    const dotColors = [ctx.palette.ok, ctx.palette.warn, ctx.palette.danger]
    for (let i = 0; i < 3; i++) {
      const blink = i === 0 ? 1 : 0.5 + 0.5 * Math.sin(ctx.t * 3 + i)
      fillHex(p, dotColors[i], 120 + blink * 135)
      p.noStroke()
      p.circle(r.x + 12 + i * 12, dotY, 5)
    }

    // Title text.
    fillHex(p, a)
    p.textSize(12)
    p.textAlign(p.LEFT, p.CENTER)
    p.text(this.title.toUpperCase(), r.x + 54, dotY + 1)

    // Right-side tag.
    if (this.tag) {
      p.textAlign(p.RIGHT, p.CENTER)
      fillHex(p, ctx.palette.accent)
      p.text(this.tag.toUpperCase(), right(r) - 10, dotY + 1)
    }

    // Body, clipped to inner rect with reveal wipe.
    const body = inset(
      { x: r.x, y: r.y + this.titleBarH, w: r.w, h: r.h - this.titleBarH },
      10,
      8,
    )
    const dc = p.drawingContext as CanvasRenderingContext2D
    dc.save()
    dc.beginPath()
    dc.rect(body.x, body.y, body.w, body.h * rev)
    dc.clip()
    this.drawBody(ctx, body)
    dc.restore()

    p.pop()
  }

  private brackets(ctx: OSContext, r: Rect, color: string): void {
    const { p } = ctx
    const L = 14
    strokeHex(p, color)
    p.strokeWeight(2)
    p.noFill()
    const corners: [number, number, number, number][] = [
      [r.x, r.y, 1, 1],
      [right(r), r.y, -1, 1],
      [r.x, r.y + r.h, 1, -1],
      [right(r), r.y + r.h, -1, -1],
    ]
    for (const [cx, cy, sx, sy] of corners) {
      p.line(cx, cy, cx + L * sx, cy)
      p.line(cx, cy, cx, cy + L * sy)
    }
  }
}
