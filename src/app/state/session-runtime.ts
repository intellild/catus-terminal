import 'background-only';
import '../runtime';
import * as Atom from 'effect/reactivity/Atom';
import type { AtomRegistry } from 'effect/reactivity/AtomRegistry';
import type { HostService } from '../../shared/hosts';
import { loadHostsAtom } from './session-actions';
import { shellOptionsAtom } from './shells';
import { tmuxSessionsSyncAtom, tmuxSyncAtom } from './tmux';
import { sessionRegistry } from './session-registry';
import { hostServiceAtom } from './host-service';

const sessionRuntimeAtom = Atom.make((get) => {
  get.mount(shellOptionsAtom);
  get.mount(loadHostsAtom);
  get.set(loadHostsAtom, undefined);
  get.set(tmuxSyncAtom, undefined);
  get.set(tmuxSessionsSyncAtom, undefined);
}).pipe(Atom.keepAlive);

// Called by the BTS entry before rendering. Reads are idempotent per registry;
// UI mounts/unmounts neither start nor stop the runtime. Reset/dispose owns cleanup.
export function startSessionRuntime(registry: AtomRegistry = sessionRegistry, host?: HostService) {
  if (host) {
    registry.set(hostServiceAtom, host);
  }
  registry.get(sessionRuntimeAtom);
}
