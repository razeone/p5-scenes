---
title: PANOPTICON OS - p5 surveillance-OS scenes
description: A filmable p5.js surveillance operating system with director-controlled scenes and recording tools.
ms.date: 2026-08-11
ms.topic: overview
---

# PANOPTICON OS - p5 surveillance-OS scenes

A fictional dystopian operating system rendered on a p5.js canvas, built to
be **filmed**: an actor can boot it, log in on camera, and operate a
surveillance desktop, while a director stages takes from an off-camera
control panel. React (Vite) hosts the canvas and the director UI; all the
fiction is drawn in p5 instance mode.

> **Shooting with this?** Read
> [`docs/director-guide.md`](docs/director-guide.md) — the on-set manual
> (setup, take protection, cueing, delivery). This README is the
> engineering view. The UX findings behind the current workflow are in
> [`docs/ux-assessment.md`](docs/ux-assessment.md).

The default opening is **boot** (BIOS/POST roll) → **login** (automated
credential typing with manual takeover) → **hypervigilancia** (a bounded
surveillance wall, flare, and configurable movie title) → **vigilancia**.
The director can also stage any of the desks directly: **vigilancia**
(activity log, dual camera feeds, telemetry,
radar), **mapa** (tactical city map — procedural street grid, sector
boundaries, restricted zone, patrol units, target ping), **geo** (real
OpenStreetMap tiles restyled per palette, with a GPS pursuit — target,
units, breadcrumb trail, operational perimeter, live lat/lon),
**galería** (a dossier board built from your own images), **sensores**
(seismic/acoustic/RF scopes, SIGINT spectrogram waterfall, environmental
gauges), and **llamada** (encrypted videoconference — real webcam in the
local tile, procedural "decrypted video" participants). Every window is
draggable by its title bar and raises on click.

The surveillance feeds have **real computer vision**: MediaPipe Tasks
Vision (WASM, GPU-accelerated) runs EfficientDet-Lite0 object detection
on whatever footage or webcam you pipe in, and a SORT-style tracker turns
detections into stable tracks — bracket lock-ons with track IDs, Spanish
class labels, live confidence, motion trails, and FIJADO lock stamps, all
drawn in the OS palette. Everything is self-hosted from `public/`
(no CDN, works offline).

## Run

```sh
pnpm install
pnpm dev        # http://localhost:5173/
```

Other scripts: `pnpm build` (typecheck + bundle), `pnpm lint`,
`pnpm preview`.

## How to test

There is no unit-test suite — the app is a visual performance. Testing is
a manual walkthrough plus a scripted CDP smoke test.

### Manual walkthrough

1. `pnpm dev`, open http://localhost:5173/. The boot roll plays
   (~4.2 s), then the login terminal appears.
2. Log in as the operator — credentials come from
   [`src/os/config/config.ts`](src/os/config/config.ts):
   ID `AGENTE.K7`, password `OBEDIENCIA` (typed input is uppercased;
   wrong credentials → ACCESS DENIED, then it resets). Enter submits each
   field.
3. On the desktop, exercise the director panel (bottom right). Rows are
   ordered by stakes; the lower half is grouped into collapsible
   sections whose open/closed state persists.
   - **TOMA** (top row — the highest-stakes control) — `● GRABAR`
     records the canvas, `■ CORTAR` cuts (also `Ctrl+G`). `● EN {3,5,10}S`
     starts after a full-screen count-in (click or `Esc` cancels) so a
     solo operator can get into frame. While rolling the row shows take
     number + elapsed; idle it shows the next take (`PRÓX T02`). The row
     always ends with the true capture chain — `1920×1080 · MP4 · AUDIO`.
     Each take opens with a ~1.6 s burned-in slate carrying **production
     title, take number, scene name and wall clock**. `FOTO` saves a PNG
     still. Only the canvas is captured — panel, REC badge, count-in and
     warning banners never appear in footage.
   - **Take list** — cut takes land here for review (they are *not*
     auto-saved unless you enable `AUTO-GUARDA`). Each row reads
     `T## · SCENE · duration · size`; `VER` plays it inline in the panel,
     `◎ BUENA` circles it (downloads + marks a keeper, exempt from
     eviction), `NG` discards it and frees the blob. The list holds the 8
     newest takes plus every circled one.
   - **ESCENA** — jump to any scene for retakes: BOOT, LOGIN,
     HYPERVIGILANCIA, VIGILANCIA, MAPA, GEO, GALERÍA, SENSORES, LLAMADA,
     CHIP, PLACA, IMPLANTE, LEALTAD, ANÁLISIS, FX STUDIO, SILENCE.
     **Guarded while recording** (see below).
   - **CUES** — one-shot and mode cues for the current scene only.
     **Bare number keys `1`–`9` fire them** (the digit is printed on each
     button), and mode cues (`PERSECUCIÓN`, `SEGUIR`, `RAYOS-X`…) render
     as active when their mode is on.
   - **ESTADO** — live readout of the current scene's modes and counters
     (mode, follow, city, zoom, page, dossier count, metal layer…), so
     the director doesn't have to decode the canvas HUD.
   - **UBICAR** (GEO only) — type lat/lon plus an operation name and
     press `IR` to point the map at a specific real place; it joins the
     `CIUDAD` cycle for the session.
   - **TIEMPO** — live scene-clock timecode (`mm:ss.d`), play, pause,
     `+1F`, `+1S`, reset, and a speed slider with a `1×` reset.
     PLAY/PAUSA highlight the transport state. **The transport drives
     real footage in every scene**: pausing freezes loaded video, the
     speed slider retimes it, and manual stepping seeks it.
   - **CAPTURA** — `FORMATO` pins the canvas to a fixed capture
     resolution (`1080P`/`1440P`/`4K`/`9:16`, letterboxed on screen) or
     follows the window (`VENTANA`); `ARCHIVO` picks MP4/H.264 or WebM
     and toggles mic capture and auto-download; a slider sets the
     count-in length. **Guarded while recording.**
   - **MEDIA** — `VIDEO` pipes a file or webcam into each slot the scene
     provides, with a per-slot `⨯` clear; `CARGADO` shows what is in each
     slot. Loaded footage is remembered in a session media bin and
     **re-attached automatically after a scene change**. `FICHAS`
     (GALERÍA) loads images or a folder as dossiers. `VISIÓN` toggles
     detection/tracking (`Ctrl+I`, on by default): bracket boxes acquire
     (`ADQUIRIENDO…`), confirm with track ID + label + confidence, draw
     motion trails and stamp `FIJADO`. Feeds without vision fall back to
     simulated noise-walker targets.
   - **LOOK** — five palettes (`Ctrl+1..5`), CRT sliders (scanlines,
     glow, vignette, flicker, glitch) **with numeric readouts** so a look
     is reproducible, `RÁFAGA` for a momentary glitch/tear burst,
     `RESET LOOK` to restore the shipped values, and `TÍTULO` — the
     production name used by the cinematic, the slate and filenames.
   - **INYECTAR** — type a line and send it in-fiction: `REGISTRO` into
     the activity log (Enter does the same), `ALERTA` in danger red,
     `AVISO` as a blinking status-bar directive.
   - **SISTEMA → RECARGA** — `ORDENAR VENTANAS` re-runs the layout while
     keeping footage, `ESCENA` rebuilds, `MEDIA` forgets the media bin
     and rebuilds, `TOMA 0` restarts take numbering, `REINICIAR` returns
     to BOOT. All **guarded while recording**.
   - **Windows drag** — grab any window by its title bar (cursor shows a
     grab hand); it raises and gets a brighter focused frame.
   - **Drag-and-drop** — a video file dropped on the canvas lands in the
     window **under the cursor** (dropping on CAM-B feeds CAM-B), falling
     back to the scene's default slot; dropped image files load as
     gallery dossiers.
   - `?` opens a shortcut + cue cheat sheet; `Ctrl+H` hides the panel
     (shortcuts stay live while hidden).
4. **Take protection.** While recording: scene/reload/restart controls dim
   and require a second confirming click (armed state shows amber, expires
   after 4 s), `Ctrl+R` is refused, resizing no longer rebuilds the scene
   (so feeds, window positions and scene state survive), and closing the
   tab warns if a take is rolling or unsaved takes exist. Cues, ambience,
   theme and message injection stay instant — they're performance
   controls.
5. Resize the window — with a fixed `FORMATO` only the letterbox scale
   changes; on `VENTANA` the phase re-lays out for the new size (never
   while rolling).
6. **Watchdog** — if the p5 draw loop dies (an exception silently freezes
   the canvas and would record dead frames), a red `LIENZO CONGELADO`
   banner appears over the canvas.

The initial hypervigilance wall currently supports up to nine procedural
surveillance screens. Its timing and screen count are configured under
`scenes.hypervigilance` in
[`src/os/config/config.ts`](src/os/config/config.ts). The bounded screen
pool is the first performance guard for the planned 33-clip media bank;
file-backed clip rotation and custom screen layouts are the next
implementation slice.

### Console API (dev builds)

The controller is exposed as `window.__os` for quick direction on set or
scripted checks:

```js
__os.setPhase('hypervigilance')  // or 'boot', 'login', 'desktop', 'geo', …
__os.play(); __os.pause(); __os.step(); __os.step(1)
__os.seek(0); __os.setSpeed(2); __os.getClock()
__os.reloadScene(); __os.reloadMedia(); __os.resetTake()
__os.relayout()            // re-run the layout, keep loaded footage
__os.setMovieTitle('HYPERVIGILANCE')
__os.cycleTheme()          // or setTheme('amber'), getThemeKey()
__os.useWebcam('cam-b')    // or loadVideoFile(file, 'cam-a'), clearFeed()
__os.getSlots()            // what footage is in each slot
__os.slotAtPoint(x, y)     // which slot is under a viewport point
__os.loadGalleryImages(files)     // dossier board from image Files
__os.setVision(false)      // toggle detection/tracking; isVisionOn()
__os.setCrt({ glitchChance: 0.1 })  // live ambience; getCrt(), resetCrt()
__os.glitchBurst()         // momentary tear burst (default 0.7s)
__os.logLine('SUJETO LOCALIZADO', 'danger')  // into the activity log
__os.announce('TOQUE DE QUEDA 21:00')        // status-bar directive
__os.trigger('geo-chase')  // fire a scene cue; getSceneState() for modes
__os.setGeoLocation(19.4326, -99.1332, 'CDMX')  // GEO: exact coordinates
__os.screenshot()          // PNG still of the canvas

// Capture chain
__os.setCaptureFormat('4k')       // 'window' | '1080p' | '1440p' | '4k' | '1080p-vertical'
__os.setCaptureContainer('mp4')   // or 'webm'
await __os.setAudioCapture(true)  // mux the mic into takes
__os.setAutoDownload(false)       // review-first (default) vs save-on-cut
__os.getCaptureState()            // format, real w/h, container, audio…
__os.startRecording(); __os.isRecording(); __os.stopRecording()
__os.getTake()             // last take number this session (0 = none)
__os.getHealth()           // draw-loop liveness (watchdog)
__os.restart()

__osDebug.visionStatus('cam-a')  // 'loading' | 'active' | 'error'
__osDebug.tracks('cam-a')        // live TrackedObject[] (video px coords)
__osDebug.windows()              // window positions / z-order / focus
__osDebug.clock()                // director clock state
__osDebug.phase()                // active phase
__osDebug.health()               // frames drawn + clock mode
__osDebug.feeds()                // per-feed paused/rate/time (not in the DOM)
__osDebug.capture()              // capture chain snapshot
__osDebug.sceneState()           // current scene's modes/counters
__osDebug.slots()                // media bin per slot
__osDebug.canRecord()            // { mp4, webm } encoder support
```

### Scripted smoke tests

With the dev server running:

```sh
node scripts/verify-rec.mjs       # recording pipeline
node scripts/verify-vision.mjs    # computer-vision pipeline
node scripts/verify-geo.mjs       # OpenStreetMap tracking scene
node scripts/verify-director.mjs  # director workflow + take protection
```

All four launch headless Edge, drive `__os` over the Chrome DevTools
Protocol, and print PASS/FAIL (exit code 1 on failure).

`verify-rec` verifies the desktop phase renders without draw-loop
exceptions and that recording produces a non-empty WebM, and saves a
mid-recording screenshot (`rec-verify.png`). This catches the silent
failure mode: an exception in p5's `draw` freezes the canvas without
visible errors, and recordings come out empty.

`verify-vision` fakes a webcam (a canvas panning `scripts/cat_and_dog.jpg`)
into CAM-A and polls `__osDebug` until the detector reports confirmed
tracks with stable IDs across several seconds — proving model load
(WASM + tflite from `public/`), inference, and tracker association all
work. Saves `vision-verify.png`. Headless Edge has no GPU, so it
exercises the CPU-delegate fallback; in a real browser the GPU delegate
is used.

`verify-geo` stages the GEO scene, fires its cues (intercept, zoom,
follow, city jump), and asserts frames keep advancing with no exceptions
while OpenStreetMap tiles stream in. Saves `geo-verify.png`.

`verify-director` covers the filming workflow end to end and is the
regression net for the UX rules: a fixed `FORMATO` pins the canvas to
exactly 1920×1080 regardless of viewport; take filenames and list rows
carry the scene name; a take encodes non-empty with an honest duration and
stays in the session list (no auto-download); **a resize while rolling
does not resize or rebuild anything**; the director transport really
pauses loaded footage; cue state is reported for the panel's active
styling; and the media bin re-attaches footage across a scene change.
Saves `director-verify.png`.

`scripts/shot-panel.mjs` is a visual helper rather than a test: it opens
a phase, expands every director-panel section (optionally the `?`
overlay) and screenshots it, so panel layout regressions are visible
without shooting a take — `node scripts/shot-panel.mjs out.png geo --keys`.

> Headless Edge has no capture device, so the webcam tests stub
> `getUserMedia` with an animated canvas stream. Feed `<video>` elements
> are never added to the DOM — use `__osDebug.feeds()` rather than
> `document.querySelector('video')` when asserting playback state.

> Headless notes: the script expects Edge at its default install path.
> `--window-size` is not reliably honored by headless Edge, so don't
> assert on layout from the screenshot — it's for eyeballing.

## Re-skinning a scene

Everything diegetic is configured in
[`src/os/config/config.ts`](src/os/config/config.ts) — OS name, agency,
motto, operator credentials, boot/auth timing, CRT intensity (scanlines,
glow, flicker, glitch chance). Palettes live in
[`src/os/config/theme.ts`](src/os/config/theme.ts).

## Architecture

React shell (declarative) drives an imperative p5 loop through a
controller — the seam is [`src/os/OSApp.ts`](src/os/OSApp.ts), which
builds each phase's scene and exposes `OSController`.

```
src/
  App.tsx                    root shell: drag-drop routing, REC badge,
                             take bin, unload guard, frozen-canvas watchdog
  components/
    OSCanvas.tsx             mounts p5 (StrictMode-safe)
    ControlPanel.tsx         director controls (off-camera UI)
  os/
    OSApp.ts                 p5 wiring, phase staging, capture chain,
                             media bin, transport sync, controller
    config/  config.ts, theme.ts
    core/    Entity, SceneManager (phases + PHASE_LABELS/ORDER, slugify),
             context, geometry
    fx/      Effects.ts      background grid + CRT post pass
    media/   FeedSource (static), VideoSource (file/webcam),
             Recorder (MP4/WebM + optional mic, review-first takes)
    vision/  VisionEngine (MediaPipe detector), ObjectTracker (IoU
             tracking w/ velocity coasting), labels (ES + threat tiers)
    widgets/ OSWindow (base chrome, dragging) + BootSequence,
             LoginWindow, ConsoleWindow, TelemetryWindow,
             SurveillancePanel, RadarWindow, StatusBar, Meters,
             TextStream, Slate, MapWindow, GeoMapWindow (OSM tiles),
             GalleryWindow, SensorWindows (scopes, spectrogram,
             gauges), CallWindow, ChipWindows, BoardWindows,
             BioWindows, LoyaltyWindows, AnalysisWindows,
             HypervigilanceScene, SilenceScene, VideoEffectsStudio
docs/
  director-guide.md          on-set manual for whoever is filming
  ux-assessment.md           UX findings this workflow was built from
public/
  mediapipe/wasm/            self-hosted MediaPipe WASM runtime
  models/                    efficientdet_lite0.tflite (COCO, f16)
```

**Capture chain.** `CaptureFormat` decides the canvas size: a fixed
format pins `ctx.width/height` to a broadcast resolution and adds a
`fixed` class to the p5 host, which CSS-letterboxes it (`width:auto` +
`max-width/height:100%`). `pixelDensity(1)` keeps the backing store equal
to the chosen resolution, so `captureStream()` encodes exactly that —
which is why takes are frame-identical across sessions. Mouse coordinates
still land correctly because p5 divides by the canvas's CSS scale.

## UX QA audit (applied)

A polish pass over both surfaces, with every finding fixed in place:

- **Canvas** — windows drag by their title bar with `grab`/`grabbing`
  cursors and raise on any click; the focused window draws a brighter,
  glowier frame; drag positions clamp so a title bar can never leave the
  canvas; window titles truncate with an ellipsis instead of colliding
  with the corner tag.
- **Panel** — `:focus-visible` rings on every control for keyboard use;
  the icon-only close button has an `aria-label`; `Escape` blurs the
  message field (handing the keyboard back to the OS); buttons get a
  0.12 s hover transition and a 1 px press-down; the panel scrolls
  inside the viewport instead of overflowing on short windows; the
  drop-target overlay fades in instead of popping.
- **Input routing** — p5's global key handlers stand down while a DOM
  input is focused, so panel typing can't leak into the login terminal
  (and vice versa).
- **Recording & take review (second pass)** — the TOMA row moved to the
  top of the panel and shows take number + elapsed time while rolling;
  a 3 s count-in supports solo operation; finished takes stay
  reviewable in a session take list (VER / BAJAR / discard) instead of
  vanishing after the auto-download's 5 s blob-URL window; the TIEMPO
  row gained a live timecode, PLAY/PAUSA active states and a speed
  readout with a `1×` reset; `TOMA 0` actually resets take numbering;
  webcam failures surface as a panel note instead of failing silently.

### Filmmaker workflow pass (2026-08-11)

A consultant-style assessment of the tool *as a filmmaking instrument*
([`docs/ux-assessment.md`](docs/ux-assessment.md)), executed in full. The
findings clustered into three themes, all now addressed:

- **Protect the take.** Nothing was guarded while rolling — the ESCENA
  row sat ~20 px under GRABAR and any click rebuilt the scene. Scene,
  reload and restart controls are now dimmed + two-click-armed while
  recording, `Ctrl+R` is refused, a resize can no longer rebuild the
  scene mid-take, and an unload guard covers rolling/unsaved takes. A
  watchdog banner surfaces a frozen draw loop, which previously recorded
  dead frames silently.
- **Fit the film pipeline.** Takes now carry editorial identity
  (`<production>-<scene>-t##-<timestamp>`, plus production title and
  scene on the burned-in slate), render at a *fixed* capture resolution
  instead of whatever the window happened to be, encode to MP4/H.264 by
  default with optional scratch mic audio, and follow a review-first flow
  (inline `VER`, `◎ BUENA` to circle and save, `NG` to discard) instead
  of auto-spamming the Downloads folder. The director transport now
  drives real footage in every scene, not just the FX studio.
- **Reduce on-set load.** Cues are hotkeyed (`1`–`9`) and mode cues show
  their active state; an `ESTADO` row exposes the scene's live modes; the
  media bin re-attaches footage across scene changes and `CARGADO` shows
  what's loaded where; drops land on the window under the cursor; the
  panel is sectioned with persisted open/closed state; theme, look, title
  and capture prefs survive reloads; CRT sliders show numeric values; and
  `?` opens an in-app shortcut/cue cheat sheet.

`scripts/verify-director.mjs` is the regression net for these rules.

Vision data flow: `SurveillancePanel` calls `VisionEngine.update()`
every draw with the feed's `<video>`; the engine runs MediaPipe
`detectForVideo` at ~10 Hz (one shared detector, GPU delegate with CPU
fallback) and `ObjectTracker` matches detections to tracks by IoU,
coasting boxes on velocity between detection ticks so overlays glide at
60 fps. Track boxes live in source-video pixels; `VideoFeed.toViewport()`
maps them through the cover-fit crop into panel space.

Each widget extends `OSWindow` (frame, title bar, reveal animation) and
draws into a padded inner rect. `SceneManager` owns the entity list and
the current phase; `OSContext` is a single mutable object (p5 instance,
palette, config, clock) refreshed every frame, which is what makes live
theme swapping and recording clean.
