import { runOnBackground, runOnMainThread, useEffect, useMainThreadRef } from '@lynx-js/react';

interface FrameDriverState {
  running: boolean;
  request: number;
}

function dispatchAnimationFrame() {
  'background only';
  const host = NativeModules.nodejs.exposed as { dispatchAnimationFrame(): void };
  host.dispatchAnimationFrame();
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
      const dispatch = runOnBackground(dispatchAnimationFrame);
      const frame = () => {
        state.current.request = 0;
        if (!state.current.running) return;
        void dispatch();
        state.current.request = requestAnimationFrame(frame);
      };
      state.current.request = requestAnimationFrame(frame);
    })();
    return () => {
      void runOnMainThread(() => {
        'main thread';
        state.current.running = false;
        if (state.current.request) cancelAnimationFrame(state.current.request);
        state.current.request = 0;
      })();
    };
  }, []);
}
