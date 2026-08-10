/**
 * config.ts — Global OS identity + tuning knobs.
 *
 * This is the single place a director edits to re-skin the fictional OS
 * for a scene: rename the agency, change the operator, retime the boot,
 * dial the CRT intensity up or down — and, under `scenes`, retime and
 * reshape every screen (unit counts, trace speeds, cue durations,
 * assembly pacing, the subject's heart rate…). No render code needs
 * touching; widgets read these values live every frame.
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
  /** Movie identity shown by the opening cinematic. */
  movieTitle: string
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

  /** Per-scene tuning. Every screen reads these live, every frame. */
  scenes: {
    vigilancia: {
      /** Simulated targets overlaid on each camera at build time. */
      targetsCamA: number
      targetsCamB: number
      /** Seconds the "SUJETO IDENTIFICADO" banner stays up (cue). */
      markSeconds: number
      /** Seconds between ambient log lines. */
      logEvery: number
    }
    hypervigilance: {
      montageSeconds: number
      flareSeconds: number
      titleSeconds: number
      activeScreens: number
    }
    map: {
      /** Patrol units on the board at build time (min 3, incl. 2 suspects). */
      units: number
      /** Movement multiplier for all units (1 = normal). */
      unitSpeed: number
      /** Target ping expansion rate (rings per second). */
      pingSpeed: number
      logEvery: number
    }
    geo: {
      /** Initial tile zoom (5 = country, 16 = street, 19 = rooftop). */
      zoom: number
      /** Pursuit units deployed at build time. */
      units: number
      /** Ground speeds in km/h. */
      targetSpeedKmh: number
      unitSpeedKmh: number
      /** Target ping expansion rate (rings per second). */
      pingSpeed: number
      /** Seconds of GPS breadcrumb trail kept behind the target. */
      trailSeconds: number
      /** Operational perimeter radius in meters (geofence ring). */
      perimeterM: number
      logEvery: number
    }
    gallery: {
      /** Seconds between ambient log lines on the dossier board. */
      logEvery: number
    }
    sensors: {
      /** Time multiplier for scope traces (1 = normal, 2 = frantic). */
      traceSpeed: number
      /** Cue durations in seconds. */
      exciteSeconds: number
      burstSeconds: number
      alarmSeconds: number
      logEvery: number
    }
    call: {
      /** Handshake duration in seconds. */
      connectSeconds: number
      /** Auto speaker-rotation rate (higher = floor changes faster). */
      speakerRate: number
      /** Signal-drop cue duration in seconds. */
      dropSeconds: number
      logEvery: number
    }
    chip: {
      /** Routing pulse speed multiplier. */
      pulseSpeed: number
      /** DRC raster sweep speed multiplier. */
      sweepSpeed: number
      /** Logic-analyzer scroll speed in px/s. */
      scrollSpeed: number
      /** Cue durations in seconds. */
      drcSeconds: number
      thermalSeconds: number
      bistSeconds: number
      /** Tapeout sign-off sweep duration in seconds. */
      tapeoutSweepSeconds: number
      logEvery: number
    }
    board: {
      /** Assembly pacing: per-station fly-in + inspection dwell. */
      flyInSeconds: number
      dwellSeconds: number
      /** Power on automatically when the manifest completes. */
      autoPowerOn: boolean
      /** Seconds for the power wave to cross the board. */
      waveSeconds: number
      /** Copper power-pulse speed multiplier. */
      pulseSpeed: number
      /** Short-circuit cue duration in seconds. */
      faultSeconds: number
      logEvery: number
    }
    analysis: {
      /** Multiplier from normalized track speed to the agitation score. */
      agitationGain: number
      /** Heatmap decay per second (higher = shorter memory). */
      heatDecay: number
      /** DPI level that triggers the preventive arrest order (0..1). */
      dpiThreshold: number
      /** Seconds for the dissent evaluation to ramp the DPI up. */
      dissentSeconds: number
      logEvery: number
    }
    loyalty: {
      /** DPI level that triggers the preventive arrest order (0..1). */
      dpiThreshold: number
      /** Seconds for the dissent evaluation to ramp the DPI up. */
      dissentSeconds: number
      /** Seconds the Leader's portrait stimulus stays on screen. */
      portraitSeconds: number
      /** How much each CURAR CIFRA press inflates the published number. */
      curateStep: number
      logEvery: number
    }
    implant: {
      /** Subject baselines (beats per minute). */
      baseHr: number
      panicHr: number
      sedateHr: number
      /** Cue durations in seconds. */
      panicSeconds: number
      sedateSeconds: number
      rewardSeconds: number
      lieSeconds: number
      arrestSeconds: number
      recoverySeconds: number
      logEvery: number
    }
    silence: {
      /** Seconds a silenced target remains frozen before reset. */
      resetSeconds: number
    }
  }
}

export const CONFIG: OSConfig = {
  osName: 'PANOPTICON OS',
  osVersion: 'v9.4.1-ESTADO',
  agency: 'EL BUEN GOBIERNO',
  agencyCode: 'EBG',
  motto: 'EL QUE NADA DEBE, NADA TEME',
  movieTitle: 'HYPERVIGILANCE',
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

  scenes: {
    vigilancia: {
      targetsCamA: 3,
      targetsCamB: 2,
      markSeconds: 3,
      logEvery: 1.4,
    },
    hypervigilance: {
      montageSeconds: 12,
      flareSeconds: 0.8,
      titleSeconds: 3.2,
      activeScreens: 9,
    },
    map: {
      units: 7,
      unitSpeed: 1,
      pingSpeed: 0.6,
      logEvery: 1.4,
    },
    geo: {
      zoom: 16,
      units: 4,
      targetSpeedKmh: 28,
      unitSpeedKmh: 38,
      pingSpeed: 0.6,
      trailSeconds: 120,
      perimeterM: 1500,
      logEvery: 1.4,
    },
    gallery: {
      logEvery: 2.2,
    },
    sensors: {
      traceSpeed: 1,
      exciteSeconds: 4,
      burstSeconds: 5,
      alarmSeconds: 6,
      logEvery: 1.4,
    },
    call: {
      connectSeconds: 2.4,
      speakerRate: 0.18,
      dropSeconds: 3,
      logEvery: 1.4,
    },
    chip: {
      pulseSpeed: 1,
      sweepSpeed: 1,
      scrollSpeed: 42,
      drcSeconds: 7,
      thermalSeconds: 8,
      bistSeconds: 5,
      tapeoutSweepSeconds: 2.5,
      logEvery: 1.6,
    },
    board: {
      flyInSeconds: 0.5,
      dwellSeconds: 1.7,
      autoPowerOn: true,
      waveSeconds: 2.2,
      pulseSpeed: 1,
      faultSeconds: 4,
      logEvery: 1.8,
    },
    analysis: {
      agitationGain: 9,
      heatDecay: 0.06,
      dpiThreshold: 0.85,
      dissentSeconds: 6,
      logEvery: 1.6,
    },
    loyalty: {
      dpiThreshold: 0.85,
      dissentSeconds: 6,
      portraitSeconds: 6,
      curateStep: 0.008,
      logEvery: 1.6,
    },
    implant: {
      baseHr: 72,
      panicHr: 142,
      sedateHr: 54,
      panicSeconds: 10,
      sedateSeconds: 12,
      rewardSeconds: 8,
      lieSeconds: 9,
      arrestSeconds: 5,
      recoverySeconds: 6,
      logEvery: 1.7,
    },
    silence: {
      resetSeconds: 10,
    },
  },
}
