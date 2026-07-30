/**
 * Recorder.ts — Phase 7: records the p5 canvas to a WebM take.
 *
 * Wraps canvas.captureStream() + MediaRecorder and auto-downloads the
 * finished take. Only the canvas is captured — DOM overlays (director
 * panel, drop hint, REC badge) never appear in the footage, so the
 * panel can stay open while rolling.
 *
 * Ownership: one recorder per app; start() is a no-op while a take is
 * already rolling. stop() finalizes asynchronously (onstop fires after
 * the last chunk lands) and then reports via onStateChange. When
 * onTakeSaved is set, the finished take's object URL is handed to that
 * callback (which then owns revoking it — this is what keeps takes
 * reviewable in the session take list); otherwise the URL is revoked
 * shortly after the auto-download.
 */

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m))
}

/** Filesystem-safe local timestamp, shared by take/photo filenames. */
export function timestampSlug(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
}

/** Metadata for a finished take (the URL stays valid until revoked). */
export interface TakeInfo {
  name: string
  url: string
  bytes: number
  seconds: number
}

export class CanvasRecorder {
  /** Reflects start/stop so the React shell can track state. */
  onStateChange?: (recording: boolean) => void
  /** Fires once per finished take; the callback owns the object URL. */
  onTakeSaved?: (take: TakeInfo) => void

  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private startedMs = 0

  get recording(): boolean {
    return this.recorder?.state === 'recording'
  }

  start(canvas: HTMLCanvasElement, fps = 60, baseName = 'os-take'): void {
    if (this.recorder) return
    const stream = canvas.captureStream(fps)
    const mimeType = pickMime()
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 16_000_000, // filming quality
    })
    this.chunks = []
    this.startedMs = performance.now()
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(this.chunks, {
        type: recorder.mimeType || 'video/webm',
      })
      const seconds = (performance.now() - this.startedMs) / 1000
      this.chunks = []
      for (const t of stream.getTracks()) t.stop()
      this.recorder = null
      const name = `${baseName}-${timestampSlug()}.webm`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      if (this.onTakeSaved) {
        this.onTakeSaved({ name, url, bytes: blob.size, seconds })
      } else {
        // Give the browser a beat to grab the blob before releasing it.
        setTimeout(() => URL.revokeObjectURL(url), 5000)
      }
      this.onStateChange?.(false)
    }
    recorder.start(1000) // chunk every second so long takes survive a crash
    this.recorder = recorder
    this.onStateChange?.(true)
  }

  stop(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop()
    }
  }
}
