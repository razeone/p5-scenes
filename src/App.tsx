import { useCallback, useEffect, useState } from 'react'
import OSCanvas from './components/OSCanvas'
import ControlPanel from './components/ControlPanel'
import type { OSController, SavedTake } from './os/OSApp'
import type { OSPhase } from './os/core/SceneManager'
import { CONFIG } from './os/config/config'
import type { PaletteKey } from './os/config/theme'
import './App.css'

// Finished takes stay reviewable from the panel (blob URLs held in
// memory); keep only the freshest few so long sessions don't hoard RAM.
const MAX_TAKES = 5

function App() {
  const [controller, setController] = useState<OSController | null>(null)
  const [theme, setTheme] = useState<PaletteKey>(CONFIG.startTheme)
  const [phase, setPhase] = useState<OSPhase>('boot')
  const [dragging, setDragging] = useState(false)
  const [recording, setRecording] = useState(false)
  const [vision, setVision] = useState(true)
  const [takes, setTakes] = useState<SavedTake[]>([])

  const onTakeSaved = useCallback((take: SavedTake) => {
    setTakes((list) => {
      const next = [take, ...list]
      for (const evicted of next.slice(MAX_TAKES)) {
        URL.revokeObjectURL(evicted.url)
      }
      return next.slice(0, MAX_TAKES)
    })
  }, [])

  const onDiscardTake = useCallback((url: string) => {
    URL.revokeObjectURL(url)
    setTakes((list) => list.filter((t) => t.url !== url))
  }, [])

  // Drag-drop footage anywhere on the canvas → the scene's camera
  // (CAM-A where it exists; the call's self tile in LLAMADA).
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file && file.type.startsWith('video/')) {
        controller?.loadVideoFile(file, phase === 'video-effects' ? 'studio' : 'cam-a')
      }
    },
    [controller, phase],
  )

  return (
    <div
      className="os-root"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <OSCanvas
        onReady={setController}
        hooks={{
          onThemeChange: setTheme,
          onPhaseChange: setPhase,
          onRecordingChange: setRecording,
          onVisionChange: setVision,
          onTakeSaved,
        }}
      />
      {dragging && (
        <div className="drop-hint">
          {phase === 'video-effects'
            ? 'SOLTAR VIDEO → EFFECTS STUDIO'
            : 'SOLTAR VIDEO → CÁMARA DE LA ESCENA'}
        </div>
      )}
      {recording && <RecBadge />}
      {controller && (
        <ControlPanel
          controller={controller}
          theme={theme}
          phase={phase}
          recording={recording}
          vision={vision}
          takes={takes}
          onDiscardTake={onDiscardTake}
        />
      )}
    </div>
  )
}

/** Off-canvas REC indicator with elapsed take time (never captured). */
function RecBadge() {
  const [sec, setSec] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setSec((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const mm = String(Math.floor(sec / 60)).padStart(2, '0')
  const ss = String(sec % 60).padStart(2, '0')
  return (
    <div className="rec-badge">
      <i /> REC {mm}:{ss}
    </div>
  )
}

export default App
