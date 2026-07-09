/**
 * ObjectTracker.ts — Multi-object tracker over per-frame detections.
 *
 * SORT-style association without the Kalman machinery: greedy IoU
 * matching between existing tracks and each new detection batch, with
 * exponential smoothing for position and a velocity estimate used to
 * coast tracks between detection ticks (detection runs ~10 Hz, render
 * runs 60 — coasting is what makes the boxes glide instead of stutter).
 *
 * Tracks confirm after a few consecutive hits (kills one-frame ghosts)
 * and die after enough consecutive misses (survives brief occlusion).
 * All coordinates are source-video pixels; the panel maps to screen.
 */

export interface DetBox {
  x: number
  y: number
  w: number
  h: number
  label: string
  score: number
}

export interface TrackedObject {
  id: number
  label: string
  score: number
  /** Box in source-video pixels. */
  x: number
  y: number
  w: number
  h: number
  /** Center velocity, px/sec. */
  vx: number
  vy: number
  /** Seconds since first detection. */
  age: number
  hits: number
  missed: number
  /** Survived enough hits to be trusted (draw solid). */
  confirmed: boolean
  /** Recent center positions, oldest first. */
  trail: { x: number; y: number }[]
}

const MIN_IOU = 0.15
const CONFIRM_HITS = 3
const MAX_MISSES = 10 // detection ticks ≈ 1s of occlusion at 10 Hz
const TRAIL_MAX = 24

function iou(a: TrackedObject | DetBox, b: DetBox): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  if (inter <= 0) return 0
  return inter / (a.w * a.h + b.w * b.h - inter)
}

export class ObjectTracker {
  private nextId = 1
  private tracks: TrackedObject[] = []

  /** Coast tracks along their velocity between detection ticks. */
  predict(dt: number): void {
    for (const t of this.tracks) {
      t.x += t.vx * dt
      t.y += t.vy * dt
      t.age += dt
    }
  }

  /**
   * Reconcile tracks with a fresh detection batch.
   * @param elapsed seconds since the previous batch (for velocity).
   */
  update(dets: DetBox[], elapsed: number): TrackedObject[] {
    // All candidate pairs above the IoU floor, best matches first.
    // Same label required unless overlap is strong (detectors flicker
    // between related classes on the same object).
    const pairs: { ti: number; di: number; v: number }[] = []
    for (let ti = 0; ti < this.tracks.length; ti++) {
      for (let di = 0; di < dets.length; di++) {
        const v = iou(this.tracks[ti], dets[di])
        if (v < MIN_IOU) continue
        if (this.tracks[ti].label !== dets[di].label && v < 0.45) continue
        pairs.push({ ti, di, v })
      }
    }
    pairs.sort((a, b) => b.v - a.v)

    const usedT = new Set<number>()
    const usedD = new Set<number>()
    for (const { ti, di } of pairs) {
      if (usedT.has(ti) || usedD.has(di)) continue
      usedT.add(ti)
      usedD.add(di)
      const t = this.tracks[ti]
      const d = dets[di]
      if (elapsed > 0.001) {
        const mvx = (d.x + d.w / 2 - (t.x + t.w / 2)) / elapsed
        const mvy = (d.y + d.h / 2 - (t.y + t.h / 2)) / elapsed
        t.vx = t.vx * 0.6 + mvx * 0.4
        t.vy = t.vy * 0.6 + mvy * 0.4
      }
      t.x += (d.x - t.x) * 0.5
      t.y += (d.y - t.y) * 0.5
      t.w += (d.w - t.w) * 0.35
      t.h += (d.h - t.h) * 0.35
      t.label = d.label
      t.score = t.score * 0.7 + d.score * 0.3
      t.hits++
      t.missed = 0
      t.confirmed = t.confirmed || t.hits >= CONFIRM_HITS
      t.trail.push({ x: t.x + t.w / 2, y: t.y + t.h / 2 })
      if (t.trail.length > TRAIL_MAX) t.trail.shift()
    }

    for (let ti = 0; ti < this.tracks.length; ti++) {
      if (usedT.has(ti)) continue
      const t = this.tracks[ti]
      t.missed++
      t.vx *= 0.85 // don't let a lost track sail away
      t.vy *= 0.85
    }
    this.tracks = this.tracks.filter((t) => t.missed <= MAX_MISSES)

    for (let di = 0; di < dets.length; di++) {
      if (usedD.has(di)) continue
      const d = dets[di]
      this.tracks.push({
        id: this.nextId++,
        label: d.label,
        score: d.score,
        x: d.x,
        y: d.y,
        w: d.w,
        h: d.h,
        vx: 0,
        vy: 0,
        age: 0,
        hits: 1,
        missed: 0,
        confirmed: false,
        trail: [{ x: d.x + d.w / 2, y: d.y + d.h / 2 }],
      })
    }

    return this.tracks
  }

  get all(): TrackedObject[] {
    return this.tracks
  }
}
