/**
 * config.ts — Global OS identity + tuning knobs.
 *
 * This is the single place a director edits to re-skin the fictional OS
 * for a scene: rename the agency, change the operator, retime the boot,
 * dial the CRT intensity up or down. No render code needs touching.
 */

import { PALETTE_ORDER, type PaletteKey } from './theme'

export interface OSConfig {
  /** Name of the fictional operating system. */
  osName: string
  /** Version string shown on boot / title bars. */
  osVersion: string
  /** Governing body — appears in headers and stamps. */
  agency: string
  /** Short agency code used in window titles. */
  agencyCode: string
  /** Motto / propaganda line shown after login. */
  motto: string
  /**
   * Operator credentials for the interactive login. The actor types these
   * on set; the login validates against them (wrong input → ACCESS DENIED).
   */
  operator: {
    user: string
    password: string
    clearance: string
    node: string
  }

  /** Which palette to start on. */
  startTheme: PaletteKey

  /** CRT / post-processing feel. */
  crt: {
    /** Scanline darkness, 0 = off .. 1 = heavy. */
    scanlineIntensity: number
    /** Gap in px between scanlines. */
    scanlineGap: number
    /** Bloom / glow strength, 0..1. */
    glow: number
    /** Screen curvature vignette strength, 0..1. */
    vignette: number
    /** Baseline flicker amount, 0..1. */
    flicker: number
    /** Chance per frame of a brief glitch burst, 0..1. */
    glitchChance: number
  }

  /** Sequence timing in milliseconds. */
  timing: {
    bootDuration: number
    loginTypeSpeed: number
    authDuration: number
  }
}

export const CONFIG: OSConfig = {
  osName: 'PANOPTICON OS',
  osVersion: 'v9.4.1-ESTADO',
  agency: 'EL BUEN GOBIERNO',
  agencyCode: 'EBG',
  motto: 'EL QUE NADA DEBE, NADA TEME',
  operator: {
    user: 'AGENTE.K7',
    password: 'OBEDIENCIA',
    clearance: 'OMEGA',
    node: 'SECTOR-11 / NODO-4471',
  },

  startTheme: PALETTE_ORDER[0],

  crt: {
    scanlineIntensity: 0.28,
    scanlineGap: 3,
    glow: 0.55,
    vignette: 0.5,
    flicker: 0.06,
    glitchChance: 0.015,
  },

  timing: {
    bootDuration: 4200,
    loginTypeSpeed: 90,
    authDuration: 2600,
  },
}
