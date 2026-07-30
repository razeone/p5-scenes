/**
 * LoginWindow.ts — Interactive authentication panel for El Buen Gobierno.
 *
 * Real keyboard interaction for on-set filming:
 *   1. The actor types the OPERATOR ID, presses Enter.
 *   2. Types the PASSCODE (masked as dots), presses Enter.
 *   3. AUTHENTICATING bar runs, then credentials are validated against
 *      CONFIG.operator → ACCESS GRANTED (fires onComplete) or
 *      ACCESS DENIED (flashes, then resets for another attempt).
 *
 * The Ministry's scanning-eye emblem crowns the panel.
 */

import { OSWindow, type OSWindowOpts } from './OSWindow'
import type { OSContext } from '../core/context'
import { fillHex, strokeHex } from '../core/context'
import type { KeyTarget } from '../core/Entity'
import type { Rect } from '../core/geometry'
import { enableGlow, disableGlow } from '../fx/Effects'

type LoginState = 'user' | 'pass' | 'auth' | 'granted' | 'denied' | 'done'

const MAX_FIELD_LEN = 24

export class LoginWindow extends OSWindow implements KeyTarget {
  onComplete?: () => void

  private state: LoginState = 'user'
  private stateStart = -1
  private userInput = ''
  private passInput = ''
  private attempts = 0
  private autoType = false
  private autoIndex = 0

  constructor(o: OSWindowOpts, options: { autoType?: boolean } = {}) {
    super(o)
    this.autoType = options.autoType ?? false
  }

  handleKey(ctx: OSContext, key: string): void {
    if (this.state !== 'user' && this.state !== 'pass') return
    this.autoType = false

    const field = this.state === 'user' ? 'userInput' : 'passInput'
    if (key === 'Enter') {
      if (this.state === 'user' && this.userInput.length > 0) {
        this.enter('pass', ctx)
      } else if (this.state === 'pass' && this.passInput.length > 0) {
        this.enter('auth', ctx)
      }
    } else if (key === 'Backspace') {
      this[field] = this[field].slice(0, -1)
    } else if (key.length === 1 && this[field].length < MAX_FIELD_LEN) {
      // Uppercase to match the terminal aesthetic.
      this[field] += key.toUpperCase()
    }
  }

  private enter(state: LoginState, ctx: OSContext): void {
    this.state = state
    this.stateStart = ctx.t
    this.autoIndex = 0
  }

  private credentialsValid(ctx: OSContext): boolean {
    const op = ctx.config.operator
    return (
      this.userInput.trim() === op.user.toUpperCase() &&
      this.passInput === op.password.toUpperCase()
    )
  }

  update(ctx: OSContext): void {
    if (this.stateStart < 0) this.stateStart = ctx.t
    const el = ctx.t - this.stateStart

    if (this.autoType && (this.state === 'user' || this.state === 'pass')) {
      const source =
        this.state === 'user'
          ? ctx.config.operator.user.toUpperCase()
          : ctx.config.operator.password.toUpperCase()
      const target = this.state === 'user' ? this.userInput : this.passInput
      const nextIndex = Math.floor(
        (el * 1000) / Math.max(1, ctx.config.timing.loginTypeSpeed),
      )
      if (nextIndex > this.autoIndex && target.length < source.length) {
        const value = source[target.length]
        if (this.state === 'user') this.userInput += value
        else this.passInput += value
        this.autoIndex = nextIndex
      }
      if (target.length >= source.length) {
        this.enter(this.state === 'user' ? 'pass' : 'auth', ctx)
      }
      return
    }

    switch (this.state) {
      case 'auth': {
        if (el > ctx.config.timing.authDuration / 1000) {
          if (this.credentialsValid(ctx)) this.enter('granted', ctx)
          else {
            this.attempts++
            this.enter('denied', ctx)
          }
        }
        break
      }
      case 'granted': {
        if (el > 1.6) {
          this.state = 'done'
          this.onComplete?.()
        }
        break
      }
      case 'denied': {
        if (el > 2.0) {
          // Reset for another attempt.
          this.userInput = ''
          this.passInput = ''
          this.enter('user', ctx)
        }
        break
      }
      default:
        break
    }
  }

  /** The Ministry's scanning-eye emblem. */
  private eye(ctx: OSContext, cx: number, cy: number, r: number): void {
    const { p, palette } = ctx
    p.push()
    p.noFill()
    enableGlow(ctx, palette.accent, 0.8)
    strokeHex(p, palette.fg)
    p.strokeWeight(1.5)
    // Almond outline.
    p.beginShape()
    for (let a = -1; a <= 1; a += 0.05) {
      p.vertex(cx + a * r, cy - Math.cos((a * Math.PI) / 2) * r * 0.55)
    }
    for (let a = 1; a >= -1; a -= 0.05) {
      p.vertex(cx + a * r, cy + Math.cos((a * Math.PI) / 2) * r * 0.55)
    }
    p.endShape(p.CLOSE)
    // Iris scans left/right; snaps to center while authenticating.
    const scan =
      this.state === 'auth' || this.state === 'granted'
        ? 0
        : Math.sin(ctx.t * 1.2) * r * 0.4
    const irisCol = this.state === 'denied' ? palette.danger : palette.accent
    strokeHex(p, irisCol)
    p.circle(cx + scan, cy, r * 0.5)
    fillHex(p, irisCol)
    p.noStroke()
    p.circle(cx + scan, cy, r * 0.16)
    disableGlow(ctx)
    p.pop()
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    const cx = inner.x + inner.w / 2

    this.eye(ctx, cx, inner.y + 42, 46)

    p.push()
    p.textAlign(p.CENTER, p.TOP)
    fillHex(p, palette.fgDim)
    p.textSize(11)
    p.text(ctx.config.agency, cx, inner.y + 94)
    fillHex(p, palette.fg)
    p.textSize(16)
    p.text('TERMINAL DE ACCESO SEGURO', cx, inner.y + 110)

    // Input fields.
    p.textAlign(p.LEFT, p.CENTER)
    const fieldX = inner.x + 30
    const fieldW = inner.w - 60
    let fy = inner.y + 168

    const drawField = (label: string, value: string, active: boolean) => {
      p.textSize(11)
      fillHex(p, palette.fgDim)
      p.text(label, fieldX, fy - 14)
      strokeHex(p, active ? palette.accent : palette.grid, 220)
      p.strokeWeight(1)
      p.noFill()
      p.rect(fieldX, fy, fieldW, 28)
      p.noStroke()
      fillHex(p, palette.fg)
      p.textSize(14)
      p.text(value, fieldX + 9, fy + 15)
      if (active && Math.floor(ctx.t * 2) % 2 === 0) {
        const w = p.textWidth(value)
        fillHex(p, palette.accent)
        p.rect(fieldX + 11 + w, fy + 6, 8, 16)
      }
    }

    drawField('ID DE OPERADOR', this.userInput, this.state === 'user')
    fy += 66
    drawField(
      'CONTRASEÑA',
      '•'.repeat(this.passInput.length),
      this.state === 'pass',
    )

    // Status line.
    fy += 60
    p.textAlign(p.CENTER, p.TOP)
    switch (this.state) {
      case 'auth': {
        const el = ctx.t - this.stateStart
        const prog = Math.min(1, el / (ctx.config.timing.authDuration / 1000))
        fillHex(p, palette.warn)
        p.textSize(13)
        p.text(
          'VERIFICANDO' + '.'.repeat(1 + (Math.floor(ctx.t * 4) % 3)),
          cx,
          fy,
        )
        strokeHex(p, palette.grid, 220)
        p.noFill()
        p.rect(fieldX, fy + 22, fieldW, 12)
        p.noStroke()
        fillHex(p, palette.warn)
        p.rect(fieldX + 1, fy + 23, (fieldW - 2) * prog, 10)
        break
      }
      case 'granted':
      case 'done': {
        const flash = Math.floor(ctx.t * 6) % 2 === 0
        enableGlow(ctx, palette.ok, 1)
        fillHex(p, flash ? palette.ok : palette.accent)
        p.textSize(22)
        p.text('ACCESO CONCEDIDO', cx, fy - 4)
        disableGlow(ctx)
        fillHex(p, palette.fgDim)
        p.textSize(11)
        p.text(
          `NIVEL ${ctx.config.operator.clearance}  //  ${ctx.config.operator.node}`,
          cx,
          fy + 26,
        )
        break
      }
      case 'denied': {
        const flash = Math.floor(ctx.t * 8) % 2 === 0
        enableGlow(ctx, palette.danger, 1)
        fillHex(p, flash ? palette.danger : palette.warn)
        p.textSize(22)
        p.text('ACCESO DENEGADO', cx, fy - 4)
        disableGlow(ctx)
        fillHex(p, palette.fgDim)
        p.textSize(11)
        p.text(`INTENTO ${this.attempts} REGISTRADO // INCIDENTE ARCHIVADO`, cx, fy + 26)
        break
      }
      default: {
        fillHex(p, palette.fgDim)
        p.textSize(11)
        p.text(
          this.state === 'user'
            ? 'INTRODUZCA ID DE OPERADOR — ENTER PARA CONTINUAR'
            : 'INTRODUZCA CONTRASEÑA — ENTER PARA VERIFICAR',
          cx,
          fy,
        )
      }
    }

    // Motto footer.
    fillHex(p, palette.fgDim, 160)
    p.textSize(10)
    p.text(`« ${ctx.config.motto} »`, cx, inner.y + inner.h - 18)
    p.pop()
  }
}
