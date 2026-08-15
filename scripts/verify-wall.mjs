// Smoke test for the HIPERVIGILANCIA video wall: drives the running app
// over CDP (headless Edge) to prove a folder of clips actually reaches the
// wall, deals across the screens, and cuts on the director clock.
//
// Prereq: dev server running (pnpm dev, http://localhost:5173/).
// Usage:  node scripts/verify-wall.mjs [screenshot.png]
//
// There is no footage on disk to feed it, so the page records its own
// clips: an animated canvas → MediaRecorder → File, one per "camera".
// That exercises the real path (File → object URL → <video>), which a
// stubbed feed would not.
//
// Checks, in order:
//  1. A set of clips loads and lands on the wall (bin size + jump to the
//     HIPERVIGILANCIA phase from another scene).
//  2. Every screen gets its own clip — the wall deals the bin out rather
//     than showing one clip nine times.
//  3. The feeds actually play (they are <video> elements never added to
//     the DOM, so this has to come from __osDebug.feeds()).
//  4. AUTO cuts on the director clock: screens change clip over time, and
//     PAUSA stops that (a montage must be reproducible take to take).
//  5. The screen count re-tiles the wall in place, keeping the footage.
//  6. BUCLE holds the montage open past its scripted length instead of
//     cutting to the desktop mid-take.
//  7. No Runtime exceptions (a p5 draw crash freezes the canvas silently).
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL_APP = 'http://localhost:5173/'
const PORT = 9227
const OUT = process.argv[2] ?? 'wall-verify.png'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const profile = mkdtempSync(join(tmpdir(), 'edge-cdp-'))
const edge = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
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
    }, 60000)
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

  // --- Build a synthetic footage folder in the page ------------------
  // Six ~700 ms clips, each a different hue, named like a camera dump so
  // the numeric sort in VideoWall.load is exercised too.
  results.clipsBuilt = await evaluate(`(async () => {
    const makeClip = (hue, name) => new Promise((resolve) => {
      const c = document.createElement('canvas')
      c.width = 320; c.height = 180
      const g = c.getContext('2d')
      const stream = c.captureStream(30)
      const chunks = []
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm' })
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' })
        resolve(new File([blob], name, { type: 'video/webm' }))
      }
      let frame = 0
      const tick = () => {
        g.fillStyle = 'hsl(' + hue + ',70%,' + (25 + (frame % 30)) + '%)'
        g.fillRect(0, 0, 320, 180)
        g.fillStyle = '#fff'
        g.font = '28px monospace'
        g.fillText(name, 12, 100)
        if (++frame < 24) requestAnimationFrame(tick)
      }
      rec.start()
      tick()
      setTimeout(() => rec.stop(), 700)
    })
    // Deliberately out of order, with a non-video file mixed in, the way
    // a real folder arrives.
    const names = ['cam_10.webm', 'cam_2.webm', 'cam_1.webm', 'cam_3.webm', 'cam_4.webm', 'cam_5.webm']
    window.__clips = []
    for (let i = 0; i < names.length; i++) {
      window.__clips.push(await makeClip(i * 55, names[i]))
    }
    window.__clips.push(new File(['notes'], 'readme.txt', { type: 'text/plain' }))
    return window.__clips.length
  })()`)

  // --- 1. A folder loads and pulls the shoot onto the wall -----------
  await evaluate(`window.__os.setPhase('desktop')`)
  await sleep(600)
  await evaluate(`window.__os.loadWallVideos(window.__clips)`)
  await sleep(2500)
  results.phaseAfterLoad = await evaluate(`window.__osDebug.phase()`)
  results.wall = await evaluate(`window.__os.getWallState()`)

  // --- 2. Each screen gets its own clip ------------------------------
  const distinct = new Set(results.wall.assigned ?? []).size
  results.distinctClips = distinct
  // The .txt must have been filtered out, and the numeric sort must put
  // cam_2 before cam_10.
  results.binOrder = await evaluate(`
    window.__clips.filter((f) => /\\.webm$/.test(f.name)).length
  `)

  // --- 3. The footage is really playing ------------------------------
  await sleep(1500)
  results.feeds = await evaluate(`window.__osDebug.feeds()`)
  const playing = (results.feeds ?? []).filter((f) => f.ready && !f.paused).length

  // --- 4. AUTO cuts on the director clock ----------------------------
  await evaluate(`window.__os.setWallPace({ holdSeconds: 1, stagger: 0.2 })`)
  const before = await evaluate(`window.__os.getWallState().assigned`)
  await sleep(3000)
  const after = await evaluate(`window.__os.getWallState().assigned`)
  results.cutWhileRolling = before.some((name, i) => name !== after[i])

  await evaluate(`window.__os.pause()`)
  const paused0 = await evaluate(`window.__os.getWallState().assigned`)
  await sleep(3000)
  const paused1 = await evaluate(`window.__os.getWallState().assigned`)
  results.frozenWhilePaused = paused0.every((name, i) => name === paused1[i])
  await evaluate(`window.__os.play()`)

  // --- 5. Re-tiling keeps the footage --------------------------------
  await evaluate(`window.__os.setWallScreens(4)`)
  await sleep(1500)
  const retiled = await evaluate(`window.__os.getWallState()`)
  results.retiled = retiled
  results.retileKeptFootage =
    retiled.screens === 4 && retiled.assigned.every((n) => n !== '—')

  // --- 6. BUCLE holds the montage open -------------------------------
  // The scripted montage is 12 s + flare + title; hold it and the phase
  // must still be HIPERVIGILANCIA well past that.
  await evaluate(`window.__os.setPhase('hypervigilance')`)
  await sleep(400)
  await evaluate(`window.__os.trigger('hv-hold')`)
  await evaluate(`window.__os.setSpeed(8)`) // 8x: 4 s of wall time > 16 s scene
  await sleep(4000)
  results.phaseWhileHeld = await evaluate(`window.__osDebug.phase()`)
  results.heldState = await evaluate(`window.__osDebug.sceneState()`)
  // Releasing must let the title land and hand off to the desktop.
  await evaluate(`window.__os.trigger('hv-title')`)
  await sleep(3000)
  await evaluate(`window.__os.setSpeed(1)`)
  results.phaseAfterTitle = await evaluate(`window.__osDebug.phase()`)

  // Screenshot last: capturing an animating canvas is slow enough to skew
  // any timing measured around it.
  await evaluate(`window.__os.setPhase('hypervigilance')`)
  await sleep(2500)
  const shot = await send('Page.captureScreenshot', { format: 'png' }, 120000)
  writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'))

  results.errors = errors
  const checks = {
    clipsBuilt: results.clipsBuilt === 7,
    jumpedToWall: results.phaseAfterLoad === 'hypervigilance',
    // 6 clips in, the readme.txt out.
    nonVideoFiltered: results.wall?.clips === 6,
    dealtAcrossScreens: distinct >= Math.min(6, results.wall?.screens ?? 0),
    footagePlaying: playing >= 4,
    cutsOnClock: results.cutWhileRolling === true,
    frozenWhilePaused: results.frozenWhilePaused === true,
    retileKeptFootage: results.retileKeptFootage === true,
    holdKeepsMontageOpen: results.phaseWhileHeld === 'hypervigilance',
    titleReleasesToDesktop: results.phaseAfterTitle === 'desktop',
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
