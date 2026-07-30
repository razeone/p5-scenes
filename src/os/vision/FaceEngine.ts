import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'

export type FaceStatus = 'idle' | 'loading' | 'active' | 'error'

export interface DetectedFace {
  x: number
  y: number
  w: number
  h: number
}

const WASM_PATH = `${import.meta.env.BASE_URL}mediapipe/wasm`
const MODEL_PATH = `${import.meta.env.BASE_URL}models/blaze_face_short_range.tflite`
const DETECT_EVERY_MS = 100

let detectorPromise: Promise<FaceDetector> | null = null
let lastTimestampMs = 0

async function sharedDetector(): Promise<FaceDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH)
      const options = (delegate: 'GPU' | 'CPU') => ({
        baseOptions: { modelAssetPath: MODEL_PATH, delegate },
        runningMode: 'VIDEO' as const,
        minDetectionConfidence: 0.5,
      })
      try {
        return await FaceDetector.createFromOptions(fileset, options('GPU'))
      } catch {
        return FaceDetector.createFromOptions(fileset, options('CPU'))
      }
    })()
    detectorPromise.catch(() => {
      detectorPromise = null
    })
  }
  return detectorPromise
}

export class FaceEngine {
  status: FaceStatus = 'idle'
  faces: DetectedFace[] = []

  private detector: FaceDetector | null = null
  private initStarted = false
  private lastDetectMs = 0

  update(video: HTMLVideoElement): DetectedFace[] {
    if (!this.initStarted) {
      this.initStarted = true
      this.status = 'loading'
      sharedDetector()
        .then((detector) => {
          this.detector = detector
          this.status = 'active'
        })
        .catch((error) => {
          this.status = 'error'
          console.error('[face] detector init failed:', error)
        })
    }
    if (!this.detector || video.readyState < 2 || video.videoWidth === 0) {
      return this.faces
    }

    const now = performance.now()
    if (now - this.lastDetectMs < DETECT_EVERY_MS) return this.faces
    this.lastDetectMs = now
    const timestamp = Math.max(now, lastTimestampMs + 1)
    lastTimestampMs = timestamp
    try {
      this.faces = this.detector.detectForVideo(video, timestamp).detections.flatMap(
        (detection) => {
          const box = detection.boundingBox
          return box
            ? [{ x: box.originX, y: box.originY, w: box.width, h: box.height }]
            : []
        },
      )
    } catch (error) {
      this.status = 'error'
      console.error('[face] detection failed:', error)
    }
    return this.faces
  }
}