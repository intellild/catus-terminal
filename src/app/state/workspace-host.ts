import 'background-only';
import '../runtime';
import * as Atom from 'effect/reactivity/Atom';
import type { WorkspaceHost } from '../../shared/workspaces';

// Configure host dependencies on the registry, independently of React.
export const workspaceHostAtom = Atom.make<WorkspaceHost | undefined>(undefined).pipe(
  Atom.keepAlive,
);

export function nativeWorkspaceHost(): WorkspaceHost {
  return NativeModules.nodejs.exposed as WorkspaceHost;
}
