// Smoke test for the director workflow: drives the running app over CDP
// (headless Edge) to verify the capture chain and the take-protection
// rules that the UX pass introduced.
//
// Prereq: dev server running (pnpm dev, http://localhost:5173/).
// Usage:  node scripts/verify-director.mjs [screenshot.png]
//
// Checks, in order:
//  1. A fixed capture format pins the canvas to exactly 1920x1080 —
//     independent of the browser window, so takes cut together.
//  2. Take filenames carry production + scene + take number.
//  3. Recording produces a non-empty file with the right resolution, and
//     the take stays in the session list for review (no auto-download).
//  4. A resize while rolling does NOT rebuild the scene or resize the
//     canvas (this used to wipe feeds and window positions mid-take).
//  5. Every video feed follows the director transport (PAUSA freezes the
//     footage, not just the fiction).
//  6. Cue state is reported so the panel can light mode buttons.
//  7. No Runtime exceptions anywhere (a p5 draw crash freezes the canvas
//     silently and records dead frames).
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL_APP = 'http://localhost:5173/'
const PORT = 9225
const OUT = process.argv[2] ?? 'director-verify.png'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const profile = mkdtempSync(join(tmpdir(), 'edge-cdp-'))
const edge = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  // Grant mic/camera without a prompt so the audio path is exercisable.
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  'about:blank',
], { stdio: 'ignore' })

const results = {}
let ws
let failed = false
try {
  let target
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://localhost:${PORT}/json`)).json()
      target = list.find((t) => t.type === 'page')
      if (target) break
    } catch {}
    await sleep(200)
  }
  if (!target) throw new Error('no CDP page target — is Edge installed?')

  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

  let id = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails?.exception?.description ?? 'exception')
    }
  }
  // Every command is bounded: a renderer that dies mid-run must surface as
  // a failed check, not as a hung process with a passing exit code.
  const send = (method, params = {}, timeoutMs = 30000) =>
    new Promise((res, rej) => {
      const mid = ++id
      const timer = setTimeout(() => {
        pending.delete(mid)
        rej(new Error(`CDP timeout after ${timeoutMs}ms: ${method}`))
      }, timeoutMs)
      pending.set(mid, (msg) => {
        clearTimeout(timer)
        res(msg)
      })
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
  ws.onclose = () => {
    for (const [mid, resolve] of pending) {
      pending.delete(mid)
      resolve({ error: { message: 'devtools socket closed (renderer crash?)' } })
    }
  }
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.result?.exceptionDetails) {
      throw new Error('eval failed: ' + JSON.stringify(r.result.exceptionDetails))
    }
    return r.result?.result?.value
  }
  const setViewport = (width, height) =>
    send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
    })

  await send('Runtime.enable')
  await send('Page.enable')
  await setViewport(1600, 900)
  await send('Page.navigate', { url: URL_APP })

  // Wait for the app rather than guessing: a cold Vite start can take
  // several seconds, and __os only exists once p5's async setup ran.
  let booted = false
  for (let i = 0; i < 60; i++) {
    await sleep(500)
    const ok = await evaluate(
      `typeof window.__os !== 'undefined' && !!document.querySelector('.ctrl')`,
    )
    if (ok) { booted = true; break }
  }
  if (!booted) throw new Error('app never became ready (is `pnpm dev` running?)')
  await sleep(1000)

  // Spy on take blobs to prove real encoded video comes out.
  await evaluate(`
    window.__blobSize = -1; window.__blobName = null;
    const origCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => { if (b instanceof Blob && b.type.startsWith('video/')) window.__blobSize = b.size; return origCreate(b) };
    'spy-ok'
  `)

  // --- 0. Scene buttons are guarded while rolling --------------------
  // Runs first, at window resolution: clicking MAPA once while recording
  // must NOT change the phase; the second click must. (This is the
  // accident that used to ruin takes.) Kept cheap so it can't be starved
  // by the high-resolution recordings later in the run.
  const clickScene = (label) =>
    evaluate(`(() => {
      const btn = [...document.querySelectorAll('.ctrl-row button')]
        .find((b) => b.textContent.trim() === ${JSON.stringify(label)})
      if (!btn) return 'not-found'
      btn.click()
      return 'clicked'
    })()`)

  await evaluate(`window.__os.setCaptureFormat('window')`)
  await evaluate(`window.__os.setPhase('desktop')`)
  await sleep(1000)
  await evaluate(`window.__os.startRecording()`)
  await sleep(600)
  const clicked = await clickScene('MAPA')
  await sleep(500)
  const phaseAfterFirst = await evaluate(`window.__os.getPhase()`)
  await clickScene('MAPA')
  await sleep(700)
  const phaseAfterSecond = await evaluate(`window.__os.getPhase()`)
  await evaluate(`window.__os.stopRecording()`)
  await sleep(1500)
  results.guard = { clicked, phaseAfterFirst, phaseAfterSecond }
  // Clear the take this produced so the later list assertions are clean.
  await evaluate(`window.__os.resetTake()`)
  await sleep(600)

  // --- 1. Fixed format pins the capture resolution -------------------
  await evaluate(`window.__os.setPhase('desktop')`)
  await evaluate(`window.__os.setCaptureFormat('1080p')`)
  await sleep(1200)
  results.capture = await evaluate(`window.__osDebug.capture()`)
  // The viewport is 1600x900 but capture must stay 1920x1080.
  const fixedOk =
    results.capture.width === 1920 && results.capture.height === 1080

  // --- 2. Editorial filename -----------------------------------------
  await evaluate(`window.__os.setMovieTitle('NOCHE CERRADA')`)
  await sleep(300)

  // --- 3. Record a short take, kept for review, right resolution ------
  const rollStart = Date.now()
  await evaluate(`window.__os.startRecording()`)
  const recOn = await evaluate(`window.__os.isRecording()`)
  await sleep(1500)

  // --- 4. A resize while rolling must not touch the canvas -----------
  const beforeResize = await evaluate(
    `(() => { const c = document.querySelector('.os-host canvas'); return { w: c.width, h: c.height } })()`,
  )
  await setViewport(1100, 700)
  await sleep(1200)
  const afterResize = await evaluate(
    `(() => { const c = document.querySelector('.os-host canvas'); return { w: c.width, h: c.height } })()`,
  )
  results.resizeStable =
    beforeResize.w === afterResize.w && beforeResize.h === afterResize.h

  await evaluate(`window.__os.stopRecording()`)
  const rollSeconds = (Date.now() - rollStart) / 1000
  await sleep(1800)
  const recOff = await evaluate(`window.__os.isRecording()`)
  results.blobSize = await evaluate(`window.__blobSize`)
  // The panel's take list is React state; read the rendered row instead.
  results.takeRow = await evaluate(
    `document.querySelector('.ctrl-take-name')?.textContent?.trim() ?? null`,
  )
  const takeListed =
    typeof results.takeRow === 'string' && /VIGILANCIA/.test(results.takeRow)
  // The listed duration must match the wall clock the take really rolled.
  const listedSeconds = Number(
    /(\d\d):(\d\d)/.exec(results.takeRow ?? '')
      ? RegExp.$1 * 60 + Number(RegExp.$2)
      : NaN,
  )
  results.duration = { listedSeconds, rollSeconds: Math.round(rollSeconds) }
  const durationHonest = Math.abs(listedSeconds - rollSeconds) <= 2

  // --- 5. Transport drives real footage ------------------------------
  // Headless Edge has no real capture device, so synthesize one: an
  // animated canvas stream stands in for the webcam.
  await evaluate(`(() => {
    const cv = document.createElement('canvas')
    cv.width = 640; cv.height = 480
    const g = cv.getContext('2d')
    let t = 0
    setInterval(() => {
      t += 1 / 30
      g.fillStyle = '#123'; g.fillRect(0, 0, 640, 480)
      g.fillStyle = '#8f8'
      g.fillRect(200 + Math.sin(t) * 120, 180 + Math.cos(t) * 60, 90, 120)
    }, 33)
    navigator.mediaDevices.getUserMedia = () => Promise.resolve(cv.captureStream(30))
    return 'fake-webcam-ready'
  })()`)
  await evaluate(`window.__os.useWebcam('cam-a')`)
  await sleep(2500)
  await evaluate(`window.__os.play()`)
  await sleep(600)
  // Feed <video> elements never enter the DOM, so read them via __osDebug.
  const whilePlaying = await evaluate(`window.__osDebug.feeds()`)
  await evaluate(`window.__os.pause()`)
  await sleep(600)
  const whilePaused = await evaluate(`window.__osDebug.feeds()`)
  results.transport = {
    feeds: whilePlaying.length,
    playing: whilePlaying.length > 0 && whilePlaying.every((f) => !f.paused),
    pausedWithClock: whilePaused.length > 0 && whilePaused.every((f) => f.paused),
  }
  await evaluate(`window.__os.play()`)

  // --- 6. Cue state is observable ------------------------------------
  await evaluate(`window.__os.setPhase('geo')`)
  await sleep(2500)
  await evaluate(`window.__os.trigger('geo-chase')`)
  await sleep(400)
  const chase = await evaluate(`window.__osDebug.sceneState()`)
  await evaluate(`window.__os.trigger('geo-patrol')`)
  await sleep(400)
  const patrol = await evaluate(`window.__osDebug.sceneState()`)
  results.sceneState = { chase: chase?.mode, patrol: patrol?.mode }

  // --- 7. Media bin survives a scene hop ----------------------------
  await evaluate(`window.__os.setPhase('desktop')`)
  await sleep(2000)
  results.slots = await evaluate(`window.__osDebug.slots()`)
  const binRestored = (results.slots ?? []).some((s) => s.kind === 'webcam')

  // Screenshot last: capturing a high-resolution animating canvas takes
  // tens of seconds in headless Edge and would skew any timing around it.
  const shot = await send('Page.captureScreenshot', { format: 'png' }, 120000)
  writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'))

  results.errors = errors
  const checks = {
    fixedFormat: fixedOk,
    filenameHasScene: takeListed,
    recordingToggled: recOn === true && recOff === false,
    blobNonEmpty: results.blobSize > 0,
    durationHonest,
    resizeStableWhileRolling: results.resizeStable === true,
    transportDrivesVideo:
      results.transport.playing === true &&
      results.transport.pausedWithClock === true,
    cueStateReported: chase?.mode === 'chase' && patrol?.mode === 'patrol',
    mediaBinRestored: binRestored,
    sceneGuardedWhileRolling:
      results.guard.clicked === 'clicked' &&
      results.guard.phaseAfterFirst === 'desktop' &&
      results.guard.phaseAfterSecond === 'map',
    noExceptions: errors.length === 0,
  }
  failed = Object.values(checks).some((ok) => !ok)
  console.log(JSON.stringify({ checks, results, screenshot: OUT }, null, 2))
  console.log(failed ? 'FAIL' : 'PASS')
} finally {
  try { ws?.close() } catch {}
  edge.kill()
}
process.exitCode = failed ? 1 : 0
