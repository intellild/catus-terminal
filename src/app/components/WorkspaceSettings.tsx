import type { Workspace, WorkspaceEnvironment } from '../../shared/workspaces';
import { launchPreview } from '../../shared/launch';
import type { EditorState, WorkspaceDraft } from '../state/session';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormInput,
  FormMessage,
  FormDescription,
  FormSubmit,
} from './ui/Form';

export function WorkspaceSettings({
  editor,
  workspaces,
  configPath,
  environment,
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
  environment?: WorkspaceEnvironment;
  onClose(): void;
  onSelect(workspace: Workspace): void;
  onAdd(): void;
  onChange(field: keyof WorkspaceDraft, value: string): void;
  onSave(): void;
  onDelete(): void;
}) {
  const draft = editor.draft;
  if (!editor.open || !draft) return null;
  const preview =
    draft.type === 'ssh' && draft.host.trim() && environment
      ? launchPreview({ ...draft, args: [] }, environment)
      : '';
  return (
    <view className="absolute inset-0 flex items-center justify-center [-x-app-region:no-drag]">
      <view className="absolute inset-0 bg-[#00000080]" bindtap={onClose} />
      <view className="w-[520px] max-h-[90%] bg-[#20262d] border border-solid border-[#39444e] rounded-[14px] flex flex-col p-[24px]">
        <view className="flex flex-row justify-between items-center mb-[18px]">
          <text className="text-[21px] text-[#e2e8ed]">Edit workspace</text>
          <view id="close-settings" bindtap={onClose}>
            <text className="text-[22px] text-[#9ca6b2]">×</text>
          </view>
        </view>
        <scroll-view scroll-y className="shrink min-h-0">
          <view className="flex flex-row flex-wrap gap-[7px] mb-[20px]">
            {workspaces.map((item) => (
              <view
                key={item.id}
                id={`edit-profile-${item.id}`}
                className={`py-[7px] px-[10px] rounded-[6px] ${draft.id === item.id ? 'bg-[#35483f]' : 'bg-[#272f37]'}`}
                bindtap={() => onSelect(item)}
              >
                <text className="text-[11px] text-[#c3cdd6]">{item.name}</text>
              </view>
            ))}
            <view id="add-workspace" className="py-[7px] px-[10px]" bindtap={onAdd}>
              <text className="text-[11px] text-[#c3cdd6]">+ Add</text>
            </view>
          </view>
          <view key={draft.id} id="workspace-editor-form">
            <Form
              control={{
                values: { ...draft },
                disabled: editor.saving,
                errors: editor.fieldErrors,
                onChange: (name, value) => onChange(name as keyof WorkspaceDraft, value),
                onSubmit: onSave,
              }}
            >
              <Field name="name" label="Name" />
              <view className="flex flex-row gap-[8px] p-[4px] bg-[#14191f] rounded-[8px] mb-[20px]">
                {(['local', 'ssh'] as const).map((type) => (
                  <view
                    id={`workspace-type-${type}`}
                    key={type}
                    className={`flex-1 py-[9px] rounded-[6px] items-center ${draft.type === type ? 'bg-[#35483f]' : 'bg-[#14191f]'}`}
                    bindtap={() => {
                      if (!editor.saving) onChange('type', type);
                    }}
                  >
                    <text className="text-[12px] text-[#dce4e9]">
                      {type === 'local' ? 'Local' : 'SSH'}
                    </text>
                  </view>
                ))}
              </view>
              {draft.type === 'local' ? (
                <Field
                  name="command"
                  label="Startup command"
                  description="$SHELL uses your default shell. You can enter a shell command."
                />
              ) : (
                <>
                  <Field
                    name="host"
                    label="Host"
                    description="Hostname, user@host or an alias in ~/.ssh/config."
                  />
                  <Field
                    name="remoteCommand"
                    label="Extra command (optional)"
                    description="Executed by the remote shell. Leave blank for an interactive SSH terminal."
                  />
                  <FormItem>
                    <FormLabel>Command preview</FormLabel>
                    <text
                      id="ssh-command-preview"
                      className="text-[12px] text-[#a8e6cf] break-all leading-[19px]"
                    >
                      {preview || 'Enter an SSH host'}
                    </text>
                  </FormItem>
                </>
              )}
              <Field name="cwd" label="Working directory" />
              <view className="flex flex-row gap-[14px]">
                <view className="flex-1">
                  <Field name="icon" label="Icon text" />
                </view>
                <view className="flex-1">
                  <Field name="color" label="Color · hex" />
                </view>
              </view>
              <FormDescription>
                Changes apply to new tabs. SFTP uses the host's SSH configuration.
              </FormDescription>
              {editor.error ? (
                <text
                  id="editor-error"
                  className="text-[11px] text-[#e4a4a4] leading-[18px] mt-[12px] break-all"
                >
                  {editor.error}
                </text>
              ) : null}
              <view className="flex flex-row items-center gap-[14px] mt-[20px]">
                <FormSubmit id="save-workspace">
                  {editor.saving ? 'Saving…' : 'Save workspace'}
                </FormSubmit>
                {!draft.isNew && workspaces.length > 1 ? (
                  <view id="delete-workspace" bindtap={onDelete}>
                    <text className="text-[11px] text-[#d59e9e]">Remove</text>
                  </view>
                ) : null}
              </view>
            </Form>
          </view>
          <text id="config-path" className="text-[10px] text-[#7d8e9c] mt-[20px] break-all">
            {configPath}
          </text>
        </scroll-view>
      </view>
    </view>
  );
}
function Field({
  name,
  label,
  description,
}: {
  name: string;
  label: string;
  description?: string;
}) {
  return (
    <FormField
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <FormInput id={`profile-${name}`} {...field} />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
