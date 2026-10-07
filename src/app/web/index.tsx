import { root } from '@lynx-js/react';
import { App } from '../App';
import { sessionRegistry } from '../state/sessionRegistry';
import { startSessionRuntime } from '../state/sessionRuntime';
import { terminalHostAtom } from '../state/terminalSessions';
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
