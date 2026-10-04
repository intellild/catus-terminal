import 'background-only';
import '../runtime';
import { useCallback, useEffect } from '@lynx-js/react';
import { useAtom, useAtomSet, useAtomValue } from '@effect/atom-react';
import * as Effect from 'effect/Effect';
import { parseWorkspaceConfig, resolveLaunch } from '../../shared/workspaces';
import type { WorkspaceConfig, WorkspaceHost } from '../../shared/workspaces';
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
  sessionViewAtom,
} from './session';
import type { WorkspaceDraft } from './session';
import type { Workspace } from '../../shared/workspaces';

function nativeHost(): WorkspaceHost {
  return NativeModules.nodejs.exposed as WorkspaceHost;
}

export function useLoadWorkspaces(host?: WorkspaceHost) {
  const setSession = useAtomSet(sessionAtom);
  const setLoad = useAtomSet(loadAtom);
  useEffect(() => {
    'background only';
    let disposed = false;
    setLoad({ loading: true, error: '' });
    Effect.runPromise(Effect.tryPromise(() => (host ?? nativeHost()).loadWorkspaces()))
      .then((payload) => {
        if (disposed) return;
        parseWorkspaceConfig(payload.config);
        setSession((current) => applyConfig(current, payload));
        setLoad({ loading: false, error: '' });
      })
      .catch((error) => {
        if (!disposed) setLoad({ loading: false, error: String(error) });
      });
    return () => {
      disposed = true;
    };
  }, [host, setLoad, setSession]);
}

export function useWorkspaceSession(host?: WorkspaceHost) {
  const view = useAtomValue(sessionViewAtom);
  const setSession = useAtomSet(sessionAtom);
  const [load, setLoad] = useAtom(loadAtom);
  const [editor, setEditor] = useAtom(editorAtom);
  const { state, workspaces, workspace, activeTab } = view;

  const loadConfig = useCallback(async () => {
    'background only';
    setLoad({ loading: true, error: '' });
    try {
      const payload = await Effect.runPromise(
        Effect.tryPromise(() => (host ?? nativeHost()).loadWorkspaces()),
      );
      // Validate on both sides of the host boundary.
      parseWorkspaceConfig(payload.config);
      setSession((current) => applyConfig(current, payload));
      setLoad({ loading: false, error: '' });
    } catch (error) {
      setLoad({ loading: false, error: String(error) });
    }
  }, [host, setLoad, setSession]);

  const openWorkspace = useCallback(
    (id: string) => {
      'background only';
      setSession((current) => selectWorkspace(current, id));
    },
    [setSession],
  );
  const addTab = useCallback(() => {
    'background only';
    setSession((current) => newTab(current));
  }, [setSession]);
  const focusTab = useCallback(
    (id: number) => {
      'background only';
      setSession((current) => selectTab(current, id));
    },
    [setSession],
  );
  const removeTab = useCallback(
    (id: number) => {
      'background only';
      setSession((current) => closeTab(current, id));
    },
    [setSession],
  );
  const openSettings = useCallback(() => {
    'background only';
    const target = workspace ?? workspaces[0];
    if (target) setEditor(editWorkspace(target));
  }, [workspace, workspaces, setEditor]);
  const updateDraft = useCallback(
    (field: keyof WorkspaceDraft, value: string) => {
      'background only';
      setEditor((current) =>
        current.draft
          ? {
              ...current,
              error: '',
              draft: { ...current.draft, [field]: value },
            }
          : current,
      );
    },
    [setEditor],
  );

  const persist = useCallback(
    async (config: WorkspaceConfig) => {
      'background only';
      if (editor.saving) return;
      setEditor((current) => ({ ...current, saving: true, error: '' }));
      try {
        const checked = parseWorkspaceConfig(config);
        const payload = await Effect.runPromise(
          Effect.tryPromise(() => (host ?? nativeHost()).saveWorkspaces(checked)),
        );
        parseWorkspaceConfig(payload.config);
        setSession((current) => applyConfig(current, payload));
        setEditor((current) => ({ ...current, open: false, saving: false, error: '' }));
      } catch (error) {
        setEditor((current) => ({ ...current, saving: false, error: String(error) }));
      }
    },
    [editor.saving, host, setSession, setEditor],
  );
  const saveDraft = useCallback(() => {
    'background only';
    if (!editor.draft || !state.payload || editor.saving) return;
    try {
      const { isNew, args: inputArgs, ...fields } = editor.draft;
      const args: unknown = JSON.parse(inputArgs);
      if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) {
        throw new Error('Arguments must be a JSON array of strings, for example ["-l"].');
      }
      const profile = {
        ...fields,
        name: fields.name.trim(),
        command: fields.command.trim(),
        cwd: fields.cwd.trim(),
        args,
      };
      const next = isNew
        ? [...workspaces, profile]
        : workspaces.map((item) => (item.id === profile.id ? profile : item));
      void persist({ version: 1, workspaces: next });
    } catch (error) {
      setEditor((current) => ({ ...current, error: String(error) }));
    }
  }, [editor, state.payload, workspaces, persist, setEditor]);
  const deleteWorkspace = useCallback(() => {
    'background only';
    if (!editor.draft || editor.draft.isNew || editor.saving || workspaces.length <= 1) return;
    void persist({
      version: 1,
      workspaces: workspaces.filter((item) => item.id !== editor.draft!.id),
    });
  }, [editor, workspaces, persist]);

  const launch =
    activeTab && state.payload ? resolveLaunch(activeTab.profile, state.payload.environment) : null;
  const command = launch ? [launch.command, ...launch.args].join(' ') : '';

  const closeSettings = useCallback(() => {
    if (!editor.saving) setEditor((current) => ({ ...current, open: false }));
  }, [editor.saving, setEditor]);
  const selectProfile = useCallback(
    (profile: Workspace) => {
      if (!editor.saving) setEditor(editWorkspace(profile));
    },
    [editor.saving, setEditor],
  );
  const addWorkspace = useCallback(() => {
    if (!editor.saving) setEditor(createDraft(workspaces));
  }, [editor.saving, workspaces, setEditor]);
  return {
    view,
    load,
    editor,
    launch,
    command,
    loadConfig,
    openWorkspace,
    addTab,
    focusTab,
    removeTab,
    openSettings,
    updateDraft,
    saveDraft,
    deleteWorkspace,
    closeSettings,
    selectProfile,
    addWorkspace,
  };
}
