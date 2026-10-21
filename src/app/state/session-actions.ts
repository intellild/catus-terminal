import 'background-only';
import '../runtime';
import * as Atom from 'effect/reactivity/Atom';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import { parseWorkspaceConfig, WorkspaceFormSchema } from '../../shared/workspaces';
import { defaultTmuxPrefix, nextTmuxSessionName } from '../../shared/launch';
import type { WorkspaceConfig } from '../../shared/workspaces';
import {
  applyConfig,
  closeTab,
  createDraft,
  editorAtom,
  editWorkspace,
  loadAtom,
  newTab,
  selectTab,
  selectWorkspace,
  sessionAtom,
  workspaceAtom,
  workspaceProfilesAtom,
} from './session';
import type { TabKind } from '../../shared/tabs';
import type { WorkspaceDraft } from './session';
import { nativeWorkspaceHost, workspaceHostAtom } from './workspace-host';
import { shellsAtom } from './shells';
import { languageAtom, settingsAtom } from './settings';
import type { SettingsSection } from './settings';
import { i18n } from '../i18n';
import { tmuxDestination, tmuxSessionsAtom } from './tmux-sessions';

export const loadWorkspacesAtom = Atom.fn<void>()((_, get) =>
  Effect.gen(function* () {
    get.set(loadAtom, { loading: true, error: '' });
    const host = yield* Effect.try({
      try: () => get(workspaceHostAtom) ?? nativeWorkspaceHost(),
      catch: (error) => error,
    });
    const payload = yield* Effect.tryPromise({
      try: () => host.loadWorkspaces(),
      catch: (error) => error,
    });
    yield* Effect.try({ try: () => parseWorkspaceConfig(payload.config), catch: (error) => error });
    applyConfig(get.registry, payload);
    get.set(loadAtom, { loading: false, error: '' });
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => get.set(loadAtom, { loading: false, error: String(error) })),
    ),
  ),
).pipe(Atom.keepAlive);

const persistWorkspacesAtom = Atom.fn<WorkspaceConfig>()((config, get) =>
  Effect.gen(function* () {
    if (get(editorAtom).saving) {
      return;
    }
    get.set(editorAtom, { ...get(editorAtom), saving: true, error: '' });
    const checked = yield* Effect.try({
      try: () => parseWorkspaceConfig(config),
      catch: (error) => error,
    });
    const host = yield* Effect.try({
      try: () => get(workspaceHostAtom) ?? nativeWorkspaceHost(),
      catch: (error) => error,
    });
    const payload = yield* Effect.tryPromise({
      try: () => host.saveWorkspaces(checked),
      catch: (error) => error,
    });
    yield* Effect.try({ try: () => parseWorkspaceConfig(payload.config), catch: (error) => error });
    applyConfig(get.registry, payload);
    const draft = get(editorAtom).draft;
    const saved = draft && payload.config.workspaces.find((item) => item.id === draft.id);
    // Deleting the displayed host leaves a draft that no longer exists; select the
    // replacement only now, after persistence cleared the saving state.
    get.set(editorAtom, editWorkspace(saved ?? payload.config.workspaces[0]!));
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() =>
        get.set(editorAtom, { ...get(editorAtom), saving: false, error: String(error) }),
      ),
    ),
  ),
).pipe(Atom.keepAlive);

export type SessionAction =
  | {
      type: 'reload' | 'addTab' | 'addWorkspace' | 'closeSettings' | 'saveDraft' | 'retryShells';
    }
  | { type: 'addTab'; kind: TabKind }
  | { type: 'openWorkspace' | 'deleteWorkspace'; id: string }
  | { type: 'focusTab' | 'closeTab'; id: number }
  | { type: 'editWorkspace'; id?: string }
  | { type: 'updateDraft'; field: keyof WorkspaceDraft; value: string }
  | { type: 'attachTmux'; session: string }
  | { type: 'newTmuxSession' }
  | { type: 'openSettings'; section?: SettingsSection }
  | { type: 'selectSettingsSection'; section: SettingsSection }
  | { type: 'selectHost'; id: string }
  | { type: 'changeLanguage'; language: string };

// All commands read the current registry state; no React closure owns business state.
export const sessionActionsAtom = Atom.fnSync<SessionAction>()((action, get) => {
  const state = get(sessionAtom);
  const workspaces = get(workspaceProfilesAtom);
  const store = get.registry;
  const editor = get(editorAtom);
  switch (action.type) {
    case 'reload':
      get.set(loadWorkspacesAtom, undefined);
      return;
    case 'addTab':
      if ('kind' in action) {
        newTab(store, state.activeWorkspaceId ?? undefined, action.kind);
      } else {
        newTab(store);
      }
      return;
    case 'attachTmux':
      if (state.activeWorkspaceId !== null) {
        newTab(store, state.activeWorkspaceId, 'tmux', action.session);
      }
      return;
    case 'newTmuxSession': {
      const workspace =
        state.activeWorkspaceId === null ? undefined : get(workspaceAtom(state.activeWorkspaceId));
      if (!workspace) {
        return;
      }
      const names = get(tmuxSessionsAtom(tmuxDestination(workspace.profile))).sessions.map(
        (session) => session.name,
      );
      newTab(
        store,
        state.activeWorkspaceId ?? undefined,
        'tmux',
        nextTmuxSessionName(workspace.profile.tmuxPrefix ?? defaultTmuxPrefix, names),
      );
      return;
    }
    case 'openSettings': {
      get.set(settingsAtom, { open: true, section: action.section ?? 'hosts' });
      if (editor.draft) {
        // closeSettings keeps the draft but clears open; shell detection only runs
        // for an open editor, so reopening must restore that flag.
        if (!editor.open) {
          get.set(editorAtom, { ...editor, open: true });
        }
      } else {
        const target =
          workspaces.find((item) => item.id === state.activeWorkspaceId) ?? workspaces[0];
        if (target) {
          get.set(editorAtom, editWorkspace(target));
        }
      }
      return;
    }
    case 'selectSettingsSection':
      get.set(settingsAtom, { ...get(settingsAtom), section: action.section });
      return;
    case 'selectHost': {
      if (editor.saving) {
        return;
      }
      const target = workspaces.find((item) => item.id === action.id);
      if (target) {
        get.set(editorAtom, editWorkspace(target));
      }
      return;
    }
    case 'changeLanguage':
      get.set(languageAtom, action.language);
      void i18n.changeLanguage(action.language);
      return;
    case 'openWorkspace':
      selectWorkspace(store, action.id);
      return;
    case 'focusTab':
      selectTab(store, action.id);
      return;
    case 'closeTab':
      closeTab(store, action.id);
      return;
    case 'retryShells':
      get.refresh(shellsAtom);
      return;
    case 'editWorkspace': {
      if (editor.saving) {
        return;
      }
      const target = workspaces.find((item) => item.id === (action.id ?? state.activeWorkspaceId));
      if (target) {
        get.set(settingsAtom, { open: true, section: 'hosts' });
        get.set(editorAtom, editWorkspace(target));
      }
      return;
    }
    case 'addWorkspace':
      if (!editor.saving && state.payload) {
        get.set(settingsAtom, { open: true, section: 'hosts' });
        get.set(editorAtom, createDraft(workspaces));
      }
      return;
    case 'closeSettings':
      if (!editor.saving) {
        get.set(settingsAtom, { ...get(settingsAtom), open: false });
        get.set(editorAtom, { ...editor, open: false });
      }
      return;
    case 'updateDraft': {
      if (!editor.draft || editor.saving) {
        return;
      }
      // The host type is chosen once; changing it would invalidate the profile.
      if (action.field === 'type' && !editor.draft.isNew) {
        return;
      }
      const { field, value } = action;
      get.set(editorAtom, {
        ...editor,
        error: '',
        draft: {
          ...editor.draft,
          [field]: value,
          ...(field === 'command' ? { args: '[]', shell: 'custom' } : {}),
          ...(field === 'shell'
            ? {
                args: value === 'custom' ? '[]' : '["-l"]',
                ...(value !== 'custom' ? { command: value } : {}),
              }
            : {}),
          ...(field === 'type' && value === 'local' && editor.draft.defaultTab === 'sftp'
            ? { defaultTab: 'shell' }
            : {}),
        },
      });
      return;
    }
    case 'deleteWorkspace': {
      if (
        editor.saving ||
        workspaces.length <= 1 ||
        !workspaces.some((item) => item.id === action.id)
      ) {
        return;
      }
      get.set(persistWorkspacesAtom, {
        version: 1,
        workspaces: workspaces.filter((item) => item.id !== action.id),
      });
      return;
    }
    case 'saveDraft': {
      if (!editor.draft || !state.payload || editor.saving) {
        return;
      }
      try {
        const { isNew, ...profile } = Schema.decodeUnknownSync(WorkspaceFormSchema)(editor.draft);
        get.set(persistWorkspacesAtom, {
          version: 1,
          workspaces: isNew
            ? [...workspaces, profile]
            : workspaces.map((item) => (item.id === profile.id ? profile : item)),
        });
      } catch (error) {
        get.set(editorAtom, { ...editor, error: String(error) });
      }
    }
  }
}).pipe(Atom.keepAlive);
