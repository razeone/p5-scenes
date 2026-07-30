/**
 * VisionEngine.ts — Real object detection for the surveillance feeds.
 *
 * MediaPipe Tasks Vision (WASM, GPU delegate with CPU fallback) running
 * EfficientDet-Lite0 — everything self-hosted from public/ so the app
 * works offline. One ObjectDetector is shared process-wide (the model is
 * ~7 MB); each feed gets its own VisionEngine holding its own tracker
 * state.
 *
 * Cadence: detection runs at ~10 Hz off the render loop's clock; the
 * tracker coasts boxes with their velocity on the 60 fps frames in
 * between. update() is synchronous and cheap when it's not a detection
 * tick, so panels just call it every draw.
 */

import { FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision'
import { ObjectTracker, type TrackedObject } from './ObjectTracker'

export type VisionStatus = 'loading' | 'active' | 'error'

const WASM_PATH = `${import.meta.env.BASE_URL}mediapipe/wasm`
const MODEL_PATH = `${import.meta.env.BASE_URL}models/efficientdet_lite0.tflite`
const DETECT_EVERY_MS = 100
const SCORE_THRESHOLD = 0.4
const MAX_RESULTS = 12

// One detector for the whole app; created on first use.
let detectorPromise: Promise<ObjectDetector> | null = null
// detectForVideo demands strictly increasing timestamps across calls —
// with two feeds sharing the detector we enforce that globally.
let lastTimestampMs = 0

async function sharedDetector(): Promise<ObjectDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH)
      const options = (delegate: 'GPU' | 'CPU') => ({
        baseOptions: { modelAssetPath: MODEL_PATH, delegate },
        runningMode: 'VIDEO' as const,
        scoreThreshold: SCORE_THRESHOLD,
        maxResults: MAX_RESULTS,
      })
      try {
        return await ObjectDetector.createFromOptions(fileset, options('GPU'))
      } catch {
        // No usable WebGL (headless, old drivers) — WASM CPU still works.
        return await ObjectDetector.createFromOptions(fileset, options('CPU'))
      }
    })()
    detectorPromise.catch(() => {
      detectorPromise = null // allow a later retry
    })
  }
  return detectorPromise
}

export class VisionEngine {
  status: VisionStatus = 'loading'
  tracks: TrackedObject[] = []

  private tracker = new ObjectTracker()
  private detector: ObjectDetector | null = null
  private initStarted = false
  private lastDetectMs = 0

  /**
   * Feed one render frame. Returns current tracks (video-pixel coords).
   * @param dt seconds since the previous render frame.
   */
  update(video: HTMLVideoElement, dt: number): TrackedObject[] {
    if (!this.initStarted) {
      this.initStarted = true
      sharedDetector()
        .then((d) => {
          this.detector = d
          this.status = 'active'
        })
        .catch((err) => {
          this.status = 'error'
          console.error('[vision] detector init failed:', err)
        })
    }
    if (!this.detector || video.readyState < 2 || video.videoWidth === 0) {
      return this.tracks
    }

    this.tracker.predict(dt)

    const now = performance.now()
    if (now - this.lastDetectMs >= DETECT_EVERY_MS) {
      const elapsed =
        this.lastDetectMs === 0 ? 0 : (now - this.lastDetectMs) / 1000
      this.lastDetectMs = now
      const ts = Math.max(now, lastTimestampMs + 1)
      lastTimestampMs = ts
      try {
        const result = this.detector.detectForVideo(video, ts)
        const dets = result.detections.flatMap((d) => {
          const box = d.boundingBox
          const cat = d.categories[0]
          if (!box || !cat) return []
          return [
            {
              x: box.originX,
              y: box.originY,
              w: box.width,
              h: box.height,
              label: cat.categoryName,
              score: cat.score,
            },
          ]
        })
        this.tracks = this.tracker.update(dets, elapsed)
      } catch (err) {
        this.status = 'error'
        console.error('[vision] detection failed:', err)
      }
    }
    return this.tracks
  }
}
