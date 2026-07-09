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
 * the last chunk lands) and then reports via onStateChange.
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

export class CanvasRecorder {
  /** Reflects start/stop so the React shell can track state. */
  onStateChange?: (recording: boolean) => void

  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []

  get recording(): boolean {
    return this.recorder?.state === 'recording'
  }

  start(canvas: HTMLCanvasElement, fps = 60): void {
    if (this.recorder) return
    const stream = canvas.captureStream(fps)
    const mimeType = pickMime()
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 16_000_000, // filming quality
    })
    this.chunks = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(this.chunks, {
        type: recorder.mimeType || 'video/webm',
      })
      this.chunks = []
      for (const t of stream.getTracks()) t.stop()
      this.recorder = null
      this.download(blob)
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

  private download(blob: Blob): void {
    const stamp = new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, '-')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `os-take-${stamp}.webm`
    a.click()
    // Give the browser a beat to grab the blob before releasing it.
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }
}
