/**
 * CallWindow.ts — Encrypted videoconference simulation.
 *
 * A 2×2 tile grid: the local operator tile takes a real FeedSource
 * (webcam or file, piped in by the director — slot 'call-self'), the
 * remote participants are procedural "decrypted video" silhouettes with
 * scanline/glitch dressing so they read as secure feeds without needing
 * footage. The call opens with a key-exchange handshake, then runs a
 * timer, rotating speaking indicators, per-tile signal meters, and a
 * decorative control strip — everything an on-camera call scene needs.
 */

import { OSWindow, type OSWindowOpts } from './OSWindow'
import type { OSContext } from '../core/context'
import { fillHex, strokeHex } from '../core/context'
import type { Rect } from '../core/geometry'
import type { FeedSource } from '../media/FeedSource'
import { enableGlow, disableGlow } from '../fx/Effects'

interface Participant {
  name: string
  role: string
  /** Visual variety for the procedural silhouette. */
  seed: number
  cameraOn: boolean
}

const CONNECT_TIME = 2.4

export class CallWindow extends OSWindow {
  /** Local tile source; swapped by the director ('call-self'). */
  feed: FeedSource | null = null
  private participants: Participant[]
  // (OSWindow keeps its own private `born` for the reveal animation.)
  private connectedAt = -1
  /** Director-forced speaker (0..3, 3 = local); null = auto rotation. */
  private speakerOverride: number | null = null
  private dropFor = 0
  private dropUntil = -1

  constructor(o: OSWindowOpts) {
    super(o)
    this.participants = [
      { name: 'DIRECTOR CENTRAL', role: 'SECTOR-0', seed: 17, cameraOn: true },
      { name: 'CMDTE. VIGILANCIA', role: 'SECTOR-11', seed: 53, cameraOn: true },
      { name: 'ANALISTA JEFE', role: 'NODO-4471', seed: 91, cameraOn: false },
    ]
  }

  // Feed ownership stays with OSApp's swapFeed (it disposes the old one).
  setFeed(feed: FeedSource): void {
    this.feed = feed
  }

  /** Hand the floor to the next participant (wraps; includes you). */
  nextSpeaker(): void {
    this.speakerOverride = ((this.speakerOverride ?? -1) + 1) % 4
  }

  /** Signal degradation burst: tiles tear, then recover. */
  dropSignal(seconds = 3): void {
    this.dropFor = seconds
    this.dropUntil = -1
  }

  /** Tear the call down and run the handshake again. */
  reconnect(): void {
    this.connectedAt = -1
    this.speakerOverride = null
    this.dropUntil = -1
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    if (this.connectedAt < 0) this.connectedAt = ctx.t
    const el = ctx.t - this.connectedAt

    const chromeH = 22
    const stripH = 30
    const grid: Rect = {
      x: inner.x,
      y: inner.y + chromeH,
      w: inner.w,
      h: inner.h - chromeH - stripH,
    }

    // --- Top chrome: channel + timer -----------------------------------
    p.push()
    p.noStroke()
    p.textSize(10)
    p.textAlign(p.LEFT, p.CENTER)
    enableGlow(ctx, palette.ok, 0.4)
    fillHex(p, palette.ok)
    p.text('● CANAL CIFRADO // E2E-AES-512', inner.x + 2, inner.y + chromeH / 2)
    disableGlow(ctx)
    p.textAlign(p.RIGHT, p.CENTER)
    fillHex(p, palette.fg)
    const live = Math.max(0, el - CONNECT_TIME)
    const mm = String(Math.floor(live / 60)).padStart(2, '0')
    const ss = String(Math.floor(live) % 60).padStart(2, '0')
    p.text(
      el < CONNECT_TIME ? 'CONECTANDO…' : `EN LLAMADA ${mm}:${ss}`,
      inner.x + inner.w - 2,
      inner.y + chromeH / 2,
    )

    // --- Connecting overlay ---------------------------------------------
    if (el < CONNECT_TIME) {
      this.drawHandshake(ctx, grid, el / CONNECT_TIME)
      this.drawStrip(ctx, inner, stripH, false)
      p.pop()
      return
    }

    // --- Tile grid -------------------------------------------------------
    const gap = 8
    const tw = (grid.w - gap) / 2
    const th = (grid.h - gap) / 2
    // Speaking rotates across everyone (index 3 = the local operator),
    // unless the director has forced the floor.
    const speaking =
      this.speakerOverride ?? Math.floor(ctx.p.noise(ctx.t * 0.18) * 8) % 4
    this.participants.forEach((pp, i) => {
      const tile: Rect = {
        x: grid.x + (i % 2) * (tw + gap),
        y: grid.y + Math.floor(i / 2) * (th + gap),
        w: tw,
        h: th,
      }
      this.drawRemoteTile(ctx, tile, pp, speaking === i)
    })
    const selfTile: Rect = { x: grid.x + tw + gap, y: grid.y + th + gap, w: tw, h: th }
    this.drawSelfTile(ctx, selfTile, speaking === 3)

    // Director-triggered signal degradation.
    if (this.dropFor > 0) {
      this.dropUntil = ctx.t + this.dropFor
      this.dropFor = 0
    }
    if (ctx.t < this.dropUntil) this.drawSignalDrop(ctx, grid)

    this.drawStrip(ctx, inner, stripH, true)
    p.pop()
  }

  /** Heavy interference over the whole grid while the link "recovers". */
  private drawSignalDrop(ctx: OSContext, grid: Rect): void {
    const { p, palette } = ctx
    // Horizontal tears sampled from the call area itself.
    for (let i = 0; i < 6; i++) {
      const ty = grid.y + p.random(grid.h - 12)
      const th2 = p.random(3, 14)
      p.copy(grid.x, ty, grid.w, th2, grid.x + p.random(-30, 30), ty, grid.w, th2)
    }
    p.noStroke()
    p.fill(0, 0, 0, 90 + p.noise(ctx.t * 9) * 60)
    p.rect(grid.x, grid.y, grid.w, grid.h)
    if (Math.floor(ctx.t * 3) % 2 === 0) {
      fillHex(p, palette.warn, 240)
      p.textSize(13)
      p.textAlign(p.CENTER, p.CENTER)
      p.text(
        '⚠ SEÑAL INESTABLE — RECUPERANDO ENLACE ⚠',
        grid.x + grid.w / 2,
        grid.y + grid.h / 2,
      )
    }
  }

  // --- Pieces ------------------------------------------------------------

  private drawHandshake(ctx: OSContext, r: Rect, progress: number): void {
    const { p, palette } = ctx
    const steps = [
      'RESOLVIENDO NODO SEGURO…',
      'INTERCAMBIO DE CLAVES (X25519)…',
      'VERIFICANDO IDENTIDAD ESTATAL…',
      'CANAL ESTABLECIDO',
    ]
    const shown = Math.min(steps.length, Math.floor(progress * (steps.length + 0.5)))
    p.noStroke()
    p.textSize(11)
    p.textAlign(p.LEFT, p.TOP)
    for (let i = 0; i < shown; i++) {
      fillHex(p, i === steps.length - 1 ? palette.ok : palette.fgDim, 220)
      p.text(steps[i], r.x + r.w * 0.28, r.y + r.h * 0.32 + i * 20)
    }
    // Progress bar.
    const bw = r.w * 0.44
    const bx = r.x + r.w * 0.28
    const by = r.y + r.h * 0.32 + steps.length * 20 + 12
    strokeHex(p, palette.grid, 220)
    p.noFill()
    p.rect(bx, by, bw, 10)
    p.noStroke()
    fillHex(p, palette.accent)
    p.rect(bx + 1, by + 1, (bw - 2) * progress, 8)
  }

  private tileChrome(ctx: OSContext, r: Rect, speaking: boolean): void {
    const { p, palette } = ctx
    if (speaking) enableGlow(ctx, palette.ok, 0.5)
    strokeHex(p, speaking ? palette.ok : palette.grid, speaking ? 235 : 200)
    p.strokeWeight(speaking ? 1.5 : 1)
    p.noFill()
    p.rect(r.x, r.y, r.w, r.h)
    disableGlow(ctx)
  }

  private namePlate(
    ctx: OSContext,
    r: Rect,
    name: string,
    role: string,
    speaking: boolean,
  ): void {
    const { p, palette } = ctx
    p.noStroke()
    fillHex(p, palette.bg, 200)
    p.rect(r.x + 1, r.y + r.h - 18, r.w - 2, 17)
    fillHex(p, speaking ? palette.ok : palette.fg, 235)
    p.textSize(9)
    p.textAlign(p.LEFT, p.CENTER)
    p.text(`${name} · ${role}`, r.x + 6, r.y + r.h - 9)
    // Voice bars when speaking.
    if (speaking) {
      for (let i = 0; i < 4; i++) {
        const h = 3 + ctx.p.noise(i * 9, ctx.t * 7) * 9
        fillHex(p, palette.ok)
        p.rect(r.x + r.w - 26 + i * 5, r.y + r.h - 6 - h, 3, h)
      }
    }
  }

  private signalMeter(ctx: OSContext, r: Rect, seed: number): void {
    const { p, palette } = ctx
    const strength = 2 + Math.floor(ctx.p.noise(seed, ctx.t * 0.4) * 3.5)
    for (let i = 0; i < 4; i++) {
      fillHex(p, i < strength ? palette.ok : palette.grid, 220)
      p.rect(r.x + r.w - 22 + i * 5, r.y + 14 - i * 2.5, 3, 3 + i * 2.5)
    }
  }

  private drawRemoteTile(
    ctx: OSContext,
    r: Rect,
    pp: Participant,
    speaking: boolean,
  ): void {
    const { p, palette } = ctx
    p.noStroke()
    p.fill(6, 9, 7)
    p.rect(r.x, r.y, r.w, r.h)

    if (pp.cameraOn) {
      // Procedural "decrypted video": jittering head-and-shoulders bust.
      const cx = r.x + r.w / 2 + (p.noise(pp.seed, ctx.t * 0.7) - 0.5) * 6
      const cy = r.y + r.h * 0.52
      const headR = Math.min(r.w, r.h) * 0.16
      const sway = Math.sin(ctx.t * 0.8 + pp.seed) * 2
      const col = p.color(palette.fg)
      col.setAlpha(70)
      p.fill(col)
      // Shoulders.
      p.ellipse(cx + sway * 0.4, cy + headR * 2.1, headR * 4.4, headR * 2.6)
      // Head, with a talking bob.
      const bob = speaking ? Math.sin(ctx.t * 10) * 1.5 : 0
      p.ellipse(cx + sway, cy - headR * 0.2 + bob, headR * 2, headR * 2.4)
      // Scanlines over the "video".
      const scan = p.color(palette.bg)
      scan.setAlpha(90)
      p.fill(scan)
      for (let y = r.y + 2; y < r.y + r.h; y += 4) p.rect(r.x, y, r.w, 1.5)
      // Occasional horizontal tear.
      if (p.noise(pp.seed + 3, ctx.t * 1.7) > 0.78) {
        const ty = r.y + p.noise(pp.seed + 5, ctx.t * 9) * (r.h - 10)
        p.copy(r.x, ty, r.w, 6, r.x + p.random(-12, 12), ty, r.w, 6)
      }
    } else {
      // Camera off: initials avatar.
      const cx = r.x + r.w / 2
      const cy = r.y + r.h / 2 - 6
      strokeHex(p, palette.fgDim, 200)
      p.noFill()
      p.circle(cx, cy, Math.min(r.w, r.h) * 0.34)
      p.noStroke()
      fillHex(p, palette.fgDim)
      p.textSize(Math.min(r.w, r.h) * 0.14)
      p.textAlign(p.CENTER, p.CENTER)
      const initials = pp.name
        .split(' ')
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
      p.text(initials, cx, cy)
      p.textSize(8)
      p.text('CÁMARA DESACTIVADA', cx, cy + Math.min(r.w, r.h) * 0.26)
    }

    this.tileChrome(ctx, r, speaking)
    this.namePlate(ctx, r, pp.name, pp.role, speaking)
    this.signalMeter(ctx, r, pp.seed)
  }

  private drawSelfTile(ctx: OSContext, r: Rect, speaking: boolean): void {
    const { p, palette } = ctx
    const op = ctx.config.operator
    p.noStroke()
    p.fill(6, 9, 7)
    p.rect(r.x, r.y, r.w, r.h)

    let live = false
    if (this.feed) {
      const dc = p.drawingContext as CanvasRenderingContext2D
      dc.save()
      dc.beginPath()
      dc.rect(r.x, r.y, r.w, r.h)
      dc.clip()
      live = this.feed.draw(ctx, r)
      dc.restore()
    }
    if (!live) {
      const cx = r.x + r.w / 2
      const cy = r.y + r.h / 2 - 6
      p.noStroke()
      fillHex(p, palette.fgDim)
      p.textSize(9)
      p.textAlign(p.CENTER, p.CENTER)
      p.text('TU CÁMARA — WEBCAM→LLAMADA', cx, cy)
    }

    this.tileChrome(ctx, r, speaking)
    this.namePlate(ctx, r, `${op.user} (TÚ)`, op.node, speaking)
  }

  private drawStrip(
    ctx: OSContext,
    inner: Rect,
    stripH: number,
    live: boolean,
  ): void {
    const { p, palette } = ctx
    const sy = inner.y + inner.h - stripH
    strokeHex(p, palette.grid, 200)
    p.line(inner.x, sy, inner.x + inner.w, sy)
    // Decorative controls, centered.
    const items: [string, boolean][] = [
      ['MIC', live],
      ['CÁM', live],
      ['CIFRAR', true],
      ['FIN', false],
    ]
    const bw = 64
    const totalW = items.length * (bw + 8) - 8
    let bx = inner.x + (inner.w - totalW) / 2
    p.textSize(9)
    for (const [label, on] of items) {
      const danger = label === 'FIN'
      const col = danger ? palette.danger : on ? palette.fg : palette.fgDim
      strokeHex(p, col, 190)
      p.noFill()
      p.rect(bx, sy + 6, bw, stripH - 12)
      p.noStroke()
      fillHex(p, col, 230)
      p.textAlign(p.CENTER, p.CENTER)
      p.text(label, bx + bw / 2, sy + stripH / 2)
      bx += bw + 8
    }
  }
}
