// Smoke test: verifies the computer-vision pipeline end-to-end.
//
// Headless Edge + CDP: replaces getUserMedia with a synthetic webcam (a
// canvas panning a cat-and-dog photo, so the COCO detector has real
// objects and real motion), pipes it into CAM-A via __os.useWebcam, and
// polls __osDebug until the MediaPipe detector reports confirmed tracks.
//
// Prereq: dev server running (pnpm dev) and a test image next to this
// script or passed as argv[2] (any photo with COCO objects works).
// Usage:  node scripts/verify-vision.mjs [image] [screenshot.png]
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL_APP = 'http://localhost:5173/'
const PORT = 9226
const IMG = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), 'cat_and_dog.jpg')
const OUT = process.argv[3] ?? 'vision-verify.png'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const imgDataUri = `data:image/jpeg;base64,${readFileSync(IMG).toString('base64')}`

const profile = mkdtempSync(join(tmpdir(), 'edge-cdp-'))
const edge = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--window-size=1600,900',
  'about:blank',
], { stdio: 'ignore' })

let ws
let failed = true
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
  const send = (method, params = {}) =>
    new Promise((res) => {
      const mid = ++id
      pending.set(mid, res)
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) {
      throw new Error('eval failed: ' + JSON.stringify(r.result.exceptionDetails))
    }
    return r.result?.result?.value
  }

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: URL_APP })
  await sleep(3000)
  await evaluate(`window.__os.setPhase('desktop')`)
  await sleep(1000)

  // Synthetic webcam: canvas slowly panning the test photo.
  await evaluate(`(() => {
    const img = new Image()
    img.src = ${JSON.stringify(imgDataUri)}
    return new Promise((resolve) => {
      img.onload = () => {
        const cv = document.createElement('canvas')
        cv.width = 640; cv.height = 480
        const g = cv.getContext('2d')
        let t = 0
        setInterval(() => {
          t += 1 / 30
          const dx = Math.sin(t * 0.5) * 40
          const dy = Math.cos(t * 0.3) * 20
          g.fillStyle = '#222'; g.fillRect(0, 0, 640, 480)
          g.drawImage(img, dx, dy, 640, 480 * (img.height / img.width) * (640 / 640))
        }, 33)
        navigator.mediaDevices.getUserMedia = () =>
          Promise.resolve(cv.captureStream(30))
        resolve('fake-webcam-ready')
      }
    })
  })()`)

  await evaluate(`window.__os.useWebcam('cam-a')`)

  // Poll for confirmed tracks (CPU-delegate inference can be slow).
  let status = null
  let samples = []
  for (let i = 0; i < 90; i++) {
    await sleep(1000)
    status = await evaluate(`window.__osDebug.visionStatus('cam-a')`)
    const tracks = await evaluate(`(window.__osDebug.tracks('cam-a') ?? [])
      .map(t => ({ id: t.id, label: t.label, score: +t.score.toFixed(2),
                   confirmed: t.confirmed, trail: t.trail.length }))`)
    if (status === 'error') break
    if (tracks.some((t) => t.confirmed)) {
      samples.push(tracks)
      if (samples.length >= 3) break // 3 consecutive seconds of tracking
    } else {
      samples = []
    }
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'))

  const confirmed = samples.at(-1)?.filter((t) => t.confirmed) ?? []
  // Stable IDs across the sampled seconds = tracking, not just detection.
  const firstIds = new Set((samples[0] ?? []).filter((t) => t.confirmed).map((t) => t.id))
  const stable = confirmed.some((t) => firstIds.has(t.id))

  failed = status !== 'active' || confirmed.length === 0 || !stable || errors.length > 0
  console.log(JSON.stringify({ status, confirmed, stable, errors, screenshot: OUT }, null, 2))
  console.log(failed ? 'FAIL' : 'PASS')
} finally {
  try { ws?.close() } catch {}
  edge.kill()
}
process.exitCode = failed ? 1 : 0
