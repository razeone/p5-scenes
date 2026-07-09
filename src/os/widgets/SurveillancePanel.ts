/**
 * SurveillancePanel.ts — Camera-feed window with tracking overlay.
 *
 * Renders whatever FeedSource it is given (static, file video, webcam)
 * and dresses it with the state's machinery: target boxes with subject
 * IDs and confidence scores, a REC indicator, running timecode, camera
 * label, and a bottom telemetry strip.
 *
 * Two overlay modes: when the feed is a VideoFeed with a VisionEngine
 * attached, targets are REAL — MediaPipe detections tracked across
 * frames, with stable IDs, class labels, and motion trails. Otherwise
 * (static feed, or vision off) noise-walker fakes keep the panel
 * performing by itself during takes.
 */

import { OSWindow, type OSWindowOpts } from './OSWindow'
import type { OSContext } from '../core/context'
import { fillHex, strokeHex } from '../core/context'
import type { Rect } from '../core/geometry'
import type { FeedSource } from '../media/FeedSource'
import { StaticFeed } from '../media/FeedSource'
import { VideoFeed } from '../media/VideoSource'
import { enableGlow, disableGlow } from '../fx/Effects'
import { labelEs, threatTier } from '../vision/labels'
import type { TrackedObject } from '../vision/ObjectTracker'
import type { VisionEngine } from '../vision/VisionEngine'

interface Target {
  seed: number
  id: string
  confidence: number
}

export interface SurveillancePanelOpts extends OSWindowOpts {
  camLabel?: string
  targetCount?: number
}

export class SurveillancePanel extends OSWindow {
  feed: FeedSource
  private camLabel: string
  private targets: Target[] = []
  /** Identification banner ("SUJETO IDENTIFICADO") shows until this t. */
  private markUntil = -1
  private markFor = 0

  constructor(o: SurveillancePanelOpts, feed?: FeedSource) {
    super(o)
    this.feed = feed ?? new StaticFeed()
    this.camLabel = o.camLabel ?? 'CAM-00'
    const n = o.targetCount ?? 2
    for (let i = 0; i < n; i++) {
      this.targets.push({
        seed: Math.random() * 1000,
        id: `SUJ-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        confidence: 0.7 + Math.random() * 0.29,
      })
    }
  }

  setFeed(feed: FeedSource): void {
    this.feed = feed
  }

  get targetCount(): number {
    return this.targets.length
  }

  /** Grow/shrink the simulated target population (fake overlay only). */
  setTargetCount(n: number): void {
    n = Math.max(0, Math.min(8, n))
    while (this.targets.length > n) this.targets.pop()
    while (this.targets.length < n) {
      this.targets.push({
        seed: Math.random() * 1000,
        id: `SUJ-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        confidence: 0.7 + Math.random() * 0.29,
      })
    }
  }

  /** Flash an identification banner over the viewport for a moment. */
  flashMark(seconds = 3): void {
    this.markFor = seconds
    this.markUntil = -1 // stamped from ctx.t on next draw
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p } = ctx
    const stripH = 20
    const view: Rect = {
      x: inner.x,
      y: inner.y,
      w: inner.w,
      h: inner.h - stripH - 4,
    }

    // --- Feed + tracking overlay (clipped to the viewport) -------------
    const dc = p.drawingContext as CanvasRenderingContext2D
    dc.save()
    dc.beginPath()
    dc.rect(view.x, view.y, view.w, view.h)
    dc.clip()
    // Local binding so instanceof narrowing survives the method calls.
    const feed = this.feed
    const live = feed.draw(ctx, view)

    let vision: VisionEngine | null = null
    let realTracks: TrackedObject[] | null = null
    if (feed instanceof VideoFeed && feed.vision) {
      vision = feed.vision
      if (live) {
        realTracks = vision.update(feed.element, ctx.dt)
        this.drawRealTracks(ctx, feed, realTracks, view)
      }
    }
    dc.restore()

    // --- Simulated overlay (only when real vision isn't running) -------
    if (!realTracks) this.drawFakeTargets(ctx, view)

    this.drawMark(ctx, view)
    this.drawOSD(ctx, view, live)
    this.drawStrip(ctx, inner, view, stripH, vision, realTracks)
  }

  // Noise-walker fakes so the panel performs by itself during takes.
  private drawFakeTargets(ctx: OSContext, view: Rect): void {
    const { p, palette } = ctx
    for (const t of this.targets) {
      // Noise-walk the box around the viewport.
      const nx = p.noise(t.seed, ctx.t * 0.12)
      const ny = p.noise(t.seed + 50, ctx.t * 0.12)
      const bw = view.w * 0.16
      const bh = view.h * 0.3
      const bx = view.x + nx * (view.w - bw)
      const by = view.y + ny * (view.h - bh)
      // Confidence breathes a little.
      const conf = Math.min(
        0.999,
        t.confidence + Math.sin(ctx.t * 0.9 + t.seed) * 0.02,
      )
      const col = conf > 0.9 ? palette.danger : palette.warn

      strokeHex(p, col, 230)
      p.strokeWeight(1)
      p.noFill()
      // Bracket corners only — classic tracker look.
      const L = Math.min(bw, bh) * 0.3
      const cs: [number, number, number, number][] = [
        [bx, by, 1, 1],
        [bx + bw, by, -1, 1],
        [bx, by + bh, 1, -1],
        [bx + bw, by + bh, -1, -1],
      ]
      for (const [cx, cy, sx, sy] of cs) {
        p.line(cx, cy, cx + L * sx, cy)
        p.line(cx, cy, cx, cy + L * sy)
      }
      // Center cross.
      p.line(bx + bw / 2 - 4, by + bh / 2, bx + bw / 2 + 4, by + bh / 2)
      p.line(bx + bw / 2, by + bh / 2 - 4, bx + bw / 2, by + bh / 2 + 4)
      // Label.
      p.noStroke()
      fillHex(p, col)
      p.textSize(9)
      p.textAlign(p.LEFT, p.BOTTOM)
      p.text(`${t.id}  ${(conf * 100).toFixed(1)}%`, bx, by - 3)
    }
  }

  // Real detections: stable track IDs, class labels, motion trails.
  private drawRealTracks(
    ctx: OSContext,
    feed: VideoFeed,
    tracks: TrackedObject[],
    view: Rect,
  ): void {
    const { p, palette } = ctx
    for (const t of tracks) {
      const a = feed.toViewport(t.x, t.y)
      const bw = t.w * feed.viewportScale
      const bh = t.h * feed.viewportScale
      const col = palette[threatTier(t.label)]
      // Unconfirmed tracks render dim while the tracker acquires them.
      const alpha = t.confirmed ? 235 : 90

      // Motion trail — where the object has been.
      if (t.confirmed && t.trail.length > 1) {
        strokeHex(p, col, 90)
        p.strokeWeight(1)
        p.noFill()
        p.beginShape()
        for (const pt of t.trail) {
          const v = feed.toViewport(pt.x, pt.y)
          p.vertex(v.x, v.y)
        }
        p.endShape()
      }

      strokeHex(p, col, alpha)
      p.strokeWeight(t.confirmed ? 1.2 : 1)
      p.noFill()
      // Bracket corners only — classic tracker look.
      const L = Math.max(6, Math.min(bw, bh) * 0.25)
      const cs: [number, number, number, number][] = [
        [a.x, a.y, 1, 1],
        [a.x + bw, a.y, -1, 1],
        [a.x, a.y + bh, 1, -1],
        [a.x + bw, a.y + bh, -1, -1],
      ]
      for (const [cx, cy, sx, sy] of cs) {
        p.line(cx, cy, cx + L * sx, cy)
        p.line(cx, cy, cx, cy + L * sy)
      }
      // Center cross.
      const mx = a.x + bw / 2
      const my = a.y + bh / 2
      p.line(mx - 4, my, mx + 4, my)
      p.line(mx, my - 4, mx, my + 4)

      // Label: TRK id · class · confidence.
      p.noStroke()
      fillHex(p, col, alpha)
      p.textSize(9)
      p.textAlign(p.LEFT, p.BOTTOM)
      const name = t.confirmed
        ? `TRK-${String(t.id).padStart(3, '0')} ${labelEs(t.label)}  ${(t.score * 100).toFixed(1)}%`
        : 'ADQUIRIENDO…'
      // Keep the label inside the viewport when the box hugs the top.
      p.text(name, Math.max(a.x, view.x + 2), Math.max(a.y - 3, view.y + 12))
      // Lock stamp once a track has history.
      if (t.confirmed && t.age > 2.5) {
        p.textAlign(p.RIGHT, p.TOP)
        p.text('FIJADO', a.x + bw, a.y + bh + 3)
      }
    }
  }

  /** "SUJETO IDENTIFICADO" strobe banner, triggered from direction. */
  private drawMark(ctx: OSContext, view: Rect): void {
    if (this.markFor > 0 && this.markUntil < 0) {
      this.markUntil = ctx.t + this.markFor
      this.markFor = 0
    }
    if (this.markUntil < 0 || ctx.t > this.markUntil) return
    const { p, palette } = ctx
    const blink = Math.floor(ctx.t * 4) % 3 !== 2
    p.push()
    const bh = 34
    const by = view.y + view.h * 0.42
    p.noStroke()
    fillHex(p, palette.bg, 210)
    p.rect(view.x + 8, by, view.w - 16, bh)
    enableGlow(ctx, palette.danger, 0.8)
    strokeHex(p, palette.danger, blink ? 255 : 120)
    p.strokeWeight(1.5)
    p.noFill()
    p.rect(view.x + 8, by, view.w - 16, bh)
    disableGlow(ctx)
    p.noStroke()
    fillHex(p, palette.danger, blink ? 255 : 140)
    p.textSize(13)
    p.textAlign(p.CENTER, p.CENTER)
    p.text(
      '⚠ SUJETO IDENTIFICADO — COINCIDENCIA 98.2% ⚠',
      view.x + view.w / 2,
      by + bh / 2 + 1,
    )
    p.pop()
  }

  private drawOSD(ctx: OSContext, view: Rect, live: boolean): void {
    const { p, palette } = ctx
    p.push()
    p.textSize(10)
    p.noStroke()
    // REC blinking dot, top-right of viewport.
    if (Math.floor(ctx.t * 2) % 2 === 0) {
      fillHex(p, palette.danger)
      p.circle(view.x + view.w - 44, view.y + 12, 6)
    }
    fillHex(p, palette.fg)
    p.textAlign(p.RIGHT, p.CENTER)
    p.text('REC', view.x + view.w - 12, view.y + 12)
    // Cam label + feed label, top-left.
    p.textAlign(p.LEFT, p.CENTER)
    fillHex(p, palette.accent)
    p.text(this.camLabel, view.x + 8, view.y + 12)
    fillHex(p, live ? palette.ok : palette.fgDim)
    p.text(this.feed.label, view.x + 8, view.y + 26)
    // Timecode, bottom-left of viewport.
    const tc = timecode(ctx)
    fillHex(p, palette.fg, 220)
    p.text(tc, view.x + 8, view.y + view.h - 12)
    p.pop()
  }

  private drawStrip(
    ctx: OSContext,
    inner: Rect,
    view: Rect,
    stripH: number,
    vision: VisionEngine | null,
    realTracks: TrackedObject[] | null,
  ): void {
    const { p, palette } = ctx
    const sy = view.y + view.h + 4
    strokeHex(p, palette.grid, 200)
    p.line(inner.x, sy, inner.x + inner.w, sy)
    p.noStroke()
    p.textSize(9)
    p.textAlign(p.LEFT, p.CENTER)
    fillHex(p, palette.fgDim)
    // Real vision reports honest numbers; otherwise the fakes perform.
    let ia = ''
    let objetivos = this.targets.length
    if (vision) {
      objetivos = realTracks?.filter((t) => t.confirmed).length ?? 0
      ia =
        vision.status === 'active'
          ? '  IA:EDL0'
          : vision.status === 'loading'
            ? '  IA:CARGANDO…'
            : '  IA:ERROR'
    }
    p.text(
      `OBJETIVOS:${objetivos}${ia}  ENC:AES-512  LAT:${(12 + p.noise(ctx.t) * 20).toFixed(0)}ms`,
      inner.x + 2,
      sy + stripH / 2,
    )
    enableGlow(ctx, palette.accent, 0.3)
    p.textAlign(p.RIGHT, p.CENTER)
    fillHex(p, palette.accent)
    p.text(ctx.config.agencyCode, inner.x + inner.w - 2, sy + stripH / 2)
    disableGlow(ctx)
  }
}

function timecode(ctx: OSContext): string {
  const total = ctx.t
  const hh = String(Math.floor(total / 3600) % 24).padStart(2, '0')
  const mm = String(Math.floor(total / 60) % 60).padStart(2, '0')
  const ss = String(Math.floor(total) % 60).padStart(2, '0')
  const ff = String(Math.floor((total % 1) * 30)).padStart(2, '0')
  return `${hh}:${mm}:${ss}:${ff}`
}
