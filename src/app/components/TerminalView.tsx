import 'background-only';
import { useEffect, useState } from '@lynx-js/react';
import { NativeTerminalView } from './NativeTerminalView';

export interface TerminalHost {
  createTerminalSession(): number;
  closeTerminalSession(id: number): void;
}

// The component owns the session for its entire mount, including inactive tabs.
export function TerminalView({ active }: { active: boolean }) {
  const [sessionId, setSessionId] = useState<number>();
  const [error, setError] = useState('');
  useEffect(() => {
    const host = NativeModules.nodejs.exposed as TerminalHost;
    try {
      const id = host.createTerminalSession();
      setSessionId(id);
      return () => host.closeTerminalSession(id);
    } catch (cause) {
      setError(String(cause));
    }
  }, []);
  if (!active) return null;
  if (error) {
    return (
      <text id="terminal-error" className="text-[12px] text-[#e4a4a4] p-[12px]">
        {error}
      </text>
    );
  }
  return sessionId === undefined ? null : <NativeTerminalView sessionId={sessionId} />;
}
