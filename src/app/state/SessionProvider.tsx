// Install main-thread API compatibility before Effect initializes.
import '../runtime/polyfills';
import { RegistryContext } from '@effect/atom-react/RegistryContext';
import type { ReactNode } from '@lynx-js/react';
import { sessionRegistry } from './sessionRegistry';

// Both threads render the same provider tree. Only BTS starts business atoms;
// the MTS registry remains empty and React does not own either registry.
export function SessionProvider({ children }: { children: ReactNode }) {
  return <RegistryContext.Provider value={sessionRegistry}>{children}</RegistryContext.Provider>;
}
