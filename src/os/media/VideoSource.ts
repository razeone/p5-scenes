/**
 * VideoSource.ts — Real footage inside a surveillance panel.
 *
 * VideoFeed wraps an HTMLVideoElement fed by either a dropped/picked
 * video file (object URL, looped) or a live webcam MediaStream. It
 * cover-fits the frame into the panel viewport, with a faint palette
 * tint so any footage sits inside the OS look.
 *
 * Ownership: whoever swaps a feed out calls dispose() to release the
 * object URL / camera tracks.
 */

import type { OSContext } from '../core/context'
import { fillHex } from '../core/context'
import type { Rect } from '../core/geometry'
import type { FeedSource } from './FeedSource'
import type { VisionEngine } from '../vision/VisionEngine'

export class VideoFeed implements FeedSource {
  readonly label: string
  /** Live object detection/tracking; attached by the director. */
  vision: VisionEngine | null = null
  private video: HTMLVideoElement
  private objectUrl?: string
  private stream?: MediaStream
  // Cover-fit mapping from the last draw(): viewport = (source - s) * scale + r
  private map = { scale: 1, sx: 0, sy: 0, rx: 0, ry: 0 }

  private constructor(video: HTMLVideoElement, label: string) {
    this.video = video
    this.label = label
  }

  /** Footage from a dropped/picked file. Loops for endless takes. */
  static fromFile(file: File): VideoFeed {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    video.src = url
    video.muted = true
    video.loop = true
    video.playsInline = true
    // dispose() can pause before play() resolves — that abort is fine.
    video.play().catch(() => {})
    const feed = new VideoFeed(video, `ARCHIVO // ${file.name.toUpperCase()}`)
    feed.objectUrl = url
    return feed
  }

  /** Live camera. */
  static async fromWebcam(): Promise<VideoFeed> {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720 },
      audio: false,
    })
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    video.play().catch(() => {})
    const feed = new VideoFeed(video, 'CAM-EN-VIVO')
    feed.stream = stream
    return feed
  }

  /** Source element, for feeding the vision engine. */
  get element(): HTMLVideoElement {
    return this.video
  }

  get ready(): boolean {
    return this.video.readyState >= 2 && this.video.videoWidth > 0
  }

  get duration(): number {
    return Number.isFinite(this.video.duration) ? this.video.duration : 0
  }

  get currentTime(): number {
    return this.video.currentTime
  }

  get paused(): boolean {
    return this.video.paused
  }

  play(): void {
    this.video.play().catch(() => {})
  }

  pause(): void {
    this.video.pause()
  }

  seek(seconds: number): void {
    if (!this.ready || !Number.isFinite(seconds)) return
    this.video.currentTime = Math.max(0, Math.min(seconds, this.duration || seconds))
  }

  setPlaybackRate(speed: number): void {
    this.video.playbackRate = Math.max(0.1, Math.min(4, speed || 1))
  }

  /** Map a point in source-video pixels to canvas coords (last draw). */
  toViewport(x: number, y: number): { x: number; y: number } {
    const m = this.map
    return {
      x: m.rx + (x - m.sx) * m.scale,
      y: m.ry + (y - m.sy) * m.scale,
    }
  }

  /** Scale factor of the last draw's cover-fit (source px → canvas px). */
  get viewportScale(): number {
    return this.map.scale
  }

  dispose(): void {
    this.vision = null
    this.video.pause()
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    if (this.stream) for (const t of this.stream.getTracks()) t.stop()
    this.video.srcObject = null
    this.video.removeAttribute('src')
  }

  draw(ctx: OSContext, r: Rect): boolean {
    const { p } = ctx
    const v = this.video
    if (v.readyState < 2 || v.videoWidth === 0) {
      p.push()
      p.noStroke()
      p.fill(8, 10, 8)
      p.rect(r.x, r.y, r.w, r.h)
      fillHex(p, ctx.palette.fgDim, 200)
      p.textSize(12)
      p.textAlign(p.CENTER, p.CENTER)
      p.text('CARGANDO SEÑAL…', r.x + r.w / 2, r.y + r.h / 2)
      p.pop()
      return false
    }

    // Cover-fit: crop the source so the viewport is filled edge to edge.
    const scale = Math.max(r.w / v.videoWidth, r.h / v.videoHeight)
    const sw = r.w / scale
    const sh = r.h / scale
    const sx = (v.videoWidth - sw) / 2
    const sy = (v.videoHeight - sh) / 2
    this.map = { scale, sx, sy, rx: r.x, ry: r.y }
    const dc = p.drawingContext as CanvasRenderingContext2D
    dc.drawImage(v, sx, sy, sw, sh, r.x, r.y, r.w, r.h)

    // Faint palette tint so footage adopts the OS atmosphere.
    p.push()
    p.noStroke()
    fillHex(p, ctx.palette.glow, 26)
    p.rect(r.x, r.y, r.w, r.h)
    p.pop()
    return true
  }
}
