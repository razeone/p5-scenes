import { Entity } from '../core/Entity'
import type { OSContext } from '../core/context'
import { fillHex, strokeHex } from '../core/context'
import type { FeedSource } from '../media/FeedSource'
import { StaticFeed } from '../media/FeedSource'
import { VideoFeed } from '../media/VideoSource'
import { FaceEngine } from '../vision/FaceEngine'
import { labelEs, threatTier } from '../vision/labels'
import type { TrackedObject } from '../vision/ObjectTracker'

export type VrFrameStyle =
  | 'optical'
  | 'mechanical'
  | 'photographic'
  | 'clinical'

export const VR_FRAME_STYLES: VrFrameStyle[] = [
  'optical',
  'mechanical',
  'photographic',
  'clinical',
]

export interface VrVisionSettings {
  frameStyle: VrFrameStyle
  showObjects: boolean
  showFaces: boolean
  showTelemetry: boolean
}

export const DEFAULT_VR_VISION_SETTINGS: VrVisionSettings = {
  frameStyle: 'optical',
  showObjects: true,
  showFaces: true,
  showTelemetry: true,
}

export type VrMessageTone = 'info' | 'warn' | 'danger'

export interface VrVisionMessage {
  id: string
  text: string
  tone: VrMessageTone
  duration: number
  createdAt: number
}

export class VrVisionScene extends Entity {
  feed: FeedSource = new StaticFeed()
  settings: VrVisionSettings = { ...DEFAULT_VR_VISION_SETTINGS }
  activeMessage: VrVisionMessage | null = null

  private faceEngine = new FaceEngine()

  setFeed(feed: FeedSource): void {
    this.feed = feed
  }

  setFrameStyle(style: VrFrameStyle): void {
    this.settings.frameStyle = style
  }

  patchSettings(patch: Partial<VrVisionSettings>): void {
    Object.assign(this.settings, patch)
  }

  setActiveMessage(message: VrVisionMessage | null): void {
    this.activeMessage = message
  }

  cycleFrameStyle(): void {
    const index = VR_FRAME_STYLES.indexOf(this.settings.frameStyle)
    this.settings.frameStyle = VR_FRAME_STYLES[(index + 1) % VR_FRAME_STYLES.length]
  }

  draw(ctx: OSContext): void {
    const { p, width, height } = ctx
    p.push()
    p.background(2, 3, 3)
    const live = this.feed.draw(ctx, { x: 0, y: 0, w: width, h: height })

    let tracks: TrackedObject[] = []
    if (live && this.feed instanceof VideoFeed) {
      tracks = this.feed.vision?.update(this.feed.element, ctx.dt) ?? []
      if (this.settings.showObjects) this.drawTracks(ctx, this.feed, tracks)
      if (this.settings.showFaces) this.drawFaces(ctx, this.feed)
    }

    if (this.activeMessage) this.drawMessage(ctx, this.activeMessage)
    this.drawFrame(ctx)
    if (this.settings.showTelemetry) this.drawReadout(ctx, tracks)
    p.pop()
  }

  private drawTracks(
    ctx: OSContext,
    feed: VideoFeed,
    tracks: TrackedObject[],
  ): void {
    const { p } = ctx
    p.push()
    p.noFill()
    p.textAlign(p.LEFT, p.BOTTOM)
    p.textSize(11)
    for (const track of tracks) {
      if (!track.confirmed) continue
      const topLeft = feed.toViewport(track.x, track.y)
      const bottomRight = feed.toViewport(track.x + track.w, track.y + track.h)
      const color = ctx.palette[threatTier(track.label)]
      strokeHex(p, color, 220)
      p.strokeWeight(1.2)
      p.rect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y)
      p.noStroke()
      fillHex(p, color, 235)
      p.text(
        `${labelEs(track.label)} ${Math.round(track.score * 100)}% // ${track.id}`,
        topLeft.x,
        topLeft.y - 5,
      )
      p.noFill()
    }
    p.pop()
  }

  private drawFaces(ctx: OSContext, feed: VideoFeed): void {
    const { p } = ctx
    const faces = this.faceEngine.update(feed.element)
    p.push()
    p.noFill()
    strokeHex(p, ctx.palette.accent, 190)
    p.strokeWeight(1)
    for (const face of faces) {
      const topLeft = feed.toViewport(face.x, face.y)
      const bottomRight = feed.toViewport(face.x + face.w, face.y + face.h)
      const w = bottomRight.x - topLeft.x
      const h = bottomRight.y - topLeft.y
      const corner = Math.min(w, h) * 0.2
      p.line(topLeft.x, topLeft.y, topLeft.x + corner, topLeft.y)
      p.line(topLeft.x, topLeft.y, topLeft.x, topLeft.y + corner)
      p.line(bottomRight.x, topLeft.y, bottomRight.x - corner, topLeft.y)
      p.line(bottomRight.x, topLeft.y, bottomRight.x, topLeft.y + corner)
      p.line(topLeft.x, bottomRight.y, topLeft.x + corner, bottomRight.y)
      p.line(topLeft.x, bottomRight.y, topLeft.x, bottomRight.y - corner)
      p.line(bottomRight.x, bottomRight.y, bottomRight.x - corner, bottomRight.y)
      p.line(bottomRight.x, bottomRight.y, bottomRight.x, bottomRight.y - corner)
    }
    p.pop()
  }

  private drawFrame(ctx: OSContext): void {
    switch (this.settings.frameStyle) {
      case 'optical':
        this.drawOpticalFrame(ctx)
        break
      case 'mechanical':
        this.drawMechanicalFrame(ctx)
        break
      case 'photographic':
        this.drawPhotographicFrame(ctx)
        break
      case 'clinical':
        this.drawClinicalFrame(ctx)
        break
    }
  }

  private drawMessage(ctx: OSContext, message: VrVisionMessage): void {
    const { p, width, height } = ctx
    const maxW = Math.min(width * 0.72, 980)
    const x = width / 2
    const y = height * 0.78
    const color = message.tone === 'danger'
      ? ctx.palette.danger
      : message.tone === 'warn'
        ? ctx.palette.warn
        : ctx.palette.fg
    p.push()
    p.noStroke()
    p.fill(0, 0, 0, 205)
    p.rectMode(p.CENTER)
    p.rect(x, y, maxW, Math.max(76, height * 0.09), 2)
    strokeHex(p, color, 210)
    p.noFill()
    p.strokeWeight(1)
    p.rect(x, y, maxW, Math.max(76, height * 0.09), 2)
    p.noStroke()
    fillHex(p, color, 245)
    p.textAlign(p.CENTER, p.CENTER)
    p.textSize(Math.max(15, Math.min(30, width * 0.018)))
    p.text(message.text, x, y, maxW - 48, Math.max(58, height * 0.075))
    p.pop()
  }

  private drawOpticalFrame(ctx: OSContext): void {
    const { p, width, height } = ctx
    const dc = p.drawingContext as CanvasRenderingContext2D
    const radius = Math.min(height * 0.395, width * 0.235)
    const bridge = Math.max(18, Math.min(width * 0.035, radius * 0.18))
    const leftX = width / 2 - radius - bridge / 2
    const rightX = width / 2 + radius + bridge / 2
    const centerY = height * 0.51

    // Each ellipse starts a distinct subpath. Without the moveTo calls,
    // Canvas joins the shapes with straight lines and creates black wedges.
    const mask = new Path2D()
    mask.rect(0, 0, width, height)
    mask.moveTo(leftX + radius, centerY)
    mask.ellipse(leftX, centerY, radius, radius, 0, 0, Math.PI * 2)
    mask.closePath()
    mask.moveTo(rightX + radius, centerY)
    mask.ellipse(rightX, centerY, radius, radius, 0, 0, Math.PI * 2)
    mask.closePath()

    dc.save()
    dc.fillStyle = 'rgba(0, 0, 0, 0.96)'
    dc.fill(mask, 'evenodd')

    // Optical falloff belongs inside each lens, strongest at the rim.
    for (const lensX of [leftX, rightX]) {
      const falloff = dc.createRadialGradient(
        lensX,
        centerY,
        radius * 0.48,
        lensX,
        centerY,
        radius,
      )
      falloff.addColorStop(0, 'rgba(0, 0, 0, 0)')
      falloff.addColorStop(0.78, 'rgba(0, 0, 0, 0.08)')
      falloff.addColorStop(1, 'rgba(0, 0, 0, 0.58)')
      dc.fillStyle = falloff
      dc.beginPath()
      dc.arc(lensX, centerY, radius, 0, Math.PI * 2)
      dc.fill()
    }
    dc.restore()

    // A shallow nose bridge separates the optics without covering them.
    p.noStroke()
    p.fill(0, 0, 0, 245)
    p.quad(
      width / 2 - bridge * 0.58,
      centerY - radius * 0.19,
      width / 2 + bridge * 0.58,
      centerY - radius * 0.19,
      width / 2 + bridge * 0.42,
      centerY + radius * 0.19,
      width / 2 - bridge * 0.42,
      centerY + radius * 0.19,
    )

    p.noFill()
    strokeHex(p, ctx.palette.fgDim, 120)
    p.strokeWeight(Math.max(5, radius * 0.025))
    p.circle(leftX, centerY, radius * 2)
    p.circle(rightX, centerY, radius * 2)
    strokeHex(p, ctx.palette.accent, 165)
    p.strokeWeight(1)
    p.circle(leftX, centerY, radius * 1.965)
    p.circle(rightX, centerY, radius * 1.965)
  }

  private drawMechanicalFrame(ctx: OSContext): void {
    const { p, width, height } = ctx
    const edge = Math.max(34, width * 0.055)
    p.noStroke()
    p.fill(4, 5, 5, 232)
    p.quad(0, 0, edge * 2.1, 0, edge, height, 0, height)
    p.quad(width, 0, width - edge * 2.1, 0, width - edge, height, width, height)
    p.rect(0, 0, width, edge * 0.72)
    p.rect(0, height - edge * 0.72, width, edge * 0.72)
    p.noFill()
    strokeHex(p, ctx.palette.fgDim, 210)
    p.strokeWeight(2)
    p.rect(edge, edge * 0.72, width - edge * 2, height - edge * 1.44)
    p.strokeWeight(1)
    for (const x of [edge * 0.55, width - edge * 0.55]) {
      for (const y of [edge * 0.38, height - edge * 0.38]) p.circle(x, y, 7)
    }
  }

  private drawPhotographicFrame(ctx: OSContext): void {
    const { p, width, height, frame } = ctx
    const edge = Math.max(22, Math.min(width, height) * 0.045)
    p.noStroke()
    p.fill(2, 2, 2, 225)
    p.rect(0, 0, width, edge + Math.sin(frame * 0.17) * 2)
    p.rect(0, height - edge, width, edge)
    p.rect(0, 0, edge, height)
    p.rect(width - edge, 0, edge, height)
    strokeHex(p, ctx.palette.fg, 90)
    p.strokeWeight(1)
    for (let i = 0; i < 9; i += 1) {
      const x = ((i * 173 + frame * 0.6) % Math.max(1, width - edge * 2)) + edge
      p.line(x, edge, x + Math.sin(i * 4.1) * 8, height - edge)
    }
  }

  private drawClinicalFrame(ctx: OSContext): void {
    const { p, width, height } = ctx
    const cx = width / 2
    const cy = height / 2
    const radius = Math.min(width, height) * 0.17
    p.noFill()
    strokeHex(p, ctx.palette.accent, 195)
    p.strokeWeight(1)
    p.circle(cx, cy, radius * 2)
    p.line(cx - radius * 1.45, cy, cx - radius * 0.32, cy)
    p.line(cx + radius * 0.32, cy, cx + radius * 1.45, cy)
    p.line(cx, cy - radius * 1.25, cx, cy - radius * 0.32)
    p.line(cx, cy + radius * 0.32, cx, cy + radius * 1.25)
    for (let i = -4; i <= 4; i += 1) {
      const x = cx + i * radius * 0.28
      p.line(x, cy + radius * 1.34, x, cy + radius * (i === 0 ? 1.48 : 1.41))
    }
  }

  private drawReadout(ctx: OSContext, tracks: TrackedObject[]): void {
    const { p, width, height } = ctx
    p.noStroke()
    p.textSize(11)
    p.textAlign(p.LEFT, p.TOP)
    fillHex(p, ctx.palette.fg, 220)
    p.text(`VR-VISION // ${this.settings.frameStyle.toUpperCase()}`, 26, 22)
    p.textAlign(p.RIGHT, p.TOP)
    fillHex(p, ctx.palette.fgDim, 215)
    p.text(this.feed.label, width - 26, 22)
    p.textAlign(p.LEFT, p.BOTTOM)
    p.text(`IA ${this.feed instanceof VideoFeed && this.feed.vision ? 'ACTIVA' : 'PASIVA'} // ${tracks.filter((track) => track.confirmed).length} OBJ`, 26, height - 22)
  }
}