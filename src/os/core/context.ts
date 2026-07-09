/**
 * context.ts — The per-frame render context handed to every entity.
 *
 * A single OSContext bundles the live p5 instance, the currently active
 * palette (so color switching is automatic everywhere), the config, and
 * timing. Entities never reach for globals — they read everything here,
 * which is what makes runtime theme swapping and recording clean.
 */

import type p5 from 'p5'
import type { Palette } from '../config/theme'
import type { OSConfig } from '../config/config'

export const MONO_FONT = '"Courier New", "DejaVu Sans Mono", monospace'

export interface OSContext {
  /** Live p5 instance (instance mode). */
  p: p5
  /** Active palette — reassigned when the theme changes. */
  palette: Palette
  /** Global OS config. */
  config: OSConfig
  /** Canvas width in px. */
  width: number
  /** Canvas height in px. */
  height: number
  /** Elapsed time in seconds since sketch start. */
  t: number
  /** Frame counter. */
  frame: number
  /** Delta time in seconds since last frame. */
  dt: number
}

/**
 * Apply a hex color to fill with optional alpha (0..255).
 * Small helper to keep call sites terse.
 */
export function fillHex(p: p5, hex: string, alpha = 255): void {
  const c = p.color(hex)
  c.setAlpha(alpha)
  p.fill(c)
}

export function strokeHex(p: p5, hex: string, alpha = 255): void {
  const c = p.color(hex)
  c.setAlpha(alpha)
  p.stroke(c)
}

/** Clamp helper. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
