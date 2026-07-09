/**
 * Effects.ts — CRT post-processing + shared visual helpers.
 *
 * These give the fictional OS its "filmed off a monitor" atmosphere:
 * a phosphor grid background, scanlines, edge vignette, subtle flicker,
 * and occasional glitch tears. Everything is driven by CONFIG.crt so a
 * director can dial the grit up or down per scene.
 *
 * Glow uses the underlying Canvas2D shadowBlur (cheap, looks great on
 * monospace text) via enableGlow()/disableGlow().
 */

import type { OSContext } from '../core/context'
import { fillHex, strokeHex } from '../core/context'

/** Turn on canvas shadow-based bloom. Wrap draws, then disableGlow(). */
export function enableGlow(ctx: OSContext, color?: string, amount = 1): void {
  const g = ctx.config.crt.glow * amount
  if (g <= 0) return
  const dc = ctx.p.drawingContext as CanvasRenderingContext2D
  dc.shadowBlur = 8 + g * 16
  dc.shadowColor = color ?? ctx.palette.glow
}

export function disableGlow(ctx: OSContext): void {
  const dc = ctx.p.drawingContext as CanvasRenderingContext2D
  dc.shadowBlur = 0
  dc.shadowColor = 'transparent'
}

/** Deep background wash + faint reference grid. Call first each frame. */
export function drawBackground(ctx: OSContext): void {
  const { p, palette, width, height } = ctx
  p.background(palette.bg)

  p.push()
  strokeHex(p, palette.grid, 90)
  p.strokeWeight(1)
  const step = 44
  // Slow vertical drift so the grid feels alive on camera.
  const drift = (ctx.t * 8) % step
  for (let x = 0; x <= width; x += step) {
    p.line(x, 0, x, height)
  }
  for (let y = -step + drift; y <= height; y += step) {
    p.line(0, y, width, y)
  }
  p.pop()
}

/** Horizontal CRT scanlines drawn over the whole frame. */
export function drawScanlines(ctx: OSContext): void {
  const { p, width, height, config } = ctx
  const { scanlineIntensity, scanlineGap } = config.crt
  if (scanlineIntensity <= 0) return
  p.push()
  p.noStroke()
  p.fill(0, 0, 0, scanlineIntensity * 255)
  for (let y = 0; y < height; y += scanlineGap * 2) {
    p.rect(0, y, width, scanlineGap)
  }
  p.pop()
}

/** Radial darkening toward the edges — screen curvature suggestion. */
export function drawVignette(ctx: OSContext): void {
  const { p, width, height, config } = ctx
  const strength = config.crt.vignette
  if (strength <= 0) return
  const dc = p.drawingContext as CanvasRenderingContext2D
  const cx = width / 2
  const cy = height / 2
  const grad = dc.createRadialGradient(
    cx,
    cy,
    Math.min(width, height) * 0.35,
    cx,
    cy,
    Math.max(width, height) * 0.75,
  )
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(1, `rgba(0,0,0,${strength})`)
  p.push()
  p.noStroke()
  dc.fillStyle = grad
  dc.fillRect(0, 0, width, height)
  p.pop()
}

/** Whole-screen brightness flicker + rare glitch tear bars. */
export function drawFlickerAndGlitch(ctx: OSContext): void {
  const { p, width, height, config } = ctx

  // Baseline flicker: a faint dark/light wash that jitters frame to frame.
  const f = config.crt.flicker
  if (f > 0) {
    const n = p.noise(ctx.t * 8) - 0.5
    p.push()
    p.noStroke()
    if (n > 0) p.fill(255, 255, 255, n * f * 60)
    else p.fill(0, 0, 0, -n * f * 90)
    p.rect(0, 0, width, height)
    p.pop()
  }

  // Occasional glitch: a few horizontal tears sampled from the canvas,
  // plus bright scan bars. Cheap and reads well on camera.
  if (p.random() < config.crt.glitchChance) {
    const tears = Math.floor(p.random(2, 5))
    for (let i = 0; i < tears; i++) {
      const y = p.random(height)
      const h = p.random(4, 26)
      const shift = p.random(-40, 40)
      // Displace a slice of the frame horizontally.
      p.copy(0, y, width, h, shift, y, width, h)
    }
    p.push()
    p.noStroke()
    fillHex(p, ctx.palette.accent, p.random(30, 90))
    const by = p.random(height)
    p.rect(0, by, width, p.random(1, 3))
    p.pop()
  }
}

/**
 * Full post chain in the right order. Call after the scene has drawn.
 */
export function applyPost(ctx: OSContext): void {
  drawScanlines(ctx)
  drawVignette(ctx)
  drawFlickerAndGlitch(ctx)
}
