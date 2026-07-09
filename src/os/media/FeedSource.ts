/**
 * FeedSource.ts — What a surveillance panel displays inside its viewport.
 *
 * A FeedSource only knows how to paint pixels into a rect; the panel adds
 * all the tracking/OSD dressing on top. StaticFeed is the "no signal"
 * placeholder; VideoFeed (media/VideoSource.ts) wraps real footage or a
 * webcam and is swapped in at runtime by the director.
 */

import type { OSContext } from '../core/context'
import { fillHex } from '../core/context'
import type { Rect } from '../core/geometry'

export interface FeedSource {
  /** Paint the feed into r. Return false if there is no signal yet. */
  draw(ctx: OSContext, r: Rect): boolean
  /** Short label for the OSD, e.g. "SIN SEÑAL", "ARCHIVO", "CAM-EN-VIVO". */
  readonly label: string
}

/** Analog snow + rolling interference band. Reads as a dead camera. */
export class StaticFeed implements FeedSource {
  readonly label = 'SIN SEÑAL'

  draw(ctx: OSContext, r: Rect): boolean {
    const { p } = ctx
    p.push()
    p.noStroke()
    // Dark backing.
    p.fill(8, 10, 8)
    p.rect(r.x, r.y, r.w, r.h)
    // Sparse snow — enough to read as static without tanking the frame rate.
    const grains = Math.floor((r.w * r.h) / 900)
    for (let i = 0; i < grains; i++) {
      const g = p.random(30, 150)
      p.fill(g, g, g, p.random(60, 200))
      p.rect(r.x + p.random(r.w), r.y + p.random(r.h), 2, 2)
    }
    // Rolling interference band.
    const bandY = r.y + ((ctx.t * 40) % (r.h + 40)) - 20
    p.fill(255, 255, 255, 14)
    p.rect(r.x, Math.max(r.y, bandY), r.w, 18)
    // NO SIGNAL stamp.
    fillHex(p, ctx.palette.fgDim, 180)
    p.textSize(12)
    p.textAlign(p.CENTER, p.CENTER)
    if (Math.floor(ctx.t * 1.5) % 2 === 0) {
      p.text('— SIN SEÑAL —', r.x + r.w / 2, r.y + r.h / 2)
    }
    p.pop()
    return false
  }
}
