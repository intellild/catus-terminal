import 'background-only';
import { useEffect, useState } from '@lynx-js/react';
import type { TerminalTab } from './session';

export interface TerminalHost {
  createTerminalSession(): number;
  closeTerminalSession(id: number): void;
}

// Sessions follow tab lifetime; the one native view only switches the selected ID.
export function useTerminalSession(tabs: readonly TerminalTab[], id?: string) {
  const [sessions] = useState(() => new Map<string, number>());
  const [errors] = useState(() => new Map<string, string>());
  const [selected, setSelected] = useState({ sessionId: 0, error: '' });
  useEffect(() => {
    const host = NativeModules.nodejs.exposed as TerminalHost;
    const live = new Set(tabs.map((tab) => tab.id));
    for (const [tabId, sessionId] of sessions) {
      if (!live.has(tabId)) {
        host.closeTerminalSession(sessionId);
        sessions.delete(tabId);
      }
    }
    for (const tabId of errors.keys()) {
      if (!live.has(tabId)) errors.delete(tabId);
    }
    for (const tab of tabs) {
      if (sessions.has(tab.id) || errors.has(tab.id)) continue;
      try {
        sessions.set(tab.id, host.createTerminalSession());
      } catch (cause) {
        errors.set(tab.id, String(cause));
      }
    }
    setSelected({
      sessionId: id ? (sessions.get(id) ?? 0) : 0,
      error: id ? (errors.get(id) ?? '') : '',
    });
  }, [tabs, id, sessions, errors]);
  useEffect(() => {
    const host = NativeModules.nodejs.exposed as TerminalHost;
    return () => {
      for (const sessionId of sessions.values()) host.closeTerminalSession(sessionId);
      sessions.clear();
      errors.clear();
    };
  }, [sessions, errors]);
  return selected;
}
