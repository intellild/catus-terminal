import type { Workspace } from '../../shared/workspaces';
import type { EditorState, WorkspaceDraft } from '../state/session';

export function WorkspaceSettings({
  editor,
  workspaces,
  configPath,
  onClose,
  onSelect,
  onAdd,
  onChange,
  onSave,
  onDelete,
}: {
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
  return (
    <>
      {editor.open && editor.draft && (
        <view className="absolute left-0 top-[54px] right-0 bottom-0 flex flex-row">
          <view className="flex-1 bg-[#00000080]" bindtap={onClose} />
          <view className="w-[370px] bg-[#20262d] border-l border-solid border-[#39444e] flex flex-col">
            <view className="p-[24px] flex flex-row items-center justify-between">
              <view>
                <text className="text-[9px] text-[#8eb4a7] tracking-[1px] mb-[7px]">
                  MAKE IT YOURS
                </text>
                <text className="text-[23px] text-[#e2e8ed]">Workspaces</text>
              </view>
              <view
                id="close-settings"
                className="w-[32px] h-[32px] flex items-center justify-center"
                bindtap={onClose}
              >
                <text className="text-[19px] text-[#9ca6b2]">×</text>
              </view>
            </view>
            <scroll-view scroll-y className="flex-1 min-h-0">
              <view key={editor.draft.id} className="pt-0 px-[24px] pb-[28px] flex flex-col">
                <view className="flex flex-row flex-wrap gap-[7px] mb-[26px]">
                  {workspaces.map((item) => (
                    <view
                      key={item.id}
                      id={`edit-profile-${item.id}`}
                      className={`py-[7px] px-[10px] rounded-[6px] border border-solid ${editor.draft?.id === item.id ? 'bg-[#35483f] border-[#6d9988]' : 'bg-[#272f37] border-[#3b4650]'}`}
                      bindtap={() => onSelect(item)}
                    >
                      <text className="text-[11px] text-[#c3cdd6]">{item.name}</text>
                    </view>
                  ))}
                  <view
                    id="add-workspace"
                    className="py-[7px] px-[10px] rounded-[6px] border border-solid border-[#3b4650] bg-[#272f37]"
                    bindtap={onAdd}
                  >
                    <text className="text-[11px] text-[#c3cdd6]">+ Add</text>
                  </view>
                </view>
                <text className="text-[13px] text-[#dce4e9] font-bold mb-[18px]">
                  {editor.draft.isNew ? 'New workspace' : 'Launch profile'}
                </text>
                <Field
                  id="profile-name"
                  label="Name"
                  value={editor.draft.name}
                  onInput={(value) => onChange('name', value)}
                />
                <Field
                  id="profile-command"
                  label="Command"
                  value={editor.draft.command}
                  onInput={(value) => onChange('command', value)}
                />
                <text className="text-[10px] text-[#7e8c99] leading-[17px] mb-[18px]">
                  $SHELL uses your account’s default shell.
                </text>
                <Field
                  id="profile-args"
                  label="Arguments · JSON array"
                  value={editor.draft.args}
                  onInput={(value) => onChange('args', value)}
                />
                <Field
                  id="profile-cwd"
                  label="Working directory"
                  value={editor.draft.cwd}
                  onInput={(value) => onChange('cwd', value)}
                />
                <view className="flex flex-row gap-[14px]">
                  <Field
                    id="profile-icon"
                    label="Icon text"
                    value={editor.draft.icon}
                    onInput={(value) => onChange('icon', value)}
                  />
                  <Field
                    id="profile-color"
                    label="Color · hex"
                    value={editor.draft.color}
                    onInput={(value) => onChange('color', value)}
                  />
                </view>
                <text className="text-[10px] text-[#7e8c99] leading-[17px] mb-[18px]">
                  Changes apply to new tabs. Existing tabs keep their launch profile.
                </text>
                {editor.error && (
                  <text
                    id="editor-error"
                    className="text-[11px] text-[#e4a4a4] leading-[18px] mt-[12px] break-all"
                  >
                    {editor.error}
                  </text>
                )}
                <view className="flex flex-row items-center gap-[14px] mt-[6px]">
                  <view
                    id="save-workspace"
                    className="py-[10px] px-[16px] rounded-[7px] bg-[#a8e6cf] mt-[15px]"
                    bindtap={onSave}
                  >
                    <text className="text-[12px] font-bold text-[#20392f]">
                      {editor.saving ? 'Saving…' : 'Save workspace'}
                    </text>
                  </view>
                  {!editor.draft.isNew && workspaces.length > 1 && (
                    <view id="delete-workspace" className="p-[10px] mt-[15px]" bindtap={onDelete}>
                      <text className="text-[11px] text-[#d59e9e]">Remove</text>
                    </view>
                  )}
                </view>
                <view className="pt-[20px] mt-[24px] border-t border-solid border-[#36414c]">
                  <text className="text-[8px] text-[#7d8e9c] tracking-[1px] mb-[9px]">
                    CONFIGURATION FILE
                  </text>
                  <text
                    id="config-path"
                    className="text-[10px] text-[#a0aebc] leading-[16px] break-all"
                  >
                    {configPath}
                  </text>
                </view>
              </view>
            </scroll-view>
          </view>
        </view>
      )}
    </>
  );
}

function Field({
  id,
  label,
  value,
  onInput,
}: {
  id: string;
  label: string;
  value: string;
  onInput(value: string): void;
}) {
  return (
    <view className="flex flex-col mb-[15px] flex-1 min-w-0">
      <text className="text-[11px] text-[#a4b0bb] mb-[7px]">{label}</text>
      <input
        id={id}
        className="w-full h-[32px] shrink-0"
        default-value={value}
        bindinput={(event) => onInput(event.detail.value)}
      />
    </view>
  );
}
