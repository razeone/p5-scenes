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
import {
  PHASE_LABELS,
  SceneManager,
  slugify,
  type OSPhase,
} from './core/SceneManager'
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
  GalleryWindow,
  buildDossier,
  type GalleryTarget,
} from './widgets/GalleryWindow'
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
import { VideoWall, type WallState } from './media/VideoWall'
import {
  CanvasRecorder,
  canRecord,
  timestampSlug,
  type TakeContainer,
  type TakeInfo,
} from './media/Recorder'
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
import {
  DEFAULT_VR_VISION_SETTINGS,
  VrVisionScene,
  type VrFrameStyle,
  type VrMessageTone,
  type VrVisionMessage,
  type VrVisionSettings,
} from './widgets/VrVisionScene'
import type { LogLevel } from './widgets/TextStream'

/** Slots the director can pipe video into (panels + the call's self tile). */
export type CamSlot =
  | 'cam-a'
  | 'cam-b'
  | 'call-self'
  | 'studio'
  | 'vr-vision'
  | 'silence'
export type StudioPreset = keyof typeof STUDIO_PRESETS

export interface StudioMediaState {
  ready: boolean
  label: string
  currentTime: number
  duration: number
  paused: boolean
}

export interface VrVisionState {
  settings: VrVisionSettings
  queue: VrVisionMessage[]
  history: VrVisionMessage[]
  active: VrVisionMessage | null
}

const VR_STORE_KEY = 'panopticon.vr-vision.v1'
const VR_HISTORY_LIMIT = 50

function loadVrVisionState(): VrVisionState {
  const fallback: VrVisionState = {
    settings: { ...DEFAULT_VR_VISION_SETTINGS },
    queue: [],
    history: [],
    active: null,
  }
  try {
    const raw = localStorage.getItem(VR_STORE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<VrVisionState>
    const settings = parsed.settings
    const frameStyle = settings?.frameStyle
    return {
      settings: {
        frameStyle:
          frameStyle && ['optical', 'mechanical', 'photographic', 'clinical'].includes(frameStyle)
            ? frameStyle
            : fallback.settings.frameStyle,
        showObjects: settings?.showObjects !== false,
        showFaces: settings?.showFaces !== false,
        showTelemetry: settings?.showTelemetry !== false,
      },
      queue: Array.isArray(parsed.queue) ? parsed.queue.slice(0, VR_HISTORY_LIMIT) : [],
      history: Array.isArray(parsed.history)
        ? parsed.history.slice(0, VR_HISTORY_LIMIT)
        : [],
      active: null,
    }
  } catch {
    return fallback
  }
}

function saveVrVisionState(state: VrVisionState): void {
  try {
    localStorage.setItem(
      VR_STORE_KEY,
      JSON.stringify({
        settings: state.settings,
        queue: state.queue.slice(0, VR_HISTORY_LIMIT),
        history: state.history.slice(0, VR_HISTORY_LIMIT),
      }),
    )
  } catch {
    // Storage can be unavailable in private mode; runtime state still works.
  }
}

/** A finished take with its slate number, for the session take list. */
export type SavedTake = TakeInfo & {
  take: number
  /** Scene the take was shot in, for the bin label. */
  scene: string
  /** Circled = a keeper. The panel sets this; NG takes get discarded. */
  kept?: boolean
}

/**
 * Fixed capture formats. 'window' keeps the legacy behaviour (canvas
 * follows the container, so takes vary with window size); the rest pin
 * the canvas to a broadcast resolution and letterbox it on screen, so
 * every take of a shoot cuts together at the same size.
 */
export type CaptureFormat =
  | 'window'
  | '1080p'
  | '1440p'
  | '4k'
  | '1080p-vertical'

export const CAPTURE_FORMATS: Record<
  CaptureFormat,
  { label: string; w: number; h: number }
> = {
  window: { label: 'VENTANA', w: 0, h: 0 },
  '1080p': { label: '1080P', w: 1920, h: 1080 },
  '1440p': { label: '1440P', w: 2560, h: 1440 },
  '4k': { label: '4K', w: 3840, h: 2160 },
  '1080p-vertical': { label: '9:16', w: 1080, h: 1920 },
}

/** What the panel needs to describe the capture chain in one glance. */
export interface CaptureState {
  format: CaptureFormat
  /** Actual canvas backing-store size = what MediaRecorder encodes. */
  width: number
  height: number
  container: TakeContainer
  /** Container that will really be used (browser support may differ). */
  effectiveContainer: TakeContainer | null
  audio: boolean
  autoDownload: boolean
}

/** Live per-slot media state, so the panel can show what's loaded where. */
export interface SlotState {
  slot: CamSlot
  kind: 'none' | 'file' | 'webcam'
  label: string
}

/**
 * Snapshot of the current scene's toggle/mode state so cue buttons can
 * render as active instead of looking like fire-and-forget one-shots.
 * Keys are scene-specific (mode, follow, city, xray, layer…).
 */
export type SceneState = Record<string, string | number | boolean>

/** Draw-loop liveness, for the frozen-canvas watchdog. */
export interface HealthState {
  frame: number
  mode: DirectorClockState['mode']
  /** Frames drawn since boot, independent of the director clock. */
  drawn: number
}

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
  // gallery (galería de expedientes)
  | 'gallery-reroll'
  | 'gallery-silence-all'
  | 'gallery-capture-all'
  | 'gallery-advance'
  | 'gallery-next-page'
  | 'gallery-prev-page'
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
  // hipervigilancia (muro de video)
  | 'hv-cut'
  | 'hv-next'
  | 'hv-prev'
  | 'hv-auto'
  | 'hv-shuffle'
  | 'hv-mark'
  | 'hv-hold'
  | 'hv-title'
  | 'hv-restart'
  // vr-vision
  | 'vr-cycle-frame'
  | 'vr-send-next'
  | 'vr-dismiss-message'

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
  /** Re-run the scene's window layout, keeping loaded footage in place. */
  relayout(): void
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
  /** What footage is loaded in each slot of the current scene. */
  getSlots(): SlotState[]
  /**
   * Which camera slot sits under a viewport point (for drag-and-drop).
   * Returns null when the point is over no feed-capable window.
   */
  slotAtPoint(clientX: number, clientY: number): CamSlot | null
  /** Load image files (folder or set) into the dossier gallery scene. */
  loadGalleryImages(files: File[]): void
  /** Patch or reset the full-screen studio's effect pipeline. */
  setStudioEffects(patch: Partial<StudioEffects>): void
  getStudioEffects(): StudioEffects
  applyStudioPreset(preset: StudioPreset): void
  getStudioMediaState(): StudioMediaState
  /** Switch the immersive VR headset frame without rebuilding its feed. */
  setVrFrameStyle(style: VrFrameStyle): void
  getVrFrameStyle(): VrFrameStyle
  setVrVisionSettings(patch: Partial<VrVisionSettings>): void
  getVrVisionState(): VrVisionState
  queueVrMessage(text: string, tone?: VrMessageTone, duration?: number): void
  sendVrMessage(id?: string): void
  dismissVrMessage(): void
  removeVrMessage(id: string): void
  replayVrMessage(id: string): void
  clearVrHistory(): void
  /**
   * Load a folder (or a hand-picked set) of clips into the HIPERVIGILANCIA
   * video wall. Non-video files are ignored; the wall jumps on screen if
   * the shoot is somewhere else.
   */
  loadWallVideos(files: File[]): void
  /** Empty the wall's bin and drop every screen back to static. */
  clearWallVideos(): void
  /** What the wall is playing, for the panel readout. */
  getWallState(): WallState
  /** Seconds a screen holds a clip, and the cut offset between screens. */
  setWallPace(patch: { holdSeconds?: number; stagger?: number }): void
  /** Re-tile the wall (1..9 screens) without restarting the take. */
  setWallScreens(screens: number): void
  /** Toggle real object detection/tracking on the video feeds. */
  setVision(on: boolean): void
  isVisionOn(): boolean
  /** Live CRT ambience: scanlines, glow, vignette, flicker, glitch. */
  setCrt(patch: Partial<OSConfig['crt']>): void
  getCrt(): OSConfig['crt']
  /** Restore the shipped CRT look (undo for slider experiments). */
  resetCrt(): OSConfig['crt']
  /** Momentary heavy glitch/tear burst (scene transitions, hits). */
  glitchBurst(seconds?: number): void
  /** Push a line into the activity log (desktop phase). */
  logLine(text: string, level?: LogLevel): void
  /** Blinking directive in the status bar for a few seconds. */
  announce(text: string, seconds?: number): void
  /** Fire a scene-specific direction cue (see SceneAction). */
  trigger(action: SceneAction): void
  /** Active modes/toggles of the current scene, for cue button states. */
  getSceneState(): SceneState
  /** Point the GEO operation at real coordinates. */
  setGeoLocation(lat: number, lon: number, label?: string): void
  /** Download a PNG still of the canvas. */
  screenshot(): void
  /** Capture chain: fixed resolution, container, scratch audio. */
  setCaptureFormat(format: CaptureFormat): void
  setCaptureContainer(container: TakeContainer): void
  setAudioCapture(on: boolean): Promise<void>
  setAutoDownload(on: boolean): void
  getCaptureState(): CaptureState
  /** Start capturing the canvas to a take file. */
  startRecording(): void
  /** Cut: finalize the take (kept in the session list for review). */
  stopRecording(): void
  isRecording(): boolean
  /** Draw-loop liveness for the frozen-canvas watchdog. */
  getHealth(): HealthState
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
  // Loaded dossier images persist across scene rebuilds so switching
  // themes / phases and returning keeps the board intact.
  let galleryTargets: GalleryTarget[] = []
  // The HIPERVIGILANCIA clip bin. Like the gallery, it outlives scene
  // rebuilds so re-tiling the wall or hopping phases never means
  // re-picking the folder.
  const wall = new VideoWall()
  wall.holdSeconds = CONFIG.scenes.hypervigilance.holdSeconds
  wall.stagger = CONFIG.scenes.hypervigilance.stagger
  wall.auto = CONFIG.scenes.hypervigilance.autoAdvance
  // Frames actually drawn — the watchdog compares this over wall time to
  // catch a p5 draw exception, which freezes the canvas silently.
  let framesDrawn = 0
  const vrVisionState = loadVrVisionState()
  let vrMessageStartedAt = 0

  // --- Capture chain ------------------------------------------------
  // A fixed format pins the canvas to a broadcast resolution so every
  // take of a shoot matches; 'window' keeps the legacy container-sized
  // behaviour. Scene name goes into the filename and the slate.
  let captureFormat: CaptureFormat = '1080p'
  let captureContainer: TakeContainer = 'mp4'
  let autoDownload = false
  let micStream: MediaStream | null = null

  const recorder = new CanvasRecorder()
  recorder.onStateChange = (rec) => hooks.onRecordingChange?.(rec)
  recorder.onTakeSaved = (info) =>
    hooks.onTakeSaved?.({ ...info, take, scene: PHASE_LABELS[scene.phase] })

  const sketch = (p: p5) => {
    ctx.p = p

    p.setup = () => {
      if (destroyed) {
        p.remove()
        return
      }
      // Re-measure: the constructor may have run before first layout.
      const size = targetSize()
      ctx.width = size.w
      ctx.height = size.h
      const c = p.createCanvas(ctx.width, ctx.height)
      c.parent(container)
      canvasEl = c.elt as HTMLCanvasElement
      // 1 device pixel per sketch pixel: the capture resolution must be
      // exactly what the director picked, not multiplied by DPR.
      p.pixelDensity(1)
      p.frameRate(60)
      p.textFont('Courier New')
      applyLetterbox()
      lastMs = p.millis()
      ready = true
      setPhase(pendingPhase ?? 'boot')
    }

    p.draw = () => {
      framesDrawn++
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

      // Footage obeys the director's transport everywhere, not just in
      // the FX studio: PAUSA freezes the video too, VEL scrubs it.
      syncFeedsToClock()
      // The montage wall cuts on the same clock as everything else.
      tickWall()
      updateVrMessage()

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
      // Clicking a dossier card body (not the title bar) cycles its state.
      if (
        hit instanceof GalleryWindow &&
        !hit.titleBarContains(p.mouseX, p.mouseY)
      ) {
        const t = hit.clickBody(ctx, p.mouseX, p.mouseY)
        if (t) controller.logLine(`${t.name}: ${t.caseId} → ESTADO ACTUALIZADO`, 'info')
      }
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

  /** Canvas size for the active format ('window' = follow the container). */
  function targetSize(): { w: number; h: number } {
    const fmt = CAPTURE_FORMATS[captureFormat]
    if (fmt.w > 0) return { w: fmt.w, h: fmt.h }
    return {
      w: container.clientWidth || ctx.width || 1280,
      h: container.clientHeight || ctx.height || 720,
    }
  }

  /**
   * Fixed formats letterbox: the canvas keeps its capture resolution and
   * CSS scales it to fit. The `fixed` class is what switches App.css from
   * stretch-to-fill to contain-and-center.
   */
  function applyLetterbox(): void {
    container.classList.toggle('fixed', CAPTURE_FORMATS[captureFormat].w > 0)
  }

  /**
   * Adopt the target size. The container can change without a window
   * resize (late stylesheet, layout shift), and phase layouts are computed
   * from ctx dims — so on a genuine change, rebuild the current phase or
   * windows keep stale geometry (a collapsed container once gave the radar
   * a negative radius and froze the draw loop).
   *
   * While rolling, a resize is never allowed to rebuild the scene: that
   * would wipe window positions, feeds and scene state mid-take. Fixed
   * formats are immune anyway — only the letterbox scale changes.
   */
  function syncSize(): void {
    if (!ready) return
    const { w, h } = targetSize()
    if (w < 2 || h < 2) return // mid-layout collapse; ignore
    if (w === ctx.width && h === ctx.height) return
    if (recorder.recording) return // protect the take
    ctx.width = w
    ctx.height = h
    ctx.p.resizeCanvas(w, h)
    if (scene.phase === 'video-effects' || scene.phase === 'silence') return
    rebuildPhase()
  }

  const sizeObserver = new ResizeObserver(() => syncSize())
  sizeObserver.observe(container)

  /** Switch capture resolution: resize, re-letterbox, re-lay out. */
  function setCaptureFormat(format: CaptureFormat): void {
    if (format === captureFormat) return
    captureFormat = format
    applyLetterbox()
    if (!ready) return
    const { w, h } = targetSize()
    ctx.width = w
    ctx.height = h
    ctx.p.resizeCanvas(w, h)
    rebuildPhase()
  }

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
      case 'gallery':
        buildGallery()
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
      case 'vr-vision':
        buildVrVision()
        break
      case 'silence':
        buildSilence()
        break
    }
    // Session media bin: footage the director already loaded comes back
    // automatically, so hopping scenes doesn't mean re-picking files.
    restoreSlots()
    hooks.onPhaseChange?.(phase)
  }

  /** Rebuild the current scene (layout/format change), keeping footage. */
  function rebuildPhase(): void {
    setPhase(scene.phase)
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

  /** Anything in the current scene that can display a feed. */
  type FeedHolder =
    | SurveillancePanel
    | CallWindow
    | VideoEffectsStudio
    | VrVisionScene
    | SilenceScene

  function isFeedHolder(e: unknown): e is FeedHolder {
    return (
      e instanceof SurveillancePanel ||
      e instanceof CallWindow ||
      e instanceof VideoEffectsStudio ||
      e instanceof VrVisionScene ||
      e instanceof SilenceScene
    )
  }

  /** Every distinct live VideoFeed in the scene (deduped: slots can share). */
  function sceneFeeds(): VideoFeed[] {
    const seen = new Set<VideoFeed>()
    for (const entity of scene.all) {
      if (!isFeedHolder(entity)) continue
      const feed = entity.feed
      if (feed instanceof VideoFeed) seen.add(feed)
    }
    return [...seen]
  }

  function disposeSceneFeeds(): void {
    for (const feed of sceneFeeds()) feed.dispose()
  }

  /**
   * Make every feed obey the director clock. Without this, PAUSA froze
   * the fiction while real footage kept playing underneath and VEL only
   * retimed the OS — the FX studio was the sole scene that matched.
   */
  function syncFeedsToClock(): void {
    const silence = widgetById('silence', SilenceScene)
    for (const feed of sceneFeeds()) {
      feed.setPlaybackRate(clockSpeed)
      const frozenBySilence = silence?.silenced && silence.feed === feed
      if (frozenBySilence) feed.pause()
      else if (clockMode === 'realtime' && clockSpeed > 0) feed.play()
      else feed.pause()
      if (clockMode === 'manual' && !frozenBySilence) feed.seek(clockTime)
    }
  }

  function setMovieTitle(title: string): void {
    ctx.config.movieTitle = title.trim() || CONFIG.movieTitle
    const cinematic = scene.get('hypervigilance')
    if (cinematic instanceof HypervigilanceScene) {
      cinematic.setTitle(ctx.config.movieTitle)
    }
  }

  /**
   * Where the content area starts under the shared top strip. Split out
   * from addStatusBar() so a scene can re-lay its windows without adding
   * a second status bar (the wall re-tiles in place).
   */
  const CONTENT_INSET = { top: 34 + 16, M: 16 }

  /** Shared top strip + the content area below it. */
  function addStatusBar(): { top: number; M: number } {
    const bar = new StatusBar()
    bar.id = 'status'
    scene.add(bar, ctx)
    return CONTENT_INSET
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
    addWallScreens(top, M)
    layoutWall()

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

  // ------------------------------------------------------------------
  // HIPERVIGILANCIA video wall
  //
  // The wall is a grid of surveillance panels fed by a clip bin the
  // director loads from a folder (see VideoWall). Panels are addressed by
  // wall order, `hv-screen-1..N`, and are deliberately outside the CamSlot
  // system: slots are single named cameras the director aims by hand,
  // while the wall is one playlist driving every screen at once.
  // ------------------------------------------------------------------

  /** Wall geometry from the current screen count. Also used by re-tiling. */
  function addWallScreens(top: number, M: number): void {
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
  }

  /** The wall's panels in wall order (empty in every other scene). */
  function wallPanels(): SurveillancePanel[] {
    const panels: SurveillancePanel[] = []
    for (let i = 1; i <= 9; i++) {
      const panel = widgetById(`hv-screen-${i}`, SurveillancePanel)
      if (!panel) break
      panels.push(panel)
    }
    return panels
  }

  /**
   * Put a screen on its clip. The panel's <video> element is reused
   * across cuts — nine fresh decoders every four seconds is what made
   * an early version of the wall hitch mid-take.
   *
   * Vision stays off here on purpose: one MediaPipe graph per screen
   * would cost more than the whole rest of the frame, and the wall reads
   * as surveillance from the fake tracking overlay alone.
   */
  function applyWallClip(panel: SurveillancePanel, screen: number): void {
    const file = wall.clipAt(screen)
    if (!file) return
    const feed = panel.feed
    if (feed instanceof VideoFeed) feed.setFile(file)
    else panel.setFeed(VideoFeed.fromFile(file))
  }

  /** (Re)deal the bin across every screen and re-arm the holds. */
  function layoutWall(): void {
    const panels = wallPanels()
    if (panels.length === 0) return
    for (const screen of wall.layout(panels.length, ctx.t)) {
      applyWallClip(panels[screen], screen)
    }
  }

  /** Apply a set of cuts the wall just decided on. */
  function applyWallCuts(cuts: number[]): void {
    if (cuts.length === 0) return
    const panels = wallPanels()
    for (const screen of cuts) {
      if (panels[screen]) applyWallClip(panels[screen], screen)
    }
  }

  /**
   * Auto-advance, driven from the draw loop on the director clock: PAUSA
   * holds the cut and a slow VEL stretches the montage, so a take can be
   * rehearsed frame by frame and still cut where it did in the rehearsal.
   */
  function tickWall(): void {
    if (scene.phase !== 'hypervigilance') return
    applyWallCuts(wall.update(ctx.t))
  }

  /** Re-tile in place — rebuilding the phase would reset the take. */
  function setWallScreens(screens: number): void {
    const next = Math.max(1, Math.min(9, Math.round(screens)))
    const cfg = ctx.config.scenes.hypervigilance
    if (next === cfg.activeScreens) return
    cfg.activeScreens = next
    if (scene.phase !== 'hypervigilance') return
    for (const panel of wallPanels()) {
      if (panel.feed instanceof VideoFeed) panel.feed.dispose()
      scene.remove(panel)
    }
    addWallScreens(CONTENT_INSET.top, CONTENT_INSET.M)
    layoutWall()
  }

  function loadWallVideos(files: File[]): void {
    const loaded = wall.load(files)
    if (loaded === 0) {
      controller.logLine('NINGÚN VIDEO VÁLIDO EN LA SELECCIÓN', 'warn')
      return
    }
    // setPhase rebuilds the wall, which deals the new bin on its own.
    if (scene.phase !== 'hypervigilance') setPhase('hypervigilance')
    else layoutWall()
    controller.logLine(`${loaded} CLIPS EN EL MURO DE VIGILANCIA`, 'ok')
  }

  function clearWallVideos(): void {
    wall.clear()
    for (const panel of wallPanels()) {
      if (panel.feed instanceof VideoFeed) panel.feed.dispose()
      panel.setFeed(new StaticFeed())
    }
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

  function buildGallery(): void {
    const W = ctx.width
    const H = ctx.height
    const { top, M } = addStatusBar()
    const rightW = Math.max(280, W * 0.24)
    const colH = H - top - M

    const gallery = new GalleryWindow({
      x: M,
      y: top,
      w: W - rightW - M * 3,
      h: colH,
      title: `${CONFIG.agencyCode} // GALERÍA DE EXPEDIENTES — OBJETIVOS`,
      tag: 'CLASIFICADO',
      revealTime: 0.6,
    })
    gallery.id = 'gallery'
    gallery.setTargets(galleryTargets)
    scene.add(gallery, ctx)

    const rx = W - rightW - M
    const log = new ConsoleWindow(
      {
        x: rx,
        y: top,
        w: rightW,
        h: colH,
        title: 'REGISTRO DE OPERACIÓN',
        tag: 'LIVE',
        revealTime: 0.8,
      },
      { autoFeedEvery: ctx.config.scenes.gallery.logEvery },
    )
    log.id = 'log'
    scene.add(log, ctx)
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

  function buildVrVision(): void {
    const vrVision = new VrVisionScene()
    vrVision.id = 'vr-vision'
    vrVision.patchSettings(vrVisionState.settings)
    vrVision.setActiveMessage(vrVisionState.active)
    if (vrVisionState.active) vrMessageStartedAt = ctx.t
    scene.add(vrVision, ctx)
  }

  function syncVrVisionScene(): void {
    const vrVision = widgetById('vr-vision', VrVisionScene)
    vrVision?.patchSettings(vrVisionState.settings)
    vrVision?.setActiveMessage(vrVisionState.active)
  }

  function updateVrMessage(): void {
    const active = vrVisionState.active
    if (!active || ctx.t - vrMessageStartedAt < active.duration) return
    vrVisionState.history.unshift(active)
    vrVisionState.history = vrVisionState.history.slice(0, VR_HISTORY_LIMIT)
    vrVisionState.active = null
    syncVrVisionScene()
    saveVrVisionState(vrVisionState)
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

  /**
   * Session media bin: what the director last pointed at each slot. Scene
   * rebuilds dispose the live <video> elements, so without this every
   * scene hop meant re-picking the same file from disk.
   */
  type SlotSource =
    | { kind: 'file'; file: File; label: string }
    | { kind: 'webcam'; label: string }
  const slotSources = new Map<CamSlot, SlotSource>()

  /** Re-attach remembered footage to whichever slots the scene provides. */
  function restoreSlots(): void {
    for (const [slot, source] of slotSources) {
      if (!holderFor(slot)) continue // this scene has no such slot
      if (source.kind === 'file') {
        swapFeed(slot, VideoFeed.fromFile(source.file))
      } else {
        // Permission is already granted, so this resolves without a prompt.
        VideoFeed.fromWebcam()
          .then((feed) => {
            if (holderFor(slot)) swapFeed(slot, feed)
            else feed.dispose()
          })
          .catch(() => slotSources.delete(slot))
      }
    }
  }

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
      // --- gallery -------------------------------------------------------
      case 'gallery-reroll': {
        const g = widgetById('gallery', GalleryWindow)
        if (g && g.count > 0) {
          g.reroll()
          log('EXPEDIENTES REGENERADOS — NUEVA FILIACIÓN', 'info')
        } else log('NO HAY EXPEDIENTES CARGADOS', 'warn')
        break
      }
      case 'gallery-silence-all': {
        const g = widgetById('gallery', GalleryWindow)
        if (g && g.count > 0) {
          g.markAll('silenced')
          log(`${g.count} OBJETIVOS MARCADOS COMO SILENCIADOS`, 'danger')
        } else log('NO HAY EXPEDIENTES CARGADOS', 'warn')
        break
      }
      case 'gallery-capture-all': {
        const g = widgetById('gallery', GalleryWindow)
        if (g && g.count > 0) {
          g.markAll('captured')
          log(`${g.count} OBJETIVOS MARCADOS COMO CAPTURADOS`, 'ok')
        } else log('NO HAY EXPEDIENTES CARGADOS', 'warn')
        break
      }
      case 'gallery-advance':
        widgetById('gallery', GalleryWindow)?.advanceAll()
        log('ESTADO DE EXPEDIENTES ACTUALIZADO', 'info')
        break
      case 'gallery-next-page':
        widgetById('gallery', GalleryWindow)?.nextPage()
        break
      case 'gallery-prev-page':
        widgetById('gallery', GalleryWindow)?.prevPage()
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
      // --- hipervigilancia (muro de video) ---------------------------------
      case 'hv-cut': {
        const screen = wall.cutOne(ctx.t)
        if (screen < 0) {
          log('MURO SIN MATERIAL — CARGA UNA CARPETA DE CLIPS', 'warn')
          break
        }
        applyWallCuts([screen])
        log(`NODO-${String(screen + 1).padStart(2, '0')}: NUEVA FUENTE EN CUADRO`, 'dim')
        break
      }
      case 'hv-next':
      case 'hv-prev': {
        const dir = action === 'hv-next' ? 1 : -1
        const cuts = wall.shift(dir, ctx.t)
        if (cuts.length === 0) {
          log('MURO SIN MATERIAL — CARGA UNA CARPETA DE CLIPS', 'warn')
          break
        }
        applyWallCuts(cuts)
        log(
          `MURO EN CLIP ${wall.state().cursor}/${wall.count}`,
          'info',
        )
        break
      }
      case 'hv-auto':
        wall.auto = !wall.auto
        // Re-arm from now, or every screen would cut at once on resume.
        if (wall.auto) wall.reschedule(ctx.t)
        log(
          wall.auto ? 'MURO EN ROTACIÓN AUTOMÁTICA' : 'MURO CONGELADO — CORTE MANUAL',
          wall.auto ? 'ok' : 'dim',
        )
        break
      case 'hv-shuffle':
        if (wall.empty) {
          log('MURO SIN MATERIAL — CARGA UNA CARPETA DE CLIPS', 'warn')
          break
        }
        wall.shuffle()
        layoutWall()
        log('ORDEN DE VIGILANCIA ALEATORIZADO', 'info')
        break
      case 'hv-mark': {
        const panels = wallPanels()
        if (panels.length === 0) break
        const hit = panels[Math.floor(Math.random() * panels.length)]
        hit.flashMark(cfg.vigilancia.markSeconds)
        log('COINCIDENCIA BIOMÉTRICA EN EL MURO — EXPEDIENTE 4471', 'danger')
        break
      }
      case 'hv-hold': {
        const cinematic = widgetById('hypervigilance', HypervigilanceScene)
        if (!cinematic) break
        const held = cinematic.setHold(!cinematic.holding)
        log(
          held ? 'MONTAJE EN BUCLE — EL TÍTULO ESPERA' : 'MONTAJE LIBERADO',
          held ? 'warn' : 'dim',
        )
        break
      }
      case 'hv-title':
        widgetById('hypervigilance', HypervigilanceScene)?.fireTitle()
        log('ENTRA TÍTULO', 'ok')
        break
      case 'hv-restart':
        widgetById('hypervigilance', HypervigilanceScene)?.restartMontage()
        layoutWall()
        log('MONTAJE DESDE EL PRIMER CUADRO', 'info')
        break
      // --- vr-vision ------------------------------------------------------
      case 'vr-cycle-frame': {
        const styles: VrFrameStyle[] = [
          'optical',
          'mechanical',
          'photographic',
          'clinical',
        ]
        const index = styles.indexOf(vrVisionState.settings.frameStyle)
        controller.setVrFrameStyle(styles[(index + 1) % styles.length])
        break
      }
      case 'vr-send-next':
        controller.sendVrMessage()
        break
      case 'vr-dismiss-message':
        controller.dismissVrMessage()
        break
    }
  }

  /**
   * Modes/toggles the current scene is holding, so cue buttons can show
   * state instead of pretending every cue is a one-shot.
   */
  function sceneStateSnapshot(): SceneState {
    const state: SceneState = {}
    switch (scene.phase) {
      case 'hypervigilance': {
        const w = wall.state()
        state.auto = w.auto
        state.clips = w.clips
        state.clip = w.cursor
        state.screens = w.screens
        state.hold =
          widgetById('hypervigilance', HypervigilanceScene)?.holding ?? false
        break
      }
      case 'map': {
        const m = widgetById('map', MapWindow)
        if (m) state.mode = m.mode
        break
      }
      case 'geo': {
        const g = widgetById('geo', GeoMapWindow)
        if (g) {
          state.mode = g.mode
          state.follow = g.follow
          state.city = g.city.label
          state.zoom = g.zoomLevel
        }
        break
      }
      case 'gallery': {
        const g = widgetById('gallery', GalleryWindow)
        if (g) {
          state.page = g.pageNumber
          state.dossiers = g.targetCount
        }
        break
      }
      case 'board': {
        const b = widgetById('board', MotherboardWindow)
        if (b) state.xray = b.xrayOn
        break
      }
      case 'chip': {
        const d = widgetById('die', DieMapWindow)
        if (d) state.layer = d.layerLabel
        break
      }
      case 'video-effects': {
        const s = widgetById('studio', VideoEffectsStudio)
        if (s) {
          state.fit = s.effects.fit
          state.mirror = s.effects.mirror
          state.overlays = s.effects.overlays
          state.trails = s.effects.trails
          state.identify = s.effects.identify
        }
        break
      }
      case 'vr-vision':
        state.frame = vrVisionState.settings.frameStyle
        state.queued = vrVisionState.queue.length
        state.messageActive = vrVisionState.active !== null
        break
      case 'silence':
        state.silenced = widgetById('silence', SilenceScene)?.silenced ?? false
        break
    }
    return state
  }

  /** Anything that can display a feed: surveillance panels + call tile. */
  function holderFor(
    slot: CamSlot,
  ): FeedHolder | undefined {
    if (slot === 'studio') {
      const e = scene.get('studio')
      return e instanceof VideoEffectsStudio ? e : undefined
    }
    if (slot === 'silence') {
      const e = scene.get('silence')
      return e instanceof SilenceScene ? e : undefined
    }
    if (slot === 'vr-vision') {
      const e = scene.get('vr-vision')
      return e instanceof VrVisionScene ? e : undefined
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
      holderFor('studio') ??
      holderFor('vr-vision')
    if (!holder) {
      if (feed instanceof VideoFeed) feed.dispose()
      return
    }
    if (holder.feed instanceof VideoFeed) holder.feed.dispose()
    // Vision only runs on surveillance panels — the call tile is a mirror.
    if (
      feed instanceof VideoFeed &&
      visionOn &&
      (holder instanceof SurveillancePanel ||
        holder instanceof VideoEffectsStudio ||
        holder instanceof VrVisionScene)
    ) {
      feed.vision = new VisionEngine()
    }
    holder.setFeed(feed)
  }

  /** Release the object URLs backing the current dossier board. */
  function disposeGalleryTargets(): void {
    for (const t of galleryTargets) URL.revokeObjectURL(t.url)
    galleryTargets = []
  }

  /** Decode image files into dossiers and (re)populate the gallery. */
  function loadGalleryImages(files: File[]): void {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) {
      controller.logLine('NINGUNA IMAGEN VÁLIDA EN LA SELECCIÓN', 'warn')
      return
    }
    disposeGalleryTargets()
    // Natural order so a picked folder reads in filename order.
    images.sort((a, b) => a.name.localeCompare(b.name))
    galleryTargets = images.map((file) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.src = url
      return buildDossier(img, url, file.name)
    })
    // Refresh a live gallery, or jump to the scene so the board shows.
    const g = widgetById('gallery', GalleryWindow)
    if (g) g.setTargets(galleryTargets)
    else setPhase('gallery')
    controller.logLine(`${galleryTargets.length} EXPEDIENTES CARGADOS EN LA GALERÍA`, 'ok')
  }

  /**
   * Filename stem for takes and stills:
   * `<production>-<scene>-t03`. Twenty clips from five scenes used to be
   * indistinguishable in the bin — this is what makes them sortable.
   */
  function takeStem(): string {
    const title = slugify(ctx.config.movieTitle)
    const sceneName = slugify(PHASE_LABELS[scene.phase])
    return `${title}-${sceneName}-t${String(Math.max(take, 1)).padStart(2, '0')}`
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
    const vrFeed = holderFor('vr-vision')?.feed
    if (vrFeed instanceof VideoFeed) {
      vrFeed.vision = on ? (vrFeed.vision ?? new VisionEngine()) : null
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
      // Forget the bins too, or restoreSlots / the wall would re-attach
      // what the director just asked to drop.
      slotSources.clear()
      wall.clear()
      disposeSceneFeeds()
      setPhase(scene.phase)
    },
    relayout: () => rebuildPhase(),
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
    loadVideoFile: (file, slot = 'cam-a') => {
      slotSources.set(slot, { kind: 'file', file, label: file.name })
      swapFeed(slot, VideoFeed.fromFile(file))
    },
    useWebcam: async (slot = 'cam-a') => {
      const feed = await VideoFeed.fromWebcam()
      slotSources.set(slot, { kind: 'webcam', label: 'WEBCAM' })
      swapFeed(slot, feed)
    },
    clearFeed: (slot = 'cam-a') => {
      slotSources.delete(slot)
      swapFeed(slot, new StaticFeed())
    },
    getSlots: () =>
      (['cam-a', 'cam-b', 'call-self', 'studio', 'vr-vision', 'silence'] as const)
        .filter((slot) => holderFor(slot))
        .map((slot) => {
          const source = slotSources.get(slot)
          const live = holderFor(slot)?.feed
          // The bin remembers intent; the holder tells us what's actually
          // on screen (a restore can still be in flight).
          if (!source || !(live instanceof VideoFeed)) {
            return { slot, kind: 'none' as const, label: 'ESTÁTICO' }
          }
          return { slot, kind: source.kind, label: source.label }
        }),
    slotAtPoint: (clientX, clientY) => {
      if (!canvasEl) return null
      // Map viewport → canvas pixels; a letterboxed canvas is CSS-scaled,
      // so the ratio matters (dropping on CAM-B must not hit CAM-A).
      const rect = canvasEl.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return null
      const x = ((clientX - rect.left) / rect.width) * ctx.width
      const y = ((clientY - rect.top) / rect.height) * ctx.height
      if (x < 0 || y < 0 || x > ctx.width || y > ctx.height) return null
      // Topmost first, so a raised window wins the drop.
      const slots: CamSlot[] = [
        'cam-a',
        'cam-b',
        'call-self',
        'studio',
        'vr-vision',
        'silence',
      ]
      let best: { slot: CamSlot; z: number } | null = null
      for (const slot of slots) {
        const holder = holderFor(slot)
        if (!holder) continue
        // Full-screen holders (studio, silence) accept a drop anywhere.
        const hit =
          holder instanceof OSWindow ? holder.contains(x, y) : true
        if (!hit) continue
        const z = holder instanceof OSWindow ? holder.z : -1
        if (!best || z >= best.z) best = { slot, z }
      }
      return best?.slot ?? null
    },
    loadGalleryImages: (files) => loadGalleryImages(files),
    loadWallVideos: (files) => loadWallVideos(files),
    clearWallVideos: () => clearWallVideos(),
    getWallState: () => wall.state(),
    setWallPace: ({ holdSeconds, stagger }) => {
      if (holdSeconds !== undefined) {
        wall.holdSeconds = Math.max(0.5, Math.min(60, holdSeconds))
      }
      if (stagger !== undefined) wall.stagger = Math.max(0, Math.min(10, stagger))
      // Re-arm so a new pace takes effect on this cut, not the next one —
      // without re-dealing the bin, which would cut every screen at once.
      wall.reschedule(ctx.t)
    },
    setWallScreens: (screens) => setWallScreens(screens),
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
    setVrFrameStyle: (style) => {
      vrVisionState.settings.frameStyle = style
      syncVrVisionScene()
      saveVrVisionState(vrVisionState)
    },
    getVrFrameStyle: () => vrVisionState.settings.frameStyle,
    setVrVisionSettings: (patch) => {
      Object.assign(vrVisionState.settings, patch)
      syncVrVisionScene()
      saveVrVisionState(vrVisionState)
    },
    getVrVisionState: () => structuredClone(vrVisionState),
    queueVrMessage: (text, tone = 'info', duration = 6) => {
      const clean = text.trim().slice(0, 240)
      if (!clean) return
      vrVisionState.queue.push({
        id: crypto.randomUUID(),
        text: clean,
        tone,
        duration: Math.max(1, Math.min(30, duration)),
        createdAt: Date.now(),
      })
      vrVisionState.queue = vrVisionState.queue.slice(-VR_HISTORY_LIMIT)
      saveVrVisionState(vrVisionState)
    },
    sendVrMessage: (id) => {
      const index = id
        ? vrVisionState.queue.findIndex((message) => message.id === id)
        : 0
      if (index < 0 || vrVisionState.queue.length === 0) return
      if (vrVisionState.active) vrVisionState.history.unshift(vrVisionState.active)
      vrVisionState.active = vrVisionState.queue.splice(index, 1)[0]
      vrVisionState.history = vrVisionState.history.slice(0, VR_HISTORY_LIMIT)
      vrMessageStartedAt = ctx.t
      syncVrVisionScene()
      saveVrVisionState(vrVisionState)
    },
    dismissVrMessage: () => {
      if (!vrVisionState.active) return
      vrVisionState.history.unshift(vrVisionState.active)
      vrVisionState.history = vrVisionState.history.slice(0, VR_HISTORY_LIMIT)
      vrVisionState.active = null
      syncVrVisionScene()
      saveVrVisionState(vrVisionState)
    },
    removeVrMessage: (id) => {
      vrVisionState.queue = vrVisionState.queue.filter((message) => message.id !== id)
      saveVrVisionState(vrVisionState)
    },
    replayVrMessage: (id) => {
      const message = vrVisionState.history.find((entry) => entry.id === id)
      if (!message) return
      vrVisionState.queue.unshift({
        ...message,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
      })
      saveVrVisionState(vrVisionState)
    },
    clearVrHistory: () => {
      vrVisionState.history = []
      saveVrVisionState(vrVisionState)
    },
    setVision: (on) => setVision(on),
    isVisionOn: () => visionOn,
    setCrt: (patch) => {
      Object.assign(ctx.config.crt, patch)
    },
    getCrt: () => ({ ...ctx.config.crt }),
    resetCrt: () => {
      Object.assign(ctx.config.crt, CONFIG.crt)
      return { ...ctx.config.crt }
    },
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
    getSceneState: () => sceneStateSnapshot(),
    setGeoLocation: (lat, lon, label) => {
      const geo = widgetById('geo', GeoMapWindow)
      if (!geo) return
      const name = geo.setLocation(lat, lon, label)
      controller.logLine(`ENLACE REPOSICIONADO — OP. ${name}`, 'info')
    },
    screenshot: () => {
      canvasEl?.toBlob((blob) => {
        if (!blob) return
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `${takeStem()}-foto-${timestampSlug()}.png`
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      }, 'image/png')
    },
    setCaptureFormat: (format) => setCaptureFormat(format),
    setCaptureContainer: (container) => {
      captureContainer = container
    },
    setAudioCapture: async (on) => {
      if (!on) {
        for (const track of micStream?.getTracks() ?? []) track.stop()
        micStream = null
        return
      }
      if (micStream) return
      // Let the rejection reach the panel so it can surface a note.
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    },
    setAutoDownload: (on) => {
      autoDownload = on
    },
    getCaptureState: () => ({
      format: captureFormat,
      width: canvasEl?.width ?? ctx.width,
      height: canvasEl?.height ?? ctx.height,
      container: captureContainer,
      effectiveContainer: CanvasRecorder.resolveContainer(captureContainer),
      audio: micStream !== null,
      autoDownload,
    }),
    startRecording: () => {
      if (!canvasEl || recorder.recording) return
      take++
      // Slate carries the scene name so the clip is identifiable on sight.
      scene.add(new Slate(take, PHASE_LABELS[scene.phase]), ctx)
      recorder.start({
        canvas: canvasEl,
        fps: 60,
        baseName: takeStem(),
        container: captureContainer,
        audio: micStream,
        autoDownload,
      })
    },
    stopRecording: () => recorder.stop(),
    isRecording: () => recorder.recording,
    getHealth: () => ({
      frame: clockFrame,
      mode: clockMode,
      drawn: framesDrawn,
    }),
    getTake: () => take,
    destroy: () => {
      destroyed = true
      sizeObserver.disconnect()
      disposeSceneFeeds()
      disposeGalleryTargets()
      recorder.stop()
      for (const track of micStream?.getTracks() ?? []) track.stop()
      micStream = null
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
        const f = holderFor(slot)?.feed
        return f instanceof VideoFeed ? (f.vision?.status ?? null) : null
      },
      tracks: (slot: CamSlot = 'cam-a') => {
        const f = holderFor(slot)?.feed
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
          health: () => controller.getHealth(),
          // Feed elements are never in the DOM, so transport behaviour
          // isn't observable via querySelector — expose it here.
          feeds: () =>
            sceneFeeds().map((f) => ({
              label: f.label,
              ready: f.ready,
              paused: f.paused,
              currentTime: f.currentTime,
              rate: f.element.playbackRate,
            })),
          capture: () => controller.getCaptureState(),
          sceneState: () => controller.getSceneState(),
          vrVision: () => controller.getVrVisionState(),
          toggleSilence: () => widgetById('silence', SilenceScene)?.click(ctx),
          slots: () => controller.getSlots(),
          canRecord: () => ({
            mp4: canRecord('mp4'),
            webm: canRecord('webm'),
          }),
    }
  }

  return controller
}
