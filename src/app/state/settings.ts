import 'background-only';
import '../runtime';
import * as Atom from 'effect/reactivity/Atom';

export type SettingsSection = 'hosts' | 'display';

export interface SettingsState {
  readonly open: boolean;
  readonly section: SettingsSection;
}

// The dialog is registry-owned so the sidebar, context menu and tab actions can
// open it without owning React state.
export const settingsAtom = Atom.make<SettingsState>({
  open: false,
  section: 'hosts',
}).pipe(Atom.keepAlive);

export const languageAtom = Atom.make('en').pipe(Atom.keepAlive);
