/**
 * GalleryWindow.ts — Target dossier gallery from real image files.
 *
 * The director drops a folder or a set of images into the OS; each one
 * becomes a surveillance "dossier card": the photo cover-fit into a
 * frame, a diagonal case stamp (SILENCIADO / CAPTURADO / EN FUGA…), a
 * threat rating and a block of fabricated biographical data — name,
 * alias, age, sector, case number, last-seen timestamp. The fiction is
 * generated once per image and stays stable across frames; the director
 * can re-roll it, mass-mark the whole board, or click a single card to
 * cycle its status live.
 *
 * Cards flow in an auto-fitting grid; when there are more targets than
 * fit, the board paginates. Images are decoded from object URLs the
 * caller owns (see OSApp.loadGalleryImages / disposal).
 */

import { OSWindow, type OSWindowOpts } from './OSWindow'
import type { OSContext } from '../core/context'
import { fillHex, strokeHex } from '../core/context'
import type { Palette } from '../config/theme'
import type { Rect } from '../core/geometry'
import { enableGlow, disableGlow } from '../fx/Effects'

/** Case dispositions a target can carry on the board. */
export type TargetStatus =
  | 'tracking'
  | 'silenced'
  | 'captured'
  | 'atlarge'
  | 'neutralized'

/** Cycle order when a card is clicked / the board is advanced. */
const STATUS_CYCLE: TargetStatus[] = [
  'tracking',
  'silenced',
  'captured',
  'atlarge',
  'neutralized',
]

interface StatusStyle {
  label: string
  /** Palette key used for the stamp + accents. */
  key: keyof Pick<Palette, 'danger' | 'ok' | 'warn' | 'accent' | 'fgDim'>
}

const STATUS_STYLE: Record<TargetStatus, StatusStyle> = {
  tracking: { label: 'EN SEGUIMIENTO', key: 'accent' },
  silenced: { label: 'SILENCIADO', key: 'danger' },
  captured: { label: 'CAPTURADO', key: 'ok' },
  atlarge: { label: 'EN FUGA', key: 'warn' },
  neutralized: { label: 'NEUTRALIZADO', key: 'fgDim' },
}

/** A single image plus its fabricated dossier. */
export interface GalleryTarget {
  img: HTMLImageElement
  /** Object URL the caller owns (revoked on replace/destroy). */
  url: string
  fileName: string
  name: string
  alias: string
  age: number
  status: TargetStatus
  /** 1..5 threat rating (pips). */
  threat: number
  sector: string
  caseId: string
  lastSeen: string
}

const FIRST_NAMES = [
  'ALEJANDRO', 'VALENTINA', 'MATEO', 'CAMILA', 'SANTIAGO', 'ISABELA',
  'SEBASTIÁN', 'LUCÍA', 'DIEGO', 'MARIANA', 'TOMÁS', 'RENATA', 'EMILIO',
  'DANIELA', 'JOAQUÍN', 'ANDREA', 'NICOLÁS', 'SOFÍA', 'RODRIGO', 'PAULA',
  'IGNACIO', 'ELENA', 'GABRIEL', 'CAROLINA', 'JULIÁN', 'NATALIA',
]

const LAST_NAMES = [
  'GARCÍA', 'RODRÍGUEZ', 'MARTÍNEZ', 'HERNÁNDEZ', 'LÓPEZ', 'GONZÁLEZ',
  'PÉREZ', 'SÁNCHEZ', 'RAMÍREZ', 'TORRES', 'FLORES', 'RIVERA', 'GÓMEZ',
  'DÍAZ', 'VARGAS', 'CASTILLO', 'MORALES', 'ORTIZ', 'NÚÑEZ', 'MENDOZA',
  'GUERRERO', 'ROJAS', 'MEDINA', 'AGUILAR', 'CAMPOS', 'FUENTES',
]

const ALIASES = [
  'EL CUERVO', 'FANTASMA', 'LA SOMBRA', 'HALCÓN', 'NÓMADA', 'EL LOBO',
  'CENIZA', 'VÍBORA', 'ESPECTRO', 'EL CARTÓGRAFO', 'ZÉNIT',
  'MERIDIANO', 'EL RELOJERO', 'CORVO', 'LA AGUJA', 'TRAMONTANA',
]

const SECTORS = [
  'SECTOR NORTE-04', 'SECTOR SUR-11', 'ZONA FRANCA', 'DISTRITO 7',
  'PERÍMETRO ESTE', 'MUELLE 9', 'ANILLO EXTERIOR', 'CASCO ANTIGUO',
  'TERMINAL B', 'SUBNIVEL -2',
]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** Stable-ish fake timestamp within the last ~90 days. */
function fakeLastSeen(): string {
  const d = new Date(Date.now() - Math.random() * 90 * 86400_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Fabricate a dossier for a freshly loaded image. */
export function buildDossier(img: HTMLImageElement, url: string, fileName: string): GalleryTarget {
  const first = pick(FIRST_NAMES)
  const last = `${pick(LAST_NAMES)} ${pick(LAST_NAMES)}`
  return {
    img,
    url,
    fileName,
    name: `${first} ${last}`,
    alias: pick(ALIASES),
    age: 19 + Math.floor(Math.random() * 45),
    status: pick(STATUS_CYCLE),
    threat: 1 + Math.floor(Math.random() * 5),
    sector: pick(SECTORS),
    caseId: `EXP-${String(1000 + Math.floor(Math.random() * 8999))}-${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`,
    lastSeen: fakeLastSeen(),
  }
}

/** Regenerate only the fictional fields, keeping the image. */
export function rerollDossier(t: GalleryTarget): void {
  const fresh = buildDossier(t.img, t.url, t.fileName)
  t.name = fresh.name
  t.alias = fresh.alias
  t.age = fresh.age
  t.status = fresh.status
  t.threat = fresh.threat
  t.sector = fresh.sector
  t.caseId = fresh.caseId
  t.lastSeen = fresh.lastSeen
}

const CARD_MIN_W = 210
const CARD_GAP = 14
const CARD_ASPECT = 1.42 // height / width

export class GalleryWindow extends OSWindow {
  private targets: GalleryTarget[] = []
  private page = 0
  /** Card rects from the last draw, for click hit-testing. */
  private hits: { rect: Rect; target: GalleryTarget }[] = []

  constructor(o: OSWindowOpts) {
    super(o)
  }

  /** Replace the whole board (caller owns disposal of old URLs). */
  setTargets(targets: GalleryTarget[]): void {
    this.targets = targets
    this.page = 0
  }

  get count(): number {
    return this.targets.length
  }

  /** Count of targets currently in a given status (for log lines). */
  countStatus(status: TargetStatus): number {
    return this.targets.filter((t) => t.status === status).length
  }

  reroll(): void {
    for (const t of this.targets) rerollDossier(t)
  }

  /** Mass-mark the whole board to one disposition. */
  markAll(status: TargetStatus): void {
    for (const t of this.targets) t.status = status
  }

  /** Advance every card one step through the disposition cycle. */
  advanceAll(): void {
    for (const t of this.targets) {
      const i = STATUS_CYCLE.indexOf(t.status)
      t.status = STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length]
    }
  }

  nextPage(): void {
    this.page++
  }

  prevPage(): void {
    this.page = Math.max(0, this.page - 1)
  }

  /** 1-based page number, for the director panel's readout. */
  get pageNumber(): number {
    return this.page + 1
  }

  /** How many dossiers are loaded on the board. */
  get targetCount(): number {
    return this.targets.length
  }

  /** Click on a card cycles its individual status; returns the target. */
  clickBody(_ctx: OSContext, mx: number, my: number): GalleryTarget | null {
    for (const h of this.hits) {
      const r = h.rect
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
        const i = STATUS_CYCLE.indexOf(h.target.status)
        h.target.status = STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length]
        return h.target
      }
    }
    return null
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    this.hits = []

    if (this.targets.length === 0) {
      this.drawEmpty(ctx, inner)
      return
    }

    // Grid geometry: as many CARD_MIN_W columns as fit, then grow cards
    // to share the leftover width evenly.
    const cols = Math.max(1, Math.floor((inner.w + CARD_GAP) / (CARD_MIN_W + CARD_GAP)))
    const cardW = (inner.w - CARD_GAP * (cols - 1)) / cols
    const cardH = cardW * CARD_ASPECT
    const rows = Math.max(1, Math.floor((inner.h + CARD_GAP) / (cardH + CARD_GAP)))
    const perPage = cols * rows
    const pageCount = Math.max(1, Math.ceil(this.targets.length / perPage))
    if (this.page >= pageCount) this.page = pageCount - 1
    const start = this.page * perPage

    for (let i = 0; i < perPage; i++) {
      const t = this.targets[start + i]
      if (!t) break
      const col = i % cols
      const row = Math.floor(i / cols)
      const cx = inner.x + col * (cardW + CARD_GAP)
      const cy = inner.y + row * (cardH + CARD_GAP)
      const rect: Rect = { x: cx, y: cy, w: cardW, h: cardH }
      this.drawCard(ctx, rect, t)
      this.hits.push({ rect, target: t })
    }

    // Footer: board summary + pagination (drawn over any partial last row).
    p.push()
    p.noStroke()
    fillHex(p, palette.fgDim, 210)
    p.textSize(9)
    p.textAlign(p.LEFT, p.BOTTOM)
    const sil = this.countStatus('silenced')
    const cap = this.countStatus('captured')
    p.text(
      `${this.targets.length} EXPEDIENTES · ${sil} SILENCIADOS · ${cap} CAPTURADOS · CLIC EN FICHA = CAMBIAR ESTADO`,
      inner.x + 2,
      inner.y + inner.h - 1,
    )
    if (pageCount > 1) {
      p.textAlign(p.RIGHT, p.BOTTOM)
      fillHex(p, palette.accent, 220)
      p.text(`PÁGINA ${this.page + 1}/${pageCount}`, inner.x + inner.w - 2, inner.y + inner.h - 1)
    }
    p.pop()
  }

  private drawEmpty(ctx: OSContext, inner: Rect): void {
    const { p, palette } = ctx
    p.push()
    p.noFill()
    strokeHex(p, palette.fgDim, 130)
    p.strokeWeight(1)
    const dc = p.drawingContext as CanvasRenderingContext2D
    dc.setLineDash([8, 6])
    p.rect(inner.x + 8, inner.y + 8, inner.w - 16, inner.h - 16, 6)
    dc.setLineDash([])
    p.noStroke()
    fillHex(p, palette.fg, 220)
    p.textAlign(p.CENTER, p.CENTER)
    p.textSize(14)
    p.text('SIN EXPEDIENTES CARGADOS', inner.x + inner.w / 2, inner.y + inner.h / 2 - 12)
    fillHex(p, palette.fgDim, 200)
    p.textSize(10)
    p.text(
      'CARGA UNA CARPETA O UN CONJUNTO DE IMÁGENES DESDE EL PANEL',
      inner.x + inner.w / 2,
      inner.y + inner.h / 2 + 10,
    )
    p.pop()
  }

  private drawCard(ctx: OSContext, r: Rect, t: GalleryTarget): void {
    const { p, palette } = ctx
    const style = STATUS_STYLE[t.status]
    const accent = palette[style.key]
    const dc = p.drawingContext as CanvasRenderingContext2D

    // Card backing + frame.
    p.push()
    p.noStroke()
    fillHex(p, palette.bg, 235)
    p.rect(r.x, r.y, r.w, r.h)

    // Photo viewport (top portion of the card).
    const photoH = r.w * 0.82
    const photo: Rect = { x: r.x, y: r.y, w: r.w, h: photoH }
    this.drawPhoto(ctx, photo, t)

    // Diagonal case stamp across the photo.
    dc.save()
    dc.beginPath()
    dc.rect(photo.x, photo.y, photo.w, photo.h)
    dc.clip()
    p.push()
    p.translate(photo.x + photo.w / 2, photo.y + photo.h / 2)
    p.rotate(-0.32)
    p.rectMode(p.CENTER)
    strokeHex(p, accent, 235)
    p.strokeWeight(2)
    fillHex(p, accent, 30)
    const stampW = photo.w * 1.15
    p.rect(0, 0, stampW, 26)
    p.noStroke()
    fillHex(p, accent, 255)
    p.textAlign(p.CENTER, p.CENTER)
    p.textSize(13)
    p.text(style.label, 0, 1)
    p.rectMode(p.CORNER)
    p.pop()
    dc.restore()

    // Threat pips (top-left over the photo).
    for (let i = 0; i < 5; i++) {
      const on = i < t.threat
      if (on) fillHex(p, palette.danger, 235)
      else fillHex(p, palette.fgDim, 120)
      p.noStroke()
      p.rect(photo.x + 6 + i * 8, photo.y + 6, 6, 6)
    }
    p.textSize(8)
    p.textAlign(p.LEFT, p.TOP)
    fillHex(p, palette.danger, 220)
    p.text('AMENAZA', photo.x + 6, photo.y + 15)

    // Case id (top-right over the photo).
    p.textAlign(p.RIGHT, p.TOP)
    fillHex(p, palette.accent, 220)
    p.textSize(8)
    p.text(t.caseId, photo.x + photo.w - 6, photo.y + 6)

    // Data block below the photo.
    const dx = r.x + 8
    let dy = photo.y + photoH + 8
    p.textAlign(p.LEFT, p.TOP)
    fillHex(p, palette.fg, 240)
    p.textSize(11)
    p.text(OSWindow.truncate(p, t.name, r.w - 16), dx, dy)
    dy += 15
    fillHex(p, palette.fgDim, 220)
    p.textSize(9)
    p.text(OSWindow.truncate(p, `ALIAS «${t.alias}»`, r.w - 16), dx, dy)
    dy += 13
    p.text(`EDAD ${t.age} · ${t.sector}`, dx, dy)
    dy += 13
    fillHex(p, palette.fgDim, 180)
    p.text(`VISTO ${t.lastSeen}`, dx, dy)

    // Frame + status-tinted brackets last so they sit on top.
    enableGlow(ctx, accent, 0.4)
    strokeHex(p, accent, 210)
    p.strokeWeight(1)
    p.noFill()
    p.rect(r.x, r.y, r.w, r.h)
    disableGlow(ctx)
    // Status ribbon under the photo.
    p.noStroke()
    fillHex(p, accent, 40)
    p.rect(r.x, photo.y + photoH, r.w, 3)
    p.pop()
  }

  /** Cover-fit the photo into the viewport, or a placeholder if loading. */
  private drawPhoto(ctx: OSContext, r: Rect, t: GalleryTarget): void {
    const { p, palette } = ctx
    const img = t.img
    const ready = img.complete && img.naturalWidth > 0
    p.push()
    p.noStroke()
    fillHex(p, palette.grid, 200)
    p.rect(r.x, r.y, r.w, r.h)
    if (!ready) {
      fillHex(p, palette.fgDim, 200)
      p.textAlign(p.CENTER, p.CENTER)
      p.textSize(10)
      p.text('DESCIFRANDO…', r.x + r.w / 2, r.y + r.h / 2)
      p.pop()
      return
    }
    const dc = p.drawingContext as CanvasRenderingContext2D
    const scale = Math.max(r.w / img.naturalWidth, r.h / img.naturalHeight)
    const sw = r.w / scale
    const sh = r.h / scale
    const sx = (img.naturalWidth - sw) / 2
    const sy = (img.naturalHeight - sh) / 2
    dc.save()
    dc.beginPath()
    dc.rect(r.x, r.y, r.w, r.h)
    dc.clip()
    // Desaturate + tint so photos read as surveillance stills.
    dc.filter = 'grayscale(1) contrast(1.15) brightness(0.92)'
    dc.drawImage(img, sx, sy, sw, sh, r.x, r.y, r.w, r.h)
    dc.filter = 'none'
    dc.restore()
    // Palette wash over the still.
    fillHex(p, palette.glow, 30)
    p.rect(r.x, r.y, r.w, r.h)
    // Scanline hint across the photo.
    strokeHex(p, palette.bg, 60)
    p.strokeWeight(1)
    for (let y = r.y + 2; y < r.y + r.h; y += 3) p.line(r.x, y, r.x + r.w, y)
    p.pop()
  }
}
