import 'background-only';
import '../runtime';
import { useCallback, useEffect } from '@lynx-js/react';
import { useAtom, useAtomSet, useAtomValue } from '@effect/atom-react';
import * as Effect from 'effect/Effect';
import { parseWorkspaceConfig, resolveLaunch, launchPreview } from '../../shared/workspaces';
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
  workspaceMenuAtom,
} from './session';
import type { WorkspaceDraft } from './session';

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
  const [workspaceMenu, setWorkspaceMenu] = useAtom(workspaceMenuAtom);
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
  const addSftpTab = useCallback(() => {
    'background only';
    setSession((current) => newTab(current, current.activeWorkspaceId, 'sftp'));
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
  const openSettings = useCallback(
    (id?: string) => {
      'background only';
      if (editor.saving) return;
      const target = id ? workspaces.find((item) => item.id === id) : workspace;
      setWorkspaceMenu(null);
      if (target) setEditor(editWorkspace(target));
    },
    [editor.saving, workspace, workspaces, setEditor, setWorkspaceMenu],
  );
  const updateDraft = useCallback(
    (field: keyof WorkspaceDraft, value: string) => {
      'background only';
      setEditor((current) =>
        current.draft
          ? {
              ...current,
              error: '',
              fieldErrors: { ...current.fieldErrors, [field]: '' },
              draft: {
                ...current.draft,
                [field]: value,
                ...(field === 'command' ? { args: '[]', shell: 'custom' } : {}),
                ...(field === 'shell'
                  ? {
                      args: value === 'custom' ? '[]' : '["-l"]',
                      ...(value !== 'custom' ? { command: value } : {}),
                    }
                  : {}),
              },
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
          Effect.tryPromise({
            try: () => (host ?? nativeHost()).saveWorkspaces(checked),
            catch: (error) => error,
          }),
        );
        parseWorkspaceConfig(payload.config);
        setSession((current) => applyConfig(current, payload));
        setEditor((current) => ({ ...current, open: false, saving: false, error: '' }));
        setWorkspaceMenu(null);
      } catch (error) {
        setEditor((current) => ({ ...current, saving: false, error: String(error) }));
      }
    },
    [editor.saving, host, setSession, setEditor, setWorkspaceMenu],
  );
  const saveDraft = useCallback(() => {
    'background only';
    if (!editor.draft || !state.payload || editor.saving) return;
    const fieldErrors: Record<string, string> = {};
    for (const field of ['name', 'command', 'cwd', 'icon'] as const) {
      if (!editor.draft[field].trim()) fieldErrors[field] = 'Required';
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(editor.draft.color))
      fieldErrors.color = 'Use a six-digit hex color';
    if (
      editor.draft.type === 'ssh' &&
      (!editor.draft.host.trim() || /^[\s-]|[\r\n\0]/.test(editor.draft.host))
    ) {
      fieldErrors.host = 'Enter a hostname, user@host or SSH config alias';
    }
    if (Object.keys(fieldErrors).length) {
      setEditor((current) => ({ ...current, fieldErrors, error: 'Check the highlighted fields.' }));
      return;
    }
    try {
      const { isNew, args: inputArgs, ...fields } = editor.draft;
      const args: unknown = JSON.parse(inputArgs);
      if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) {
        throw new Error('Arguments must be a JSON array of strings, for example ["-l"].');
      }
      const profile = {
        ...fields,
        name: fields.name.trim(),
        host: fields.host.trim(),
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
  const deleteWorkspace = useCallback(
    (id: string) => {
      'background only';
      if (editor.saving || workspaces.length <= 1 || !workspaces.some((item) => item.id === id))
        return;
      void persist({ version: 1, workspaces: workspaces.filter((item) => item.id !== id) });
    },
    [editor.saving, workspaces, persist],
  );
  const openWorkspaceMenu = useCallback(
    (id: string, x: number, y: number) => {
      'background only';
      if (editor.saving || !workspaces.some((item) => item.id === id)) return;
      setEditor((current) => ({ ...current, error: '' }));
      setWorkspaceMenu({ id, x, y });
    },
    [editor.saving, workspaces, setEditor, setWorkspaceMenu],
  );
  const closeWorkspaceMenu = useCallback(() => {
    'background only';
    if (!editor.saving) setWorkspaceMenu(null);
  }, [editor.saving, setWorkspaceMenu]);

  const launch =
    activeTab && state.payload ? resolveLaunch(activeTab.profile, state.payload.environment) : null;
  const command =
    activeTab && state.payload ? launchPreview(activeTab.profile, state.payload.environment) : '';

  const closeSettings = useCallback(() => {
    if (!editor.saving) setEditor((current) => ({ ...current, open: false }));
  }, [editor.saving, setEditor]);
  const addWorkspace = useCallback(() => {
    'background only';
    if (!editor.saving && state.payload) {
      setWorkspaceMenu(null);
      setEditor(createDraft(workspaces));
    }
  }, [editor.saving, state.payload, workspaces, setEditor, setWorkspaceMenu]);
  return {
    view,
    load,
    editor,
    workspaceMenu,
    openWorkspaceMenu,
    closeWorkspaceMenu,
    launch,
    command,
    loadConfig,
    openWorkspace,
    addTab,
    addSftpTab,
    focusTab,
    removeTab,
    openSettings,
    updateDraft,
    saveDraft,
    deleteWorkspace,
    closeSettings,
    addWorkspace,
  };
}
