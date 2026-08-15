/**
 * Recorder.ts — records the p5 canvas to a take file.
 *
 * Wraps canvas.captureStream() + MediaRecorder. Only the canvas is
 * captured — DOM overlays (director panel, drop hint, REC badge) never
 * appear in the footage, so the panel can stay open while rolling.
 *
 * Container preference: MP4/H.264 when the browser can encode it (drops
 * straight into any NLE), else WebM. An optional microphone track can be
 * muxed in so takes carry scratch audio for sync.
 *
 * Ownership: one recorder per app; start() is a no-op while a take is
 * already rolling. stop() finalizes asynchronously (onstop fires after
 * the last chunk lands) and then reports via onStateChange. The finished
 * take's object URL is handed to onTakeSaved, which then owns revoking
 * it — that's what keeps takes reviewable in the session take list.
 * Downloading is the caller's choice (review-first workflow); set
 * autoDownload to save every take the moment it's cut.
 */

/** Preferred container for takes. */
export type TakeContainer = 'mp4' | 'webm'

const CANDIDATES: Record<TakeContainer, string[]> = {
  // avc1.640028 = H.264 High 4.0; the generic strings are fallbacks.
  mp4: [
    'video/mp4;codecs=avc1.640028',
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
  ],
  webm: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'],
}

function supported(mime: string): boolean {
  return (
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)
  )
}

/** First encodable mime for the preferred container, else any container. */
function pickMime(prefer: TakeContainer): string | undefined {
  const order: TakeContainer[] = prefer === 'mp4' ? ['mp4', 'webm'] : ['webm', 'mp4']
  for (const container of order) {
    const hit = CANDIDATES[container].find(supported)
    if (hit) return hit
  }
  return undefined
}

/** Whether this browser can encode the given container at all. */
export function canRecord(container: TakeContainer): boolean {
  return CANDIDATES[container].some(supported)
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
  /** Capture resolution, so the panel can show what was actually filmed. */
  width: number
  height: number
  /** True when a microphone track was muxed in. */
  hasAudio: boolean
}

export interface StartOpts {
  canvas: HTMLCanvasElement
  fps?: number
  /** Filename stem — scene identity is baked in by the caller. */
  baseName?: string
  container?: TakeContainer
  /** Live mic track to mux in (caller owns the stream's lifetime). */
  audio?: MediaStream | null
  /** Save to disk the instant the take is cut. */
  autoDownload?: boolean
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

  /** Container actually used for the next take (null = cannot record). */
  static resolveContainer(prefer: TakeContainer): TakeContainer | null {
    const mime = pickMime(prefer)
    if (!mime) return null
    return mime.startsWith('video/mp4') ? 'mp4' : 'webm'
  }

  start(opts: StartOpts): void {
    if (this.recorder) return
    const {
      canvas,
      fps = 60,
      baseName = 'os-take',
      container = 'mp4',
      audio = null,
      autoDownload = false,
    } = opts

    const stream = canvas.captureStream(fps)
    for (const track of audio?.getAudioTracks() ?? []) stream.addTrack(track)
    const mimeType = pickMime(container)
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 16_000_000, // filming quality
      audioBitsPerSecond: 128_000,
    })
    // Capture dims come from the backing store, which is what MediaRecorder
    // encodes — report them so the director sees the true output size.
    const width = canvas.width
    const height = canvas.height
    const hasAudio = (audio?.getAudioTracks().length ?? 0) > 0
    const ext = (mimeType ?? '').startsWith('video/mp4') ? 'mp4' : 'webm'

    this.chunks = []
    this.startedMs = performance.now()
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(this.chunks, {
        type: recorder.mimeType || `video/${ext}`,
      })
      const seconds = (performance.now() - this.startedMs) / 1000
      this.chunks = []
      // Only the canvas tracks are ours to stop; the mic stream belongs to
      // the caller and stays live for the next take.
      for (const track of stream.getVideoTracks()) track.stop()
      this.recorder = null
      const name = `${baseName}-${timestampSlug()}.${ext}`
      const url = URL.createObjectURL(blob)
      if (autoDownload) {
        const a = document.createElement('a')
        a.href = url
        a.download = name
        a.click()
      }
      if (this.onTakeSaved) {
        this.onTakeSaved({
          name,
          url,
          bytes: blob.size,
          seconds,
          width,
          height,
          hasAudio,
        })
      } else {
        // Nobody is holding the take: give the browser a beat to grab the
        // blob for the download, then release it.
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
