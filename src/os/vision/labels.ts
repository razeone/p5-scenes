/**
 * labels.ts — In-fiction dressing for COCO detector classes.
 *
 * The detector speaks English COCO; the OS speaks state Spanish. Also
 * classifies labels into threat tiers so the overlay colors mean
 * something: people are SUJETOS (danger), vehicles warrant caution,
 * everything else is inventory.
 */

const ES: Record<string, string> = {
  person: 'SUJETO',
  bicycle: 'BICICLETA',
  car: 'VEHÍCULO',
  motorcycle: 'MOTOCICLETA',
  airplane: 'AERONAVE',
  bus: 'AUTOBÚS',
  train: 'TREN',
  truck: 'CAMIÓN',
  boat: 'EMBARCACIÓN',
  'traffic light': 'SEMÁFORO',
  bird: 'AVE',
  cat: 'FELINO',
  dog: 'CANINO',
  backpack: 'MOCHILA',
  umbrella: 'PARAGUAS',
  handbag: 'BOLSO',
  suitcase: 'MALETA',
  bottle: 'BOTELLA',
  cup: 'RECIPIENTE',
  chair: 'SILLA',
  couch: 'SOFÁ',
  'potted plant': 'PLANTA',
  bed: 'CAMA',
  'dining table': 'MESA',
  tv: 'PANTALLA',
  laptop: 'TERMINAL',
  mouse: 'PERIFÉRICO',
  keyboard: 'TECLADO',
  'cell phone': 'DISPOSITIVO',
  book: 'DOCUMENTO',
  clock: 'RELOJ',
  scissors: 'OBJETO PUNZANTE',
  knife: 'ARMA BLANCA',
}

/** Threat tier → palette key used by the overlay. */
export type ThreatTier = 'danger' | 'warn' | 'accent'

const TIER: Record<string, ThreatTier> = {
  person: 'danger',
  knife: 'danger',
  scissors: 'danger',
  car: 'warn',
  truck: 'warn',
  bus: 'warn',
  motorcycle: 'warn',
  bicycle: 'warn',
  airplane: 'warn',
  boat: 'warn',
  train: 'warn',
}

export function labelEs(cocoLabel: string): string {
  return ES[cocoLabel] ?? cocoLabel.toUpperCase()
}

export function threatTier(cocoLabel: string): ThreatTier {
  return TIER[cocoLabel] ?? 'accent'
}
