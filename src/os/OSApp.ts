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
import { CONFIG, type OSConfig } from './config/config'
import { PALETTES, PALETTE_ORDER, type PaletteKey } from './config/theme'
import type {
  DirectorClockState,
  OSContext,
} from './core/context'
import { SceneManager, type OSPhase } from './core/SceneManager'
import { drawBackground, applyPost } from './fx/Effects'
import { BootSequence } from './widgets/BootSequence'
import { LoginWindow } from './widgets/LoginWindow'
import { ConsoleWindow } from './widgets/ConsoleWindow'
import { TelemetryWindow } from './widgets/TelemetryWindow'
import { SurveillancePanel } from './widgets/SurveillancePanel'
import { RadarWindow } from './widgets/RadarWindow'
import { StatusBar } from './widgets/StatusBar'
import { OSWindow } from './widgets/OSWindow'
import { MapWindow } from './widgets/MapWindow'
import { GeoMapWindow } from './widgets/GeoMapWindow'
import {
  ScopeWindow,
  SpectrogramWindow,
  GaugeArrayWindow,
} from './widgets/SensorWindows'
import { CallWindow } from './widgets/CallWindow'
import {
  DieMapWindow,
  LogicAnalyzerWindow,
  FabStatsWindow,
  CHIP_FEED,
} from './widgets/ChipWindows'
import {
  MotherboardWindow,
  BoardManifestWindow,
  BOARD_FEED,
} from './widgets/BoardWindows'
import {
  BioStateEntity,
  BodyMapWindow,
  VitalsWindow,
  NeuroChemWindow,
  BehaviorWindow,
  IMPLANT_FEED,
} from './widgets/BioWindows'
import {
  LoyaltyStateEntity,
  PhysioWindow,
  ConductWindow,
  LoyaltyWindow,
  StateWindow,
  LOYALTY_FEED,
} from './widgets/LoyaltyWindows'
import {
  LiveMetricsEntity,
  LiveAnalysisWindow,
  LiveVerdictWindow,
  ANALYSIS_FEED,
} from './widgets/AnalysisWindows'
import { StaticFeed } from './media/FeedSource'
import { VideoFeed } from './media/VideoSource'
import { CanvasRecorder, timestampSlug, type TakeInfo } from './media/Recorder'
import { VisionEngine } from './vision/VisionEngine'
import { Slate } from './widgets/Slate'
import { HypervigilanceScene } from './widgets/HypervigilanceScene'
import { SilenceScene } from './widgets/SilenceScene'
import {
  DEFAULT_STUDIO_EFFECTS,
  STUDIO_PRESETS,
  VideoEffectsStudio,
  type StudioEffects,
} from './widgets/VideoEffectsStudio'
import type { LogLevel } from './widgets/TextStream'

/** Slots the director can pipe video into (panels + the call's self tile). */
export type CamSlot = 'cam-a' | 'cam-b' | 'call-self' | 'studio' | 'silence'
export type StudioPreset = keyof typeof STUDIO_PRESETS

export interface StudioMediaState {
  ready: boolean
  label: string
  currentTime: number
  duration: number
  paused: boolean
}

/** A finished take with its slate number, for the session take list. */
export type SavedTake = TakeInfo & { take: number }

/**
 * One-shot scene-specific direction cues. Each acts on the widgets of
 * the current scene (no-ops elsewhere), so the panel can show only the
 * controls that matter for what's on screen.
 */
export type SceneAction =
  // vigilancia
  | 'cam-mark'
  | 'targets-up'
  | 'targets-down'
  // mapa
  | 'map-new-target'
  | 'map-chase'
  | 'map-patrol'
  | 'map-add-unit'
  | 'map-remove-unit'
  // geo (rastreo sobre mapa real)
  | 'geo-new-target'
  | 'geo-chase'
  | 'geo-patrol'
  | 'geo-follow'
  | 'geo-zoom-in'
  | 'geo-zoom-out'
  | 'geo-city'
  | 'geo-add-unit'
  | 'geo-remove-unit'
  // sensores
  | 'sensor-quake'
  | 'sensor-transmission'
  | 'sensor-chem'
  // llamada
  | 'call-next-speaker'
  | 'call-drop'
  | 'call-reconnect'
  // chip
  | 'chip-drc'
  | 'chip-thermal'
  | 'chip-layer'
  | 'chip-reroute'
  | 'chip-test'
  | 'chip-tapeout'
  // placa
  | 'board-restart'
  | 'board-next'
  | 'board-power'
  | 'board-xray'
  | 'board-fault'
  // implante
  | 'bio-panic'
  | 'bio-sedate'
  | 'bio-reward'
  | 'bio-lie'
  | 'bio-arrest'
  // lealtad
  | 'loy-portrait'
  | 'loy-dissent'
  | 'loy-pardon'
  | 'loy-curate'
  // análisis (lealtad sobre video real)
  | 'ana-dissent'
  | 'ana-pardon'
  | 'ana-reset'

export interface OSController {
  setTheme(key: PaletteKey): void
  cycleTheme(dir?: number): void
  getThemeKey(): PaletteKey
  /** Jump to a phase (for retakes: boot, login, desktop). */
  setPhase(phase: OSPhase): void
  getPhase(): OSPhase
  /** Restart the whole performance from boot. */
  restart(): void
  /** Rebuild the current scene without changing its phase. */
  reloadScene(): void
  /** Dispose current video sources and rebuild the current scene. */
  reloadMedia(): void
  /** Reset the current take and its scene-local timeline. */
  resetTake(): void
  /** Transport controls for rehearsal and deterministic rendering. */
  play(): void
  pause(): void
  step(seconds?: number): void
  seek(seconds: number): void
  setSpeed(speed: number): void
  getClock(): DirectorClockState
  setMovieTitle(title: string): void
  getMovieTitle(): string
  /** Pipe a video file into a surveillance slot (desktop phase). */
  loadVideoFile(file: File, slot?: CamSlot): void
  /** Pipe the live webcam into a surveillance slot. */
  useWebcam(slot?: CamSlot): Promise<void>
  /** Drop a slot back to static. */
  clearFeed(slot?: CamSlot): void
  /** Patch or reset the full-screen studio's effect pipeline. */
  setStudioEffects(patch: Partial<StudioEffects>): void
  getStudioEffects(): StudioEffects
  applyStudioPreset(preset: StudioPreset): void
  getStudioMediaState(): StudioMediaState
  /** Toggle real object detection/tracking on the video feeds. */
  setVision(on: boolean): void
  isVisionOn(): boolean
  /** Live CRT ambience: scanlines, glow, vignette, flicker, glitch. */
  setCrt(patch: Partial<OSConfig['crt']>): void
  getCrt(): OSConfig['crt']
  /** Momentary heavy glitch/tear burst (scene transitions, hits). */
  glitchBurst(seconds?: number): void
  /** Push a line into the activity log (desktop phase). */
  logLine(text: string, level?: LogLevel): void
  /** Blinking directive in the status bar for a few seconds. */
  announce(text: string, seconds?: number): void
  /** Fire a scene-specific direction cue (see SceneAction). */
  trigger(action: SceneAction): void
  /** Download a PNG still of the canvas. */
  screenshot(): void
  /** Start capturing the canvas to a WebM take. */
  startRecording(): void
  /** Cut: finalize the take and auto-download it. */
  stopRecording(): void
  isRecording(): boolean
  /** Number of the last take recorded this session (0 = none yet). */
  getTake(): number
  destroy(): void
}

/** Callbacks so the React shell can reflect internal state changes. */
export interface OSHooks {
  onThemeChange?: (key: PaletteKey) => void
  onPhaseChange?: (phase: OSPhase) => void
  onRecordingChange?: (recording: boolean) => void
  onVisionChange?: (on: boolean) => void
  /** A take finished; the receiver owns revoking take.url. */
  onTakeSaved?: (take: SavedTake) => void
}

export function createOSApp(
  container: HTMLElement,
  hooks: OSHooks = {},
): OSController {
  let themeKey: PaletteKey = CONFIG.startTheme
  const scene = new SceneManager()

  // The single mutable context object, refreshed each frame.
  // config.crt is a session-local copy so the director can slide values
  // live without mutating the module-level defaults.
  const ctx: OSContext = {
    p: null as unknown as p5,
    palette: PALETTES[themeKey],
    config: {
      ...CONFIG,
      crt: { ...CONFIG.crt },
      scenes: structuredClone(CONFIG.scenes),
    },
    width: container.clientWidth || 1280,
    height: container.clientHeight || 720,
    t: 0,
    frame: 0,
    dt: 0,
    clock: {
      mode: 'realtime',
      time: 0,
      frame: 0,
      speed: 1,
    },
  }

  let lastMs = 0
  let clockMode: 'realtime' | 'paused' | 'manual' = 'realtime'
  let clockTime = 0
  let clockFrame = 0
  let clockSpeed = 1
  let pendingStep = 0
  let previousClockTime = 0
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
  recorder.onTakeSaved = (info) => hooks.onTakeSaved?.({ ...info, take })

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
      const wallDt = Math.min((now - lastMs) / 1000, 0.1)
      lastMs = now
      const advance =
        clockMode === 'realtime' ? wallDt * clockSpeed : pendingStep
      pendingStep = 0
      clockTime += advance
      clockFrame += advance > 0 ? 1 : 0
      ctx.dt = Math.max(0, clockTime - previousClockTime)
      previousClockTime = clockTime
      ctx.t = clockTime
      ctx.frame = clockFrame
      ctx.clock = {
        mode: clockMode,
        time: clockTime,
        frame: clockFrame,
        speed: clockSpeed,
      }
      ctx.palette = PALETTES[themeKey]

      drawBackground(ctx)
      scene.update(ctx)
      scene.draw(ctx)

      // Director-triggered glitch burst: spike the post pass briefly.
      const crt = ctx.config.crt
      const bursting = ctx.t < glitchBurstUntil
      let saved: { glitchChance: number; flicker: number } | null = null
      if (bursting) {
        saved = { glitchChance: crt.glitchChance, flicker: crt.flicker }
        crt.glitchChance = 0.85
        crt.flicker = Math.max(crt.flicker, 0.6)
      }
      applyPost(ctx)
      if (saved) {
        crt.glitchChance = saved.glitchChance
        crt.flicker = saved.flicker
      }
    }

    // Keyboard → focused entity (login fields, etc.).
    // keyTyped gets printable characters; keyPressed handles the rest.
    // When a DOM input has focus (director panel text field), stand down
    // entirely — returning false there would preventDefault the typing.
    const typingInDom = () => {
      const el = document.activeElement
      return (
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      )
    }

    p.keyTyped = () => {
      if (typingInDom()) return true
      if (typeof p.key === 'string' && p.key.length === 1) {
        scene.dispatchKey(ctx, p.key)
      }
      return false // prevent browser defaults while filming
    }

    p.keyPressed = () => {
      if (typingInDom()) return true
      if (p.key === 'Enter' || p.key === 'Backspace') {
        scene.dispatchKey(ctx, p.key)
        return false
      }
      return true
    }

    p.windowResized = () => syncSize()

    // --- Window dragging (title-bar grab, bring-to-front on any press).
    // Events over the DOM control panel are ignored — p5 listens on the
    // whole window, so we gate on the event target being the canvas.
    let dragWin: OSWindow | null = null

    const windowAt = (
      x: number,
      y: number,
      titleOnly: boolean,
    ): OSWindow | null => {
      const all = scene.all
      for (let i = all.length - 1; i >= 0; i--) {
        const e = all[i]
        if (!(e instanceof OSWindow) || !e.visible) continue
        if (titleOnly ? e.titleBarContains(x, y) : e.contains(x, y)) return e
      }
      return null
    }

    const setFocused = (win: OSWindow | null) => {
      for (const e of scene.all) {
        if (e instanceof OSWindow) e.focused = e === win
      }
    }

    p.mousePressed = (event?: object) => {
      if (event instanceof MouseEvent && event.target !== canvasEl) return
      const hit = windowAt(p.mouseX, p.mouseY, false)
      if (!hit) {
        if (scene.phase === 'silence') {
          widgetById('silence', SilenceScene)?.click(ctx)
        }
        return
      }
      scene.bringToFront(hit)
      setFocused(hit)
      if (hit.draggable && hit.titleBarContains(p.mouseX, p.mouseY)) {
        dragWin = hit
        if (canvasEl) canvasEl.style.cursor = 'grabbing'
      }
    }

    p.mouseDragged = () => {
      dragWin?.moveBy(p.movedX, p.movedY, ctx.width, ctx.height)
    }

    p.mouseReleased = () => {
      dragWin = null
      if (canvasEl) canvasEl.style.cursor = ''
    }

    p.mouseMoved = (event?: object) => {
      if (dragWin || !canvasEl) return
      if (event instanceof MouseEvent && event.target !== canvasEl) return
      const over = windowAt(p.mouseX, p.mouseY, true)
      canvasEl.style.cursor = over?.draggable ? 'grab' : ''
    }
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
    if (scene.phase === 'video-effects' || scene.phase === 'silence') return
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
    resetClock()
    disposeSceneFeeds()
    scene.clear()
    scene.setFocus(null)
    switch (phase) {
      case 'boot':
        buildBoot()
        break
      case 'login':
        buildLogin()
        break
      case 'hypervigilance':
        buildHypervigilance()
        break
      case 'desktop':
        buildDesktop()
        break
      case 'map':
        buildMap()
        break
      case 'geo':
        buildGeo()
        break
      case 'sensors':
        buildSensors()
        break
      case 'call':
        buildCall()
        break
      case 'chip':
        buildChip()
        break
      case 'board':
        buildBoard()
        break
      case 'implant':
        buildImplant()
        break
      case 'loyalty':
        buildLoyalty()
        break
      case 'analysis':
        buildAnalysis()
        break
      case 'video-effects':
        buildVideoEffects()
        break
      case 'silence':
        buildSilence()
        break
    }
    hooks.onPhaseChange?.(phase)
  }

  function resetClock(): void {
    clockMode = 'realtime'
    clockTime = 0
    clockFrame = 0
    pendingStep = 0
    previousClockTime = 0
    ctx.t = 0
    ctx.dt = 0
    ctx.frame = 0
    ctx.clock = {
      mode: clockMode,
      time: clockTime,
      frame: clockFrame,
      speed: clockSpeed,
    }
  }

  function playClock(): void {
    clockMode = 'realtime'
  }

  function pauseClock(): void {
    clockMode = 'paused'
    pendingStep = 0
  }

  function stepClock(seconds = 1 / 60): void {
    clockMode = 'manual'
    pendingStep += Math.max(0, seconds)
  }

  function seekClock(seconds: number): void {
    clockMode = 'manual'
    clockTime = Math.max(0, seconds)
    pendingStep = 0
    previousClockTime = clockTime
    ctx.t = clockTime
    ctx.dt = 0
  }

  function setClockSpeed(speed: number): void {
    clockSpeed = Math.max(0, Math.min(8, speed))
  }

  function disposeSceneFeeds(): void {
    const disposed = new Set<VideoFeed>()
    for (const entity of scene.all) {
      const feed =
        entity instanceof SurveillancePanel ||
        entity instanceof CallWindow ||
        entity instanceof VideoEffectsStudio ||
        entity instanceof SilenceScene
          ? entity.feed
          : null
      if (feed instanceof VideoFeed && !disposed.has(feed)) {
        disposed.add(feed)
        feed.dispose()
      }
    }
  }

  function setMovieTitle(title: string): void {
    ctx.config.movieTitle = title.trim() || CONFIG.movieTitle
    const cinematic = scene.get('hypervigilance')
    if (cinematic instanceof HypervigilanceScene) {
      cinematic.setTitle(ctx.config.movieTitle)
    }
  }

  /** Shared top strip + the content area below it. */
  function addStatusBar(): { top: number; M: number } {
    const bar = new StatusBar()
    bar.id = 'status'
    scene.add(bar, ctx)
    return { top: 34 + 16, M: 16 }
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
    }, { autoType: true })
    login.onComplete = () => setPhase('hypervigilance')
    scene.add(login, ctx)
    scene.setFocus(login)
  }

  function buildHypervigilance(): void {
    const { top, M } = addStatusBar()
    const count = Math.max(
      1,
      Math.min(9, ctx.config.scenes.hypervigilance.activeScreens),
    )
    const columns = Math.ceil(Math.sqrt(count))
    const rows = Math.ceil(count / columns)
    const wallW = ctx.width - M * 2
    const wallH = ctx.height - top - M
    const gap = M / 2
    const tileW = (wallW - gap * (columns - 1)) / columns
    const tileH = (wallH - gap * (rows - 1)) / rows

    for (let i = 0; i < count; i++) {
      const col = i % columns
      const row = Math.floor(i / columns)
      const panel = new SurveillancePanel({
        x: M + col * (tileW + gap),
        y: top + row * (tileH + gap),
        w: tileW,
        h: tileH,
        title: `VIGILANCIA // NODO-${String(i + 1).padStart(2, '0')}`,
        tag: `CAM-${String(i + 1).padStart(2, '0')}`,
        camLabel: `HYPERVIGILANCE / ${String(i + 1).padStart(2, '0')}`,
        targetCount: i % 3,
        revealTime: 0.15 + i * 0.04,
      })
      panel.id = `hv-screen-${i + 1}`
      scene.add(panel, ctx)
    }

    const cinematic = new HypervigilanceScene({
      title: ctx.config.movieTitle,
      montageSeconds: ctx.config.scenes.hypervigilance.montageSeconds,
      flareSeconds: ctx.config.scenes.hypervigilance.flareSeconds,
      titleSeconds: ctx.config.scenes.hypervigilance.titleSeconds,
      onComplete: () => setPhase('desktop'),
    })
    cinematic.id = 'hypervigilance'
    cinematic.z = 100
    scene.add(cinematic, ctx)
  }

  function buildDesktop(): void {
    const W = ctx.width
    const H = ctx.height
    const { top, M } = addStatusBar()

    // Column widths: log | 2× surveillance | telemetry+radar.
    const logW = Math.max(300, W * 0.24)
    const rightW = Math.max(300, W * 0.26)
    const midW = W - logW - rightW - M * 4
    const colH = H - top - M

    // Left: activity log.
    const vigCfg = ctx.config.scenes.vigilancia
    const log = new ConsoleWindow(
      {
        x: M,
        y: top,
        w: logW,
        h: colH,
        title: `${CONFIG.agencyCode} // REGISTRO`,
        tag: 'LIVE',
        revealTime: 0.6,
      },
      { autoFeedEvery: vigCfg.logEvery },
    )
    log.id = 'log'
    scene.add(log, ctx)

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
      targetCount: vigCfg.targetsCamA,
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
      targetCount: vigCfg.targetsCamB,
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

  function buildMap(): void {
    const W = ctx.width
    const H = ctx.height
    const { top, M } = addStatusBar()
    const rightW = Math.max(280, W * 0.24)
    const colH = H - top - M

    const map = new MapWindow({
      x: M,
      y: top,
      w: W - rightW - M * 3,
      h: colH,
      title: `${CONFIG.agencyCode} // MAPA TÁCTICO — DISTRITO CENTRO`,
      tag: 'S-7/S-11',
      revealTime: 0.6,
    })
    map.id = 'map'
    scene.add(map, ctx)

    const rx = W - rightW - M
    const logH = colH * 0.55
    const log = new ConsoleWindow(
      {
        x: rx,
        y: top,
        w: rightW,
        h: logH,
        title: 'MOVIMIENTOS',
        tag: 'LIVE',
        revealTime: 0.8,
      },
      { autoFeedEvery: ctx.config.scenes.map.logEvery },
    )
    log.id = 'log'
    scene.add(log, ctx)
    scene.add(
      new RadarWindow({
        x: rx,
        y: top + logH + M,
        w: rightW,
        h: colH - logH - M,
        title: 'RASTREO AÉREO',
        tag: 'DRON-3',
        revealTime: 1.0,
      }),
      ctx,
    )
  }

  function buildGeo(): void {
    const W = ctx.width
    const H = ctx.height
    const { top, M } = addStatusBar()
    const rightW = Math.max(280, W * 0.24)
    const colH = H - top - M

    const geo = new GeoMapWindow({
      x: M,
      y: top,
      w: W - rightW - M * 3,
      h: colH,
      title: `${CONFIG.agencyCode} // RASTREO GEOESPACIAL — GPS EN VIVO`,
      tag: 'SAT',
      revealTime: 0.6,
    })
    geo.id = 'geo'
    scene.add(geo, ctx)

    const rx = W - rightW - M
    const logH = colH * 0.55
    const log = new ConsoleWindow(
      {
        x: rx,
        y: top,
        w: rightW,
        h: logH,
        title: 'ENLACE SATELITAL',
        tag: 'LIVE',
        revealTime: 0.8,
      },
      { autoFeedEvery: ctx.config.scenes.geo.logEvery },
    )
    log.id = 'log'
    scene.add(log, ctx)
    scene.add(
      new RadarWindow({
        x: rx,
        y: top + logH + M,
        w: rightW,
        h: colH - logH - M,
        title: 'RASTREO AÉREO',
        tag: 'DRON-3',
        revealTime: 1.0,
      }),
      ctx,
    )
  }

  function buildSensors(): void {
    const W = ctx.width
    const H = ctx.height
    const { top, M } = addStatusBar()
    const colH = H - top - M
    const leftW = Math.max(320, W * 0.3)
    const rightW = Math.max(280, W * 0.24)
    const midW = W - leftW - rightW - M * 4

    // Left: three stacked scopes.
    const scopeH = (colH - M * 2) / 3
    const kinds = [
      ['seismic', 'RED SÍSMICA'],
      ['acoustic', 'MICRÓFONOS URBANOS'],
      ['rf', 'INTERCEPCIÓN RF'],
    ] as const
    kinds.forEach(([kind, title], i) => {
      const scope = new ScopeWindow(
        {
          x: M,
          y: top + i * (scopeH + M),
          w: leftW,
          h: scopeH,
          title,
          tag: `CH-${i * 2 + 1}/${i * 2 + 2}`,
          revealTime: 0.5 + i * 0.15,
        },
        kind,
      )
      scope.id = `scope-${kind}`
      scene.add(scope, ctx)
    })

    // Middle: spectrogram over gauge array.
    const specH = colH * 0.55
    const spec = new SpectrogramWindow({
      x: M * 2 + leftW,
      y: top,
      w: midW,
      h: specH,
      title: 'ESPECTRO — BARRIDO SIGINT',
      tag: '0–500MHZ',
      accentKey: 'accent',
      revealTime: 0.7,
    })
    spec.id = 'spectrogram'
    scene.add(spec, ctx)
    const gauges = new GaugeArrayWindow({
      x: M * 2 + leftW,
      y: top + specH + M,
      w: midW,
      h: colH - specH - M,
      title: 'AMBIENTE URBANO',
      tag: 'NODO-4471',
      revealTime: 0.9,
    })
    gauges.id = 'gauges'
    scene.add(gauges, ctx)

    // Right: sensor event log.
    const rx = W - rightW - M
    const log = new ConsoleWindow(
      {
        x: rx,
        y: top,
        w: rightW,
        h: colH,
        title: 'EVENTOS DE SENSOR',
        tag: 'LIVE',
        revealTime: 1.0,
      },
      { autoFeedEvery: ctx.config.scenes.sensors.logEvery },
    )
    log.id = 'log'
    scene.add(log, ctx)
  }

  function buildCall(): void {
    const W = ctx.width
    const H = ctx.height
    const { top, M } = addStatusBar()
    const colH = H - top - M
    const sideW = Math.max(260, W * 0.2)

    const call = new CallWindow({
      x: M,
      y: top,
      w: W - sideW - M * 3,
      h: colH,
      title: `${CONFIG.agencyCode} // CONFERENCIA SEGURA — NIVEL OMEGA`,
      tag: 'CIFRADO',
      revealTime: 0.5,
    })
    call.id = 'call'
    scene.add(call, ctx)

    const rx = W - sideW - M
    const log = new ConsoleWindow(
      {
        x: rx,
        y: top,
        w: sideW,
        h: colH,
        title: 'ACTA DE SESIÓN',
        tag: 'REC',
        revealTime: 0.8,
      },
      { autoFeedEvery: ctx.config.scenes.call.logEvery },
    )
    log.id = 'log'
    scene.add(log, ctx)
  }

  function buildChip(): void {
    const W = ctx.width
    const H = ctx.height
    const { top, M } = addStatusBar()
    const colH = H - top - M
    const leftW = Math.max(430, W * 0.4)
    const rightW = Math.max(280, W * 0.22)
    const midW = W - leftW - rightW - M * 4

    // Left: the die floorplan, full height.
    const die = new DieMapWindow({
      x: M,
      y: top,
      w: leftW,
      h: colH,
      title: `${CONFIG.agencyCode} // ORÁCULO-1 — PLANO DE SILICIO`,
      tag: '3NM',
      revealTime: 0.6,
    })
    die.id = 'die'
    scene.add(die, ctx)

    // Middle: logic analyzer over timing/wafer stats.
    const wavesH = colH * 0.52
    const waves = new LogicAnalyzerWindow({
      x: M * 2 + leftW,
      y: top,
      w: midW,
      h: wavesH,
      title: 'ANALIZADOR LÓGICO — BUS DE DEPURACIÓN',
      tag: '2.0GS/S',
      accentKey: 'accent',
      revealTime: 0.75,
    })
    waves.id = 'waves'
    scene.add(waves, ctx)

    const fab = new FabStatsWindow({
      x: M * 2 + leftW,
      y: top + wavesH + M,
      w: midW,
      h: colH - wavesH - M,
      title: 'CIERRE DE TIEMPOS Y OBLEA',
      tag: 'STA',
      revealTime: 0.9,
    })
    fab.id = 'fab'
    scene.add(fab, ctx)

    // Right: EDA/foundry log.
    const log = new ConsoleWindow(
      {
        x: W - rightW - M,
        y: top,
        w: rightW,
        h: colH,
        title: `${CONFIG.agencyCode} // REGISTRO EDA`,
        tag: 'REC',
        revealTime: 0.8,
      },
      { feed: CHIP_FEED, autoFeedEvery: ctx.config.scenes.chip.logEvery },
    )
    log.id = 'log'
    scene.add(log, ctx)
  }

  function buildBoard(): void {
    const W = ctx.width
    const H = ctx.height
    const { top, M } = addStatusBar()
    const colH = H - top - M
    const rightW = Math.max(300, W * 0.24)
    const boardW = W - rightW - M * 3

    // Left: the assembly line, full height.
    const board = new MotherboardWindow({
      x: M,
      y: top,
      w: boardW,
      h: colH,
      title: `${CONFIG.agencyCode} // PLACA BASE 0447 — LÍNEA DE ENSAMBLAJE`,
      tag: 'ATX',
      revealTime: 0.6,
    })
    board.id = 'board'
    scene.add(board, ctx)

    // Right: manifest checklist over the assembly log.
    const rx = W - rightW - M
    const manifestH = Math.min(330, colH * 0.48)
    const manifest = new BoardManifestWindow(
      {
        x: rx,
        y: top,
        w: rightW,
        h: manifestH,
        title: 'MANIFIESTO DE ENSAMBLAJE',
        tag: 'QA',
        accentKey: 'accent',
        revealTime: 0.75,
      },
      board,
    )
    manifest.id = 'manifest'
    scene.add(manifest, ctx)

    const log = new ConsoleWindow(
      {
        x: rx,
        y: top + manifestH + M,
        w: rightW,
        h: colH - manifestH - M,
        title: `${CONFIG.agencyCode} // REGISTRO DE LÍNEA`,
        tag: 'REC',
        revealTime: 0.9,
      },
      { feed: BOARD_FEED, autoFeedEvery: ctx.config.scenes.board.logEvery },
    )
    log.id = 'log'
    scene.add(log, ctx)
  }

  function buildImplant(): void {
    const W = ctx.width
    const H = ctx.height
    const { top, M } = addStatusBar()
    const colH = H - top - M
    const bodyW = Math.max(280, W * 0.2)
    const behW = Math.max(280, W * 0.22)
    const logW = Math.max(280, W * 0.19)
    const midW = W - bodyW - behW - logW - M * 5

    // Shared subject simulation (invisible entity all windows read).
    const bio = new BioStateEntity()
    bio.id = 'bio'
    scene.add(bio, ctx)

    const body = new BodyMapWindow(
      {
        x: M,
        y: top,
        w: bodyW,
        h: colH,
        title: 'SUJETO 4471 — MAPA CORPORAL',
        tag: 'IMPLANTE',
        revealTime: 0.6,
      },
      bio,
    )
    body.id = 'bodymap'
    scene.add(body, ctx)

    // Middle: vitals over neurochemistry.
    const vitH = colH * 0.52
    const vitals = new VitalsWindow(
      {
        x: M * 2 + bodyW,
        y: top,
        w: midW,
        h: vitH,
        title: 'CONSTANTES VITALES — TIEMPO REAL',
        tag: '512HZ',
        revealTime: 0.7,
      },
      bio,
    )
    vitals.id = 'vitals'
    scene.add(vitals, ctx)

    const neuro = new NeuroChemWindow(
      {
        x: M * 2 + bodyW,
        y: top + vitH + M,
        w: midW,
        h: colH - vitH - M,
        title: 'NEUROQUÍMICA — MICRODIÁLISIS',
        tag: 'CH-9',
        accentKey: 'accent',
        revealTime: 0.85,
      },
      bio,
    )
    neuro.id = 'neuro'
    scene.add(neuro, ctx)

    const behavior = new BehaviorWindow(
      {
        x: M * 3 + bodyW + midW,
        y: top,
        w: behW,
        h: colH,
        title: 'ANÁLISIS CONDUCTUAL',
        tag: 'OMEGA',
        revealTime: 0.95,
      },
      bio,
    )
    behavior.id = 'behavior'
    scene.add(behavior, ctx)

    const log = new ConsoleWindow(
      {
        x: W - logW - M,
        y: top,
        w: logW,
        h: colH,
        title: `${CONFIG.agencyCode} // BITÁCORA DEL IMPLANTE`,
        tag: 'REC',
        revealTime: 1.05,
      },
      { feed: IMPLANT_FEED, autoFeedEvery: ctx.config.scenes.implant.logEvery },
    )
    log.id = 'log'
    scene.add(log, ctx)
  }

  function buildLoyalty(): void {
    const W = ctx.width
    const H = ctx.height
    const { top, M } = addStatusBar()
    const colH = H - top - M
    const physW = Math.max(280, W * 0.22)
    const condW = Math.max(320, W * 0.26)
    const loyW = Math.max(320, W * 0.26)
    const rightW = W - physW - condW - loyW - M * 5

    // Same subject simulation as IMPLANTE + the regime's derived scores.
    const bio = new BioStateEntity()
    bio.id = 'bio'
    scene.add(bio, ctx)
    const loy = new LoyaltyStateEntity(bio)
    loy.id = 'loy'
    scene.add(loy, ctx)

    const physio = new PhysioWindow(
      {
        x: M,
        y: top,
        w: physW,
        h: colH,
        title: 'FISIOLOGÍA — SUJETO 4471',
        tag: 'MIEDO',
        revealTime: 0.6,
      },
      bio,
      loy,
    )
    physio.id = 'physio'
    scene.add(physio, ctx)

    const conduct = new ConductWindow(
      {
        x: M * 2 + physW,
        y: top,
        w: condW,
        h: colH,
        title: 'CONDUCTA Y PRODUCTIVIDAD',
        tag: 'CUOTA',
        accentKey: 'accent',
        revealTime: 0.75,
      },
      loy,
    )
    conduct.id = 'conduct'
    scene.add(conduct, ctx)

    const loyalty = new LoyaltyWindow(
      {
        x: M * 3 + physW + condW,
        y: top,
        w: loyW,
        h: colH,
        title: 'LEALTAD — CLASIFICADO OMEGA',
        tag: 'DPI',
        revealTime: 0.9,
      },
      loy,
    )
    loyalty.id = 'loyalty'
    scene.add(loyalty, ctx)

    const rx = W - rightW - M
    const stateH = Math.min(240, colH * 0.42)
    const state = new StateWindow(
      {
        x: rx,
        y: top,
        w: rightW,
        h: stateH,
        title: 'TABLERO NACIONAL',
        tag: 'LÍDER',
        accentKey: 'accent',
        revealTime: 1.0,
      },
      loy,
    )
    state.id = 'state'
    scene.add(state, ctx)

    const log = new ConsoleWindow(
      {
        x: rx,
        y: top + stateH + M,
        w: rightW,
        h: colH - stateH - M,
        title: `${CONFIG.agencyCode} // BITÁCORA DE LEALTAD`,
        tag: 'REC',
        revealTime: 1.1,
      },
      { feed: LOYALTY_FEED, autoFeedEvery: ctx.config.scenes.loyalty.logEvery },
    )
    log.id = 'log'
    scene.add(log, ctx)
  }

  function buildAnalysis(): void {
    const W = ctx.width
    const H = ctx.height
    const { top, M } = addStatusBar()
    const colH = H - top - M
    const camW = Math.max(420, W * 0.34)
    const anaW = Math.max(300, W * 0.24)
    const verW = Math.max(280, W * 0.22)
    const logW = W - camW - anaW - verW - M * 5

    // The evaluation camera sits in the 'cam-a' slot so the director's
    // ARCHIVO→A / WEBCAM→A buttons pipe video (and vision) straight in.
    const cam = new SurveillancePanel({
      x: M,
      y: top,
      w: camW,
      h: colH,
      title: 'EVALUACIÓN // SALA DE OBSERVACIÓN 1',
      tag: 'CAM-EVAL',
      camLabel: 'CAM-EVAL / SALA-1',
      targetCount: 2,
      revealTime: 0.6,
    })
    cam.id = 'cam-a'
    scene.add(cam, ctx)

    const live = new LiveMetricsEntity(cam)
    live.id = 'live'
    scene.add(live, ctx)

    const analysis = new LiveAnalysisWindow(
      {
        x: M * 2 + camW,
        y: top,
        w: anaW,
        h: colH,
        title: 'MÉTRICAS DE VISIÓN — TIEMPO REAL',
        tag: 'IA',
        accentKey: 'accent',
        revealTime: 0.75,
      },
      live,
    )
    analysis.id = 'analysis'
    scene.add(analysis, ctx)

    const verdict = new LiveVerdictWindow(
      {
        x: M * 3 + camW + anaW,
        y: top,
        w: verW,
        h: colH,
        title: 'VEREDICTO ALGORÍTMICO',
        tag: 'DPI',
        revealTime: 0.9,
      },
      live,
    )
    verdict.id = 'verdict'
    scene.add(verdict, ctx)

    const log = new ConsoleWindow(
      {
        x: W - logW - M,
        y: top,
        w: logW,
        h: colH,
        title: `${CONFIG.agencyCode} // CADENA DE CUSTODIA`,
        tag: 'REC',
        revealTime: 1.0,
      },
      { feed: ANALYSIS_FEED, autoFeedEvery: ctx.config.scenes.analysis.logEvery },
    )
    log.id = 'log'
    scene.add(log, ctx)
  }

  function buildVideoEffects(): void {
    const studio = new VideoEffectsStudio()
    studio.id = 'studio'
    scene.add(studio, ctx)
  }

  function buildSilence(): void {
    const silence = new SilenceScene(ctx.config.scenes.silence.resetSeconds)
    silence.id = 'silence'
    scene.add(silence, ctx)
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
  let glitchBurstUntil = 0
  let take = 0

  function panelFor(slot: CamSlot): SurveillancePanel | undefined {
    const e = scene.get(slot)
    return e instanceof SurveillancePanel ? e : undefined
  }

  function widgetById<T>(
    id: string,
    cls: abstract new (...args: never[]) => T,
  ): T | undefined {
    const e = scene.get(id)
    return e instanceof cls ? e : undefined
  }

  /**
   * Scene-cue dispatch. Every case resolves its widgets by id, so cues
   * fired in the wrong scene simply find nothing and no-op. Log lines
   * sell the event in the on-screen record.
   */
  function runAction(action: SceneAction): void {
    const log = (text: string, level: LogLevel = 'info') =>
      controller.logLine(text, level)
    const cfg = ctx.config.scenes
    switch (action) {
      // --- vigilancia --------------------------------------------------
      case 'cam-mark':
        widgetById('cam-a', SurveillancePanel)?.flashMark(cfg.vigilancia.markSeconds)
        log('COINCIDENCIA BIOMÉTRICA CONFIRMADA — EXPEDIENTE 4471', 'danger')
        break
      case 'targets-up':
      case 'targets-down': {
        const d = action === 'targets-up' ? 1 : -1
        for (const slot of ['cam-a', 'cam-b'] as const) {
          const panel = panelFor(slot)
          panel?.setTargetCount(panel.targetCount + d)
        }
        log(d > 0 ? 'NUEVO SUJETO EN CUADRO — RASTREANDO' : 'SUJETO FUERA DE CUADRO', d > 0 ? 'warn' : 'dim')
        break
      }
      // --- mapa --------------------------------------------------------
      case 'map-new-target':
        widgetById('map', MapWindow)?.newTarget()
        log('POSICIÓN DEL OBJETIVO RETRIANGULADA', 'warn')
        break
      case 'map-chase':
        widgetById('map', MapWindow)?.setMode('chase')
        log('ORDEN EMITIDA: CONVERGER SOBRE EL OBJETIVO', 'danger')
        break
      case 'map-patrol':
        widgetById('map', MapWindow)?.setMode('patrol')
        log('UNIDADES DE VUELTA A PATRULLA', 'ok')
        break
      case 'map-add-unit':
        widgetById('map', MapWindow)?.addUnit()
        log('UNIDAD ADICIONAL DESPLEGADA', 'info')
        break
      case 'map-remove-unit':
        widgetById('map', MapWindow)?.removeUnit()
        log('UNIDAD RETIRADA DEL SECTOR', 'dim')
        break
      // --- geo -----------------------------------------------------------
      case 'geo-new-target':
        widgetById('geo', GeoMapWindow)?.newTarget()
        log('SEÑAL GPS READQUIRIDA — OBJETIVO REUBICADO', 'warn')
        break
      case 'geo-chase':
        widgetById('geo', GeoMapWindow)?.setMode('chase')
        log('ORDEN EMITIDA: INTERCEPTAR AL OBJETIVO', 'danger')
        break
      case 'geo-patrol':
        widgetById('geo', GeoMapWindow)?.setMode('patrol')
        log('UNIDADES DE VUELTA A PATRULLA DE SECTOR', 'ok')
        break
      case 'geo-follow': {
        const on = widgetById('geo', GeoMapWindow)?.toggleFollow()
        if (on !== undefined) {
          log(on ? 'CÁMARA FIJADA AL OBJETIVO' : 'CÁMARA EN POSICIÓN FIJA', 'dim')
        }
        break
      }
      case 'geo-zoom-in':
        widgetById('geo', GeoMapWindow)?.zoomBy(1)
        break
      case 'geo-zoom-out':
        widgetById('geo', GeoMapWindow)?.zoomBy(-1)
        break
      case 'geo-city': {
        const label = widgetById('geo', GeoMapWindow)?.nextCity()
        if (label) log(`ENLACE REPOSICIONADO — OP. ${label}`, 'info')
        break
      }
      case 'geo-add-unit':
        widgetById('geo', GeoMapWindow)?.addUnit()
        log('UNIDAD ADICIONAL EN CAMPO', 'info')
        break
      case 'geo-remove-unit':
        widgetById('geo', GeoMapWindow)?.removeUnit()
        log('UNIDAD RETIRADA DEL OPERATIVO', 'dim')
        break
      // --- sensores ----------------------------------------------------
      case 'sensor-quake':
        widgetById('scope-seismic', ScopeWindow)?.excite(cfg.sensors.exciteSeconds)
        log('EVENTO SÍSMICO DETECTADO — MAGNITUD EN ANÁLISIS', 'danger')
        break
      case 'sensor-transmission':
        widgetById('scope-rf', ScopeWindow)?.excite(cfg.sensors.exciteSeconds)
        widgetById('spectrogram', SpectrogramWindow)?.burst(cfg.sensors.burstSeconds)
        log('TRANSMISIÓN NO REGISTRADA EN BANDA VIGILADA', 'warn')
        break
      case 'sensor-chem':
        widgetById('gauges', GaugeArrayWindow)?.alarm(cfg.sensors.alarmSeconds)
        log('UMBRAL QUÍMICO SUPERADO — NODO-4471', 'danger')
        break
      // --- llamada -----------------------------------------------------
      case 'call-next-speaker':
        widgetById('call', CallWindow)?.nextSpeaker()
        break
      case 'call-drop':
        widgetById('call', CallWindow)?.dropSignal(cfg.call.dropSeconds)
        log('ENLACE DEGRADADO — REINTENTANDO', 'warn')
        break
      case 'call-reconnect':
        widgetById('call', CallWindow)?.reconnect()
        log('RENEGOCIANDO SESIÓN CIFRADA', 'info')
        break
      // --- chip ----------------------------------------------------------
      case 'chip-drc':
        widgetById('die', DieMapWindow)?.drcStorm()
        widgetById('fab', FabStatsWindow)?.drcAlarm(cfg.chip.drcSeconds)
        log('VERIFICACIÓN FÍSICA: VIOLACIONES DRC — ESPACIADO M3', 'danger')
        break
      case 'chip-thermal':
        widgetById('die', DieMapWindow)?.thermalEvent()
        widgetById('fab', FabStatsWindow)?.heatUp(cfg.chip.thermalSeconds)
        log('PUNTO CALIENTE EN EL DADO — ACELERANDO DISIPACIÓN', 'danger')
        break
      case 'chip-layer': {
        const layer = widgetById('die', DieMapWindow)?.cycleLayer()
        if (layer) log(`CAPA DE RUTEO ACTIVA: ${layer}`, 'dim')
        break
      }
      case 'chip-reroute':
        widgetById('die', DieMapWindow)?.reroute()
        log('RUTEO GLOBAL REINICIADO — CONGESTIÓN 3.1%', 'warn')
        break
      case 'chip-test':
        widgetById('waves', LogicAnalyzerWindow)?.bist(cfg.chip.bistSeconds)
        log('PATRÓN BIST INYECTADO EN CADENA DE EXPLORACIÓN', 'info')
        break
      case 'chip-tapeout':
        widgetById('die', DieMapWindow)?.tapeout()
        widgetById('fab', FabStatsWindow)?.freeze()
        controller.announce('GDSII FIRMADO — ENVIADO A FUNDICIÓN NACIONAL')
        log('TAPEOUT: GDSII FIRMADO — LOTE 0447 A FUNDICIÓN', 'ok')
        break
      // --- placa -----------------------------------------------------------
      case 'board-restart':
        widgetById('board', MotherboardWindow)?.restart()
        log('LÍNEA REINICIADA — SUSTRATO EN BANCO', 'info')
        break
      case 'board-next':
        widgetById('board', MotherboardWindow)?.skip()
        log('ESTACIÓN LIBERADA — SIGUIENTE COMPONENTE', 'dim')
        break
      case 'board-power':
        widgetById('board', MotherboardWindow)?.powerOn()
        controller.announce('PLACA 0447 OPERATIVA — TENSIÓN NOMINAL')
        log('ENCENDIDO: POST 00 — TODAS LAS TENSIONES OK', 'ok')
        break
      case 'board-xray': {
        const on = widgetById('board', MotherboardWindow)?.toggleXray()
        if (on !== undefined) {
          log(on ? 'VISTA RAYOS-X — COBRE EXPUESTO' : 'VISTA NORMAL RESTAURADA', 'dim')
        }
        break
      }
      case 'board-fault':
        widgetById('board', MotherboardWindow)?.shortCircuit()
        log('CORTOCIRCUITO DETECTADO — AISLANDO RIEL', 'danger')
        break
      // --- implante --------------------------------------------------------
      case 'bio-panic':
        widgetById('bio', BioStateEntity)?.panic()
        log('CRISIS DE PÁNICO — CORTISOL FUERA DE RANGO', 'danger')
        break
      case 'bio-sedate':
        widgetById('bio', BioStateEntity)?.sedate()
        log('MICRODOSIS LIBERADA — SEDACIÓN REMOTA ACTIVA', 'warn')
        break
      case 'bio-reward':
        widgetById('bio', BioStateEntity)?.reward()
        log('ESTÍMULO DE RECOMPENSA — LEALTAD REFORZADA', 'ok')
        break
      case 'bio-lie':
        widgetById('bio', BioStateEntity)?.flagLie()
        log('PATRÓN DE ENGAÑO DETECTADO — EXPEDIENTE ACTUALIZADO', 'danger')
        break
      case 'bio-arrest':
        widgetById('bio', BioStateEntity)?.cardiacArrest()
        controller.announce('SUJETO 4471 EN ASISTOLIA — REANIMACIÓN REMOTA')
        log('ASISTOLIA — PROTOCOLO DE REANIMACIÓN REMOTA', 'danger')
        break
      // --- lealtad ---------------------------------------------------------
      case 'loy-portrait':
        widgetById('loy', LoyaltyStateEntity)?.showPortrait()
        log('RETRATO DEL LÍDER EN PANTALLA — MIDIENDO RESPUESTA', 'warn')
        break
      case 'loy-dissent':
        widgetById('loy', LoyaltyStateEntity)?.dissent()
        controller.announce('EVALUACIÓN DE DISIDENCIA EN CURSO — SUJETO 4471')
        log('ALGORITMO DE DISIDENCIA: EVALUACIÓN PRIORITARIA', 'danger')
        break
      case 'loy-pardon':
        widgetById('loy', LoyaltyStateEntity)?.pardon()
        log('ORDEN RESCINDIDA — "EL DATO ERA ERRÓNEO"', 'ok')
        break
      case 'loy-curate':
        widgetById('loy', LoyaltyStateEntity)?.curate()
        log('FELICIDAD NACIONAL CURADA PARA EL BOLETÍN', 'dim')
        break
      // --- análisis ----------------------------------------------------------
      case 'ana-dissent':
        widgetById('live', LiveMetricsEntity)?.dissent()
        controller.announce('EVALUACIÓN DE DISIDENCIA SOBRE EVIDENCIA VISUAL')
        log('ALGORITMO DE DISIDENCIA: PONDERANDO CONDUCTA EN CÁMARA', 'danger')
        break
      case 'ana-pardon':
        widgetById('live', LiveMetricsEntity)?.pardon()
        log('ORDEN RESCINDIDA — EVIDENCIA VISUAL INSUFICIENTE', 'ok')
        break
      case 'ana-reset':
        widgetById('live', LiveMetricsEntity)?.reset()
        log('CALIBRACIÓN REINICIADA — NUEVA LÍNEA BASE', 'info')
        break
    }
  }

  /** Anything that can display a feed: surveillance panels + call tile. */
  function holderFor(
    slot: CamSlot,
  ): SurveillancePanel | CallWindow | VideoEffectsStudio | SilenceScene | undefined {
    if (slot === 'studio') {
      const e = scene.get('studio')
      return e instanceof VideoEffectsStudio ? e : undefined
    }
    if (slot === 'silence') {
      const e = scene.get('silence')
      return e instanceof SilenceScene ? e : undefined
    }
    if (slot === 'call-self') {
      const e = scene.get('call')
      return e instanceof CallWindow ? e : undefined
    }
    return panelFor(slot)
  }

  function swapFeed(slot: CamSlot, feed: VideoFeed | StaticFeed): void {
    // Scene-aware fallback: if the requested slot doesn't exist in the
    // current scene, land the footage on whatever can show it instead
    // of silently disposing it (LLAMADA only has the call's self tile).
    const holder =
      holderFor(slot) ??
      holderFor('cam-a') ??
      holderFor('cam-b') ??
      holderFor('call-self') ??
      holderFor('studio')
    if (!holder) {
      if (feed instanceof VideoFeed) feed.dispose()
      return
    }
    if (holder.feed instanceof VideoFeed) holder.feed.dispose()
    // Vision only runs on surveillance panels — the call tile is a mirror.
    if (
      feed instanceof VideoFeed &&
      visionOn &&
      (holder instanceof SurveillancePanel || holder instanceof VideoEffectsStudio)
    ) {
      feed.vision = new VisionEngine()
    }
    holder.setFeed(feed)
  }

  function setVision(on: boolean): void {
    visionOn = on
    for (const slot of ['cam-a', 'cam-b'] as const) {
      const feed = panelFor(slot)?.feed
      if (feed instanceof VideoFeed) {
        feed.vision = on ? (feed.vision ?? new VisionEngine()) : null
      }
    }
    const studioFeed = holderFor('studio')?.feed
    if (studioFeed instanceof VideoFeed) {
      studioFeed.vision = on ? (studioFeed.vision ?? new VisionEngine()) : null
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
    reloadScene: () => setPhase(scene.phase),
    reloadMedia: () => {
      disposeSceneFeeds()
      setPhase(scene.phase)
    },
    resetTake: () => {
      // Back to a clean slate: take numbering restarts at TOMA 01.
      take = 0
      setPhase(scene.phase)
    },
    play: () => playClock(),
    pause: () => pauseClock(),
    step: (seconds) => stepClock(seconds),
    seek: (seconds) => seekClock(seconds),
    setSpeed: (speed) => setClockSpeed(speed),
    getClock: () => ({
      mode: clockMode,
      time: clockTime,
      frame: clockFrame,
      speed: clockSpeed,
    }),
    setMovieTitle: (title) => setMovieTitle(title),
    getMovieTitle: () => {
      const cinematic = scene.get('hypervigilance')
      return cinematic instanceof HypervigilanceScene
        ? cinematic.movieTitle
        : ctx.config.movieTitle
    },
    loadVideoFile: (file, slot = 'cam-a') =>
      swapFeed(slot, VideoFeed.fromFile(file)),
    useWebcam: async (slot = 'cam-a') =>
      swapFeed(slot, await VideoFeed.fromWebcam()),
    clearFeed: (slot = 'cam-a') => swapFeed(slot, new StaticFeed()),
    setStudioEffects: (patch) => {
      widgetById('studio', VideoEffectsStudio)?.patchEffects(patch)
    },
    getStudioEffects: () => ({
      ...(widgetById('studio', VideoEffectsStudio)?.effects ?? DEFAULT_STUDIO_EFFECTS),
    }),
    applyStudioPreset: (preset) => {
      const studio = widgetById('studio', VideoEffectsStudio)
      if (studio) studio.effects = { ...STUDIO_PRESETS[preset] }
    },
    getStudioMediaState: () => {
      const feed = widgetById('studio', VideoEffectsStudio)?.feed
      return feed instanceof VideoFeed
        ? {
            ready: feed.ready,
            label: feed.label,
            currentTime: feed.currentTime,
            duration: feed.duration,
            paused: feed.paused,
          }
        : { ready: false, label: 'NO SIGNAL', currentTime: 0, duration: 0, paused: true }
    },
    setVision: (on) => setVision(on),
    isVisionOn: () => visionOn,
    setCrt: (patch) => {
      Object.assign(ctx.config.crt, patch)
    },
    getCrt: () => ({ ...ctx.config.crt }),
    glitchBurst: (seconds = 0.7) => {
      glitchBurstUntil = ctx.t + seconds
    },
    logLine: (text, level = 'info') => {
      const e = scene.get('log')
      if (e instanceof ConsoleWindow) {
        e.stream.log(ctx, text.toUpperCase(), level)
      }
    },
    announce: (text, seconds = 8) => {
      const e = scene.get('status')
      if (e instanceof StatusBar) e.announce(text, seconds)
    },
    trigger: (action) => runAction(action),
    screenshot: () => {
      canvasEl?.toBlob((blob) => {
        if (!blob) return
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `os-foto-${timestampSlug()}.png`
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      }, 'image/png')
    },
    startRecording: () => {
      if (!canvasEl || recorder.recording) return
      take++
      scene.add(new Slate(take), ctx)
      recorder.start(canvasEl, 60, `os-toma-${String(take).padStart(2, '0')}`)
    },
    stopRecording: () => recorder.stop(),
    isRecording: () => recorder.recording,
    getTake: () => take,
    destroy: () => {
      destroyed = true
      sizeObserver.disconnect()
      disposeSceneFeeds()
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
      windows: () =>
        scene.all
          .filter((e): e is OSWindow => e instanceof OSWindow)
          .map((w) => ({
            title: w.title,
            x: Math.round(w.x),
            y: Math.round(w.y),
            z: w.z,
            focused: w.focused,
          })),
          clock: () => controller.getClock(),
          phase: () => controller.getPhase(),
    }
  }

  return controller
}
