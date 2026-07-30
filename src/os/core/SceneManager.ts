/**
 * SceneManager.ts — Holds and orchestrates entities.
 *
 * Owns the list of Entities, keeps them z-sorted, and fans out
 * update/draw. Also owns the high-level OS phase (boot → login → desktop)
 * so different scenes can be staged for the shoot.
 */

import type { OSContext } from './context'
import { isKeyTarget, type Entity, type KeyTarget } from './Entity'

export type OSPhase =
  | 'boot'
  | 'login'
  | 'hypervigilance'
  | 'desktop'
  | 'map'
  | 'sensors'
  | 'call'
  | 'chip'
  | 'board'
  | 'implant'
  | 'loyalty'
  | 'analysis'
  | 'video-effects'

export class SceneManager {
  private entities: Entity[] = []
  phase: OSPhase = 'boot'
  /** Entity currently receiving keyboard input, if any. */
  focus: (Entity & KeyTarget) | null = null

  /** Route a key to the focused entity. Returns true if consumed. */
  dispatchKey(ctx: OSContext, key: string): boolean {
    if (this.focus && this.focus.visible) {
      this.focus.handleKey(ctx, key)
      return true
    }
    return false
  }

  setFocus(e: Entity | null): void {
    this.focus = e && isKeyTarget(e) ? (e as Entity & KeyTarget) : null
  }

  add<T extends Entity>(e: T, ctx?: OSContext): T {
    this.entities.push(e)
    this.entities.sort((a, b) => a.z - b.z)
    if (ctx) e.onMount(ctx)
    return e
  }

  remove(e: Entity): void {
    const i = this.entities.indexOf(e)
    if (i >= 0) this.entities.splice(i, 1)
  }

  get(id: string): Entity | undefined {
    return this.entities.find((e) => e.id === id)
  }

  /** All entities in draw order (bottom first). Read-only. */
  get all(): readonly Entity[] {
    return this.entities
  }

  /** Raise an entity above everything else (window click/drag). */
  bringToFront(e: Entity): void {
    if (this.entities.length === 0) return
    const maxZ = Math.max(...this.entities.map((x) => x.z))
    if (e.z <= maxZ) {
      e.z = maxZ + 1
      this.entities.sort((a, b) => a.z - b.z)
    }
  }

  clear(): void {
    this.entities = []
  }

  update(ctx: OSContext): void {
    for (const e of this.entities) {
      if (e.visible) e.update(ctx)
    }
  }

  draw(ctx: OSContext): void {
    for (const e of this.entities) {
      if (e.visible) e.draw(ctx)
    }
  }
}
