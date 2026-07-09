/**
 * geometry.ts — Rect type + tiny layout helpers used across widgets.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function rect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h }
}

/** Shrink a rect inward by pad (uniform, or per-axis). */
export function inset(r: Rect, padX: number, padY = padX): Rect {
  return {
    x: r.x + padX,
    y: r.y + padY,
    w: r.w - padX * 2,
    h: r.h - padY * 2,
  }
}

export function right(r: Rect): number {
  return r.x + r.w
}
export function bottom(r: Rect): number {
  return r.y + r.h
}
