/**
 * ControlPanel.tsx — Director's off-camera controls.
 *
 * Not part of the fiction: a collapsible strip for staging takes —
 * jump phases, switch color themes live, pipe video files / webcam into
 * the surveillance slots, dial the CRT ambience, inject log lines and
 * status-bar directives, and capture stills / WebM takes. Only the
 * canvas is captured, so the panel never shows up in footage; hide it
 * with the ⨯ or Ctrl+H anyway if it distracts.
 *
 * Layout mirrors the filming workflow: TOMA (record/cut, count-in,
 * still, session take list) sits on top because it's the highest-stakes
 * control; staging (ESCENA/CUES/TIEMPO) follows; look-and-feel and
 * injection rows come after.
 */

import { Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  CamSlot,
  OSController,
  SavedTake,
  SceneAction,
  StudioMediaState,
} from '../os/OSApp'
import type { OSPhase } from '../os/core/SceneManager'
import type { OSConfig } from '../os/config/config'
import type { DirectorClockState } from '../os/core/context'
import { PALETTES, PALETTE_ORDER, type PaletteKey } from '../os/config/theme'
import type { StudioEffects } from '../os/widgets/VideoEffectsStudio'

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
}

// One-shot cues per scene; the row only shows what the current scene
// can respond to (see SceneAction in OSApp).
const SCENE_ACTIONS: Partial<
  Record<OSPhase, { id: SceneAction; label: string; title?: string }[]>
> = {
  desktop: [
    { id: 'cam-mark', label: 'IDENTIFICAR', title: 'Banner "sujeto identificado" en CAM-A' },
    { id: 'targets-up', label: '+SUJETO', title: 'Más objetivos simulados en cuadro' },
    { id: 'targets-down', label: '−SUJETO', title: 'Menos objetivos simulados en cuadro' },
  ],
  map: [
    { id: 'map-new-target', label: 'MOVER OBJETIVO' },
    { id: 'map-chase', label: 'PERSECUCIÓN', title: 'Las unidades convergen sobre el objetivo' },
    { id: 'map-patrol', label: 'PATRULLA', title: 'Las unidades vuelven a rondar' },
    { id: 'map-add-unit', label: '+UNIDAD' },
    { id: 'map-remove-unit', label: '−UNIDAD' },
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
    { id: 'board-xray', label: 'RAYOS-X', title: 'Cobre brillante, componentes fantasma' },
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
  silence: [{ slot: 'silence', label: 'SILENCE' }],
}

const PHASES: { id: OSPhase; label: string }[] = [
  { id: 'boot', label: 'BOOT' },
  { id: 'login', label: 'LOGIN' },
  { id: 'hypervigilance', label: 'HYPERVIGILANCIA' },
  { id: 'desktop', label: 'VIGILANCIA' },
  { id: 'map', label: 'MAPA' },
  { id: 'sensors', label: 'SENSORES' },
  { id: 'call', label: 'LLAMADA' },
  { id: 'chip', label: 'CHIP' },
  { id: 'board', label: 'PLACA' },
  { id: 'implant', label: 'IMPLANTE' },
  { id: 'loyalty', label: 'LEALTAD' },
  { id: 'analysis', label: 'ANÁLISIS' },
  { id: 'video-effects', label: 'FX STUDIO' },
  { id: 'silence', label: 'SILENCE' },
]

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
  // Count-in before rolling (null = idle). Lets a solo operator hit
  // record and get in front of the camera before the slate burns in.
  const [countdown, setCountdown] = useState<number | null>(null)
  const [countdownMode, setCountdownMode] = useState<'record' | 'play'>('record')
  // Transient feedback for async failures (webcam denied/unavailable).
  const [note, setNote] = useState<string | null>(null)
  // Panel position: null = CSS default (bottom-right); set once dragged.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const slotRef = useRef<CamSlot>('cam-a')
  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const recStartRef = useRef(0)
  const noteTimerRef = useRef(0)

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
  }

  const flashNote = (text: string) => {
    setNote(text)
    window.clearTimeout(noteTimerRef.current)
    noteTimerRef.current = window.setTimeout(() => setNote(null), 5000)
  }

  const startWebcam = (slot: CamSlot) => {
    controller.useWebcam(slot).catch(() => {
      flashNote('WEBCAM NO DISPONIBLE O PERMISO DENEGADO')
    })
  }

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

  // Ctrl+H toggles the panel; Ctrl+G toggles recording; Ctrl+1..5 themes.
  // These stay live while the panel is hidden (hooks run before the
  // early return below).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return
      const target = e.target
      const typing =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      if (typing) return
      if (e.key.toLowerCase() === 'h') {
        e.preventDefault()
        setHidden((h) => !h)
      }
      if (e.key.toLowerCase() === 'r') {
        e.preventDefault()
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
  }, [controller])

  // Live transport readout: scene timecode + clock mode + REC elapsed.
  // 5 Hz is plenty for a tenths display and costs nothing next to the
  // 60 fps canvas.
  useEffect(() => {
    if (hidden) return
    const id = window.setInterval(() => {
      setClock(controller.getClock())
      if (phase === 'video-effects') {
        setStudioMedia(controller.getStudioMediaState())
      }
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

  if (hidden) return <Fragment>{countInOverlay}</Fragment>

  return (
    <div
      className="ctrl"
      ref={panelRef}
      style={
        pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined
      }
    >
      {countInOverlay}
      <div
        className="ctrl-row ctrl-head"
        title="Arrastra para mover el panel"
        onPointerDown={onHeadPointerDown}
        onPointerMove={onHeadPointerMove}
        onPointerUp={onHeadPointerUp}
        onPointerCancel={onHeadPointerUp}
      >
        <span className="ctrl-title">DIRECCIÓN</span>
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
            title="Graba tras una cuenta atrás de 3 s (para entrar a cuadro)"
            onClick={() =>
              setCountdown((c) => {
                setCountdownMode('record')
                return c === null ? 3 : null
              })
            }
          >
            {countdown !== null ? `● EN ${countdown}…` : '● EN 3S'}
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

      {takes.length > 0 && (
        <div className="ctrl-takes">
          {takes.map((t) => (
            <div className="ctrl-take" key={t.url}>
              <span className="ctrl-take-name">
                T{String(t.take).padStart(2, '0')} · {fmtMMSS(t.seconds)} ·{' '}
                {fmtBytes(t.bytes)}
              </span>
              <button
                type="button"
                title="Revisar la toma en una pestaña nueva"
                onClick={() => window.open(t.url, '_blank')}
              >
                VER
              </button>
              <a className="ctrl-take-dl" href={t.url} download={t.name}>
                BAJAR
              </a>
              <button
                type="button"
                className="ctrl-take-x"
                title="Quitar de la lista (el archivo ya descargado no se borra)"
                aria-label={`Quitar toma ${t.take} de la lista`}
                onClick={() => onDiscardTake(t.url)}
              >
                ⨯
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="ctrl-row">
        <span className="ctrl-label">ESCENA</span>
        {PHASES.map(({ id, label }) => (
          <button
            type="button"
            key={id}
            className={id === phase ? 'on' : ''}
            onClick={() => controller.setPhase(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {SCENE_ACTIONS[phase] && (
        <div className="ctrl-row">
          <span className="ctrl-label">CUES</span>
          {SCENE_ACTIONS[phase]!.map(({ id, label, title }) => (
            <button
              type="button"
              key={id}
              title={title}
              onClick={() => controller.trigger(id)}
            >
              {label}
            </button>
          ))}
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

      {phase === 'hypervigilance' && (
        <div className="ctrl-row">
          <span className="ctrl-label">TÍTULO</span>
          <input
            type="text"
            className="ctrl-text"
            value={movieTitle}
            maxLength={60}
            onChange={(e) => {
              setMovieTitle(e.target.value)
              controller.setMovieTitle(e.target.value)
            }}
          />
          <button
            type="button"
            onClick={() => {
              setMovieTitle('HYPERVIGILANCE')
              controller.setMovieTitle('HYPERVIGILANCE')
            }}
          >
            DEFAULT
          </button>
        </div>
      )}

      <div className="ctrl-row">
        <span className="ctrl-label">RECARGA</span>
        <button
          type="button"
          title="Reconstruye la escena actual"
          onClick={() => controller.reloadScene()}
        >
          ESCENA
        </button>
        <button
          type="button"
          title="Descarta los videos activos y reconstruye la escena"
          onClick={() => controller.reloadMedia()}
        >
          MEDIA
        </button>
        <button
          type="button"
          title="Reconstruye la escena y reinicia la numeración de tomas"
          onClick={() => controller.resetTake()}
        >
          TOMA 0
        </button>
      </div>

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
            </Fragment>
          ))}
          <button
            type="button"
            onClick={() => {
              controller.clearFeed('cam-a')
              controller.clearFeed('cam-b')
              controller.clearFeed('call-self')
              controller.clearFeed('studio')
            }}
          >
            LIMPIAR
          </button>
        </div>
      )}

      {note && <div className="ctrl-err">{note}</div>}

      <div className="ctrl-row">
        <span className="ctrl-label">AMBIENTE</span>
        {CRT_SLIDERS.map(({ key, label, max }) => (
          <label key={key} className="ctrl-slider" title={label}>
            <span>{label}</span>
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
      </div>

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

      <div className="ctrl-hint">
        arrastra ventanas por su barra de título · video al lienzo → cámara
        de la escena ·
        Ctrl+1..{PALETTE_ORDER.length} temas · Ctrl+G grabar · Ctrl+I visión ·
        Ctrl+R reiniciar · Ctrl+H ocultar
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
    </div>
  )
}
