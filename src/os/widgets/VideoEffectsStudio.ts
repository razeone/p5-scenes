import { Entity } from '../core/Entity'
import type { OSContext } from '../core/context'
import { fillHex, strokeHex } from '../core/context'
import type { FeedSource } from '../media/FeedSource'
import { StaticFeed } from '../media/FeedSource'
import { VideoFeed } from '../media/VideoSource'
import type { TrackedObject } from '../vision/ObjectTracker'
import { labelEs, threatTier } from '../vision/labels'
import { FaceEngine, type DetectedFace } from '../vision/FaceEngine'

export type StudioFit = 'cover' | 'contain'

export interface StudioEffects {
  fit: StudioFit
  zoom: number
  panX: number
  panY: number
  rotation: number
  mirror: boolean
  blur: number
  pixelate: number
  faceBlur: number
  brightness: number
  contrast: number
  saturation: number
  hue: number
  invert: number
  rgbSplit: number
  noise: number
  glitch: number
  overlays: boolean
  trails: boolean
  identify: boolean
}

export const DEFAULT_STUDIO_EFFECTS: StudioEffects = {
  fit: 'cover',
  zoom: 1,
  panX: 0,
  panY: 0,
  rotation: 0,
  mirror: false,
  blur: 0,
  pixelate: 1,
  faceBlur: 0,
  brightness: 1,
  contrast: 1,
  saturation: 1,
  hue: 0,
  invert: 0,
  rgbSplit: 0,
  noise: 0,
  glitch: 0,
  overlays: false,
  trails: true,
  identify: false,
}

export const STUDIO_PRESETS = {
  clean: DEFAULT_STUDIO_EFFECTS,
  identify: {
    ...DEFAULT_STUDIO_EFFECTS,
    contrast: 1.12,
    saturation: 0.78,
    overlays: true,
    identify: true,
  },
  glitch: {
    ...DEFAULT_STUDIO_EFFECTS,
    contrast: 1.25,
    saturation: 1.35,
    rgbSplit: 12,
    noise: 0.22,
    glitch: 0.55,
  },
  privacy: {
    ...DEFAULT_STUDIO_EFFECTS,
    faceBlur: 18,
  },
  night: {
    ...DEFAULT_STUDIO_EFFECTS,
    brightness: 0.72,
    contrast: 1.45,
    saturation: 0.2,
    hue: 95,
    noise: 0.12,
    overlays: true,
  },
} satisfies Record<string, StudioEffects>

interface DrawMap {
  scale: number
  sourceX: number
  sourceY: number
  drawX: number
  drawY: number
  centerX: number
  centerY: number
}

export class VideoEffectsStudio extends Entity {
  feed: FeedSource = new StaticFeed()
  effects: StudioEffects = { ...DEFAULT_STUDIO_EFFECTS }

  private buffer = document.createElement('canvas')
  private pixelBuffer = document.createElement('canvas')
  private map: DrawMap | null = null
  private faceEngine = new FaceEngine()

  setFeed(feed: FeedSource): void {
    this.feed = feed
  }

  patchEffects(patch: Partial<StudioEffects>): void {
    Object.assign(this.effects, patch)
  }

  resetEffects(): void {
    this.effects = { ...DEFAULT_STUDIO_EFFECTS }
  }

  // Transport sync (play/pause/rate/seek against the director clock) is
  // applied to every feed centrally in OSApp's draw loop, so the studio
  // no longer needs its own update pass.

  draw(ctx: OSContext): void {
    const { p, width, height } = ctx
    p.push()
    p.background(5, 6, 7)

    if (!(this.feed instanceof VideoFeed) || !this.feed.ready) {
      this.feed.draw(ctx, { x: 0, y: 0, w: width, h: height })
      this.drawEmptyState(ctx)
      p.pop()
      return
    }

    this.renderVideo(ctx, this.feed)
    const faces = this.effects.faceBlur > 0
      ? this.faceEngine.update(this.feed.element)
      : []
    if (faces.length > 0) this.drawFaceBlur(ctx, faces)
    const tracks = this.feed.vision?.update(this.feed.element, ctx.dt) ?? []
    if (this.effects.overlays) this.drawTracks(ctx, tracks)
    this.drawNoiseAndGlitch(ctx)
    this.drawHud(ctx, tracks)
    p.pop()
  }

  private renderVideo(ctx: OSContext, feed: VideoFeed): void {
    const { width, height } = ctx
    this.ensureCanvas(this.buffer, width, height)
    const dc = this.buffer.getContext('2d')
    if (!dc) return

    const video = feed.element
    const coverScale = Math.max(width / video.videoWidth, height / video.videoHeight)
    const containScale = Math.min(width / video.videoWidth, height / video.videoHeight)
    const scale = this.effects.fit === 'cover' ? coverScale : containScale
    const drawW = video.videoWidth * scale
    const drawH = video.videoHeight * scale
    const drawX = (width - drawW) / 2
    const drawY = (height - drawH) / 2
    const centerX = width / 2 + this.effects.panX * width * 0.5
    const centerY = height / 2 + this.effects.panY * height * 0.5

    dc.save()
    dc.clearRect(0, 0, width, height)
    dc.fillStyle = '#050607'
    dc.fillRect(0, 0, width, height)
    dc.translate(centerX, centerY)
    dc.rotate((this.effects.rotation * Math.PI) / 180)
    dc.scale(
      this.effects.zoom * (this.effects.mirror ? -1 : 1),
      this.effects.zoom,
    )
    dc.translate(-width / 2, -height / 2)
    dc.filter = [
      `blur(${this.effects.blur}px)`,
      `brightness(${this.effects.brightness})`,
      `contrast(${this.effects.contrast})`,
      `saturate(${this.effects.saturation})`,
      `hue-rotate(${this.effects.hue}deg)`,
      `invert(${this.effects.invert})`,
    ].join(' ')
    dc.drawImage(video, drawX, drawY, drawW, drawH)
    dc.restore()

    this.map = {
      scale,
      sourceX: width / 2,
      sourceY: height / 2,
      drawX,
      drawY,
      centerX,
      centerY,
    }

    const canvas = ctx.p.drawingContext as CanvasRenderingContext2D
    canvas.save()
    canvas.imageSmoothingEnabled = this.effects.pixelate <= 1
    if (this.effects.pixelate > 1) {
      const factor = Math.max(2, Math.round(this.effects.pixelate))
      const pw = Math.max(1, Math.round(width / factor))
      const ph = Math.max(1, Math.round(height / factor))
      this.ensureCanvas(this.pixelBuffer, pw, ph)
      const pc = this.pixelBuffer.getContext('2d')
      if (pc) {
        pc.imageSmoothingEnabled = true
        pc.clearRect(0, 0, pw, ph)
        pc.drawImage(this.buffer, 0, 0, pw, ph)
        canvas.drawImage(this.pixelBuffer, 0, 0, pw, ph, 0, 0, width, height)
      }
    } else {
      canvas.drawImage(this.buffer, 0, 0)
    }

    if (this.effects.rgbSplit > 0) {
      const split = this.effects.rgbSplit
      canvas.globalCompositeOperation = 'screen'
      canvas.globalAlpha = 0.34
      canvas.drawImage(this.buffer, -split, 0)
      canvas.drawImage(this.buffer, split, 0)
    }
    canvas.restore()
  }

  private mapPoint(x: number, y: number): { x: number; y: number } {
    const map = this.map
    if (!map) return { x, y }
    let px = map.drawX + x * map.scale - map.sourceX
    let py = map.drawY + y * map.scale - map.sourceY
    px -= map.centerX
    py -= map.centerY
    px *= this.effects.zoom * (this.effects.mirror ? -1 : 1)
    py *= this.effects.zoom
    const angle = (this.effects.rotation * Math.PI) / 180
    const rx = px * Math.cos(angle) - py * Math.sin(angle)
    const ry = px * Math.sin(angle) + py * Math.cos(angle)
    return { x: rx + map.centerX, y: ry + map.centerY }
  }

  private drawTracks(ctx: OSContext, tracks: TrackedObject[]): void {
    const { p, palette } = ctx
    for (const track of tracks.filter((item) => item.confirmed)) {
      const corners = [
        this.mapPoint(track.x, track.y),
        this.mapPoint(track.x + track.w, track.y),
        this.mapPoint(track.x + track.w, track.y + track.h),
        this.mapPoint(track.x, track.y + track.h),
      ]
      const color = palette[threatTier(track.label)]
      p.noFill()
      strokeHex(p, color, 230)
      p.strokeWeight(1.5)
      p.beginShape()
      for (const point of corners) p.vertex(point.x, point.y)
      p.endShape(p.CLOSE)

      if (this.effects.trails && track.trail.length > 1) {
        strokeHex(p, color, 100)
        p.beginShape()
        for (const point of track.trail) {
          const mapped = this.mapPoint(point.x, point.y)
          p.vertex(mapped.x, mapped.y)
        }
        p.endShape()
      }

      p.noStroke()
      fillHex(p, color)
      p.textSize(11)
      p.textAlign(p.LEFT, p.BOTTOM)
      p.text(
        `TRK-${String(track.id).padStart(3, '0')}  ${labelEs(track.label)}  ${(track.score * 100).toFixed(0)}%`,
        corners[0].x,
        corners[0].y - 6,
      )
    }
  }

  private drawFaceBlur(ctx: OSContext, faces: DetectedFace[]): void {
    const canvas = ctx.p.drawingContext as CanvasRenderingContext2D
    for (const face of faces) {
      const padX = face.w * 0.16
      const padY = face.h * 0.2
      const corners = [
        this.mapPoint(face.x - padX, face.y - padY),
        this.mapPoint(face.x + face.w + padX, face.y - padY),
        this.mapPoint(face.x + face.w + padX, face.y + face.h + padY),
        this.mapPoint(face.x - padX, face.y + face.h + padY),
      ]
      canvas.save()
      canvas.beginPath()
      canvas.moveTo(corners[0].x, corners[0].y)
      for (const point of corners.slice(1)) canvas.lineTo(point.x, point.y)
      canvas.closePath()
      canvas.clip()
      canvas.filter = `blur(${this.effects.faceBlur}px)`
      canvas.drawImage(this.buffer, 0, 0)
      canvas.restore()
    }
  }

  private drawNoiseAndGlitch(ctx: OSContext): void {
    const { p, width, height } = ctx
    if (this.effects.noise > 0) {
      p.stroke(255, 255 * this.effects.noise)
      p.strokeWeight(1)
      const count = Math.round(width * height * this.effects.noise * 0.00018)
      for (let i = 0; i < count; i++) {
        const x = p.random(width)
        const y = p.random(height)
        p.point(x, y)
      }
    }
    if (this.effects.glitch > 0 && Math.random() < this.effects.glitch * 0.22) {
      const dc = p.drawingContext as CanvasRenderingContext2D
      const slices = 2 + Math.floor(this.effects.glitch * 7)
      for (let i = 0; i < slices; i++) {
        const y = Math.random() * height
        const h = 3 + Math.random() * height * 0.06
        const offset = (Math.random() - 0.5) * 80 * this.effects.glitch
        dc.drawImage(this.buffer, 0, y, width, h, offset, y, width, h)
      }
    }
  }

  private drawHud(ctx: OSContext, tracks: TrackedObject[]): void {
    const { p, palette, width, height } = ctx
    p.noStroke()
    fillHex(p, palette.bg, 185)
    p.rect(14, 14, 245, 50)
    strokeHex(p, palette.grid, 200)
    p.noFill()
    p.rect(14, 14, 245, 50)
    p.noStroke()
    fillHex(p, palette.fg)
    p.textAlign(p.LEFT, p.TOP)
    p.textSize(11)
    p.text('VIDEO EFFECTS STUDIO', 26, 25)
    fillHex(p, palette.fgDim)
    p.textSize(9)
    const status = this.effects.faceBlur > 0
      ? `FACE ${this.faceEngine.status.toUpperCase()} · ${this.faceEngine.faces.length}`
      : this.feed instanceof VideoFeed && this.feed.vision
      ? `${this.feed.vision.status.toUpperCase()} · ${tracks.filter((t) => t.confirmed).length} TRACKS`
      : 'VISION OFF'
    p.text(status, 26, 44)

    if (this.effects.identify && tracks.some((track) => track.confirmed)) {
      fillHex(p, palette.bg, 215)
      p.rect(width * 0.2, height * 0.78, width * 0.6, 42)
      strokeHex(p, palette.danger)
      p.noFill()
      p.rect(width * 0.2, height * 0.78, width * 0.6, 42)
      p.noStroke()
      fillHex(p, palette.danger)
      p.textSize(14)
      p.textAlign(p.CENTER, p.CENTER)
      p.text('SUBJECT IDENTIFIED // TRACK LOCKED', width / 2, height * 0.78 + 21)
    }
  }

  private drawEmptyState(ctx: OSContext): void {
    const { p, palette, width, height } = ctx
    p.noStroke()
    fillHex(p, palette.fg)
    p.textAlign(p.CENTER, p.CENTER)
    p.textSize(Math.min(22, width / 30))
    p.text('DROP A VIDEO OR CHOOSE FILE / WEBCAM', width / 2, height / 2)
    fillHex(p, palette.fgDim)
    p.textSize(11)
    p.text('VIDEO EFFECTS STUDIO · READY', width / 2, height / 2 + 34)
  }

  private ensureCanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
  }
}