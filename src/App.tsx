import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import OSCanvas from './components/OSCanvas'
import ControlPanel from './components/ControlPanel'
import type { OSController, SavedTake } from './os/OSApp'
import type { OSPhase } from './os/core/SceneManager'
import { CONFIG } from './os/config/config'
import { PALETTES, type PaletteKey } from './os/config/theme'
import { filesFromDrop } from './os/media/DropFiles'
import { isVideoFile } from './os/media/VideoWall'
import './App.css'

// Finished takes stay reviewable from the panel (blob URLs held in
// memory); keep only the freshest few so long sessions don't hoard RAM.
// Circled ("kept") takes are never evicted — the director marked those.
const MAX_TAKES = 8

function App() {
  const [controller, setController] = useState<OSController | null>(null)
  const [theme, setTheme] = useState<PaletteKey>(CONFIG.startTheme)
  const [phase, setPhase] = useState<OSPhase>('boot')
  const [dragging, setDragging] = useState(false)
  const [recording, setRecording] = useState(false)
  const [vision, setVision] = useState(true)
  const [takes, setTakes] = useState<SavedTake[]>([])
  const palette = PALETTES[theme]
  // Draw-loop watchdog: a p5 exception freezes the canvas silently, and
  // a recording made against a frozen canvas is a dead frame for its
  // whole length. Surfacing it beats discovering it in the edit.
  const [frozen, setFrozen] = useState(false)
  // Takes the director hasn't saved yet, for the unload guard.
  const unsavedRef = useRef(0)

  const onTakeSaved = useCallback((take: SavedTake) => {
    setTakes((list) => {
      const next = [take, ...list]
      // Evict from the tail, but skip circled takes.
      const keep: SavedTake[] = []
      const dropped: SavedTake[] = []
      for (const t of next) {
        if (keep.length < MAX_TAKES || t.kept) keep.push(t)
        else dropped.push(t)
      }
      for (const evicted of dropped) URL.revokeObjectURL(evicted.url)
      return keep
    })
  }, [])

  const onDiscardTake = useCallback((url: string) => {
    URL.revokeObjectURL(url)
    setTakes((list) => list.filter((t) => t.url !== url))
  }, [])

  /** Circled take: the director saved it, so stop counting it as unsaved. */
  const onKeepTake = useCallback((url: string) => {
    setTakes((list) =>
      list.map((t) => (t.url === url ? { ...t, kept: true } : t)),
    )
  }, [])

  // Warn before a reload throws away takes that were never saved. The
  // take list lives in memory, so a stray Ctrl+Shift+R used to be silent
  // and total data loss.
  useEffect(() => {
    unsavedRef.current = takes.filter((t) => !t.kept).length
  }, [takes])

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!recording && unsavedRef.current === 0) return
      e.preventDefault()
      // Browsers show their own wording; a non-empty value is the signal.
      e.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [recording])

  // Watchdog: compare drawn frames over wall time. Only fires when the
  // clock says the scene should be advancing.
  useEffect(() => {
    if (!controller) return
    let last = controller.getHealth().drawn
    const id = window.setInterval(() => {
      const health = controller.getHealth()
      const stalled = health.drawn === last && health.mode === 'realtime'
      last = health.drawn
      setFrozen(stalled)
    }, 1200)
    return () => window.clearInterval(id)
  }, [controller])

  /**
   * Drag-drop footage onto the canvas. What the drop means depends on
   * what it carries, so the director never has to aim at the right panel:
   *
   *   many videos (or a folder)  → the HIPERVIGILANCIA montage playlist
   *   one video                  → the window under the cursor
   *   images only                → the dossier board
   *
   * Folders arrive without a flat file list, so the entries are walked
   * (see DropFiles); the drop point is captured up front because the
   * event's coordinates are read after that await.
   */
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      if (!controller) return
      const point = { x: e.clientX, y: e.clientY }

      void filesFromDrop(e.dataTransfer).then((files) => {
        if (files.length === 0) return
        const videos = files.filter(isVideoFile)

        if (videos.length > 1 || (videos.length === 1 && phase === 'hypervigilance')) {
          controller.loadWallVideos(videos)
          return
        }

        if (videos.length === 0) {
          const images = files.filter((f) => f.type.startsWith('image/'))
          if (images.length > 0) controller.loadGalleryImages(images)
          return
        }

        const fallback =
          phase === 'video-effects'
            ? 'studio'
            : phase === 'silence'
              ? 'silence'
              : 'cam-a'
        controller.loadVideoFile(
          videos[0],
          controller.slotAtPoint(point.x, point.y) ?? fallback,
        )
      })
    },
    [controller, phase],
  )

  return (
    <div
      className="os-root"
      style={{
        '--ui-bg': palette.bg,
        '--ui-grid': palette.grid,
        '--ui-fg': palette.fg,
        '--ui-fg-dim': palette.fgDim,
        '--ui-accent': palette.accent,
        '--ui-warn': palette.warn,
        '--ui-danger': palette.danger,
        '--ui-ok': palette.ok,
      } as CSSProperties}
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
            : phase === 'gallery'
              ? 'SOLTAR IMÁGENES → EXPEDIENTES'
              : 'SOLTAR VIDEO SOBRE UNA CÁMARA'}
        </div>
      )}
      {recording && <RecBadge />}
      {frozen && (
        <div className="os-watchdog" role="alert">
          LIENZO CONGELADO
          <span>
            el bucle de dibujo se detuvo — recarga la página; una toma
            grabada así queda en negro
          </span>
        </div>
      )}
      {controller && (
        <ControlPanel
          controller={controller}
          theme={theme}
          phase={phase}
          recording={recording}
          vision={vision}
          takes={takes}
          onDiscardTake={onDiscardTake}
          onKeepTake={onKeepTake}
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
