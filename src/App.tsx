import { useCallback, useEffect, useState } from 'react'
import OSCanvas from './components/OSCanvas'
import ControlPanel from './components/ControlPanel'
import type { OSController } from './os/OSApp'
import type { OSPhase } from './os/core/SceneManager'
import { CONFIG } from './os/config/config'
import type { PaletteKey } from './os/config/theme'
import './App.css'

function App() {
  const [controller, setController] = useState<OSController | null>(null)
  const [theme, setTheme] = useState<PaletteKey>(CONFIG.startTheme)
  const [phase, setPhase] = useState<OSPhase>('boot')
  const [dragging, setDragging] = useState(false)
  const [recording, setRecording] = useState(false)
  const [vision, setVision] = useState(true)

  // Drag-drop footage anywhere on the canvas → CAM-A.
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file && file.type.startsWith('video/')) {
        controller?.loadVideoFile(file, 'cam-a')
      }
    },
    [controller],
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
        }}
      />
      {dragging && (
        <div className="drop-hint">SOLTAR VIDEO → CAM-A</div>
      )}
      {recording && <RecBadge />}
      {controller && (
        <ControlPanel
          controller={controller}
          theme={theme}
          phase={phase}
          recording={recording}
          vision={vision}
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
