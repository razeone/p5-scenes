/**
 * ConsoleWindow.ts — A window that hosts a scrolling TextStream.
 *
 * The everyday "logs are streaming" panel of the OS. Wraps a TextStream
 * with autoFeed on so it fills itself with ambient surveillance chatter.
 */

import { OSWindow, type OSWindowOpts } from './OSWindow'
import { TextStream, type TextStreamOpts } from './TextStream'
import type { OSContext } from '../core/context'
import type { Rect } from '../core/geometry'

export class ConsoleWindow extends OSWindow {
  readonly stream: TextStream

  constructor(o: OSWindowOpts, streamOpts?: TextStreamOpts) {
    super(o)
    this.stream = new TextStream({ autoFeedEvery: 1.4, ...streamOpts })
  }

  update(ctx: OSContext): void {
    this.stream.update(ctx)
  }

  protected drawBody(ctx: OSContext, inner: Rect): void {
    this.stream.draw(ctx, inner)
  }
}
