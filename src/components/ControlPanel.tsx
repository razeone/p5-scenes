/**
 * ControlPanel.tsx — Director's off-camera controls.
 *
 * Not part of the fiction: a collapsible strip for staging takes —
 * jump phases, switch color themes live, pipe video files / webcam into
 * the surveillance slots, and record the canvas to a WebM take. Only the
 * canvas is captured, so the panel never shows up in footage; hide it
 * with the ⨯ or Ctrl+H anyway if it distracts.
 */

import { useEffect, useRef, useState } from 'react'
import type { CamSlot, OSController } from '../os/OSApp'
import type { OSPhase } from '../os/core/SceneManager'
import { PALETTES, PALETTE_ORDER, type PaletteKey } from '../os/config/theme'

interface Props {
  controller: OSController
  theme: PaletteKey
  phase: OSPhase
  recording: boolean
  vision: boolean
}

const PHASES: OSPhase[] = ['boot', 'login', 'desktop']

export default function ControlPanel({
  controller,
  theme,
  phase,
  recording,
  vision,
}: Props) {
  const [hidden, setHidden] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const slotRef = useRef<CamSlot>('cam-a')

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
          onClick={() => setHidden(true)}
        >
          ⨯
        </button>
      </div>

      <div className="ctrl-row">
        <span className="ctrl-label">ESCENA</span>
        {PHASES.map((ph) => (
          <button
            type="button"
            key={ph}
            className={ph === phase ? 'on' : ''}
            onClick={() => controller.setPhase(ph)}
          >
            {ph.toUpperCase()}
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
          onClick={() => {
            controller.clearFeed('cam-a')
            controller.clearFeed('cam-b')
          }}
        >
          LIMPIAR
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
        {recording && <span className="ctrl-note">grabando lienzo…</span>}
      </div>

      <div className="ctrl-hint">
        arrastra un video al lienzo → CAM-A · Ctrl+1..{PALETTE_ORDER.length}{' '}
        temas · Ctrl+G grabar · Ctrl+I visión · Ctrl+H ocultar
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
