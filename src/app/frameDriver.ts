import { dispatchUIFrames } from './components/ui/frames';
import { runOnBackground, runOnMainThread, useEffect, useMainThreadRef } from '@lynx-js/react';

interface FrameDriverState {
  running: boolean;
  request: number;
}

let dispatchFailed = false;

function dispatchAnimationFrame() {
  'background only';
  try {
    dispatchUIFrames();
    const host = NativeModules.nodejs.exposed as { dispatchAnimationFrame(): void };
    host.dispatchAnimationFrame();
    dispatchFailed = false;
  } catch (error) {
    // The RAF loop owns retries: a transient host failure must not stop the
    // cross-thread call and leave the terminal without frames.
    if (!dispatchFailed) {
      dispatchFailed = true;
      console.error('Terminal frame dispatch failed', error);
    }
  }
}

// Import from App so runOnBackground is included in the main-thread bundle.
// One driver per app runtime, independent of tabs, sessions and terminal elements.
// Replace this adapter when the host's native RAF can drive Rust directly.
export function useFrameDriver() {
  const state = useMainThreadRef<FrameDriverState>({ running: false, request: 0 });
  useEffect(() => {
    void runOnMainThread(() => {
      'main thread';
      state.current.running = true;
      let dispatch: (() => void) | undefined;
      const frame = () => {
        state.current.request = 0;
        if (!state.current.running) {
          return;
        }
        try {
          dispatch ??= runOnBackground(dispatchAnimationFrame);
          dispatch();
        } catch {
          // Keep the RAF chain (and its retry) alive. Otherwise a transient
          // cross-thread or host binding failure stops every terminal frame.
          dispatch = undefined;
        }
        state.current.request = requestAnimationFrame(frame);
      };
      state.current.request = requestAnimationFrame(frame);
    })();
    return () => {
      void runOnMainThread(() => {
        'main thread';
        state.current.running = false;
        if (state.current.request) {
          cancelAnimationFrame(state.current.request);
        }
        state.current.request = 0;
      })();
    };
  }, []);
}
