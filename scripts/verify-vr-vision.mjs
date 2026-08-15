import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL_APP = 'http://localhost:5173/'
const PORT = 9228
const OUT = process.argv[2] ?? 'vr-vision-verify.png'
const OPTICAL_OUT = process.argv[3] ?? 'vr-optical-verify.png'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
  for (let i = 0; i < 50; i += 1) {
    try {
      const pages = await (await fetch(`http://localhost:${PORT}/json`)).json()
      target = pages.find((page) => page.type === 'page')
      if (target) break
    } catch {}
    await sleep(200)
  }
  if (!target) throw new Error('no CDP page target — is Edge installed?')

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
  const waitForApp = async () => {
    for (let i = 0; i < 60; i += 1) {
      await sleep(300)
      if (await evaluate(`typeof window.__os !== 'undefined'`)) return
    }
    throw new Error('app never became ready — is pnpm dev running?')
  }

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: URL_APP })
  await waitForApp()
  await evaluate(`localStorage.removeItem('panopticon.vr-vision.v1')`)
  await send('Page.reload')
  await sleep(500)
  await waitForApp()
  await evaluate(`window.__os.setPhase('vr-vision')`)
  await sleep(500)

  await evaluate(`(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 480
    const context = canvas.getContext('2d')
    let frame = 0
    setInterval(() => {
      frame += 1
      context.fillStyle = '#111'
      context.fillRect(0, 0, 640, 480)
      context.fillStyle = '#ddd'
      context.fillRect(180 + Math.sin(frame / 20) * 80, 90, 220, 310)
      context.fillStyle = '#222'
      context.fillRect(235 + Math.sin(frame / 20) * 80, 145, 42, 42)
      context.fillRect(315 + Math.sin(frame / 20) * 80, 145, 42, 42)
    }, 33)
    navigator.mediaDevices.getUserMedia = () => Promise.resolve(canvas.captureStream(30))
    return 'synthetic-webcam-ready'
  })()`)
  await evaluate(`window.__os.useWebcam('vr-vision')`)
  await sleep(1500)

  await evaluate(`window.__os.setVrFrameStyle('optical')`)
  await evaluate(`document.querySelector('.ctrl').style.display = 'none'`)
  const opticalShot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(OPTICAL_OUT, Buffer.from(opticalShot.result.data, 'base64'))
  await evaluate(`document.querySelector('.ctrl').style.display = ''`)

  const styles = ['optical', 'mechanical', 'photographic', 'clinical']
  const observedStyles = []
  for (const style of styles) {
    await evaluate(`window.__os.setVrFrameStyle(${JSON.stringify(style)})`)
    observedStyles.push(await evaluate(`window.__osDebug.sceneState().frame`))
  }

  await evaluate(`window.__os.pause()`)
  await evaluate(`window.__os.queueVrMessage('ABRA LOS OJOS', 'warn', 2)`)
  await evaluate(`window.__os.sendVrMessage()`)
  await sleep(2300)
  const pausedCue = await evaluate(`window.__osDebug.vrVision().active?.text ?? null`)
  await evaluate(`window.__os.step(2.1)`)
  await sleep(300)
  const expiredState = await evaluate(`window.__osDebug.vrVision()`)

  await evaluate(`window.__os.queueVrMessage('RECUERDE EL MUELLE', 'info', 6)`)
  const beforeReload = await evaluate(`window.__osDebug.vrVision()`)
  await send('Page.reload')
  await waitForApp()
  const afterReload = await evaluate(`window.__osDebug.vrVision()`)

  await evaluate(`window.__os.setPhase('vr-vision')`)
  await sleep(500)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'))

  const checks = {
    phase: await evaluate(`window.__os.getPhase()`) === 'vr-vision',
    allFrames: JSON.stringify(observedStyles) === JSON.stringify(styles),
    cuePausedWithClock: pausedCue === 'ABRA LOS OJOS',
    cueExpiredAfterStep:
      expiredState.active === null && expiredState.history[0]?.text === 'ABRA LOS OJOS',
    settingsPersisted: afterReload.settings.frameStyle === beforeReload.settings.frameStyle,
    queuePersisted: afterReload.queue.some((message) => message.text === 'RECUERDE EL MUELLE'),
    mediaNotPersisted: !(await evaluate(`window.__osDebug.slots()`))
      .some((slot) => slot.kind !== 'none'),
    noRuntimeErrors: errors.length === 0,
  }
  failed = Object.values(checks).some((value) => !value)
  console.log(JSON.stringify({
    checks,
    observedStyles,
    errors,
    screenshot: OUT,
    opticalScreenshot: OPTICAL_OUT,
  }, null, 2))
  console.log(failed ? 'FAIL' : 'PASS')
} finally {
  try { ws?.close() } catch {}
  edge.kill()
}

process.exitCode = failed ? 1 : 0