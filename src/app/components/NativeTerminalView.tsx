import 'background-only';
import { useCallback, useMainThreadRef } from '@lynx-js/react';
import type { MainThreadRef } from '@lynx-js/react';
import type { KeyEvent, MainThread } from '@lynx-js/types';

export function NativeTerminalView({ sessionId }: { sessionId: number }) {
  const frameLoop = useMainThreadRef<FrameLoop | null>(null);
  const attach = useCallback(
    (element: MainThread.Element | null) => {
      'main thread';
      stopFrames(frameLoop);
      if (!element) return;
      frameLoop.current = { element, request: 0, stopped: false, needsFocus: true };
      requestFrame(frameLoop);
      return () => {
        stopFrames(frameLoop);
      };
    },
    [frameLoop],
  );

  const key = (event: KeyEvent) => {
    'background only';
    // macOS system shortcuts stay with the host; ordinary/control/option keys go to the PTY.
    if (event.metaKey) return;
    lynx
      .createSelectorQuery()
      .select('#terminal-surface')
      .invoke({
        method: 'key',
        params: { key: event.key, control: event.ctrlKey, alt: event.altKey },
      })
      .exec();
  };
  return (
    <native-terminal
      id="terminal-surface"
      terminal-id={sessionId}
      focusable
      className={sessionId === 0 ? 'hidden' : 'flex-1 w-full min-h-0'}
      main-thread:ref={attach}
      bindtap={focus}
      catchkeydown={key}
    />
  );
}

function focus() {
  'background only';
  lynx.createSelectorQuery().select('#terminal-surface').invoke({ method: 'focus' }).exec();
}

interface FrameLoop {
  element: MainThread.Element;
  request: number;
  stopped: boolean;
  needsFocus: boolean;
}

function stopFrames(ref: MainThreadRef<FrameLoop | null>) {
  'main thread';
  const loop = ref.current;
  if (loop) {
    loop.stopped = true;
    cancelAnimationFrame(loop.request);
    ref.current = null;
  }
}

function requestFrame(ref: MainThreadRef<FrameLoop | null>) {
  'main thread';
  const loop = ref.current;
  if (!loop || loop.stopped) return;
  loop.request = requestAnimationFrame(() => {
    if (loop.stopped) return;
    if (!Number(loop.element.getAttribute('terminal-id'))) {
      requestFrame(ref);
      return;
    }
    // Schedule only after the native method finishes; idle grids do not draw.
    loop.element.invoke('renderFrame').then(
      () => {
        if (loop.stopped) return;
        if (loop.needsFocus) {
          loop.needsFocus = false;
          void loop.element.invoke('focus').catch(console.error);
        }
        requestFrame(ref);
      },
      (cause: unknown) => {
        if (!loop.stopped) console.error('Terminal render failed', cause);
        if (!loop.stopped) requestFrame(ref);
      },
    );
  });
}
