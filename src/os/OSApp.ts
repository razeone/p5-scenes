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
import { OSWindow } from './widgets/OSWindow'
import { MapWindow } from './widgets/MapWindow'
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
import { StaticFeed } from './media/FeedSource'
import { VideoFeed } from './media/VideoSource'
import { CanvasRecorder, timestampSlug } from './media/Recorder'
import { VisionEngine } from './vision/VisionEngine'
import { Slate } from './widgets/Slate'
import type { LogLevel } from './widgets/TextStream'

/** Slots the director can pipe video into (panels + the call's self tile). */
export type CamSlot = 'cam-a' | 'cam-b' | 'call-self'

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
      if (!hit) return
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
      case 'map':
        buildMap()
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
    }
    hooks.onPhaseChange?.(phase)
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
    })
    login.onComplete = () => setPhase('desktop')
    scene.add(login, ctx)
    scene.setFocus(login)
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
    }
  }

  /** Anything that can display a feed: surveillance panels + call tile. */
  function holderFor(
    slot: CamSlot,
  ): SurveillancePanel | CallWindow | undefined {
    if (slot === 'call-self') {
      const e = scene.get('call')
      return e instanceof CallWindow ? e : undefined
    }
    return panelFor(slot)
  }

  function swapFeed(slot: CamSlot, feed: VideoFeed | StaticFeed): void {
    const holder = holderFor(slot)
    if (!holder) {
      if (feed instanceof VideoFeed) feed.dispose()
      return
    }
    if (holder.feed instanceof VideoFeed) holder.feed.dispose()
    // Vision only runs on surveillance panels — the call tile is a mirror.
    if (
      feed instanceof VideoFeed &&
      visionOn &&
      holder instanceof SurveillancePanel
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
    }
  }

  return controller
}
