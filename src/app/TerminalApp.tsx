import 'background-only';
import './runtime';
import { useCallback, useEffect } from '@lynx-js/react';
import { RegistryProvider, useAtom, useAtomSet, useAtomValue } from '@effect/atom-react';
import * as Effect from 'effect/Effect';
import type { NativeInputEvent } from '@catus/native';
import { parseWorkspaceConfig, resolveLaunch } from '../shared/workspaces';
import type { WorkspaceConfig, WorkspaceHost } from '../shared/workspaces';
import {
  applyConfig, closeTab, createDraft, editorAtom, editWorkspace, loadAtom,
  newTab, selectTab, selectWorkspace, sessionAtom, sessionViewAtom,
} from './state/session';
import type { WorkspaceDraft } from './state/session';
import './App.css';

function nativeHost(): WorkspaceHost {
  'background only';
  return NativeModules.nodejs.exposed as WorkspaceHost;
}

export function WorkspaceApp({ host }: { host?: WorkspaceHost }) {
  return <RegistryProvider><TerminalApp host={host} /></RegistryProvider>;
}

function TerminalApp({ host }: { host?: WorkspaceHost }) {
  const view = useAtomValue(sessionViewAtom);
  const setSession = useAtomSet(sessionAtom);
  const [load, setLoad] = useAtom(loadAtom);
  const [editor, setEditor] = useAtom(editorAtom);
  const { state, workspaces, workspace, tabs, activeTab, runningIds } = view;

  const loadConfig = useCallback(async () => {
    'background only';
    setLoad({ loading: true, error: '' });
    try {
      const payload = await Effect.runPromise(Effect.tryPromise(() => (host ?? nativeHost()).loadWorkspaces()));
      // Validate on both sides of the host boundary.
      parseWorkspaceConfig(payload.config);
      setSession(current => applyConfig(current, payload));
      setLoad({ loading: false, error: '' });
    } catch (error) {
      setLoad({ loading: false, error: String(error) });
    }
  }, [host, setLoad, setSession]);

  useEffect(() => {
    'background only';
    let disposed = false;
    setLoad({ loading: true, error: '' });
    Effect.runPromise(Effect.tryPromise(() => (host ?? nativeHost()).loadWorkspaces())).then(payload => {
      if (disposed) return;
      parseWorkspaceConfig(payload.config);
      setSession(current => applyConfig(current, payload));
      setLoad({ loading: false, error: '' });
    }).catch(error => {
      if (!disposed) setLoad({ loading: false, error: String(error) });
    });
    return () => { disposed = true; };
  }, [host, setLoad, setSession]);

  const openWorkspace = useCallback((id: string) => {
    'background only';
    setSession(current => selectWorkspace(current, id));
  }, [setSession]);
  const addTab = useCallback(() => {
    'background only';
    setSession(current => newTab(current));
  }, [setSession]);
  const focusTab = useCallback((id: string) => {
    'background only';
    setSession(current => selectTab(current, id));
  }, [setSession]);
  const removeTab = useCallback((id: string) => {
    'background only';
    setSession(current => closeTab(current, id));
  }, [setSession]);
  const openSettings = useCallback(() => {
    'background only';
    const target = workspace ?? workspaces[0];
    if (target) setEditor(editWorkspace(target));
  }, [workspace, workspaces, setEditor]);
  const updateDraft = useCallback((field: keyof WorkspaceDraft, value: string) => {
    'background only';
    setEditor(current => current.draft ? {
      ...current, error: '', draft: { ...current.draft, [field]: value },
    } : current);
  }, [setEditor]);

  const persist = useCallback(async (config: WorkspaceConfig) => {
    'background only';
    if (editor.saving) return;
    setEditor(current => ({ ...current, saving: true, error: '' }));
    try {
      const checked = parseWorkspaceConfig(config);
      const payload = await Effect.runPromise(Effect.tryPromise(() => (host ?? nativeHost()).saveWorkspaces(checked)));
      parseWorkspaceConfig(payload.config);
      setSession(current => applyConfig(current, payload));
      setEditor(current => ({ ...current, open: false, saving: false, error: '' }));
    } catch (error) {
      setEditor(current => ({ ...current, saving: false, error: String(error) }));
    }
  }, [editor.saving, host, setSession, setEditor]);
  const saveDraft = useCallback(() => {
    'background only';
    if (!editor.draft || !state.payload || editor.saving) return;
    try {
      const { isNew, args: inputArgs, ...fields } = editor.draft;
      const args: unknown = JSON.parse(inputArgs);
      if (!Array.isArray(args) || !args.every(arg => typeof arg === 'string')) {
        throw new Error('Arguments must be a JSON array of strings, for example ["-l"].');
      }
      const profile = { ...fields, name: fields.name.trim(), command: fields.command.trim(), cwd: fields.cwd.trim(), args };
      const next = isNew ? [...workspaces, profile] : workspaces.map(item => item.id === profile.id ? profile : item);
      void persist({ version: 1, workspaces: next });
    } catch (error) {
      setEditor(current => ({ ...current, error: String(error) }));
    }
  }, [editor, state.payload, workspaces, persist, setEditor]);
  const deleteWorkspace = useCallback(() => {
    'background only';
    if (!editor.draft || editor.draft.isNew || editor.saving || workspaces.length <= 1) return;
    void persist({ version: 1, workspaces: workspaces.filter(item => item.id !== editor.draft!.id) });
  }, [editor, workspaces, persist]);

  const launch = activeTab && state.payload ? resolveLaunch(activeTab.profile, state.payload.environment) : null;
  const command = launch ? [launch.command, ...launch.args].join(' ') : '';

  return (
    <view className="Application">
      <view className="WorkspaceDock">
        <view className="BrandMark"><text className="BrandLetter">c</text></view>
        <view className="DockSeparator" />
        <scroll-view scroll-y className="WorkspaceScroll">
          <view className="WorkspaceList">
            {workspaces.map(item => (
              <view id={`workspace-${item.id}`} key={item.id}
                className={`WorkspaceItem ${workspace?.id === item.id ? 'WorkspaceSelected' : ''}`}
                bindtap={() => openWorkspace(item.id)}>
                <view className="WorkspaceIcon" style={{ backgroundColor: workspace?.id === item.id ? item.color : '#25292f' }}>
                  <text className={`WorkspaceGlyph ${workspace?.id === item.id ? 'WorkspaceGlyphSelected' : ''}`}>{item.icon}</text>
                </view>
                <text className="WorkspaceName">{item.name}</text>
                <view className="DotSlot">
                  {runningIds.has(item.id) && <view id={`running-${item.id}`} className="RunningDot" style={{ backgroundColor: item.color }} />}
                </view>
              </view>
            ))}
          </view>
        </scroll-view>
        <view id="workspace-settings" className="DockSettings" bindtap={openSettings}><text className="SettingsGlyph">⚙</text></view>
        <text className="DockCaption">CATUS</text>
      </view>

      <view className="MainPane">
        <view className="TabChrome">
          <scroll-view scroll-x className="TabScroll">
            <view className="TabList" style={{ width: `${Math.max(tabs.length * 198, 198)}px` }}>
              {tabs.map(tab => (
                <view key={tab.id} className={`Tab ${activeTab?.id === tab.id ? 'TabActive' : ''}`}>
                  <view id={`tab-${tab.number}`} className="TabSelect" bindtap={() => focusTab(tab.id)}>
                    <view className="TabDot" style={{ backgroundColor: tab.profile.color }} />
                    <text className={`TabTitle ${activeTab?.id === tab.id ? 'TabTitleActive' : ''}`}>{`${tab.profile.name} ${tab.number}`}</text>
                  </view>
                  <view id={`close-tab-${tab.number}`} className="TabClose" bindtap={() => removeTab(tab.id)}><text className="CloseGlyph">×</text></view>
                </view>
              ))}
              {!tabs.length && <text className="NoTabsLabel">{load.loading ? 'Opening workspace…' : 'No open tabs'}</text>}
            </view>
          </scroll-view>
          <view id="new-tab" className="NewTab" bindtap={addTab}><text className="PlusGlyph">+</text></view>
          <view className="ChromeDivider" />
          <text className="ChromeLabel">Catus Terminal</text>
        </view>

        <view className="WorkspaceToolbar">
          <view className="ToolbarLeading">
            <text className="ToolbarIcon" style={{ color: workspace?.color ?? '#a8e6cf' }}>{workspace?.icon ?? '>_'}</text>
            <text id="active-workspace" className="ToolbarTitle">{workspace?.name ?? 'Workspaces'}</text>
            <text className="ToolbarSlash">/</text>
            <text className="ToolbarDetail">{tabs.length} {tabs.length === 1 ? 'tab' : 'tabs'}</text>
          </view>
          <view id="edit-workspace" className="ToolbarButton" bindtap={openSettings}><text className="ToolbarButtonText">Configure workspace</text></view>
        </view>

        <view className="TerminalStage">
          {load.error ? <view className="EmptyState">
            <text className="EmptyTitle">Could not load workspaces</text>
            <text id="config-error" className="ErrorText">{load.error}</text>
            <view id="retry-config" className="PrimaryButton" bindtap={loadConfig}><text className="PrimaryButtonText">Try again</text></view>
          </view> : <>
            <view className="StageHeading">
              <view className="StagePath"><text className="PathTilde">~</text><text id="session-directory" className="PathText">{launch?.cwd ?? 'Choose a workspace'}</text></view>
              <text id="session-label" className="SessionBadge">{activeTab ? `SESSION ${String(activeTab.number).padStart(2, '0')}` : 'NO SESSION'}</text>
            </view>
            <view className="EmptyState">
              <view className="TerminalSymbol"><text className="TerminalSymbolText" style={{ color: workspace?.color ?? '#a8e6cf' }}>{workspace?.icon ?? '>_'}</text></view>
              <text className="EmptyEyebrow">{activeTab ? `${activeTab.profile.name.toUpperCase()} WORKSPACE` : 'YOUR WORKSPACE'}</text>
              <text id="terminal-placeholder" className="EmptyTitle">{load.loading ? 'Getting things ready.' : activeTab ? 'A little space to make things.' : 'Start something new.'}</text>
              <text className="EmptyDescription">{activeTab ? 'Your terminal content will appear here.' : 'Open a terminal tab in this workspace.'}</text>
              {activeTab ? <view className="CommandPill"><text className="CommandPrompt">$</text><text id="session-command" className="CommandText">{command}</text></view>
                : !load.loading && <view id="start-terminal" className="PrimaryButton" bindtap={addTab}><text className="PrimaryButtonText">+ New terminal</text></view>}
              <text className="PlaceholderNote">TERMINAL CONTENT PLACEHOLDER</text>
            </view>
            <view className="StageFooter"><text className="StageFooterText">{workspace?.name ?? 'Catus'} · {activeTab ? `Tab ${activeTab.number}` : 'No open tabs'}</text><text className="StageFooterText">A place for every kind of work.</text></view>
          </>}
        </view>

        <view className="StatusBar">
          <view className="StatusLeading"><view className="StatusDot" /><text id="session-summary" className="StatusText">{runningIds.size} {runningIds.size === 1 ? 'workspace' : 'workspaces'} open · {state.tabs.length} {state.tabs.length === 1 ? 'tab' : 'tabs'}</text></view>
          <text className="StatusHint">{activeTab ? 'Local session · placeholder' : 'Ready'}</text>
        </view>
      </view>

      {editor.open && editor.draft && <view className="SettingsOverlay">
        <view className="SettingsScrim" bindtap={() => { if (!editor.saving) setEditor(current => ({ ...current, open: false })); }} />
        <view className="SettingsPanel">
          <view className="SettingsHeading"><view><text className="SettingsEyebrow">MAKE IT YOURS</text><text className="SettingsTitle">Workspaces</text></view>
            <view id="close-settings" className="PanelClose" bindtap={() => { if (!editor.saving) setEditor(current => ({ ...current, open: false })); }}><text className="CloseGlyph">×</text></view>
          </view>
          <scroll-view scroll-y className="SettingsScroll"><view className="SettingsBody">
            <view className="ProfileChoices">{workspaces.map(item => <view key={item.id} id={`edit-profile-${item.id}`}
              className={`ProfileChoice ${editor.draft?.id === item.id ? 'ProfileChoiceSelected' : ''}`}
              bindtap={() => { if (!editor.saving) setEditor(editWorkspace(item)); }}><text className="ProfileChoiceText">{item.name}</text></view>)}
              <view id="add-workspace" className="ProfileChoice" bindtap={() => { if (!editor.saving) setEditor(createDraft(workspaces)); }}><text className="ProfileChoiceText">+ Add</text></view>
            </view>
            <text className="EditorSectionTitle">{editor.draft.isNew ? 'New workspace' : 'Launch profile'}</text>
            <Field id="profile-name" label="Name" value={editor.draft.name} onInput={value => updateDraft('name', value)} />
            <Field id="profile-command" label="Command" value={editor.draft.command} onInput={value => updateDraft('command', value)} />
            <text className="FieldHint">$SHELL uses your account’s default shell.</text>
            <Field id="profile-args" label="Arguments · JSON array" value={editor.draft.args} onInput={value => updateDraft('args', value)} />
            <Field id="profile-cwd" label="Working directory" value={editor.draft.cwd} onInput={value => updateDraft('cwd', value)} />
            <view className="AppearanceFields"><Field id="profile-icon" label="Icon text" value={editor.draft.icon} onInput={value => updateDraft('icon', value)} />
              <Field id="profile-color" label="Color · hex" value={editor.draft.color} onInput={value => updateDraft('color', value)} /></view>
            <text className="FieldHint">Changes apply to new tabs. Existing tabs keep their launch profile.</text>
            {editor.error && <text id="editor-error" className="ErrorText">{editor.error}</text>}
            <view className="EditorActions"><view id="save-workspace" className="PrimaryButton" bindtap={saveDraft}><text className="PrimaryButtonText">{editor.saving ? 'Saving…' : 'Save workspace'}</text></view>
              {!editor.draft.isNew && workspaces.length > 1 && <view id="delete-workspace" className="DeleteButton" bindtap={deleteWorkspace}><text className="DeleteText">Remove</text></view>}
            </view>
            <view className="ConfigLocation"><text className="ConfigLocationLabel">CONFIGURATION FILE</text><text id="config-path" className="ConfigLocationPath">{state.payload?.path}</text></view>
          </view></scroll-view>
        </view>
      </view>}
    </view>
  );
}

function Field({ id, label, value, onInput }: { id: string; label: string; value: string; onInput(value: string): void }) {
  return <view className="Field"><text className="FieldLabel">{label}</text>
    <native-input id={id} className="FieldInput" value={value} bindinput={(event: NativeInputEvent) => onInput(event.detail.value)} />
  </view>;
}
