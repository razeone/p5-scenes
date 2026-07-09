/**
 * ControlPanel.tsx — Director's off-camera controls.
 *
 * Not part of the fiction: a collapsible strip for staging takes —
 * jump phases, switch color themes live, pipe video files / webcam into
 * the surveillance slots, dial the CRT ambience, inject log lines and
 * status-bar directives, and capture stills / WebM takes. Only the
 * canvas is captured, so the panel never shows up in footage; hide it
 * with the ⨯ or Ctrl+H anyway if it distracts.
 */

import { useEffect, useRef, useState } from 'react'
import type { CamSlot, OSController } from '../os/OSApp'
import type { OSPhase } from '../os/core/SceneManager'
import type { OSConfig } from '../os/config/config'
import { PALETTES, PALETTE_ORDER, type PaletteKey } from '../os/config/theme'

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
}

const PHASES: { id: OSPhase; label: string }[] = [
  { id: 'boot', label: 'BOOT' },
  { id: 'login', label: 'LOGIN' },
  { id: 'desktop', label: 'VIGILANCIA' },
  { id: 'map', label: 'MAPA' },
  { id: 'sensors', label: 'SENSORES' },
  { id: 'call', label: 'LLAMADA' },
]

export default function ControlPanel({
  controller,
  theme,
  phase,
  recording,
  vision,
}: Props) {
  const [hidden, setHidden] = useState(false)
  const [crt, setCrt] = useState(() => controller.getCrt())
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const slotRef = useRef<CamSlot>('cam-a')

  const slide = (key: CrtKey, value: number) => {
    setCrt((c) => ({ ...c, [key]: value }))
    controller.setCrt({ [key]: value })
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
      if (e.key.toLowerCase() === 'h') {
        e.preventDefault()
        setHidden((h) => !h)
      }
      if (e.key.toLowerCase() === 'g') {
        e.preventDefault()
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

  const pickVideo = (slot: CamSlot) => {
    slotRef.current = slot
    fileRef.current?.click()
  }

  if (hidden) return null

  return (
    <div className="ctrl">
      <div className="ctrl-row ctrl-head">
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
        <span className="ctrl-label">VIDEO</span>
        <button type="button" onClick={() => pickVideo('cam-a')}>
          ARCHIVO→A
        </button>
        <button type="button" onClick={() => pickVideo('cam-b')}>
          ARCHIVO→B
        </button>
        <button type="button" onClick={() => void controller.useWebcam('cam-a')}>
          WEBCAM→A
        </button>
        <button type="button" onClick={() => void controller.useWebcam('cam-b')}>
          WEBCAM→B
        </button>
        <button
          type="button"
          title="Tu webcam en la videollamada (escena LLAMADA)"
          onClick={() => void controller.useWebcam('call-self')}
        >
          WEBCAM→LLAMADA
        </button>
        <button
          type="button"
          onClick={() => {
            controller.clearFeed('cam-a')
            controller.clearFeed('cam-b')
            controller.clearFeed('call-self')
          }}
        >
          LIMPIAR
        </button>
      </div>

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

      <div className="ctrl-row">
        <span className="ctrl-label">TOMA</span>
        <button
          type="button"
          className={recording ? 'rec on' : 'rec'}
          onClick={() =>
            recording ? controller.stopRecording() : controller.startRecording()
          }
        >
          {recording ? '■ CORTAR' : '● GRABAR'}
        </button>
        <button type="button" onClick={() => controller.screenshot()}>
          FOTO
        </button>
        {recording && <span className="ctrl-note">grabando lienzo…</span>}
      </div>

      <div className="ctrl-hint">
        arrastra ventanas por su barra de título · video al lienzo → CAM-A ·
        Ctrl+1..{PALETTE_ORDER.length} temas · Ctrl+G grabar · Ctrl+I visión ·
        Ctrl+H ocultar
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
