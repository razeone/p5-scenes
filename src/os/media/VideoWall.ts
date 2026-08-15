/**
 * VideoWall.ts — The clip bin behind the HYPERVIGILANCIA video wall.
 *
 * The director points the wall at a folder of footage; this owns the
 * ordered bin, remembers which clip each screen is showing, and runs the
 * staggered auto-advance that keeps the wall cutting by itself during a
 * take. Screens never cut as one block: each one is offset by `stagger`,
 * so the wall rolls instead of blinking.
 *
 * It never touches the canvas. It hands OSApp a list of screen indices
 * that need new footage and OSApp does the feed plumbing — see
 * layoutWall() / applyWallClip() there.
 *
 * Ownership: the bin holds Files (cheap handles), not decoders. The live
 * <video> elements belong to the panels and die with the scene.
 */

/** Containers browsers play that don't always carry a video/* MIME type. */
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|ogv|ogg|mpg|mpeg|m2ts|ts)$/i

/**
 * A picked folder arrives as every file it contains, and Windows drops
 * `.mov`/`.mkv` in with an empty type — so the extension is the fallback.
 */
export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || VIDEO_EXT.test(file.name)
}

/** What the director panel needs to describe the wall in one glance. */
export interface WallState {
  /** Clips in the bin. */
  clips: number
  /** 1-based position in the bin of the clip on screen 1 (0 = empty). */
  cursor: number
  /** Screens the bin is currently feeding. */
  screens: number
  auto: boolean
  /** Seconds a screen holds a clip before cutting. */
  holdSeconds: number
  /** Seconds between neighbouring screens' cuts. */
  stagger: number
  /** Filename on each screen, in wall order. */
  assigned: string[]
}

export class VideoWall {
  private clips: File[] = []
  /** Bin index each screen is showing, in wall order. */
  private shown: number[] = []
  /** Scene time (seconds) at which each screen next cuts. */
  private dueAt: number[] = []
  /** Walks the bin: every cut takes the next clip, so nothing repeats. */
  private head = 0
  /** Which screen a manual CORTE hits next. */
  private rotor = 0

  auto = false
  holdSeconds = 4
  stagger = 0.7

  get count(): number {
    return this.clips.length
  }

  get empty(): boolean {
    return this.clips.length === 0
  }

  /**
   * Replace the bin. Sorted by filename with numeric collation so
   * `cam_2.mp4` lands before `cam_10.mp4` — a folder should read in the
   * order the director sees it on disk. Returns how many clips were kept.
   */
  load(files: File[]): number {
    this.clips = files
      .filter(isVideoFile)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    this.head = 0
    this.rotor = 0
    return this.clips.length
  }

  clear(): void {
    this.clips = []
    this.shown = []
    this.dueAt = []
    this.head = 0
    this.rotor = 0
  }

  /** Fisher-Yates. The wall re-reads from the top afterwards. */
  shuffle(): void {
    for (let i = this.clips.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[this.clips[i], this.clips[j]] = [this.clips[j], this.clips[i]]
    }
    this.head = 0
  }

  /**
   * Point `screens` panels at the top of the bin and re-arm their holds.
   * Called on every wall rebuild — the bin outlives the panels, so this
   * is what puts footage back after a scene change or a re-tile.
   * Returns the screen indices that now have a clip.
   */
  layout(screens: number, t: number): number[] {
    this.shown = []
    this.dueAt = []
    this.rotor = 0
    if (this.clips.length === 0) return []
    for (let i = 0; i < screens; i++) {
      this.shown.push(this.take())
      this.dueAt.push(t + this.holdSeconds + i * this.stagger)
    }
    return this.shown.map((_, i) => i)
  }

  /**
   * Re-arm the holds without touching what is on screen. Used when the
   * pace changes or AUTO comes back on mid-take: re-dealing the bin there
   * would cut all nine screens at once, which reads as a glitch.
   */
  reschedule(t: number): void {
    for (let i = 0; i < this.dueAt.length; i++) {
      this.dueAt[i] = t + this.holdSeconds + i * this.stagger
    }
  }

  /** Next clip off the bin, wrapping. */
  private take(): number {
    const i = this.head % this.clips.length
    this.head = (this.head + 1) % this.clips.length
    return i
  }

  /**
   * Screens whose hold has expired, on the director clock. Empty while
   * AUTO is off, so the caller can skip the panel lookup entirely.
   */
  update(t: number): number[] {
    if (!this.auto || this.clips.length === 0) return []
    const cut: number[] = []
    for (let i = 0; i < this.shown.length; i++) {
      if (t < this.dueAt[i]) continue
      this.shown[i] = this.take()
      this.dueAt[i] = t + this.holdSeconds
      cut.push(i)
    }
    return cut
  }

  /** Manual rolling cut: the next screen in rotation takes a new clip. */
  cutOne(t: number): number {
    if (this.clips.length === 0 || this.shown.length === 0) return -1
    const i = this.rotor % this.shown.length
    this.rotor = (this.rotor + 1) % this.shown.length
    this.shown[i] = this.take()
    this.dueAt[i] = t + this.holdSeconds
    return i
  }

  /**
   * Move the whole wall one clip up or down the bin — the "video by
   * video" pass, where every screen steps together. Returns every screen,
   * since they all need new footage.
   */
  shift(dir: number, t: number): number[] {
    if (this.clips.length === 0 || this.shown.length === 0) return []
    const n = this.clips.length
    for (let i = 0; i < this.shown.length; i++) {
      this.shown[i] = (this.shown[i] + dir + n) % n
      this.dueAt[i] = t + this.holdSeconds + i * this.stagger
    }
    this.head = (this.shown[this.shown.length - 1] + 1) % n
    return this.shown.map((_, i) => i)
  }

  /** The file a screen should be showing, or null when the bin is empty. */
  clipAt(screen: number): File | null {
    const i = this.shown[screen]
    return i === undefined ? null : (this.clips[i] ?? null)
  }

  state(): WallState {
    return {
      clips: this.clips.length,
      cursor: this.shown.length > 0 ? this.shown[0] + 1 : 0,
      screens: this.shown.length,
      auto: this.auto,
      holdSeconds: this.holdSeconds,
      stagger: this.stagger,
      assigned: this.shown.map((i) => this.clips[i]?.name ?? '—'),
    }
  }
}
