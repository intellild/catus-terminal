import 'background-only';
import '../runtime';
import * as Atom from 'effect/reactivity/Atom';
import type { HostService } from '../../shared/config';

// Configure host dependencies on the registry, independently of React.
export const hostServiceAtom = Atom.make<HostService | undefined>(undefined).pipe(Atom.keepAlive);

export function nativeHostService(): HostService {
  return NativeModules.nodejs.exposed as HostService;
}
