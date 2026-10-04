import 'background-only';
import { useEffect, useState, useMainThreadRef } from '@lynx-js/react';
import type { MainThreadRef } from '@lynx-js/react';
import type { RustTerminal } from '@catus/native/lynxtron';
import type { KeyEvent, MainThread } from '@lynx-js/types';
import type { TerminalTab } from '../state/session';

// The component owns PTYs by tab ID. Switching tabs changes only the visible view.
export function TerminalSurface({
  tabs,
  activeId,
}: {
  tabs: readonly TerminalTab[];
  activeId?: string;
}) {
  const [sessions] = useState(() => new Map<string, RustTerminal>());
  const [nativeId, setNativeId] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const liveIds = new Set(tabs.map((tab) => tab.id));
    for (const [id, session] of sessions) {
      if (!liveIds.has(id)) {
        session.close();
        sessions.delete(id);
      }
    }
    if (!activeId) {
      setNativeId('');
      return;
    }
    try {
      let session = sessions.get(activeId);
      if (!session) {
        const host = NativeModules.nodejs.exposed as { createDefaultTerminal(): RustTerminal };
        session = host.createDefaultTerminal();
        sessions.set(activeId, session);
      }
      setNativeId(session.nativeId);
      setError('');
    } catch (cause) {
      setNativeId('');
      setError(String(cause));
    }
  }, [tabs, activeId, sessions]);
  useEffect(
    () => () => {
      for (const session of sessions.values()) session.close();
      sessions.clear();
    },
    [sessions],
  );

  const frameLoop = useMainThreadRef<FrameLoop | null>(null);

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
  if (!activeId) return null;
  return (
    <view className="flex-1 min-h-0 flex flex-col [-x-app-region:no-drag]">
      {nativeId ? (
        <native-terminal
          key={nativeId}
          id="terminal-surface"
          terminal-id={nativeId}
          focusable
          className="flex-1 w-full min-h-0"
          main-thread:ref={(element) => {
            'main thread';
            stopFrames(frameLoop);
            if (!element) return;
            frameLoop.current = { element, request: 0, stopped: false, needsFocus: true };
            requestFrame(frameLoop);
            return () => {
              stopFrames(frameLoop);
            };
          }}
          bindtap={focus}
          catchkeydown={key}
        />
      ) : null}
      {error ? (
        <text id="terminal-error" className="text-[12px] text-[#e4a4a4] p-[12px]">
          {error}
        </text>
      ) : null}
    </view>
  );
}

function focus() {
  'background only';
  lynx
    .createSelectorQuery()
    .select('#terminal-surface')
    .invoke({ method: 'focus', params: {} })
    .exec();
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
    // Schedule only after the native method finishes; idle grids do not draw.
    loop.element.invoke('renderFrame', {}).then(
      () => {
        if (loop.stopped) return;
        if (loop.needsFocus) {
          loop.needsFocus = false;
          void loop.element.invoke('focus', {}).catch(console.error);
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
