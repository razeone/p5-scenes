/**
 * Entity.ts — Base class for every drawable in the OS scene graph.
 *
 * The "classes for the shapes" all descend from here: windows, panels,
 * gauges, text streams. An entity knows how to update its state and draw
 * itself given the shared OSContext. Keeping this tiny keeps the scene
 * composable — the SceneManager just holds a list of Entities.
 */

import type { OSContext } from './context'

/**
 * Entities that accept keyboard input implement this and get registered
 * as the SceneManager focus. `key` follows KeyboardEvent.key semantics
 * ("a", "Enter", "Backspace", ...).
 */
export interface KeyTarget {
  handleKey(ctx: OSContext, key: string): void
}

export function isKeyTarget(e: unknown): e is KeyTarget {
  return typeof (e as KeyTarget).handleKey === 'function'
}

export abstract class Entity {
  /** Whether the entity participates in update/draw. */
  visible = true
  /** Higher draws later (on top). */
  z = 0
  /** Optional id for lookup / director control. */
  id?: string

  /** Advance internal state. Override as needed. */
  update(_ctx: OSContext): void {}

  /** Render. Must be implemented. */
  abstract draw(ctx: OSContext): void

  /** Called once when added to a scene, if it needs canvas dimensions etc. */
  onMount(_ctx: OSContext): void {}
}
