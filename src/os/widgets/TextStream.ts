/**
 * TextStream.ts — Scrolling monospace log with a blinking cursor.
 *
 * Reusable inside any window body. Lines carry a severity that maps to a
 * palette color. Optional autoFeed emits ambient government-surveillance
 * chatter so idle windows still feel alive on camera.
 */

import type { OSContext } from '../core/context'
import { fillHex } from '../core/context'
import type { Rect } from '../core/geometry'

export type LogLevel = 'info' | 'ok' | 'warn' | 'danger' | 'dim'

interface LogLine {
  text: string
  level: LogLevel
  /** Character reveal progress for a typewriter effect (0..1). */
  reveal: number
  typing: boolean
}

export interface TextStreamOpts {
  maxLines?: number
  lineHeight?: number
  textSize?: number
  /** Prefix each line with a fake timestamp. */
  timestamps?: boolean
  /** Type characters in rather than snapping the whole line. */
  typewriter?: boolean
  /** Auto-emit ambient lines every N seconds (0 = off). */
  autoFeedEvery?: number
  /** Pool of templates for autoFeed. */
  feed?: { text: string; level: LogLevel }[]
}

export class TextStream {
  private lines: LogLine[] = []
  private opts: Required<Omit<TextStreamOpts, 'feed'>> & {
    feed: { text: string; level: LogLevel }[]
  }
  private lastFeed = 0
  private charsPerSec = 55

  constructor(opts: TextStreamOpts = {}) {
    this.opts = {
      maxLines: opts.maxLines ?? 40,
      lineHeight: opts.lineHeight ?? 16,
      textSize: opts.textSize ?? 12,
      timestamps: opts.timestamps ?? true,
      typewriter: opts.typewriter ?? true,
      autoFeedEvery: opts.autoFeedEvery ?? 0,
      feed: opts.feed ?? DEFAULT_FEED,
    }
  }

  clear(): void {
    this.lines = []
  }

  push(text: string, level: LogLevel = 'info'): void {
    this.lines.push({
      text,
      level,
      reveal: this.opts.typewriter ? 0 : 1,
      typing: this.opts.typewriter,
    })
    if (this.lines.length > this.opts.maxLines) this.lines.shift()
  }

  /** True when the most recent line has finished typing. */
  get idle(): boolean {
    const last = this.lines[this.lines.length - 1]
    return !last || !last.typing
  }

  update(ctx: OSContext): void {
    // Advance typewriter on the newest still-typing line.
    for (const l of this.lines) {
      if (l.typing) {
        const perChar = 1 / Math.max(1, l.text.length)
        l.reveal += this.charsPerSec * perChar * ctx.dt
        if (l.reveal >= 1) {
          l.reveal = 1
          l.typing = false
        }
        break // only one line types at a time
      }
    }

    if (this.opts.autoFeedEvery > 0 && this.idle) {
      if (ctx.t - this.lastFeed > this.opts.autoFeedEvery) {
        this.lastFeed = ctx.t
        const pick =
          this.opts.feed[Math.floor(ctx.p.random(this.opts.feed.length))]
        this.push(this.stamp(ctx, pick.text), pick.level)
      }
    }
  }

  private stamp(ctx: OSContext, text: string): string {
    if (!this.opts.timestamps) return text
    const secs = ctx.t
    const hh = String(6 + (Math.floor(secs / 3600) % 18)).padStart(2, '0')
    const mm = String(Math.floor(secs / 60) % 60).padStart(2, '0')
    const ss = String(Math.floor(secs) % 60).padStart(2, '0')
    return `${hh}:${mm}:${ss}  ${text}`
  }

  /** Convenience: push a line already stamped. */
  log(ctx: OSContext, text: string, level: LogLevel = 'info'): void {
    this.push(this.stamp(ctx, text), level)
  }

  private colorFor(ctx: OSContext, level: LogLevel): string {
    switch (level) {
      case 'ok':
        return ctx.palette.ok
      case 'warn':
        return ctx.palette.warn
      case 'danger':
        return ctx.palette.danger
      case 'dim':
        return ctx.palette.fgDim
      default:
        return ctx.palette.fg
    }
  }

  draw(ctx: OSContext, r: Rect): void {
    const { p } = ctx
    const lh = this.opts.lineHeight
    const visible = Math.floor(r.h / lh)
    const start = Math.max(0, this.lines.length - visible)
    p.push()
    p.textSize(this.opts.textSize)
    p.textAlign(p.LEFT, p.TOP)
    p.noStroke()
    let y = r.y
    for (let i = start; i < this.lines.length; i++) {
      const l = this.lines[i]
      const shown =
        l.reveal >= 1
          ? l.text
          : l.text.slice(0, Math.floor(l.text.length * l.reveal))
      fillHex(p, this.colorFor(ctx, l.level))
      p.text(shown, r.x, y)
      // Blinking cursor at the end of the active/last line.
      const isLast = i === this.lines.length - 1
      if (isLast && (l.typing || Math.floor(ctx.t * 2) % 2 === 0)) {
        const cw = p.textWidth(shown)
        fillHex(p, ctx.palette.accent)
        p.rect(r.x + cw + 1, y, this.opts.textSize * 0.55, this.opts.textSize)
      }
      y += lh
    }
    p.pop()
  }
}

const DEFAULT_FEED: { text: string; level: LogLevel }[] = [
  { text: 'CIUDADANO #48213 — movimiento registrado / SECTOR-3', level: 'info' },
  { text: 'COINCIDENCIA FACIAL 0.981 — sujeto marcado', level: 'warn' },
  { text: 'DRON D-12 — telemetría nominal', level: 'ok' },
  { text: 'PAQUETE INTERCEPTADO — 4.2MB archivado', level: 'dim' },
  { text: 'VIOLACIÓN DE TOQUE DE QUEDA — multa emitida', level: 'warn' },
  { text: 'PUERTA BIOMÉTRICA 7 — acceso concedido', level: 'ok' },
  { text: 'PUNTAJE SOCIAL recalculado: -14', level: 'danger' },
  { text: 'BARRIDO ÍNDICE-DE-PENSAMIENTO completo', level: 'dim' },
  { text: 'MATRÍCULA EBG-7741 rastreada', level: 'info' },
  { text: 'ANOMALÍA en densidad de multitud / PLAZA-1', level: 'warn' },
  { text: 'RELÉ DE COMUNICACIONES re-cifrado', level: 'ok' },
  { text: 'SUJETO re-identificado en 3 cámaras', level: 'info' },
]
