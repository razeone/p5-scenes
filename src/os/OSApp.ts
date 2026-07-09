/**
 * OSApp.ts — Wires p5 (instance mode) to the OS scene graph and exposes
 * an imperative controller the React shell drives (theme, phase staging,
 * video feeds, and canvas recording).
 *
 * This is the seam between the declarative React control panel and the
 * imperative p5 render loop. React holds an OSController; the loop reads
 * a mutable OSContext that this module keeps up to date every frame.
 *
 * Phase flow for filming:  boot → login (interactive) → desktop.
 * The controller can jump straight to any phase for retakes.
 */

import p5 from 'p5'
import { CONFIG } from './config/config'
import { PALETTES, PALETTE_ORDER, type PaletteKey } from './config/theme'
import type { OSContext } from './core/context'
import { SceneManager, type OSPhase } from './core/SceneManager'
import { drawBackground, applyPost } from './fx/Effects'
import { BootSequence } from './widgets/BootSequence'
import { LoginWindow } from './widgets/LoginWindow'
import { ConsoleWindow } from './widgets/ConsoleWindow'
import { TelemetryWindow } from './widgets/TelemetryWindow'
import { SurveillancePanel } from './widgets/SurveillancePanel'
import { RadarWindow } from './widgets/RadarWindow'
import { StatusBar } from './widgets/StatusBar'
import { StaticFeed } from './media/FeedSource'
import { VideoFeed } from './media/VideoSource'
import { CanvasRecorder } from './media/Recorder'
import { VisionEngine } from './vision/VisionEngine'

/** Panel slots the director can pipe video into. */
export type CamSlot = 'cam-a' | 'cam-b'

export interface OSController {
  setTheme(key: PaletteKey): void
  cycleTheme(dir?: number): void
  getThemeKey(): PaletteKey
  /** Jump to a phase (for retakes: boot, login, desktop). */
  setPhase(phase: OSPhase): void
  getPhase(): OSPhase
  /** Restart the whole performance from boot. */
  restart(): void
  /** Pipe a video file into a surveillance slot (desktop phase). */
  loadVideoFile(file: File, slot?: CamSlot): void
  /** Pipe the live webcam into a surveillance slot. */
  useWebcam(slot?: CamSlot): Promise<void>
  /** Drop a slot back to static. */
  clearFeed(slot?: CamSlot): void
  /** Toggle real object detection/tracking on the video feeds. */
  setVision(on: boolean): void
  isVisionOn(): boolean
  /** Start capturing the canvas to a WebM take. */
  startRecording(): void
  /** Cut: finalize the take and auto-download it. */
  stopRecording(): void
  isRecording(): boolean
  destroy(): void
}

/** Callbacks so the React shell can reflect internal state changes. */
export interface OSHooks {
  onThemeChange?: (key: PaletteKey) => void
  onPhaseChange?: (phase: OSPhase) => void
  onRecordingChange?: (recording: boolean) => void
  onVisionChange?: (on: boolean) => void
}

export function createOSApp(
  container: HTMLElement,
  hooks: OSHooks = {},
): OSController {
  let themeKey: PaletteKey = CONFIG.startTheme
  const scene = new SceneManager()

  // The single mutable context object, refreshed each frame.
  const ctx: OSContext = {
    p: null as unknown as p5,
    palette: PALETTES[themeKey],
    config: CONFIG,
    width: container.clientWidth || 1280,
    height: container.clientHeight || 720,
    t: 0,
    frame: 0,
    dt: 0,
  }

  let lastMs = 0
  // p5 v2 runs setup asynchronously — remember phase requests that arrive
  // before the canvas exists instead of letting setup stomp them.
  let ready = false
  let pendingPhase: OSPhase | null = null
  let canvasEl: HTMLCanvasElement | null = null
  // destroy() can land before async setup finishes (StrictMode remount);
  // instance.remove() is a no-op pre-canvas, so setup must self-abort or
  // a zombie instance keeps drawing and firing hooks.
  let destroyed = false

  const recorder = new CanvasRecorder()
  recorder.onStateChange = (rec) => hooks.onRecordingChange?.(rec)

  const sketch = (p: p5) => {
    ctx.p = p

    p.setup = () => {
      if (destroyed) {
        p.remove()
        return
      }
      // Re-measure: the constructor may have run before first layout.
      ctx.width = container.clientWidth || ctx.width
      ctx.height = container.clientHeight || ctx.height
      const c = p.createCanvas(ctx.width, ctx.height)
      c.parent(container)
      canvasEl = c.elt as HTMLCanvasElement
      p.frameRate(60)
      p.textFont('Courier New')
      lastMs = p.millis()
      ready = true
      setPhase(pendingPhase ?? 'boot')
    }

    p.draw = () => {
      const now = p.millis()
      ctx.dt = Math.min((now - lastMs) / 1000, 0.1)
      lastMs = now
      ctx.t = now / 1000
      ctx.frame = p.frameCount
      ctx.palette = PALETTES[themeKey]

      drawBackground(ctx)
      scene.update(ctx)
      scene.draw(ctx)
      applyPost(ctx)
    }

    // Keyboard → focused entity (login fields, etc.).
    // keyTyped gets printable characters; keyPressed handles the rest.
    p.keyTyped = () => {
      if (typeof p.key === 'string' && p.key.length === 1) {
        scene.dispatchKey(ctx, p.key)
      }
      return false // prevent browser defaults while filming
    }

    p.keyPressed = () => {
      if (p.key === 'Enter' || p.key === 'Backspace') {
        scene.dispatchKey(ctx, p.key)
        return false
      }
      return true
    }

    p.windowResized = () => syncSize()
  }

  /**
   * Adopt the container's real size. The container can change without a
   * window resize (late stylesheet, layout shift), and phase layouts are
   * computed from ctx dims — so on a genuine change, rebuild the current
   * phase or windows keep the stale geometry (a collapsed container once
   * gave the radar a negative radius and froze the draw loop).
   */
  function syncSize(): void {
    if (!ready) return
    const w = container.clientWidth
    const h = container.clientHeight
    if (w < 2 || h < 2) return // mid-layout collapse; ignore
    if (w === ctx.width && h === ctx.height) return
    ctx.width = w
    ctx.height = h
    ctx.p.resizeCanvas(w, h)
    setPhase(scene.phase)
  }

  const sizeObserver = new ResizeObserver(() => syncSize())
  sizeObserver.observe(container)

  // ------------------------------------------------------------------
  // Phase staging
  // ------------------------------------------------------------------

  function setPhase(phase: OSPhase): void {
    if (!ready) {
      pendingPhase = phase
      return
    }
    scene.phase = phase
    scene.clear()
    scene.setFocus(null)
    switch (phase) {
      case 'boot':
        buildBoot()
        break
      case 'login':
        buildLogin()
        break
      case 'desktop':
        buildDesktop()
        break
    }
    hooks.onPhaseChange?.(phase)
  }

  function buildBoot(): void {
    const boot = new BootSequence()
    boot.onComplete = () => setPhase('login')
    scene.add(boot, ctx)
  }

  function buildLogin(): void {
    const w = Math.min(440, ctx.width * 0.6)
    const h = 470
    const login = new LoginWindow({
      x: (ctx.width - w) / 2,
      y: (ctx.height - h) / 2,
      w,
      h,
      title: `${CONFIG.agencyCode} // AUTENTICACIÓN`,
      tag: 'SEGURO',
      revealTime: 0.5,
    })
    login.onComplete = () => setPhase('desktop')
    scene.add(login, ctx)
    scene.setFocus(login)
  }

  function buildDesktop(): void {
    const W = ctx.width
    const H = ctx.height
    const M = 16 // outer margin / gutter
    const top = 34 + M // below the status bar

    scene.add(new StatusBar(), ctx)

    // Column widths: log | 2× surveillance | telemetry+radar.
    const logW = Math.max(300, W * 0.24)
    const rightW = Math.max(300, W * 0.26)
    const midW = W - logW - rightW - M * 4
    const colH = H - top - M

    // Left: activity log.
    scene.add(
      new ConsoleWindow({
        x: M,
        y: top,
        w: logW,
        h: colH,
        title: `${CONFIG.agencyCode} // REGISTRO`,
        tag: 'LIVE',
        revealTime: 0.6,
      }),
      ctx,
    )

    // Middle: two stacked surveillance feeds.
    const feedH = (colH - M) / 2
    const camA = new SurveillancePanel({
      x: M * 2 + logW,
      y: top,
      w: midW,
      h: feedH,
      title: 'VIGILANCIA // PLAZA-1',
      tag: 'CAM-07',
      camLabel: 'CAM-07 / PLAZA-1',
      targetCount: 3,
      revealTime: 0.7,
    })
    camA.id = 'cam-a'
    scene.add(camA, ctx)

    const camB = new SurveillancePanel({
      x: M * 2 + logW,
      y: top + feedH + M,
      w: midW,
      h: feedH,
      title: 'VIGILANCIA // SECTOR-11',
      tag: 'CAM-12',
      camLabel: 'CAM-12 / SECTOR-11',
      targetCount: 2,
      accentKey: 'accent',
      revealTime: 0.9,
    })
    camB.id = 'cam-b'
    scene.add(camB, ctx)

    // Right: telemetry on top, radar below.
    const rx = W - rightW - M
    const telH = Math.min(280, colH * 0.45)
    scene.add(
      new TelemetryWindow({
        x: rx,
        y: top,
        w: rightW,
        h: telH,
        title: 'TELEMETRÍA DE NODO',
        tag: CONFIG.operator.clearance,
        accentKey: 'accent',
        revealTime: 0.8,
      }),
      ctx,
    )
    scene.add(
      new RadarWindow({
        x: rx,
        y: top + telH + M,
        w: rightW,
        h: colH - telH - M,
        title: 'RASTREO AÉREO',
        tag: 'DRON-3',
        revealTime: 1.0,
      }),
      ctx,
    )
  }

  const instance = new p5(sketch, container)

  function applyTheme(key: PaletteKey) {
    themeKey = key
    ctx.palette = PALETTES[key]
    hooks.onThemeChange?.(key)
  }

  // ------------------------------------------------------------------
  // Feed management
  // ------------------------------------------------------------------

  // Vision is a mode, not a per-feed switch: new video feeds pick it up
  // automatically so the director toggles it once for the whole desk.
  let visionOn = true

  function panelFor(slot: CamSlot): SurveillancePanel | undefined {
    const e = scene.get(slot)
    return e instanceof SurveillancePanel ? e : undefined
  }

  function swapFeed(slot: CamSlot, feed: VideoFeed | StaticFeed): void {
    const panel = panelFor(slot)
    if (!panel) {
      if (feed instanceof VideoFeed) feed.dispose()
      return
    }
    if (panel.feed instanceof VideoFeed) panel.feed.dispose()
    if (feed instanceof VideoFeed && visionOn) feed.vision = new VisionEngine()
    panel.setFeed(feed)
  }

  function setVision(on: boolean): void {
    visionOn = on
    for (const slot of ['cam-a', 'cam-b'] as const) {
      const feed = panelFor(slot)?.feed
      if (feed instanceof VideoFeed) {
        feed.vision = on ? (feed.vision ?? new VisionEngine()) : null
      }
    }
    hooks.onVisionChange?.(on)
  }

  const controller: OSController = {
    setTheme: (key) => applyTheme(key),
    cycleTheme: (dir = 1) => {
      const i = PALETTE_ORDER.indexOf(themeKey)
      const next =
        PALETTE_ORDER[(i + dir + PALETTE_ORDER.length) % PALETTE_ORDER.length]
      applyTheme(next)
    },
    getThemeKey: () => themeKey,
    setPhase: (phase) => setPhase(phase),
    getPhase: () => scene.phase,
    restart: () => setPhase('boot'),
    loadVideoFile: (file, slot = 'cam-a') =>
      swapFeed(slot, VideoFeed.fromFile(file)),
    useWebcam: async (slot = 'cam-a') =>
      swapFeed(slot, await VideoFeed.fromWebcam()),
    clearFeed: (slot = 'cam-a') => swapFeed(slot, new StaticFeed()),
    setVision: (on) => setVision(on),
    isVisionOn: () => visionOn,
    startRecording: () => {
      if (canvasEl) recorder.start(canvasEl)
    },
    stopRecording: () => recorder.stop(),
    isRecording: () => recorder.recording,
    destroy: () => {
      destroyed = true
      sizeObserver.disconnect()
      recorder.stop()
      instance.remove()
    },
  }

  // Dev/console access for quick direction on set:
  //   __os.setTheme('amber'), __os.useWebcam('cam-b'), __os.restart(), ...
  // __osDebug peeks at live vision state (smoke tests, on-set checks).
  if (import.meta.env.DEV) {
    ;(window as unknown as { __os: OSController }).__os = controller
    ;(window as unknown as { __osDebug: object }).__osDebug = {
      visionStatus: (slot: CamSlot = 'cam-a') => {
        const f = panelFor(slot)?.feed
        return f instanceof VideoFeed ? (f.vision?.status ?? null) : null
      },
      tracks: (slot: CamSlot = 'cam-a') => {
        const f = panelFor(slot)?.feed
        return f instanceof VideoFeed ? (f.vision?.tracks ?? null) : null
      },
    }
  }

  return controller
}
