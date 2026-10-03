import type { NativeInputEvent } from '@catus/native';
import type { Workspace } from '../../shared/workspaces';
import type { EditorState, WorkspaceDraft } from '../state/session';

export function WorkspaceSettings({ editor, workspaces, configPath, onClose, onSelect, onAdd, onChange, onSave, onDelete }: {
  editor: EditorState;
  workspaces: readonly Workspace[];
  configPath?: string;
  onClose(): void;
  onSelect(workspace: Workspace): void;
  onAdd(): void;
  onChange(field: keyof WorkspaceDraft, value: string): void;
  onSave(): void;
  onDelete(): void;
}) {
  return <>
    {editor.open && editor.draft && <view className="SettingsOverlay">
      <view className="SettingsScrim" bindtap={onClose} />
      <view className="SettingsPanel">
        <view className="SettingsHeading"><view><text className="SettingsEyebrow">MAKE IT YOURS</text><text className="SettingsTitle">Workspaces</text></view>
          <view id="close-settings" className="PanelClose" bindtap={onClose}><text className="CloseGlyph">×</text></view>
        </view>
        <scroll-view scroll-y className="SettingsScroll"><view className="SettingsBody">
          <view className="ProfileChoices">{workspaces.map(item => <view key={item.id} id={`edit-profile-${item.id}`}
            className={`ProfileChoice ${editor.draft?.id === item.id ? 'ProfileChoiceSelected' : ''}`}
            bindtap={() => onSelect(item)}><text className="ProfileChoiceText">{item.name}</text></view>)}
            <view id="add-workspace" className="ProfileChoice" bindtap={onAdd}><text className="ProfileChoiceText">+ Add</text></view>
          </view>
          <text className="EditorSectionTitle">{editor.draft.isNew ? 'New workspace' : 'Launch profile'}</text>
          <Field id="profile-name" label="Name" value={editor.draft.name} onInput={value => onChange('name', value)} />
          <Field id="profile-command" label="Command" value={editor.draft.command} onInput={value => onChange('command', value)} />
          <text className="FieldHint">$SHELL uses your account’s default shell.</text>
          <Field id="profile-args" label="Arguments · JSON array" value={editor.draft.args} onInput={value => onChange('args', value)} />
          <Field id="profile-cwd" label="Working directory" value={editor.draft.cwd} onInput={value => onChange('cwd', value)} />
          <view className="AppearanceFields"><Field id="profile-icon" label="Icon text" value={editor.draft.icon} onInput={value => onChange('icon', value)} />
            <Field id="profile-color" label="Color · hex" value={editor.draft.color} onInput={value => onChange('color', value)} /></view>
          <text className="FieldHint">Changes apply to new tabs. Existing tabs keep their launch profile.</text>
          {editor.error && <text id="editor-error" className="ErrorText">{editor.error}</text>}
          <view className="EditorActions"><view id="save-workspace" className="PrimaryButton" bindtap={onSave}><text className="PrimaryButtonText">{editor.saving ? 'Saving…' : 'Save workspace'}</text></view>
            {!editor.draft.isNew && workspaces.length > 1 && <view id="delete-workspace" className="DeleteButton" bindtap={onDelete}><text className="DeleteText">Remove</text></view>}
          </view>
          <view className="ConfigLocation"><text className="ConfigLocationLabel">CONFIGURATION FILE</text><text id="config-path" className="ConfigLocationPath">{configPath}</text></view>
        </view></scroll-view>
      </view>
    </view>}
  </>;
}

function Field({ id, label, value, onInput }: { id: string; label: string; value: string; onInput(value: string): void }) {
  return <view className="Field"><text className="FieldLabel">{label}</text>
    <native-input id={id} className="FieldInput" value={value} bindinput={(event: NativeInputEvent) => onInput(event.detail.value)} />
  </view>;
}
