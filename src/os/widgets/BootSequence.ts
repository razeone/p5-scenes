/**
 * BootSequence.ts — Full-screen BIOS / POST boot roll.
 *
 * Types out power-on self-test lines against a scripted timeline, shows a
 * memory-check counter and a progress bar, then calls onComplete. Total
 * length is driven by CONFIG.timing.bootDuration so a director can retime
 * it for a shot.
 */

import { Entity } from '../core/Entity'
import type { OSContext } from '../core/context'
import { fillHex, strokeHex } from '../core/context'
import { enableGlow, disableGlow } from '../fx/Effects'

interface BootLine {
  text: string
  status?: 'OK' | 'WARN' | 'FAIL' | ''
}

export class BootSequence extends Entity {
  private start = -1
  private done = false
  onComplete?: () => void

  private lines: BootLine[] = [
    { text: 'FIRMWARE DEL ESTADO // PANOPTICON BIOS 9.4', status: '' },
    { text: 'COPYRIGHT (C) EL BUEN GOBIERNO', status: '' },
    { text: 'CPU: OMNI-CORE X24 @ 4.40THZ  ....... ', status: 'OK' },
    { text: 'MEMORY TEST', status: 'OK' },
    { text: 'ENCLAVE SEGURO / TPM ................ ', status: 'OK' },
    { text: 'BUS BIOMETRICO ...................... ', status: 'OK' },
    { text: 'RED DE VIGILANCIA ................... ', status: 'OK' },
    { text: 'REGISTRO CIUDADANO (4.2B) ........... ', status: 'OK' },
    { text: 'DEMONIO INDICE-DE-PENSAMIENTO ....... ', status: 'WARN' },
    { text: 'FIRMA DEL NUCLEO DE LEALTAD ......... ', status: 'OK' },
    { text: 'RED: ENLACE SECTOR-11 ............... ', status: 'OK' },
    { text: 'CARGANDO PANOPTICON OS .............. ', status: 'OK' },
  ]

  update(ctx: OSContext): void {
    if (this.start < 0) this.start = ctx.t
    const elapsed = ctx.t - this.start
    const dur = ctx.config.timing.bootDuration / 1000
    if (!this.done && elapsed >= dur) {
      this.done = true
      this.onComplete?.()
    }
  }

  draw(ctx: OSContext): void {
    const { p, palette } = ctx
    const elapsed = ctx.t - Math.max(0, this.start)
    const dur = ctx.config.timing.bootDuration / 1000
    const progress = Math.min(1, elapsed / dur)

    const x = 60
    let y = 70
    const lh = 22

    p.push()
    p.textAlign(p.LEFT, p.TOP)
    p.textSize(14)

    enableGlow(ctx, palette.fg, 0.5)
    // Reveal lines over the first ~78% of the boot, one at a time.
    const revealFrac = 0.78
    const shown = Math.floor((progress / revealFrac) * this.lines.length)
    for (let i = 0; i < this.lines.length && i <= shown; i++) {
      const l = this.lines[i]
      fillHex(p, palette.fg)
      let text = l.text
      if (l.text === 'MEMORY TEST') {
        const mb = Math.min(262144, Math.floor(progress * 2 * 262144))
        text = `MEMORY TEST : ${mb.toLocaleString()} KB ......... `
      }
      p.text(text, x, y)
      if (l.status) {
        const col =
          l.status === 'OK'
            ? palette.ok
            : l.status === 'WARN'
              ? palette.warn
              : palette.danger
        fillHex(p, col)
        p.text(`[ ${l.status} ]`, x + 460, y)
      }
      y += lh
    }
    disableGlow(ctx)

    // Progress bar pinned near the bottom.
    const barY = ctx.height - 90
    const barW = ctx.width - 120
    strokeHex(p, palette.grid, 220)
    p.noFill()
    p.rect(60, barY, barW, 16)
    p.noStroke()
    fillHex(p, palette.accent)
    p.rect(62, barY + 2, (barW - 4) * progress, 12)
    fillHex(p, palette.fgDim)
    p.text(
      `INICIALIZACIÓN DEL SISTEMA ${Math.floor(progress * 100)}%`,
      60,
      barY + 24,
    )

    // Blinking cursor after the last shown line.
    if (Math.floor(ctx.t * 2) % 2 === 0 && progress < revealFrac) {
      fillHex(p, palette.accent)
      p.rect(x, y, 9, 14)
    }
    p.pop()
  }
}
