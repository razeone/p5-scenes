// Smoke test: drives the running app over CDP (headless Edge) to verify
// the GEO tracking scene renders OpenStreetMap tiles and survives its
// director cues (intercept, zoom, city jump) without draw-loop crashes.
//
// Prereq: dev server running (pnpm dev, http://localhost:5173/).
// Usage:  node scripts/verify-geo.mjs [screenshot.png]
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL_APP = 'http://localhost:5173/'
const PORT = 9224
const OUT = process.argv[2] ?? 'geo-verify.png'

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
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true })
    if (r.result?.exceptionDetails) {
      throw new Error('eval failed: ' + JSON.stringify(r.result.exceptionDetails))
    }
    return r.result?.result?.value
  }

  await send('Runtime.enable')
  await send('Page.enable')
  // --window-size is not reliably honored by headless Edge here; force it.
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1600, height: 900, deviceScaleFactor: 1, mobile: false,
  })
  await send('Page.navigate', { url: URL_APP })
  await sleep(3000)

  await evaluate(`window.__os.setPhase('geo')`)
  const phase = await evaluate(`window.__os.getPhase()`)
  await sleep(6000) // let tiles stream in

  // Poke the director cues the scene claims to support.
  for (const cue of ['geo-chase', 'geo-zoom-in', 'geo-follow', 'geo-city']) {
    await evaluate(`window.__os.trigger('${cue}')`)
    await sleep(400)
  }
  await sleep(4000) // tiles for the new city + zoom level

  // A frozen draw loop means a crashed p5 sketch — verify frames advance.
  const f1 = await evaluate(`window.__osDebug.clock().frame`)
  await sleep(500)
  const f2 = await evaluate(`window.__osDebug.clock().frame`)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'))

  failed = phase !== 'geo' || !(f2 > f1) || errors.length > 0
  console.log(JSON.stringify({ phase, framesAdvancing: f2 > f1, errors, screenshot: OUT }, null, 2))
  console.log(failed ? 'FAIL' : 'PASS')
} finally {
  try { ws?.close() } catch {}
  edge.kill()
}
process.exitCode = failed ? 1 : 0
