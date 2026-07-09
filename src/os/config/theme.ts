/**
 * theme.ts — Color themes for the OS.
 *
 * Every palette is faction/scene-swappable at runtime. Colors are plain
 * hex strings so they can be tuned per shot without touching render code.
 * Add a new palette here and it instantly shows up in the director's
 * theme cycler and hotkeys.
 */

export interface Palette {
  /** Human label shown in the control panel. */
  label: string
  /** Deep background wash behind everything. */
  bg: string
  /** Faint grid / chrome lines. */
  grid: string
  /** Primary phosphor text + strokes. */
  fg: string
  /** Dimmed variant of fg for secondary text. */
  fgDim: string
  /** Bright accent for highlights, cursors, active borders. */
  accent: string
  /** Warning / alert color. */
  warn: string
  /** Critical / danger color. */
  danger: string
  /** OK / success color. */
  ok: string
  /** Glow tint used by the bloom pass (usually === fg). */
  glow: string
}

export const PALETTES: Record<string, Palette> = {
  phosphor: {
    label: 'PHOSPHOR // GREEN',
    bg: '#020a04',
    grid: '#0d3a1e',
    fg: '#39ff88',
    fgDim: '#1f8f4d',
    accent: '#b9ffcf',
    warn: '#ffd23f',
    danger: '#ff4d5e',
    ok: '#39ff88',
    glow: '#39ff88',
  },
  amber: {
    label: 'AMBER // ARCHIVE',
    bg: '#0d0700',
    grid: '#3a2600',
    fg: '#ffb000',
    fgDim: '#a06b00',
    accent: '#ffe0a3',
    warn: '#ff8c1a',
    danger: '#ff3b30',
    ok: '#ffb000',
    glow: '#ffb000',
  },
  ice: {
    label: 'ICE // MINISTRY',
    bg: '#01060d',
    grid: '#0a2740',
    fg: '#4fd6ff',
    fgDim: '#2b7fa0',
    accent: '#d6f4ff',
    warn: '#ffd23f',
    danger: '#ff5470',
    ok: '#39ffd0',
    glow: '#4fd6ff',
  },
  alert: {
    label: 'RED ALERT // LOCKDOWN',
    bg: '#0d0203',
    grid: '#3a0d12',
    fg: '#ff415a',
    fgDim: '#a02330',
    accent: '#ffd0d6',
    warn: '#ff8c1a',
    danger: '#ff1024',
    ok: '#ff8fa0',
    glow: '#ff415a',
  },
  mono: {
    label: 'MONO // DECLASSIFIED',
    bg: '#050505',
    grid: '#1f1f1f',
    fg: '#e6e6e6',
    fgDim: '#7a7a7a',
    accent: '#ffffff',
    warn: '#c8c8c8',
    danger: '#ffffff',
    ok: '#c8c8c8',
    glow: '#bfbfbf',
  },
}

export type PaletteKey = keyof typeof PALETTES

/** Ordered list used by the theme cycler / hotkeys. */
export const PALETTE_ORDER: PaletteKey[] = [
  'phosphor',
  'amber',
  'ice',
  'alert',
  'mono',
]
