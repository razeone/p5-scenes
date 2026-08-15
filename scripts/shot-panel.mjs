// Ad-hoc visual check: expands every director-panel section (and
// optionally the `?` overlay) and screenshots the result, so layout
// regressions in the panel are visible without shooting a whole take.
//
// Prereq: dev server running (pnpm dev).
// Usage: node scripts/shot-panel.mjs [out.png] [phase] [--keys] [--mobile] [--theme=amber]
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9226
const OUT = process.argv[2] ?? 'panel-shot.png'
const PHASE = process.argv[3] ?? 'geo'
const KEYS = process.argv.includes('--keys')
const MOBILE = process.argv.includes('--mobile')
const THEME = process.argv.find((arg) => arg.startsWith('--theme='))?.slice(8)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = mkdtempSync(join(tmpdir(), 'edge-cdp-'))
const edge = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  'about:blank',
], { stdio: 'ignore' })

let ws
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
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const send = (method, params = {}) =>
    new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: MOBILE ? 390 : 1500,
    height: MOBILE ? 844 : 1200,
    deviceScaleFactor: 1,
    mobile: MOBILE,
  })
  await send('Page.navigate', { url: 'http://localhost:5173/' })
  for (let i = 0; i < 60; i++) {
    await sleep(500)
    if (await evaluate(`typeof window.__os !== 'undefined'`)) break
  }
  await evaluate(`window.__os.setCaptureFormat('window')`)
  await evaluate(`window.__os.setPhase('${PHASE}')`)
  if (THEME) await evaluate(`window.__os.setTheme(${JSON.stringify(THEME)})`)
  await sleep(2500)
  // Open every collapsed section.
  await evaluate(`[...document.querySelectorAll('.ctrl-sec')]
    .filter((s) => s.getAttribute('aria-expanded') === 'false')
    .forEach((s) => s.click()); 'expanded'`)
  await sleep(600)
  if (KEYS) {
    await evaluate(`[...document.querySelectorAll('.ctrl-x')].find((b) => b.textContent.trim() === '?')?.click(); 'keys'`)
    await sleep(400)
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'))
  console.log(`saved ${OUT} (phase ${PHASE}${THEME ? `, theme ${THEME}` : ''}${KEYS ? ', keys overlay' : ''}${MOBILE ? ', mobile' : ''})`)
} finally {
  try { ws?.close() } catch {}
  edge.kill()
}
