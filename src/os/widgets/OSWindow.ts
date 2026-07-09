/**
 * OSWindow.ts — Base window chrome for the fictional OS.
 *
 * Every framed panel in the OS (console, login, surveillance, radar)
 * extends this. It draws the bracket-cornered frame, a title bar with
 * the agency code and status dots, and hands subclasses a padded inner
 * Rect via drawBody(). Optional boot-in reveal so windows can animate on.
 *
 * Windows are draggable by their title bar (OSApp owns the mouse and
 * calls titleBarContains/moveBy) and carry a `focused` flag the frame
 * renders brighter, so the actor can rearrange the desk mid-take.
 */

import type p5 from 'p5'
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
  /** Title-bar dragging enabled (director/actor can rearrange). */
  draggable = true
  /** Last-touched window; frame renders brighter. */
  focused = false
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

  contains(px: number, py: number): boolean {
    return (
      px >= this.x && px <= this.x + this.w && py >= this.y && py <= this.y + this.h
    )
  }

  titleBarContains(px: number, py: number): boolean {
    return (
      px >= this.x &&
      px <= this.x + this.w &&
      py >= this.y &&
      py <= this.y + this.titleBarH
    )
  }

  /** Drag delta, clamped so the title bar can never leave the canvas. */
  moveBy(dx: number, dy: number, canvasW: number, canvasH: number): void {
    this.x = Math.min(Math.max(this.x + dx, -this.w + 80), canvasW - 80)
    this.y = Math.min(Math.max(this.y + dy, 0), canvasH - this.titleBarH)
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

    // Frame + bracket corners — brighter when this window is focused.
    enableGlow(ctx, a, this.focused ? 0.9 : 0.5)
    strokeHex(p, a, this.focused ? 255 : 190)
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

    // Title text, truncated so it never collides with the tag.
    fillHex(p, a)
    p.textSize(12)
    p.textAlign(p.LEFT, p.CENTER)
    const tagW = this.tag ? p.textWidth(this.tag.toUpperCase()) + 24 : 10
    p.text(
      truncate(p, this.title.toUpperCase(), r.w - 54 - tagW),
      r.x + 54,
      dotY + 1,
    )

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

  static truncate = truncate

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

/** Cut text with an ellipsis to fit maxW at the current text size. */
function truncate(p: p5, text: string, maxW: number): string {
  if (maxW <= 0) return ''
  if (p.textWidth(text) <= maxW) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (p.textWidth(text.slice(0, mid) + '…') <= maxW) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo) + '…'
}
