import 'background-only';
import '../runtime';
import * as AtomRegistry from 'effect/reactivity/AtomRegistry';

// App-wide lifetime: React regions only subscribe to this registry.
export const sessionRegistry = AtomRegistry.make();
