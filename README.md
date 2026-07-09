# PANOPTICON OS — p5 surveillance-OS scenes

A fictional dystopian operating system rendered on a p5.js canvas, built to
be **filmed**: an actor can boot it, log in on camera, and operate a
surveillance desktop, while a director stages takes from an off-camera
control panel. React (Vite) hosts the canvas and the director UI; all the
fiction is drawn in p5 instance mode.

The performance opens with **boot** (BIOS/POST roll) → **login**
(interactive terminal, real typing), then the director can stage any of
four desks: **vigilancia** (activity log, dual camera feeds, telemetry,
radar), **mapa** (tactical city map — procedural street grid, sector
boundaries, restricted zone, patrol units, target ping), **sensores**
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
3. On the desktop, exercise the director panel (bottom right):
   - **ESCENA** — jump straight to any scene for retakes: BOOT, LOGIN,
     VIGILANCIA, MAPA, SENSORES, LLAMADA.
   - **Windows drag** — grab any window by its title bar (cursor shows
     a grab hand); it raises above the others and gets a brighter
     focused frame. Positions reset on scene change/resize.
   - **TEMA** — five palettes, switchable live (also `Ctrl+1..5`).
   - **VIDEO** — pipe a video file or the webcam into CAM slot A/B, or
     your webcam into the videocall's local tile (WEBCAM→LLAMADA);
     LIMPIAR drops everything back. Dragging a video file anywhere onto
     the canvas also feeds CAM-A.
   - **VISIÓN** — toggles object detection/tracking on the video feeds
     (also `Ctrl+I`; on by default). With footage of people, vehicles,
     or animals you should see bracket boxes acquire (`ADQUIRIENDO…`),
     confirm with a track ID + label + confidence, draw motion trails,
     and stamp `FIJADO` once locked; the panel strip shows
     `IA:EDL0` and the live object count. Feeds without vision (or
     static) fall back to the simulated noise-walker targets.
   - **AMBIENTE** — live CRT sliders (scanlines, glow, vignette,
     flicker, glitch chance) plus `RÁFAGA`, a momentary heavy
     glitch/tear burst for transitions and dramatic hits.
   - **MENSAJE** — type a line and send it in-fiction: `REGISTRO`
     pushes it into the activity log (Enter does the same), `ALERTA`
     pushes it in danger red, `AVISO` blinks it as a status-bar
     directive for a few seconds.
   - **TOMA** — `● GRABAR` records the canvas; `■ CORTAR` stops and
     auto-downloads a numbered take (`os-toma-01-<timestamp>.webm`).
     Also `Ctrl+G`. Each take opens with a 1.6 s burned-in slate (take
     number, OS, wall clock) and a blinking REC badge shows while
     rolling. `FOTO` downloads a PNG still. Only the canvas is captured
     — the panel and badge never appear in footage.
   - `Ctrl+H` hides/shows the panel (shortcuts stay live while hidden).
4. Resize the window — the current phase re-lays out for the new size.

### Console API (dev builds)

The controller is exposed as `window.__os` for quick direction on set or
scripted checks:

```js
__os.setPhase('desktop')   // 'boot' | 'login' | 'desktop'
__os.cycleTheme()          // or setTheme('amber'), getThemeKey()
__os.useWebcam('cam-b')    // or loadVideoFile(file, 'cam-a'), clearFeed()
__os.setVision(false)      // toggle detection/tracking; isVisionOn()
__os.setCrt({ glitchChance: 0.1 })  // live ambience; getCrt()
__os.glitchBurst()         // momentary tear burst (default 0.7s)
__os.logLine('SUJETO LOCALIZADO', 'danger')  // into the activity log
__os.announce('TOQUE DE QUEDA 21:00')        // status-bar directive
__os.screenshot()          // PNG still of the canvas
__os.startRecording(); __os.isRecording(); __os.stopRecording()
__os.restart()

__osDebug.visionStatus('cam-a')  // 'loading' | 'active' | 'error'
__osDebug.tracks('cam-a')        // live TrackedObject[] (video px coords)
__osDebug.windows()              // window positions / z-order / focus
```

### Scripted smoke tests

With the dev server running:

```sh
node scripts/verify-rec.mjs      # recording pipeline
node scripts/verify-vision.mjs   # computer-vision pipeline
```

Both launch headless Edge, drive `__os` over the Chrome DevTools
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
  App.tsx                    root shell: drag-drop, REC badge, panel
  components/
    OSCanvas.tsx             mounts p5 (StrictMode-safe)
    ControlPanel.tsx         director controls (off-camera UI)
  os/
    OSApp.ts                 p5 wiring, phase staging, controller
    config/  config.ts, theme.ts
    core/    Entity, SceneManager (phases), context, geometry
    fx/      Effects.ts      background grid + CRT post pass
    media/   FeedSource (static), VideoSource (file/webcam), Recorder
    vision/  VisionEngine (MediaPipe detector), ObjectTracker (IoU
             tracking w/ velocity coasting), labels (ES + threat tiers)
    widgets/ OSWindow (base chrome, dragging) + BootSequence,
             LoginWindow, ConsoleWindow, TelemetryWindow,
             SurveillancePanel, RadarWindow, StatusBar, Meters,
             TextStream, Slate, MapWindow, SensorWindows (scopes,
             spectrogram, gauges), CallWindow
public/
  mediapipe/wasm/            self-hosted MediaPipe WASM runtime
  models/                    efficientdet_lite0.tflite (COCO, f16)
```

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
