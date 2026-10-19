import 'background-only';
import '../runtime';
import * as Atom from 'effect/reactivity/Atom';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import { parseWorkspaceConfig, WorkspaceFormSchema } from '../../shared/workspaces';
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
  workspaceProfilesAtom,
} from './session';
import type { TabKind } from '../../shared/tabs';
import type { WorkspaceDraft } from './session';
import { nativeWorkspaceHost, workspaceHostAtom } from './workspaceHost';
import { shellsAtom } from './shells';

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
    get.set(editorAtom, { ...get(editorAtom), open: false, saving: false, error: '' });
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
  | { type: 'updateDraft'; field: keyof WorkspaceDraft; value: string };

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
        get.set(editorAtom, editWorkspace(target));
      }
      return;
    }
    case 'addWorkspace':
      if (!editor.saving && state.payload) {
        get.set(editorAtom, createDraft(workspaces));
      }
      return;
    case 'closeSettings':
      if (!editor.saving) {
        get.set(editorAtom, { ...editor, open: false });
      }
      return;
    case 'updateDraft': {
      if (!editor.draft || editor.saving) {
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
    case 'deleteWorkspace':
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
