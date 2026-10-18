import 'background-only';
import * as Effect from 'effect/Effect';

// The hover trigger interrupts this sleep on direction changes or unmount.
// This module stays out of the main-thread runtime.
export function delayPopover(milliseconds: number, callback: () => void): () => void {
  'background only';
  return Effect.runCallback(Effect.sleep(milliseconds).pipe(Effect.andThen(Effect.sync(callback))));
}
