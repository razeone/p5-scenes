// Smoke test: drives the running app over CDP (headless Edge) to verify
// the GALERÍA dossier scene loads synthetic image files, renders the
// target cards, and survives its director cues (silence/capture all,
// advance, reroll, paginate) without draw-loop crashes.
//
// Prereq: dev server running (pnpm dev, http://localhost:5173/).
// Usage:  node scripts/verify-gallery.mjs [screenshot.png]
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL_APP = process.env.APP_URL ?? 'http://localhost:5173/'
const PORT = 9225
const OUT = process.argv[2] ?? 'gallery-verify.png'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  const send = (method, params = {}) =>
    new Promise((res) => {
      const mid = ++id
      pending.set(mid, res)
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
  const evaluate = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })
    if (r.result?.exceptionDetails) {
      throw new Error('eval failed: ' + JSON.stringify(r.result.exceptionDetails))
    }
    return r.result?.result?.value
  }

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1600, height: 900, deviceScaleFactor: 1, mobile: false,
  })
  await send('Page.navigate', { url: URL_APP })
  await sleep(3000)

  await evaluate(`window.__os.setPhase('gallery')`)

  // Synthesize a handful of PNG "mugshots" as File objects and feed them
  // through the same path the director's file picker uses.
  const loaded = await evaluate(`(async () => {
    const files = []
    for (let i = 0; i < 7; i++) {
      const c = document.createElement('canvas')
      c.width = 200; c.height = 260
      const g = c.getContext('2d')
      g.fillStyle = 'hsl(' + (i * 47) + ',40%,45%)'
      g.fillRect(0, 0, c.width, c.height)
      g.fillStyle = 'rgba(0,0,0,0.35)'
      g.beginPath(); g.arc(100, 110, 55, 0, Math.PI * 2); g.fill()
      g.fillStyle = '#fff'; g.font = '40px monospace'; g.textAlign = 'center'
      g.fillText('#' + (i + 1), 100, 230)
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
      files.push(new File([blob], 'objetivo-' + i + '.png', { type: 'image/png' }))
    }
    window.__os.loadGalleryImages(files)
    return files.length
  })()`, true)

  await sleep(1500) // let images decode + cards render

  // Poke the director cues the scene claims to support.
  for (const cue of ['gallery-silence-all', 'gallery-capture-all', 'gallery-advance', 'gallery-reroll', 'gallery-next-page', 'gallery-prev-page']) {
    await evaluate(`window.__os.trigger('${cue}')`)
    await sleep(300)
  }
  await sleep(800)

  const phase = await evaluate(`window.__os.getPhase()`)
  // A frozen draw loop means a crashed p5 sketch — verify frames advance.
  const f1 = await evaluate(`window.__osDebug.clock().frame`)
  await sleep(500)
  const f2 = await evaluate(`window.__osDebug.clock().frame`)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'))

  failed = phase !== 'gallery' || loaded !== 7 || !(f2 > f1) || errors.length > 0
  console.log(JSON.stringify({ phase, loaded, framesAdvancing: f2 > f1, errors, screenshot: OUT }, null, 2))
  console.log(failed ? 'FAIL' : 'PASS')
} finally {
  try { ws?.close() } catch {}
  edge.kill()
}
process.exitCode = failed ? 1 : 0
