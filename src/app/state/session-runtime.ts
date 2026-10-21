import 'background-only';
import '../runtime';
import * as Atom from 'effect/reactivity/Atom';
import type { AtomRegistry } from 'effect/reactivity/AtomRegistry';
import type { WorkspaceHost } from '../../shared/workspaces';
import { loadWorkspacesAtom } from './session-actions';
import { shellOptionsAtom } from './shells';
import { tmuxSessionsSyncAtom, tmuxSyncAtom } from './tmux';
import { sessionRegistry } from './session-registry';
import { workspaceHostAtom } from './workspace-host';

const sessionRuntimeAtom = Atom.make((get) => {
  get.mount(shellOptionsAtom);
  get.mount(loadWorkspacesAtom);
  get.set(loadWorkspacesAtom, undefined);
  get.set(tmuxSyncAtom, undefined);
  get.set(tmuxSessionsSyncAtom, undefined);
}).pipe(Atom.keepAlive);

// Called by the BTS entry before rendering. Reads are idempotent per registry;
// UI mounts/unmounts neither start nor stop the runtime. Reset/dispose owns cleanup.
export function startSessionRuntime(
  registry: AtomRegistry = sessionRegistry,
  host?: WorkspaceHost,
) {
  if (host) {
    registry.set(workspaceHostAtom, host);
  }
  registry.get(sessionRuntimeAtom);
}
