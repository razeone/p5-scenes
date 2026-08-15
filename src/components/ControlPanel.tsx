/**
 * ControlPanel.tsx — Director's off-camera controls.
 *
 * Not part of the fiction: a collapsible strip for staging takes —
 * jump phases, switch color themes live, pipe video files / webcam into
 * the surveillance slots, dial the CRT ambience, inject log lines and
 * status-bar directives, and capture stills / takes. Only the canvas is
 * captured, so the panel never shows up in footage; hide it with the ⨯
 * or Ctrl+H anyway if it distracts.
 *
 * Layout mirrors the filming workflow, in falling order of stakes:
 * TOMA (record/cut, count-in, still, take review) sits on top, then
 * staging (ESCENA/CUES/TIEMPO). Everything else lives in collapsible
 * sections so the panel can run lean while rolling — see SECTIONS.
 *
 * Two rules govern this UI, both learned from ruined takes:
 *   1. While REC is rolling, controls that rebuild the scene are guarded
 *      (dimmed + two-click arm). Performance controls stay instant.
 *   2. State the director needs mid-take (mode, follow, format, what's
 *      loaded where) is always visible, never inferred from the canvas.
 */

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  CamSlot,
  CaptureFormat,
  CaptureState,
  OSController,
  SavedTake,
  SceneAction,
  SceneState,
  SlotState,
  StudioMediaState,
  VrVisionState,
} from '../os/OSApp'
import { CAPTURE_FORMATS } from '../os/OSApp'
import { PHASE_LABELS, PHASE_ORDER, type OSPhase } from '../os/core/SceneManager'
import type { OSConfig } from '../os/config/config'
import type { DirectorClockState } from '../os/core/context'
import { PALETTES, PALETTE_ORDER, type PaletteKey } from '../os/config/theme'
import type { StudioEffects } from '../os/widgets/VideoEffectsStudio'
import type { WallState } from '../os/media/VideoWall'
import {
  VR_FRAME_STYLES,
  type VrFrameStyle,
  type VrMessageTone,
} from '../os/widgets/VrVisionScene'

type CrtKey = keyof OSConfig['crt']

// Slider bank for the CRT ambience. glitchChance is a per-frame
// probability, so its usable range is far below 1.
const CRT_SLIDERS: { key: CrtKey; label: string; max: number }[] = [
  { key: 'scanlineIntensity', label: 'LÍNEAS', max: 1 },
  { key: 'glow', label: 'BRILLO', max: 1 },
  { key: 'vignette', label: 'VIÑETA', max: 1 },
  { key: 'flicker', label: 'TEMBLOR', max: 1 },
  { key: 'glitchChance', label: 'GLITCH', max: 0.15 },
]

interface Props {
  controller: OSController
  theme: PaletteKey
  phase: OSPhase
  recording: boolean
  vision: boolean
  takes: SavedTake[]
  onDiscardTake: (url: string) => void
  onKeepTake: (url: string) => void
}

/**
 * A director cue. `active` reads the scene-state snapshot so mode cues
 * (PERSECUCIÓN, SEGUIR, RAYOS-X…) light up instead of looking like
 * fire-and-forget one-shots — the director can see the scene's mode
 * without decoding the canvas HUD mid-take.
 */
interface Cue {
  id: SceneAction
  label: string
  title?: string
  active?: (state: SceneState) => boolean
}

// Cues per scene; the row only shows what the current scene can respond
// to (see SceneAction in OSApp). Number keys 1-9 fire them in order.
const SCENE_ACTIONS: Partial<Record<OSPhase, Cue[]>> = {
  hypervigilance: [
    { id: 'hv-cut', label: 'CORTE', title: 'Una pantalla pasa al siguiente clip (corte rodante)' },
    { id: 'hv-next', label: 'CLIP ▶', title: 'Todo el muro avanza un clip' },
    { id: 'hv-prev', label: '◀ CLIP', title: 'Todo el muro retrocede un clip' },
    {
      id: 'hv-auto',
      label: 'AUTO',
      title: 'Rotación automática de los clips durante la toma',
      active: (s) => s.auto === true,
    },
    {
      id: 'hv-hold',
      label: 'BUCLE',
      title: 'El montaje no termina: el título espera a que lo llames',
      active: (s) => s.hold === true,
    },
    { id: 'hv-title', label: 'TÍTULO', title: 'Entra ya el fogonazo y el título' },
    { id: 'hv-mark', label: 'IDENTIFICAR', title: 'Coincidencia biométrica en una pantalla al azar' },
    { id: 'hv-shuffle', label: 'ALEATORIO', title: 'Baraja el orden de la carpeta' },
    { id: 'hv-restart', label: 'REINICIAR', title: 'El montaje vuelve al primer cuadro' },
  ],
  desktop: [
    { id: 'cam-mark', label: 'IDENTIFICAR', title: 'Banner "sujeto identificado" en CAM-A' },
    { id: 'targets-up', label: '+SUJETO', title: 'Más objetivos simulados en cuadro' },
    { id: 'targets-down', label: '−SUJETO', title: 'Menos objetivos simulados en cuadro' },
  ],
  map: [
    { id: 'map-new-target', label: 'MOVER OBJETIVO' },
    {
      id: 'map-chase',
      label: 'PERSECUCIÓN',
      title: 'Las unidades convergen sobre el objetivo',
      active: (s) => s.mode === 'chase',
    },
    {
      id: 'map-patrol',
      label: 'PATRULLA',
      title: 'Las unidades vuelven a rondar',
      active: (s) => s.mode === 'patrol',
    },
    { id: 'map-add-unit', label: '+UNIDAD' },
    { id: 'map-remove-unit', label: '−UNIDAD' },
  ],
  geo: [
    { id: 'geo-new-target', label: 'MOVER OBJETIVO', title: 'Reubica la señal GPS del objetivo' },
    {
      id: 'geo-chase',
      label: 'INTERCEPTAR',
      title: 'Las unidades convergen sobre el objetivo',
      active: (s) => s.mode === 'chase',
    },
    {
      id: 'geo-patrol',
      label: 'PATRULLA',
      title: 'Las unidades vuelven a rondar el sector',
      active: (s) => s.mode === 'patrol',
    },
    {
      id: 'geo-follow',
      label: 'SEGUIR',
      title: 'Fija o libera la cámara sobre el objetivo',
      active: (s) => s.follow === true,
    },
    { id: 'geo-zoom-in', label: 'ZOOM+' },
    { id: 'geo-zoom-out', label: 'ZOOM−' },
    { id: 'geo-city', label: 'CIUDAD', title: 'Salta a la siguiente ciudad real' },
    { id: 'geo-add-unit', label: '+UNIDAD' },
    { id: 'geo-remove-unit', label: '−UNIDAD' },
  ],
  gallery: [
    { id: 'gallery-silence-all', label: 'SILENCIAR TODO', title: 'Marca todos los objetivos como silenciados' },
    { id: 'gallery-capture-all', label: 'CAPTURAR TODO', title: 'Marca todos los objetivos como capturados' },
    { id: 'gallery-advance', label: 'AVANZAR ESTADO', title: 'Rota el estado de cada expediente' },
    { id: 'gallery-reroll', label: 'REGENERAR', title: 'Nueva filiación aleatoria para cada ficha' },
    { id: 'gallery-prev-page', label: '◀ PÁGINA' },
    { id: 'gallery-next-page', label: 'PÁGINA ▶' },
  ],
  sensors: [
    { id: 'sensor-quake', label: 'SISMO', title: 'Dispara la red sísmica' },
    { id: 'sensor-transmission', label: 'TRANSMISIÓN', title: 'Banda caliente en el espectro + RF' },
    { id: 'sensor-chem', label: 'ALERTA QUÍMICA', title: 'Medidores químicos al rojo' },
  ],
  call: [
    { id: 'call-next-speaker', label: 'CAMBIAR VOZ', title: 'Pasa la palabra al siguiente' },
    { id: 'call-drop', label: 'CAÍDA DE SEÑAL' },
    { id: 'call-reconnect', label: 'RECONECTAR', title: 'Rehace el handshake de la llamada' },
  ],
  chip: [
    { id: 'chip-drc', label: 'VIOLACIONES DRC', title: 'Tormenta de violaciones de diseño en el dado' },
    { id: 'chip-thermal', label: 'PUNTO CALIENTE', title: 'Un bloque se sobrecalienta' },
    { id: 'chip-layer', label: 'CAPA METAL', title: 'Cicla la capa de ruteo resaltada (M1–M5)' },
    { id: 'chip-reroute', label: 'RE-RUTEO', title: 'El autorouter recalcula las redes' },
    { id: 'chip-test', label: 'TEST BIST', title: 'Patrón de prueba en el analizador lógico' },
    { id: 'chip-tapeout', label: 'TAPEOUT', title: 'Firma el GDSII y lo envía a fundición' },
  ],
  board: [
    { id: 'board-restart', label: 'REINICIAR', title: 'Repite el ensamblaje desde el sustrato' },
    { id: 'board-next', label: 'SIGUIENTE', title: 'Salta a la próxima estación' },
    { id: 'board-power', label: 'ENCENDIDO', title: 'Salta al final: la placa entera se ilumina' },
    {
      id: 'board-xray',
      label: 'RAYOS-X',
      title: 'Cobre brillante, componentes fantasma',
      active: (s) => s.xray === true,
    },
    { id: 'board-fault', label: 'FALLA', title: 'Cortocircuito con chispas en un componente' },
  ],
  implant: [
    { id: 'bio-panic', label: 'PÁNICO', title: 'Crisis: FC 140+, cortisol y adrenalina al rojo' },
    { id: 'bio-sedate', label: 'SEDAR', title: 'Microdosis remota: todo baja, estado DÓCIL' },
    { id: 'bio-reward', label: 'RECOMPENSA', title: 'Pico de dopamina: estado EUFORIA' },
    { id: 'bio-lie', label: 'ENGAÑO', title: 'Índice de engaño al 93% + pensamiento disidente' },
    { id: 'bio-arrest', label: 'PARO', title: 'Asistolia con reanimación remota automática' },
  ],
  loyalty: [
    { id: 'loy-portrait', label: 'RETRATO', title: 'Muestra al Líder y mide la respuesta neural' },
    { id: 'loy-dissent', label: 'DISIDENCIA', title: 'El DPI sube hasta cruzar el umbral de arresto' },
    { id: 'loy-pardon', label: 'INDULTO', title: 'Rescinde la orden: "el dato era erróneo"' },
    { id: 'loy-curate', label: 'CURAR CIFRA', title: 'Infla la felicidad publicada, hunde la real' },
    { id: 'bio-panic', label: 'PÁNICO', title: 'El índice de miedo se dispara' },
  ],
  analysis: [
    { id: 'cam-mark', label: 'IDENTIFICAR', title: 'Banner "sujeto identificado" sobre el video' },
    { id: 'ana-dissent', label: 'DISIDENCIA', title: 'El DPI (alimentado por la cámara) cruza el umbral' },
    { id: 'ana-pardon', label: 'INDULTO', title: 'Rescinde la orden de arresto' },
    { id: 'ana-reset', label: 'CALIBRAR', title: 'Borra heatmap e historiales — nueva línea base' },
  ],
  'vr-vision': [
    { id: 'vr-cycle-frame', label: 'CAMBIAR VISOR', title: 'Cicla el estilo del marco sin reiniciar el video' },
    { id: 'vr-send-next', label: 'ENVIAR SIG.', title: 'Muestra la siguiente línea de la cola' },
    { id: 'vr-dismiss-message', label: 'QUITAR LÍNEA', title: 'Retira la línea activa del visor' },
  ],
}

// Where footage can land per scene. Only working targets get buttons —
// pressing WEBCAM→A in LLAMADA used to dispose the feed into nothing.
const VIDEO_TARGETS: Partial<
  Record<OSPhase, { slot: CamSlot; label: string }[]>
> = {
  desktop: [
    { slot: 'cam-a', label: 'A' },
    { slot: 'cam-b', label: 'B' },
  ],
  analysis: [{ slot: 'cam-a', label: 'CÁMARA' }],
  call: [{ slot: 'call-self', label: 'LLAMADA' }],
  'video-effects': [{ slot: 'studio', label: 'STUDIO' }],
  'vr-vision': [{ slot: 'vr-vision', label: 'VISOR' }],
  silence: [{ slot: 'silence', label: 'SILENCE' }],
}

/**
 * Collapsible sections. Shoot-critical rows (TOMA / ESCENA / CUES /
 * TIEMPO) are never collapsible; these carry the prep-time controls, so
 * the panel can stay small on set. Open/closed state persists.
 */
const SECTIONS = {
  captura: 'CAPTURA',
  media: 'MEDIA',
  look: 'LOOK',
  inyectar: 'INYECTAR',
  sistema: 'SISTEMA',
} as const
type SectionKey = keyof typeof SECTIONS

const DEFAULT_OPEN: Record<SectionKey, boolean> = {
  captura: true,
  media: true,
  look: false,
  inyectar: false,
  sistema: false,
}

/** Director prefs that survive a reload (a shoot day includes reloads). */
interface DirectorPrefs {
  open: Record<SectionKey, boolean>
  format: CaptureFormat
  container: 'mp4' | 'webm'
  autoDownload: boolean
  countIn: number
  crt: OSConfig['crt'] | null
  theme: PaletteKey | null
  movieTitle: string | null
}

const PREFS_KEY = 'panopticon.director.prefs.v1'

function loadPrefs(): Partial<DirectorPrefs> {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw ? (JSON.parse(raw) as Partial<DirectorPrefs>) : {}
  } catch {
    return {} // private mode / corrupt entry: fall back to defaults
  }
}

function savePrefs(patch: Partial<DirectorPrefs>): void {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ ...loadPrefs(), ...patch }),
    )
  } catch {
    /* storage unavailable — prefs just don't persist */
  }
}

const COUNT_IN_OPTIONS = [3, 5, 10]

/** Collapsible section header; the summary keeps state visible when shut. */
function SectionHead({
  id,
  open,
  onToggle,
  summary,
}: {
  id: SectionKey
  open: boolean
  onToggle: (key: SectionKey) => void
  summary?: string
}) {
  return (
    <button
      type="button"
      className="ctrl-sec"
      aria-expanded={open}
      onClick={() => onToggle(id)}
    >
      <i>{open ? '▾' : '▸'}</i>
      {SECTIONS[id]}
      {!open && summary && <span className="ctrl-dim">{summary}</span>}
    </button>
  )
}

/** Shortcut cheat sheet (`?`) — the panel's only in-app documentation. */
function KeysOverlay({
  phase,
  onClose,
}: {
  phase: OSPhase
  onClose: () => void
}) {
  const cues = SCENE_ACTIONS[phase] ?? []
  return createPortal(
    <button type="button" className="ctrl-keys" onClick={onClose}>
      <div className="ctrl-keys-card">
        <h2>ATAJOS DE DIRECCIÓN</h2>
        <dl>
          <dt>Ctrl+G</dt>
          <dd>grabar / cortar</dd>
          <dt>Ctrl+H</dt>
          <dd>ocultar o mostrar el panel</dd>
          <dt>Ctrl+I</dt>
          <dd>visión por computadora on/off</dd>
          <dt>Ctrl+R</dt>
          <dd>reiniciar desde BOOT (bloqueado grabando)</dd>
          <dt>Ctrl+1…{PALETTE_ORDER.length}</dt>
          <dd>paleta de color</dd>
          <dt>1…9</dt>
          <dd>cues de la escena actual</dd>
          <dt>Esc</dt>
          <dd>cancelar cuenta atrás · salir de un campo de texto</dd>
          <dt>?</dt>
          <dd>esta ayuda</dd>
        </dl>
        {cues.length > 0 && (
          <>
            <h2 style={{ marginTop: 14 }}>
              CUES — {PHASE_LABELS[phase]}
            </h2>
            <dl>
              {cues.slice(0, 9).map((cue, i) => (
                <Fragment key={cue.id}>
                  <dt>{i + 1}</dt>
                  <dd>
                    {cue.label}
                    {cue.title ? ` — ${cue.title.toLowerCase()}` : ''}
                  </dd>
                </Fragment>
              ))}
            </dl>
          </>
        )}
        <p>clic en cualquier parte para cerrar</p>
      </div>
    </button>,
    document.body,
  )
}

const STUDIO_SLIDERS: {
  key: keyof StudioEffects
  label: string
  min: number
  max: number
  step: number
}[] = [
  { key: 'zoom', label: 'ZOOM', min: 0.25, max: 3, step: 0.05 },
  { key: 'panX', label: 'PAN X', min: -1, max: 1, step: 0.02 },
  { key: 'panY', label: 'PAN Y', min: -1, max: 1, step: 0.02 },
  { key: 'rotation', label: 'ROTAR', min: -180, max: 180, step: 1 },
  { key: 'blur', label: 'BLUR', min: 0, max: 24, step: 0.5 },
  { key: 'pixelate', label: 'PIXEL', min: 1, max: 32, step: 1 },
  { key: 'faceBlur', label: 'ROSTRO', min: 0, max: 30, step: 1 },
  { key: 'brightness', label: 'LUZ', min: 0.2, max: 2, step: 0.02 },
  { key: 'contrast', label: 'CONTRASTE', min: 0.2, max: 2.5, step: 0.02 },
  { key: 'saturation', label: 'COLOR', min: 0, max: 2.5, step: 0.02 },
  { key: 'hue', label: 'TONO', min: -180, max: 180, step: 1 },
  { key: 'invert', label: 'INVERTIR', min: 0, max: 1, step: 0.01 },
  { key: 'rgbSplit', label: 'RGB', min: 0, max: 30, step: 1 },
  { key: 'noise', label: 'RUIDO', min: 0, max: 1, step: 0.01 },
  { key: 'glitch', label: 'GLITCH', min: 0, max: 1, step: 0.01 },
]

/** 00:00 for durations ≥ 1s resolution. */
function fmtMMSS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Scene-clock timecode with tenths: 00:07.4 */
function fmtTimecode(t: number): string {
  const tenths = Math.floor((t % 1) * 10)
  return `${fmtMMSS(t)}.${tenths}`
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)}GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)}MB`
  return `${Math.round(bytes / 1e3)}KB`
}

export default function ControlPanel({
  controller,
  theme,
  phase,
  recording,
  vision,
  takes,
  onDiscardTake,
  onKeepTake,
}: Props) {
  const [hidden, setHidden] = useState(false)
  const [crt, setCrt] = useState(() => controller.getCrt())
  const [msg, setMsg] = useState('')
  const [movieTitle, setMovieTitle] = useState(() => controller.getMovieTitle())
  const [speed, setSpeed] = useState(1)
  const [clock, setClock] = useState<DirectorClockState>(() =>
    controller.getClock(),
  )
  const [recSec, setRecSec] = useState(0)
  const [studioFx, setStudioFx] = useState<StudioEffects>(() =>
    controller.getStudioEffects(),
  )
  const [studioMedia, setStudioMedia] = useState<StudioMediaState>(() =>
    controller.getStudioMediaState(),
  )
  const [vrState, setVrState] = useState<VrVisionState>(() =>
    controller.getVrVisionState(),
  )
  const [vrDraft, setVrDraft] = useState('')
  const [vrTone, setVrTone] = useState<VrMessageTone>('info')
  const [vrDuration, setVrDuration] = useState(6)
  // Count-in before rolling (null = idle). Lets a solo operator hit
  // record and get in front of the camera before the slate burns in.
  const [countdown, setCountdown] = useState<number | null>(null)
  const [countdownMode, setCountdownMode] = useState<'record' | 'play'>('record')
  const [countIn, setCountIn] = useState(() => loadPrefs().countIn ?? 3)
  // Transient feedback for async failures (webcam denied/unavailable).
  const [note, setNote] = useState<string | null>(null)
  // Panel position: null = CSS default (bottom-right); set once dragged.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  // Collapsible sections + the live capture/slot/scene readouts.
  const [open, setOpen] = useState<Record<SectionKey, boolean>>(() => ({
    ...DEFAULT_OPEN,
    ...loadPrefs().open,
  }))
  const [capture, setCapture] = useState<CaptureState>(() =>
    controller.getCaptureState(),
  )
  const [slots, setSlots] = useState<SlotState[]>([])
  const [sceneState, setSceneState] = useState<SceneState>({})
  // HIPERVIGILANCIA video wall: bin size, what's on screen 1, pacing.
  const [wallState, setWallState] = useState<WallState>(() =>
    controller.getWallState(),
  )
  // The screen count is the one wall value the panel owns — it re-tiles
  // the wall, so the slider must not fight the 5 Hz poll while dragging.
  const [wallScreens, setWallScreens] = useState(
    () => controller.getWallState().screens || 9,
  )
  // Guard for scene-destroying controls while rolling: first click arms,
  // second click commits. Cleared on a timer and when REC stops.
  const [armed, setArmed] = useState<string | null>(null)
  const [showKeys, setShowKeys] = useState(false)
  // GEO: direct coordinates instead of only cycling preset cities.
  const [geoLat, setGeoLat] = useState('')
  const [geoLon, setGeoLon] = useState('')
  const [geoName, setGeoName] = useState('')
  // Take under inline review (url), so reviewing costs no new tab.
  const [reviewing, setReviewing] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const imagesRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const wallRef = useRef<HTMLInputElement>(null)
  const wallFolderRef = useRef<HTMLInputElement>(null)
  const slotRef = useRef<CamSlot>('cam-a')
  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const recStartRef = useRef(0)
  const noteTimerRef = useRef(0)
  const armTimerRef = useRef(0)

  // Drag the panel by its DIRECCIÓN title bar (pointer capture keeps the
  // drag alive even when the cursor outruns the header).
  const onHeadPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return // the ⨯
    const r = panelRef.current?.getBoundingClientRect()
    if (!r) return
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onHeadPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const r = panelRef.current?.getBoundingClientRect()
    if (!drag || !r) return
    setPos({
      x: Math.min(Math.max(e.clientX - drag.dx, 8 - r.width + 60), window.innerWidth - 60),
      y: Math.min(Math.max(e.clientY - drag.dy, 0), window.innerHeight - 40),
    })
  }
  const onHeadPointerUp = () => {
    dragRef.current = null
  }

  const slide = (key: CrtKey, value: number) => {
    setCrt((c) => ({ ...c, [key]: value }))
    controller.setCrt({ [key]: value })
    savePrefs({ crt: { ...crt, [key]: value } })
  }

  const flashNote = useCallback((text: string) => {
    setNote(text)
    window.clearTimeout(noteTimerRef.current)
    noteTimerRef.current = window.setTimeout(() => setNote(null), 5000)
  }, [])

  const startWebcam = (slot: CamSlot) => {
    controller.useWebcam(slot).catch(() => {
      flashNote('WEBCAM NO DISPONIBLE O PERMISO DENEGADO')
    })
  }

  const toggleSection = (key: SectionKey) => {
    setOpen((current) => {
      const next = { ...current, [key]: !current[key] }
      savePrefs({ open: next })
      return next
    })
  }

  /**
   * Run a scene-destroying action, but only after confirmation while a
   * take is rolling. `id` identifies the armed control so a second click
   * on a *different* button re-arms rather than firing by surprise.
   */
  const guarded = (id: string, run: () => void) => {
    if (!recording) {
      run()
      return
    }
    if (armed !== id) {
      setArmed(id)
      flashNote('GRABANDO — PULSA DE NUEVO PARA CONFIRMAR')
      window.clearTimeout(armTimerRef.current)
      armTimerRef.current = window.setTimeout(() => setArmed(null), 4000)
      return
    }
    setArmed(null)
    run()
  }

  /** Props shared by every guarded button (dim + armed styling). */
  const guardProps = (id: string) => ({
    className: armed === id ? 'armed' : undefined,
    'data-armed': armed === id ? 'true' : undefined,
  })

  const applySpeed = (value: number) => {
    setSpeed(value)
    controller.setSpeed(value)
  }

  const patchStudio = (patch: Partial<StudioEffects>) => {
    setStudioFx((current) => ({ ...current, ...patch }))
    controller.setStudioEffects(patch)
  }

  const applyStudioPreset = (
    preset: Parameters<OSController['applyStudioPreset']>[0],
  ) => {
    controller.applyStudioPreset(preset)
    setStudioFx(controller.getStudioEffects())
  }

  const refreshVrState = () => setVrState(controller.getVrVisionState())

  const patchVr = (patch: Parameters<OSController['setVrVisionSettings']>[0]) => {
    controller.setVrVisionSettings(patch)
    refreshVrState()
  }

  const queueVrDraft = () => {
    if (!vrDraft.trim()) return
    controller.queueVrMessage(vrDraft, vrTone, vrDuration)
    setVrDraft('')
    refreshVrState()
  }

  const sendLog = (level: 'info' | 'danger') => {
    if (!msg.trim()) return
    controller.logLine(msg.trim(), level)
    setMsg('')
  }

  const sendTicker = () => {
    if (!msg.trim()) return
    controller.announce(msg.trim())
    setMsg('')
  }

  // Keyboard: Ctrl chords for the panel/global controls, bare digits for
  // the current scene's cues (the one thing a director fires mid-take,
  // which used to be mouse-only), `?` for the cheat sheet. All stay live
  // while the panel is hidden — hooks run before the early return below.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target
      const typing =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      if (typing) return

      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        if (e.key === '?') {
          e.preventDefault()
          setShowKeys((s) => !s)
          return
        }
        // Bare 1..9 → the nth cue of the current scene.
        const cues = SCENE_ACTIONS[phase]
        const digit = Number(e.key)
        if (cues && digit >= 1 && digit <= Math.min(9, cues.length)) {
          e.preventDefault()
          controller.trigger(cues[digit - 1].id)
        }
        return
      }

      if (!e.ctrlKey) return
      if (e.key.toLowerCase() === 'h') {
        e.preventDefault()
        setHidden((h) => !h)
      }
      if (e.key.toLowerCase() === 'r') {
        e.preventDefault()
        // Never restart from boot mid-take without asking.
        if (controller.isRecording()) {
          flashNote('GRABANDO — CORTA ANTES DE REINICIAR')
          return
        }
        controller.restart()
      }
      if (e.key.toLowerCase() === 'g') {
        e.preventDefault()
        setCountdown(null) // a direct toggle overrides a pending count-in
        if (controller.isRecording()) controller.stopRecording()
        else controller.startRecording()
      }
      if (e.key.toLowerCase() === 'i') {
        e.preventDefault()
        controller.setVision(!controller.isVisionOn())
      }
      const n = Number(e.key)
      if (n >= 1 && n <= PALETTE_ORDER.length) {
        e.preventDefault()
        controller.setTheme(PALETTE_ORDER[n - 1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [controller, phase, flashNote])

  // Restore persisted look/identity once the controller exists. Kept out
  // of the render path so a fresh session still starts on CONFIG values.
  useEffect(() => {
    const prefs = loadPrefs()
    if (prefs.theme && PALETTE_ORDER.includes(prefs.theme)) {
      controller.setTheme(prefs.theme)
    }
    if (prefs.crt) controller.setCrt(prefs.crt)
    if (prefs.movieTitle) {
      controller.setMovieTitle(prefs.movieTitle)
      setMovieTitle(prefs.movieTitle)
    }
    if (prefs.format) controller.setCaptureFormat(prefs.format)
    if (prefs.container) controller.setCaptureContainer(prefs.container)
    if (prefs.autoDownload !== undefined) {
      controller.setAutoDownload(prefs.autoDownload)
    }
    setCrt(controller.getCrt())
    setCapture(controller.getCaptureState())
  }, [controller])

  // Persist the theme whenever it changes upstream (buttons or Ctrl+N).
  useEffect(() => {
    savePrefs({ theme })
  }, [theme])

  // Arming is only meaningful while rolling.
  useEffect(() => {
    if (!recording) setArmed(null)
  }, [recording])

  // Live transport readout: scene timecode + clock mode + REC elapsed.
  // 5 Hz is plenty for a tenths display and costs nothing next to the
  // 60 fps canvas.
  useEffect(() => {
    if (hidden) return
    const id = window.setInterval(() => {
      setClock(controller.getClock())
      // Cue states, loaded footage and capture dims are all things the
      // director needs at a glance; poll them with the timecode.
      setSceneState(controller.getSceneState())
      setSlots(controller.getSlots())
      setCapture(controller.getCaptureState())
      if (phase === 'video-effects') {
        setStudioMedia(controller.getStudioMediaState())
      }
      if (phase === 'hypervigilance') setWallState(controller.getWallState())
      if (phase === 'vr-vision') setVrState(controller.getVrVisionState())
      if (controller.isRecording()) {
        setRecSec((performance.now() - recStartRef.current) / 1000)
      }
    }, 200)
    return () => window.clearInterval(id)
  }, [controller, hidden, phase])

  useEffect(() => {
    if (recording) {
      recStartRef.current = performance.now()
      setRecSec(0)
    }
  }, [recording])

  useEffect(() => {
    if (phase === 'video-effects') {
      setStudioFx(controller.getStudioEffects())
    }
    if (phase === 'vr-vision') setVrState(controller.getVrVisionState())
  }, [controller, phase])

  // Count-in: tick once per second, roll at zero. Escape cancels.
  useEffect(() => {
    if (countdown === null) return
    if (countdown <= 0) {
      setCountdown(null)
      if (countdownMode === 'play') controller.play()
      else controller.startRecording()
      return
    }
    const id = window.setTimeout(() => setCountdown((c) => (c ?? 1) - 1), 1000)
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCountdown(null)
    }
    window.addEventListener('keydown', onEsc)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('keydown', onEsc)
    }
  }, [countdown, countdownMode, controller])

  const pickVideo = (slot: CamSlot) => {
    slotRef.current = slot
    fileRef.current?.click()
  }

  // Folder selection needs the non-standard webkitdirectory attribute,
  // which React won't type — set it imperatively once.
  useEffect(() => {
    for (const el of [folderRef.current, wallFolderRef.current]) {
      if (!el) continue
      el.setAttribute('webkitdirectory', '')
      el.setAttribute('directory', '')
    }
  }, [])

  const loadGallery = (list: FileList | null) => {
    const files = list ? Array.from(list) : []
    if (files.length) controller.loadGalleryImages(files)
  }

  const loadWall = (list: FileList | null) => {
    const files = list ? Array.from(list) : []
    if (files.length === 0) return
    controller.loadWallVideos(files)
    setWallState(controller.getWallState())
  }

  const applyFormat = (format: CaptureFormat) => {
    controller.setCaptureFormat(format)
    setCapture(controller.getCaptureState())
    savePrefs({ format })
  }

  const applyContainer = (container: 'mp4' | 'webm') => {
    controller.setCaptureContainer(container)
    setCapture(controller.getCaptureState())
    savePrefs({ container })
  }

  const toggleAudio = () => {
    const next = !capture.audio
    controller
      .setAudioCapture(next)
      .then(() => setCapture(controller.getCaptureState()))
      .catch(() => flashNote('MICRÓFONO NO DISPONIBLE O PERMISO DENEGADO'))
  }

  const toggleAutoDownload = () => {
    const next = !capture.autoDownload
    controller.setAutoDownload(next)
    setCapture(controller.getCaptureState())
    savePrefs({ autoDownload: next })
  }

  const applyGeoLocation = () => {
    const lat = Number(geoLat)
    const lon = Number(geoLon)
    if (!Number.isFinite(lat) || Math.abs(lat) > 90) {
      flashNote('LATITUD FUERA DE RANGO (−90 A 90)')
      return
    }
    if (!Number.isFinite(lon) || Math.abs(lon) > 180) {
      flashNote('LONGITUD FUERA DE RANGO (−180 A 180)')
      return
    }
    controller.setGeoLocation(lat, lon, geoName)
    setGeoLat('')
    setGeoLon('')
    setGeoName('')
  }

  const countInOverlay =
    countdown !== null && countdown > 0
      ? createPortal(
          <button
            type="button"
            className="rec-countdown"
            title="Cancelar cuenta atrás (Esc)"
            onClick={() => setCountdown(null)}
          >
            <span className="rec-countdown-num">{countdown}</span>
            <span className="rec-countdown-hint">
              {countdownMode === 'play'
                ? 'REPRODUCCIÓN'
                : `TOMA ${String(controller.getTake() + 1).padStart(2, '0')}`}{' '}
              — clic o Esc para cancelar
            </span>
          </button>,
          document.body,
        )
      : null

  const keysOverlay = showKeys ? (
    <KeysOverlay phase={phase} onClose={() => setShowKeys(false)} />
  ) : null

  if (hidden) {
    return (
      <Fragment>
        {countInOverlay}
        {keysOverlay}
      </Fragment>
    )
  }

  return (
    <div
      className="ctrl"
      ref={panelRef}
      style={
        pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined
      }
    >
      {countInOverlay}
      {keysOverlay}
      <div
        className="ctrl-row ctrl-head"
        title="Arrastra para mover el panel"
        onPointerDown={onHeadPointerDown}
        onPointerMove={onHeadPointerMove}
        onPointerUp={onHeadPointerUp}
        onPointerCancel={onHeadPointerUp}
      >
        <span className="ctrl-title">DIRECCIÓN</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="ctrl-x"
          title="Atajos de teclado (?)"
          aria-label="Ver atajos de teclado"
          onClick={() => setShowKeys(true)}
        >
          ?
        </button>
        <button
          type="button"
          className="ctrl-x"
          title="Ocultar (Ctrl+H)"
          aria-label="Ocultar panel de dirección (Ctrl+H)"
          onClick={() => setHidden(true)}
        >
          ⨯
        </button>
      </div>

      <div className="ctrl-row">
        <span className="ctrl-label">TOMA</span>
        <button
          type="button"
          className={recording ? 'rec on' : 'rec'}
          title="Grabar/cortar el lienzo (Ctrl+G)"
          onClick={() => {
            setCountdown(null)
            if (recording) controller.stopRecording()
            else controller.startRecording()
          }}
        >
          {recording ? '■ CORTAR' : '● GRABAR'}
        </button>
        {!recording && (
          <button
            type="button"
            className={countdown !== null ? 'rec on' : 'rec'}
            title={`Graba tras una cuenta atrás de ${countIn} s (para entrar a cuadro)`}
            onClick={() =>
              setCountdown((c) => {
                setCountdownMode('record')
                return c === null ? countIn : null
              })
            }
          >
            {countdown !== null ? `● EN ${countdown}…` : `● EN ${countIn}S`}
          </button>
        )}
        <button
          type="button"
          title="Descarga un PNG del lienzo"
          onClick={() => controller.screenshot()}
        >
          FOTO
        </button>
        {recording ? (
          <span className="ctrl-note">
            TOMA {String(controller.getTake()).padStart(2, '0')} ·{' '}
            {fmtMMSS(recSec)}
          </span>
        ) : (
          <span className="ctrl-dim" title="Número de la próxima toma">
            PRÓX T{String(controller.getTake() + 1).padStart(2, '0')}
          </span>
        )}
        <span
          className="ctrl-dim"
          title="Resolución y contenedor reales de la grabación"
        >
          {capture.width}×{capture.height} ·{' '}
          {(capture.effectiveContainer ?? 'SIN CODEC').toUpperCase()}
          {capture.audio ? ' · AUDIO' : ''}
        </span>
      </div>

      {phase === 'video-effects' && (
        <div className="ctrl-row">
          <span className="ctrl-label">MEDIA</span>
          <span className="ctrl-tc" title={studioMedia.label}>
            {fmtMMSS(studioMedia.currentTime)} / {fmtMMSS(studioMedia.duration)}
          </span>
          <input
            className="ctrl-scrub"
            type="range"
            aria-label="Posición del video"
            min={0}
            max={Math.max(studioMedia.duration, 0.01)}
            step={0.01}
            value={Math.min(studioMedia.currentTime, studioMedia.duration || 0)}
            disabled={!studioMedia.ready || studioMedia.duration <= 0}
            onChange={(event) => controller.seek(Number(event.target.value))}
          />
          <span className={studioMedia.ready ? 'ctrl-dim' : 'ctrl-note'}>
            {studioMedia.ready ? studioMedia.label : 'SIN VIDEO'}
          </span>
          <button
            type="button"
            disabled={!studioMedia.ready}
            title="Reproducir tras una cuenta atrás de 3 s"
            onClick={() => {
              controller.pause()
              setCountdownMode('play')
              setCountdown(3)
            }}
          >
            ▶ EN 3S
          </button>
        </div>
      )}

      {phase === 'vr-vision' && (
        <div className="vr-controls">
          <div className="ctrl-row">
            <span className="ctrl-label">VISOR</span>
            {VR_FRAME_STYLES.map((style: VrFrameStyle) => (
              <button
                type="button"
                key={style}
                className={vrState.settings.frameStyle === style ? 'on' : ''}
                onClick={() => patchVr({ frameStyle: style })}
              >
                {{
                  optical: 'ÓPTICO',
                  mechanical: 'MECÁNICO',
                  photographic: 'FOTO',
                  clinical: 'CLÍNICO',
                }[style]}
              </button>
            ))}
          </div>
          <div className="ctrl-row">
            <span className="ctrl-label">CAPAS</span>
            <button
              type="button"
              className={vrState.settings.showObjects ? 'on' : ''}
              onClick={() => patchVr({ showObjects: !vrState.settings.showObjects })}
            >
              OBJETOS
            </button>
            <button
              type="button"
              className={vrState.settings.showFaces ? 'on' : ''}
              onClick={() => patchVr({ showFaces: !vrState.settings.showFaces })}
            >
              ROSTROS
            </button>
            <button
              type="button"
              className={vrState.settings.showTelemetry ? 'on' : ''}
              onClick={() => patchVr({ showTelemetry: !vrState.settings.showTelemetry })}
            >
              TELEMETRÍA
            </button>
          </div>
          <div className="ctrl-row vr-compose">
            <span className="ctrl-label">LÍNEA</span>
            <textarea
              className="ctrl-text vr-draft"
              value={vrDraft}
              maxLength={240}
              rows={2}
              placeholder="línea para el sujeto…"
              onChange={(event) => setVrDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault()
                  queueVrDraft()
                }
                if (event.key === 'Escape') event.currentTarget.blur()
              }}
            />
            <select
              value={vrTone}
              aria-label="Tono de la línea"
              onChange={(event) => setVrTone(event.target.value as VrMessageTone)}
            >
              <option value="info">NEUTRA</option>
              <option value="warn">AVISO</option>
              <option value="danger">ALERTA</option>
            </select>
            <select
              value={vrDuration}
              aria-label="Duración de la línea"
              onChange={(event) => setVrDuration(Number(event.target.value))}
            >
              {[3, 6, 10, 15].map((seconds) => (
                <option key={seconds} value={seconds}>{seconds}S</option>
              ))}
            </select>
            <button type="button" onClick={queueVrDraft}>AÑADIR</button>
          </div>
          {vrState.active && (
            <div className="ctrl-row vr-active">
              <span className="ctrl-label">AL AIRE</span>
              <span className="vr-line-text">{vrState.active.text}</span>
              <button
                type="button"
                onClick={() => {
                  controller.dismissVrMessage()
                  refreshVrState()
                }}
              >
                QUITAR
              </button>
            </div>
          )}
          {vrState.queue.map((message, index) => (
            <div className="ctrl-row vr-cue" key={message.id}>
              <span className="ctrl-label">Q{index + 1}</span>
              <span className="vr-line-text">{message.text}</span>
              <span className="ctrl-dim">{message.duration}S</span>
              <button
                type="button"
                onClick={() => {
                  controller.sendVrMessage(message.id)
                  refreshVrState()
                }}
              >
                ENVIAR
              </button>
              <button
                type="button"
                title="Eliminar de la cola"
                aria-label="Eliminar línea de la cola"
                onClick={() => {
                  controller.removeVrMessage(message.id)
                  refreshVrState()
                }}
              >
                ×
              </button>
            </div>
          ))}
          {vrState.history.length > 0 && (
            <div className="ctrl-row vr-history">
              <span className="ctrl-label">HIST.</span>
              {vrState.history.slice(0, 4).map((message) => (
                <button
                  type="button"
                  key={`${message.id}-${message.createdAt}`}
                  title={message.text}
                  onClick={() => {
                    controller.replayVrMessage(message.id)
                    refreshVrState()
                  }}
                >
                  REPETIR {message.text.slice(0, 18)}{message.text.length > 18 ? '…' : ''}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  controller.clearVrHistory()
                  refreshVrState()
                }}
              >
                LIMPIAR
              </button>
            </div>
          )}
        </div>
      )}

      {takes.length > 0 && (
        <div className="ctrl-takes">
          {takes.map((t) => (
            <Fragment key={t.url}>
              <div className={t.kept ? 'ctrl-take kept' : 'ctrl-take'}>
                <span
                  className="ctrl-take-name"
                  title={`${t.name} · ${t.width}×${t.height}${t.hasAudio ? ' · audio' : ''}`}
                >
                  {t.kept ? '◎ ' : ''}T{String(t.take).padStart(2, '0')} ·{' '}
                  {t.scene} · {fmtMMSS(t.seconds)} · {fmtBytes(t.bytes)}
                </span>
                <button
                  type="button"
                  className={reviewing === t.url ? 'on' : ''}
                  title="Revisar aquí mismo"
                  onClick={() =>
                    setReviewing((current) => (current === t.url ? null : t.url))
                  }
                >
                  VER
                </button>
                {/* Circled take: saves to disk and marks it a keeper. */}
                <a
                  className="ctrl-take-dl"
                  href={t.url}
                  download={t.name}
                  title="Marcar como buena y guardar en disco"
                  onClick={() => onKeepTake(t.url)}
                >
                  ◎ BUENA
                </a>
                <button
                  type="button"
                  className="ctrl-take-x"
                  title="NG: descartar la toma y liberar memoria"
                  aria-label={`Descartar toma ${t.take}`}
                  onClick={() => {
                    if (reviewing === t.url) setReviewing(null)
                    onDiscardTake(t.url)
                  }}
                >
                  NG
                </button>
              </div>
              {reviewing === t.url && (
                <video
                  className="ctrl-take-preview"
                  src={t.url}
                  controls
                  autoPlay
                  playsInline
                />
              )}
            </Fragment>
          ))}
          {!capture.autoDownload && (
            <span className="ctrl-take-meta">
              las tomas no se guardan solas — ◎ BUENA las baja
            </span>
          )}
        </div>
      )}

      {/* Scene jumps rebuild the scene, so they're guarded while rolling:
          this row used to sit one mis-click away from GRABAR. */}
      <div className={recording ? 'ctrl-row ctrl-guarded' : 'ctrl-row'}>
        <span className="ctrl-label">ESCENA</span>
        {PHASE_ORDER.map((id) => (
          <button
            type="button"
            key={id}
            className={
              id === phase
                ? 'on'
                : armed === `phase-${id}`
                  ? 'armed'
                  : undefined
            }
            title={
              recording && id !== phase
                ? 'Grabando: pulsa dos veces para cambiar de escena'
                : undefined
            }
            onClick={() =>
              guarded(`phase-${id}`, () => controller.setPhase(id))
            }
          >
            {PHASE_LABELS[id]}
          </button>
        ))}
      </div>

      {/* Cues are performance controls: never guarded, always hotkeyed
          (bare 1-9), and mode cues show their state. */}
      {SCENE_ACTIONS[phase] && (
        <div className="ctrl-row">
          <span className="ctrl-label">CUES</span>
          {SCENE_ACTIONS[phase]!.map((cue, i) => (
            <button
              type="button"
              key={cue.id}
              className={cue.active?.(sceneState) ? 'on' : undefined}
              title={
                i < 9 ? `${cue.title ?? cue.label} · tecla ${i + 1}` : cue.title
              }
              onClick={() => controller.trigger(cue.id)}
            >
              {i < 9 && <i className="ctrl-key">{i + 1}</i>}
              {cue.label}
            </button>
          ))}
        </div>
      )}

      {/* Scene readout: the modes and counters that only lived on canvas. */}
      {Object.keys(sceneState).length > 0 && (
        <div className="ctrl-row">
          <span className="ctrl-label">ESTADO</span>
          <span className="ctrl-dim">
            {Object.entries(sceneState)
              .map(([key, value]) => {
                const shown =
                  typeof value === 'boolean' ? (value ? 'SÍ' : 'NO') : value
                return `${key.toUpperCase()}: ${shown}`
              })
              .join(' · ')}
          </span>
        </div>
      )}

      {phase === 'geo' && (
        <div className="ctrl-row">
          <span className="ctrl-label">UBICAR</span>
          <input
            type="text"
            className="ctrl-text"
            style={{ minWidth: 70, flex: '0 1 80px' }}
            placeholder="lat"
            value={geoLat}
            onChange={(e) => setGeoLat(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyGeoLocation()
              if (e.key === 'Escape') e.currentTarget.blur()
            }}
          />
          <input
            type="text"
            className="ctrl-text"
            style={{ minWidth: 70, flex: '0 1 80px' }}
            placeholder="lon"
            value={geoLon}
            onChange={(e) => setGeoLon(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyGeoLocation()
              if (e.key === 'Escape') e.currentTarget.blur()
            }}
          />
          <input
            type="text"
            className="ctrl-text"
            style={{ minWidth: 90 }}
            placeholder="nombre del operativo"
            value={geoName}
            maxLength={40}
            onChange={(e) => setGeoName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyGeoLocation()
              if (e.key === 'Escape') e.currentTarget.blur()
            }}
          />
          <button type="button" onClick={applyGeoLocation}>
            IR
          </button>
        </div>
      )}

      {phase === 'video-effects' && (
        <>
          <div className="ctrl-row">
            <span className="ctrl-label">PRESET</span>
            {(['clean', 'identify', 'glitch', 'privacy', 'night'] as const).map(
              (preset) => (
                <button
                  type="button"
                  key={preset}
                  onClick={() => applyStudioPreset(preset)}
                >
                  {preset.toUpperCase()}
                </button>
              ),
            )}
          </div>
          <div className="ctrl-row">
            <span className="ctrl-label">VISTA</span>
            <button
              type="button"
              className={studioFx.fit === 'cover' ? 'on' : ''}
              onClick={() => patchStudio({ fit: 'cover' })}
            >
              LLENAR
            </button>
            <button
              type="button"
              className={studioFx.fit === 'contain' ? 'on' : ''}
              onClick={() => patchStudio({ fit: 'contain' })}
            >
              AJUSTAR
            </button>
            <button
              type="button"
              className={studioFx.mirror ? 'on' : ''}
              onClick={() => patchStudio({ mirror: !studioFx.mirror })}
            >
              ESPEJO
            </button>
            <button
              type="button"
              className={studioFx.overlays ? 'on' : ''}
              onClick={() => patchStudio({ overlays: !studioFx.overlays })}
            >
              OBJETOS
            </button>
            <button
              type="button"
              className={studioFx.trails ? 'on' : ''}
              onClick={() => patchStudio({ trails: !studioFx.trails })}
            >
              RASTROS
            </button>
            <button
              type="button"
              className={studioFx.identify ? 'on' : ''}
              onClick={() => patchStudio({ identify: !studioFx.identify })}
            >
              IDENTIFY
            </button>
          </div>
          <div className="ctrl-row ctrl-fx-bank">
            <span className="ctrl-label">EFECTOS</span>
            {STUDIO_SLIDERS.map(({ key, label, min, max, step }) => (
              <label key={key} className="ctrl-slider" title={label}>
                <span>{label}</span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={studioFx[key] as number}
                  onChange={(event) =>
                    patchStudio({ [key]: Number(event.target.value) })
                  }
                />
              </label>
            ))}
          </div>
        </>
      )}

      <div className="ctrl-row">
        <span className="ctrl-label">TIEMPO</span>
        <span
          className="ctrl-tc"
          title="Reloj de escena (se reinicia al cambiar de escena)"
        >
          {fmtTimecode(clock.time)}
        </span>
        <button
          type="button"
          className={clock.mode === 'realtime' ? 'on' : ''}
          onClick={() => controller.play()}
        >
          ▶ PLAY
        </button>
        <button
          type="button"
          className={clock.mode === 'paused' ? 'on' : ''}
          onClick={() => controller.pause()}
        >
          ❚❚ PAUSA
        </button>
        <button type="button" title="Avanza un fotograma" onClick={() => controller.step()}>
          +1F
        </button>
        <button type="button" title="Avanza un segundo" onClick={() => controller.step(1)}>
          +1S
        </button>
        <button
          type="button"
          title="Reinicia el reloj de escena a 0"
          onClick={() => controller.seek(0)}
        >
          RESET
        </button>
        <label className="ctrl-slider" title="Velocidad de reproducción">
          <span>VEL {speed.toFixed(2)}×</span>
          <input
            type="range"
            min={0}
            max={4}
            step={0.25}
            value={speed}
            onChange={(e) => applySpeed(Number(e.target.value))}
          />
        </label>
        {speed !== 1 && (
          <button
            type="button"
            title="Vuelve a velocidad normal"
            onClick={() => applySpeed(1)}
          >
            1×
          </button>
        )}
      </div>

      {note && <div className="ctrl-err">{note}</div>}

      <SectionHead
        id="captura"
        open={open.captura}
        onToggle={toggleSection}
        summary={`${CAPTURE_FORMATS[capture.format].label} · ${(capture.effectiveContainer ?? '—').toUpperCase()}`}
      />
      {open.captura && (
        <>
          {/* Fixed formats keep every take of the shoot frame-identical. */}
          <div className={recording ? 'ctrl-row ctrl-guarded' : 'ctrl-row'}>
            <span className="ctrl-label">FORMATO</span>
            {(Object.keys(CAPTURE_FORMATS) as CaptureFormat[]).map((key) => (
              <button
                type="button"
                key={key}
                className={
                  capture.format === key
                    ? 'on'
                    : armed === `fmt-${key}`
                      ? 'armed'
                      : undefined
                }
                title={
                  CAPTURE_FORMATS[key].w > 0
                    ? `${CAPTURE_FORMATS[key].w}×${CAPTURE_FORMATS[key].h} — el lienzo se escala con bandas`
                    : 'El lienzo sigue el tamaño de la ventana'
                }
                onClick={() => guarded(`fmt-${key}`, () => applyFormat(key))}
              >
                {CAPTURE_FORMATS[key].label}
              </button>
            ))}
          </div>
          <div className="ctrl-row">
            <span className="ctrl-label">ARCHIVO</span>
            {(['mp4', 'webm'] as const).map((c) => (
              <button
                type="button"
                key={c}
                className={capture.container === c ? 'on' : undefined}
                title={
                  c === 'mp4'
                    ? 'H.264 — entra directo en cualquier editor'
                    : 'VP9/VP8 — respaldo si el navegador no codifica MP4'
                }
                onClick={() => applyContainer(c)}
              >
                {c.toUpperCase()}
              </button>
            ))}
            <button
              type="button"
              className={capture.audio ? 'on' : undefined}
              title="Graba el micrófono junto al lienzo (audio de referencia para sincronizar)"
              onClick={toggleAudio}
            >
              {capture.audio ? 'AUDIO ON' : 'AUDIO OFF'}
            </button>
            <button
              type="button"
              className={capture.autoDownload ? 'on' : undefined}
              title="Guardar cada toma al cortar, sin revisarla"
              onClick={toggleAutoDownload}
            >
              {capture.autoDownload ? 'AUTO-GUARDA' : 'REVISAR 1º'}
            </button>
            <label className="ctrl-slider" title="Duración de la cuenta atrás">
              <span>CUENTA {countIn}S</span>
              <input
                type="range"
                min={0}
                max={COUNT_IN_OPTIONS.length - 1}
                step={1}
                value={COUNT_IN_OPTIONS.indexOf(countIn)}
                onChange={(e) => {
                  const next = COUNT_IN_OPTIONS[Number(e.target.value)]
                  setCountIn(next)
                  savePrefs({ countIn: next })
                }}
              />
            </label>
          </div>
        </>
      )}

      <SectionHead
        id="media"
        open={open.media}
        onToggle={toggleSection}
        summary={
          slots.length > 0
            ? slots
                .map((s) => `${s.slot.replace('cam-', '').toUpperCase()}:${s.label}`)
                .join(' ')
            : 'sin cámaras en esta escena'
        }
      />
      {open.media && (
        <>
          {VIDEO_TARGETS[phase] && (
            <div className="ctrl-row">
              <span className="ctrl-label">VIDEO</span>
              {VIDEO_TARGETS[phase]!.map(({ slot, label }) => (
                <Fragment key={slot}>
                  <button type="button" onClick={() => pickVideo(slot)}>
                    ARCHIVO→{label}
                  </button>
                  <button type="button" onClick={() => startWebcam(slot)}>
                    WEBCAM→{label}
                  </button>
                  {/* Per-slot clear: LIMPIAR used to wipe every slot. */}
                  <button
                    type="button"
                    title={`Devuelve ${label} a estático`}
                    onClick={() => controller.clearFeed(slot)}
                  >
                    ⨯{label}
                  </button>
                </Fragment>
              ))}
            </div>
          )}
          {slots.length > 0 && (
            <div className="ctrl-row">
              <span className="ctrl-label">CARGADO</span>
              <span className="ctrl-dim">
                {slots
                  .map((s) => `${s.slot.toUpperCase()} → ${s.label}`)
                  .join(' · ')}
              </span>
            </div>
          )}
          {phase === 'gallery' && (
            <div className="ctrl-row">
              <span className="ctrl-label">FICHAS</span>
              <button type="button" onClick={() => imagesRef.current?.click()}>
                CARGAR IMÁGENES
              </button>
              <button type="button" onClick={() => folderRef.current?.click()}>
                CARGAR CARPETA
              </button>
            </div>
          )}
          {phase === 'hypervigilance' && (
            <>
              <div className="ctrl-row">
                <span className="ctrl-label">MURO</span>
                <button
                  type="button"
                  title="Carga una carpeta entera de video en el muro"
                  onClick={() => wallFolderRef.current?.click()}
                >
                  CARGAR CARPETA
                </button>
                <button
                  type="button"
                  title="Elige clips sueltos para el muro"
                  onClick={() => wallRef.current?.click()}
                >
                  CARGAR CLIPS
                </button>
                <button
                  type="button"
                  title="Vacía el muro: todas las pantallas a estático"
                  onClick={() => controller.clearWallVideos()}
                >
                  ⨯ MURO
                </button>
              </div>
              <div className="ctrl-row">
                <span className="ctrl-label">CLIPS</span>
                <span className="ctrl-dim">
                  {wallState.clips === 0
                    ? 'sin material — arrastra una carpeta de video al lienzo'
                    : `${wallState.cursor}/${wallState.clips} · ${wallState.assigned[0] ?? '—'}`}
                </span>
              </div>
              <div className="ctrl-row">
                <label className="ctrl-slider" title="Pantallas del muro (1 = un clip a la vez)">
                  <span>PANTALLAS {wallScreens}</span>
                  <input
                    type="range"
                    min={1}
                    max={9}
                    step={1}
                    value={wallScreens}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      setWallScreens(n)
                      controller.setWallScreens(n)
                    }}
                  />
                </label>
                <label className="ctrl-slider" title="Segundos que cada pantalla aguanta un clip">
                  <span>RITMO {wallState.holdSeconds.toFixed(1)}S</span>
                  <input
                    type="range"
                    min={0.5}
                    max={20}
                    step={0.5}
                    value={wallState.holdSeconds}
                    onChange={(e) =>
                      controller.setWallPace({ holdSeconds: Number(e.target.value) })
                    }
                  />
                </label>
                <label
                  className="ctrl-slider"
                  title="Desfase entre cortes de pantallas vecinas (0 = todas cortan juntas)"
                >
                  <span>DESFASE {wallState.stagger.toFixed(1)}S</span>
                  <input
                    type="range"
                    min={0}
                    max={4}
                    step={0.1}
                    value={wallState.stagger}
                    onChange={(e) =>
                      controller.setWallPace({ stagger: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
            </>
          )}
          <div className="ctrl-row">
            <span className="ctrl-label">VISIÓN</span>
            <button
              type="button"
              className={vision ? 'on' : ''}
              title="Detección y rastreo de objetos en los feeds de video (Ctrl+I)"
              onClick={() => controller.setVision(!vision)}
            >
              {vision ? 'IA ACTIVA' : 'IA APAGADA'}
            </button>
          </div>
        </>
      )}

      <SectionHead
        id="look"
        open={open.look}
        onToggle={toggleSection}
        summary={PALETTES[theme].label}
      />
      {open.look && (
        <>
          <div className="ctrl-row">
            <span className="ctrl-label">TEMA</span>
            {PALETTE_ORDER.map((key, i) => (
              <button
                type="button"
                key={key}
                className={key === theme ? 'on' : ''}
                title={`${PALETTES[key].label} (Ctrl+${i + 1})`}
                style={{ ['--sw' as string]: PALETTES[key].fg }}
                onClick={() => controller.setTheme(key)}
              >
                <i className="sw" />
                {key.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="ctrl-row">
            <span className="ctrl-label">AMBIENTE</span>
            {CRT_SLIDERS.map(({ key, label, max }) => (
              <label key={key} className="ctrl-slider" title={label}>
                {/* Numeric readout: a look is reproducible now. */}
                <span>
                  {label} {crt[key].toFixed(max > 0.5 ? 2 : 3)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={max}
                  step={max / 100}
                  value={crt[key]}
                  onChange={(e) => slide(key, Number(e.target.value))}
                />
              </label>
            ))}
            <button type="button" onClick={() => controller.glitchBurst()}>
              RÁFAGA
            </button>
            <button
              type="button"
              title="Vuelve al look de fábrica"
              onClick={() => {
                const next = controller.resetCrt()
                setCrt(next)
                savePrefs({ crt: next })
              }}
            >
              RESET LOOK
            </button>
          </div>
          <div className="ctrl-row">
            <span className="ctrl-label">TÍTULO</span>
            <input
              type="text"
              className="ctrl-text"
              title="Aparece en la cinemática, en la claqueta y en el nombre de archivo"
              value={movieTitle}
              maxLength={60}
              onChange={(e) => {
                setMovieTitle(e.target.value)
                controller.setMovieTitle(e.target.value)
                savePrefs({ movieTitle: e.target.value })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') e.currentTarget.blur()
              }}
            />
            <button
              type="button"
              onClick={() => {
                setMovieTitle('HYPERVIGILANCE')
                controller.setMovieTitle('HYPERVIGILANCE')
                savePrefs({ movieTitle: 'HYPERVIGILANCE' })
              }}
            >
              DEFAULT
            </button>
          </div>
        </>
      )}

      <SectionHead
        id="inyectar"
        open={open.inyectar}
        onToggle={toggleSection}
        summary="registro · aviso"
      />
      {open.inyectar && (
        <div className="ctrl-row">
          <span className="ctrl-label">MENSAJE</span>
          <input
            type="text"
            className="ctrl-text"
            placeholder="texto para registro / aviso…"
            value={msg}
            maxLength={80}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') sendLog('info')
              // Escape hands the keyboard back to the OS canvas.
              if (e.key === 'Escape') e.currentTarget.blur()
            }}
          />
          <button type="button" onClick={() => sendLog('info')}>
            REGISTRO
          </button>
          <button type="button" onClick={() => sendLog('danger')}>
            ALERTA
          </button>
          <button type="button" onClick={sendTicker}>
            AVISO
          </button>
        </div>
      )}

      <SectionHead
        id="sistema"
        open={open.sistema}
        onToggle={toggleSection}
        summary="recarga · ventanas · tomas"
      />
      {open.sistema && (
        <div className={recording ? 'ctrl-row ctrl-guarded' : 'ctrl-row'}>
          <span className="ctrl-label">RECARGA</span>
          <button
            type="button"
            title="Reordena las ventanas sin descartar el video cargado"
            {...guardProps('relayout')}
            onClick={() => guarded('relayout', () => controller.relayout())}
          >
            ORDENAR VENTANAS
          </button>
          <button
            type="button"
            title="Reconstruye la escena actual"
            {...guardProps('reload-scene')}
            onClick={() =>
              guarded('reload-scene', () => controller.reloadScene())
            }
          >
            ESCENA
          </button>
          <button
            type="button"
            title="Descarta los videos activos (y el bin) y reconstruye la escena"
            {...guardProps('reload-media')}
            onClick={() =>
              guarded('reload-media', () => controller.reloadMedia())
            }
          >
            MEDIA
          </button>
          <button
            type="button"
            title="Reconstruye la escena y reinicia la numeración de tomas"
            {...guardProps('reset-take')}
            onClick={() => guarded('reset-take', () => controller.resetTake())}
          >
            TOMA 0
          </button>
          <button
            type="button"
            title="Vuelve al arranque (BOOT)"
            {...guardProps('restart')}
            onClick={() => guarded('restart', () => controller.restart())}
          >
            REINICIAR
          </button>
        </div>
      )}

      <div className="ctrl-hint">
        {recording ? (
          <span className="ctrl-warn">
            GRABANDO — cambios de escena y recargas piden confirmación
          </span>
        ) : (
          <>
            cues con teclas 1-9 · <b>?</b> atajos · arrastra ventanas por su
            barra de título · video al lienzo → cámara de la escena
          </>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) controller.loadVideoFile(f, slotRef.current)
          e.target.value = ''
        }}
      />

      <input
        ref={imagesRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          loadGallery(e.target.files)
          e.target.value = ''
        }}
      />

      <input
        ref={folderRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          loadGallery(e.target.files)
          e.target.value = ''
        }}
      />

      <input
        ref={wallRef}
        type="file"
        accept="video/*"
        multiple
        hidden
        onChange={(e) => {
          loadWall(e.target.files)
          e.target.value = ''
        }}
      />

      {/* Folder pick: no accept filter — a directory hands over every file
          it contains and the wall does its own video filtering. */}
      <input
        ref={wallFolderRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          loadWall(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
