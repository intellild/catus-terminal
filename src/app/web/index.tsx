import { root } from '@lynx-js/react';
import { App } from '../app';
import { sessionRegistry } from '../state/session-registry';
import { startSessionRuntime } from '../state/session-runtime';
import { terminalHostAtom } from '../state/terminal-sessions';
import { createWebHost } from './host';

if (__BACKGROUND__) {
  const host = createWebHost();
  sessionRegistry.set(terminalHostAtom, host);
  startSessionRuntime(sessionRegistry, host);
}
root.render(<App />);

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept();
}
