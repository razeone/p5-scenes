import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL_APP = 'http://localhost:5173/'
const PORT = 9229
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const profile = mkdtempSync(join(tmpdir(), 'edge-cdp-'))
const edge = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--window-size=1280,720',
  'about:blank',
], { stdio: 'ignore' })

let ws
let failed = true
try {
  let target
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const pages = await (await fetch(`http://localhost:${PORT}/json`)).json()
      target = pages.find((page) => page.type === 'page')
      if (target) break
    } catch {}
    await sleep(200)
  }
  if (!target) throw new Error('no CDP page target - is Edge installed?')

  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })

  let id = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    } else if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails?.exception?.description ?? 'exception')
    }
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const messageId = ++id
    const timer = setTimeout(() => {
      pending.delete(messageId)
      reject(new Error(`CDP timeout: ${method}`))
    }, 30000)
    pending.set(messageId, (message) => {
      clearTimeout(timer)
      resolve(message)
    })
    ws.send(JSON.stringify({ id: messageId, method, params }))
  })
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (response.result?.exceptionDetails) {
      throw new Error(`eval failed: ${JSON.stringify(response.result.exceptionDetails)}`)
    }
    return response.result?.result?.value
  }
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: URL_APP })
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(300)
    if (await evaluate(`typeof window.__os !== 'undefined'`)) break
  }

  await evaluate(`window.__os.setCaptureFormat('window')`)
  await evaluate(`window.__os.setPhase('silence')`)
  await evaluate(`(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 360
    const context = canvas.getContext('2d')
    let frame = 0
    setInterval(() => {
      frame += 1
      context.fillStyle = '#06130a'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = '#39ff88'
      context.fillRect((frame * 4) % canvas.width, 100, 80, 160)
    }, 33)
    navigator.mediaDevices.getUserMedia = () => Promise.resolve(canvas.captureStream(30))
    return 'synthetic-webcam-ready'
  })()`)
  await evaluate(`window.__os.useWebcam('silence')`)
  await sleep(1800)

  const before = await evaluate(`({
    feed: window.__osDebug.feeds()[0],
    clock: window.__osDebug.clock(),
    state: window.__osDebug.sceneState(),
  })`)
  await evaluate(`window.__osDebug.toggleSilence()`)
  await sleep(250)
  const frozenStart = await evaluate(`({
    feed: window.__osDebug.feeds()[0],
    clock: window.__osDebug.clock(),
    state: window.__osDebug.sceneState(),
  })`)
  await sleep(1200)
  const frozenEnd = await evaluate(`({
    feed: window.__osDebug.feeds()[0],
    clock: window.__osDebug.clock(),
    state: window.__osDebug.sceneState(),
  })`)
  await evaluate(`window.__osDebug.toggleSilence()`)
  await sleep(700)
  const resumed = await evaluate(`({
    feed: window.__osDebug.feeds()[0],
    clock: window.__osDebug.clock(),
    state: window.__osDebug.sceneState(),
  })`)

  const frozenDelta = Math.abs(frozenEnd.feed.currentTime - frozenStart.feed.currentTime)
  const checks = {
    feedWasPlaying: before.feed && before.feed.paused === false,
    silencedStateActive:
      frozenStart.state.silenced === true && frozenEnd.state.silenced === true,
    feedPausedDuringSilenced:
      frozenStart.feed.paused === true && frozenEnd.feed.paused === true,
    frameTimeFrozen: frozenDelta < 0.03,
    sceneClockContinues: frozenEnd.clock.time - frozenStart.clock.time > 0.9,
    resumesOnSecondClick:
      resumed.state.silenced === false &&
      resumed.feed.paused === false &&
      resumed.feed.currentTime > frozenEnd.feed.currentTime + 0.3,
    noRuntimeErrors: errors.length === 0,
  }
  failed = Object.values(checks).some((value) => !value)
  console.log(JSON.stringify({ checks, frozenDelta, before, frozenStart, frozenEnd, resumed, errors }, null, 2))
  console.log(failed ? 'FAIL' : 'PASS')
} finally {
  try { ws?.close() } catch {}
  edge.kill()
}

process.exitCode = failed ? 1 : 0
