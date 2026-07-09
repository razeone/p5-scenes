// Smoke test: drives the running app over CDP (headless Edge) to verify
// the desktop phase renders and canvas recording produces real video.
//
// Prereq: dev server running (pnpm dev, http://localhost:5173/).
// Usage:  node scripts/verify-rec.mjs [screenshot.png]
//
// Checks: isRecording() toggles true→false, the encoded WebM blob is
// non-empty, no Runtime exceptions fired (a p5 draw crash freezes the
// canvas silently — captureStream then records 0 bytes), and saves a
// screenshot taken mid-recording.
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL_APP = 'http://localhost:5173/'
const PORT = 9223
const OUT = process.argv[2] ?? 'rec-verify.png'

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
  // Wait for the DevTools endpoint.
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
  await send('Page.navigate', { url: URL_APP })
  await sleep(3000) // let p5 set up + boot phase start

  // Spy on the download blob so we can prove real encoded video came out.
  await evaluate(`
    window.__blobSize = -1;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => { if (b instanceof Blob) window.__blobSize = b.size; return orig(b) };
    'spy-ok'
  `)

  await evaluate(`window.__os.setPhase('desktop')`)
  await sleep(1500)

  await evaluate(`window.__os.startRecording()`)
  const recOn = await evaluate(`window.__os.isRecording()`)
  await sleep(1200)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'))

  await sleep(2000)
  await evaluate(`window.__os.stopRecording()`)
  await sleep(1500) // let onstop fire + blob assemble
  const recOff = await evaluate(`window.__os.isRecording()`)
  const blobSize = await evaluate(`window.__blobSize`)

  failed = !recOn || recOff || !(blobSize > 0) || errors.length > 0
  console.log(JSON.stringify({ recOn, recOff, blobSize, errors, screenshot: OUT }, null, 2))
  console.log(failed ? 'FAIL' : 'PASS')
} finally {
  try { ws?.close() } catch {}
  edge.kill()
}
process.exitCode = failed ? 1 : 0
