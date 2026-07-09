# PANOPTICON OS — p5 surveillance-OS scenes

A fictional dystopian operating system rendered on a p5.js canvas, built to
be **filmed**: an actor can boot it, log in on camera, and operate a
surveillance desktop, while a director stages takes from an off-camera
control panel. React (Vite) hosts the canvas and the director UI; all the
fiction is drawn in p5 instance mode.

The performance runs in three phases: **boot** (BIOS/POST roll) →
**login** (interactive terminal, real typing) → **desktop** (activity log,
two surveillance feeds, telemetry, radar).

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
   - **ESCENA** — jump straight to any phase for retakes.
   - **TEMA** — five palettes, switchable live (also `Ctrl+1..5`).
   - **VIDEO** — pipe a video file or the webcam into CAM slot A/B;
     LIMPIAR drops back to static. Dragging a video file anywhere onto
     the canvas also feeds CAM-A.
   - **VISIÓN** — toggles object detection/tracking on the video feeds
     (also `Ctrl+I`; on by default). With footage of people, vehicles,
     or animals you should see bracket boxes acquire (`ADQUIRIENDO…`),
     confirm with a track ID + label + confidence, draw motion trails,
     and stamp `FIJADO` once locked; the panel strip shows
     `IA:EDL0` and the live object count. Feeds without vision (or
     static) fall back to the simulated noise-walker targets.
   - **TOMA** — `● GRABAR` records the canvas; `■ CORTAR` stops and
     auto-downloads `os-take-<timestamp>.webm`. Also `Ctrl+G`. A blinking
     REC badge shows while rolling. Only the canvas is captured — the
     panel and badge never appear in footage.
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
__os.startRecording(); __os.isRecording(); __os.stopRecording()
__os.restart()

__osDebug.visionStatus('cam-a')  // 'loading' | 'active' | 'error'
__osDebug.tracks('cam-a')        // live TrackedObject[] (video px coords)
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
    widgets/ OSWindow (base chrome) + BootSequence, LoginWindow,
             ConsoleWindow, TelemetryWindow, SurveillancePanel,
             RadarWindow, StatusBar, Meters, TextStream
public/
  mediapipe/wasm/            self-hosted MediaPipe WASM runtime
  models/                    efficientdet_lite0.tflite (COCO, f16)
```

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
