import { cn } from '../lib/utils';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './ui/Select';
import { Input } from './ui/Input';
import type { ShellOption } from '../../shared/shells';
import type { WorkspaceEnvironment } from '../../shared/workspaces';
import { launchPreview } from '../../shared/launch';
import type { EditorState, WorkspaceDraft } from '../state/session';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  FormDescription,
  FormSubmit,
} from './ui/Form';

export function WorkspaceSettings({
  editor,
  shells,
  onRetryShells,
  configPath,
  environment,
  onClose,
  onChange,
  onSave,
}: {
  editor: EditorState;
  shells: { options: readonly ShellOption[]; loading: boolean; error: string };
  onRetryShells(): void;
  configPath?: string;
  environment?: WorkspaceEnvironment;
  onClose(): void;
  onChange(field: keyof WorkspaceDraft, value: string): void;
  onSave(): void;
}) {
  const draft = editor.draft;
  if (!editor.open || !draft) return null;
  const shellOptions = [
    { value: '$SHELL', label: 'Default shell' },
    ...shells.options,
    ...(draft.shell !== '$SHELL' &&
    draft.shell !== 'custom' &&
    !shells.options.some((option) => option.value === draft.shell)
      ? [{ value: draft.shell, label: draft.shell }]
      : []),
    { value: 'custom', label: 'Custom command' },
  ];
  const preview =
    draft.type === 'ssh' && draft.host.trim() && environment
      ? launchPreview({ ...draft, args: [] }, environment)
      : '';
  return (
    <view
      className={cn('absolute inset-0 flex items-center justify-center [-x-app-region:no-drag]')}
    >
      <view className={cn('absolute inset-0 bg-[#00000080]')} bindtap={onClose} />
      <view
        className={cn(
          'w-[520px] max-h-[90%] bg-[#20262d] border border-solid border-[#39444e] rounded-[14px] flex flex-col p-[24px]',
        )}
      >
        <view className={cn('flex flex-row justify-between items-center mb-[18px]')}>
          <text className={cn('text-[21px] text-[#e2e8ed]')}>
            {draft.isNew ? 'Add workspace' : 'Edit workspace'}
          </text>
          <view id="close-settings" bindtap={onClose}>
            <text className={cn('text-[22px] text-[#9ca6b2]')}>×</text>
          </view>
        </view>
        <scroll-view scroll-y className={cn('shrink min-h-0')}>
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
              <view
                className={cn(
                  'flex flex-row gap-[8px] p-[4px] bg-[#14191f] rounded-[8px] mb-[20px]',
                )}
              >
                {(['local', 'ssh'] as const).map((type) => (
                  <view
                    id={`workspace-type-${type}`}
                    key={type}
                    className={cn(
                      'flex-1 py-[9px] rounded-[6px] items-center',
                      draft.type === type ? 'bg-[#35483f]' : 'bg-[#14191f]',
                    )}
                    bindtap={() => {
                      if (!editor.saving) onChange('type', type);
                    }}
                  >
                    <text className={cn('text-[12px] text-[#dce4e9]')}>
                      {type === 'local' ? 'Local' : 'SSH'}
                    </text>
                  </view>
                ))}
              </view>
              {draft.type === 'ssh' ? (
                <Field
                  name="host"
                  label="Host"
                  description="Hostname, user@host or an alias in ~/.ssh/config."
                />
              ) : null}
              <FormField
                name="shell"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Shell</FormLabel>
                    <FormControl>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={field.disabled}
                      >
                        <SelectTrigger id="profile-shell">
                          <SelectValue>
                            {shellOptions.find((option) => option.value === field.value)?.label}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent id="profile-shell-content" dismissId="profile-shell-dismiss">
                          {shellOptions.map((option, index) => (
                            <SelectItem
                              key={option.value}
                              value={option.value}
                              id={`profile-shell-option-${option.value === 'custom' ? 'custom' : index}`}
                            >
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormDescription>
                      {shells.loading
                        ? 'Detecting shells…'
                        : draft.type === 'ssh'
                          ? 'Shells detected on the remote host. Default shell uses the remote account default.'
                          : 'Shells installed on this computer.'}
                    </FormDescription>
                    {shells.error ? (
                      <view>
                        <text
                          id="shell-load-error"
                          className={cn('text-[11px] text-[#e4a4a4] break-all')}
                        >
                          {shells.error}
                        </text>
                        <view id="retry-shells" bindtap={onRetryShells}>
                          <text className={cn('text-[12px] text-[#a8e6cf]')}>Retry</text>
                        </view>
                      </view>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
              {draft.shell === 'custom' ? (
                <Field
                  name="command"
                  label="Custom command"
                  description="Enter the shell or command to start."
                />
              ) : null}
              {draft.type === 'ssh' ? (
                <>
                  <Field
                    name="remoteCommand"
                    label="Extra command (optional)"
                    description="Runs before the selected shell. Leave blank to start the shell directly."
                  />
                  <FormItem>
                    <FormLabel>Command preview</FormLabel>
                    <text
                      id="ssh-command-preview"
                      className={cn('text-[12px] text-[#a8e6cf] break-all leading-[19px]')}
                    >
                      {preview || 'Enter an SSH host'}
                    </text>
                  </FormItem>
                </>
              ) : null}
              <Field name="cwd" label="Working directory" />
              <view className={cn('flex flex-row gap-[14px]')}>
                <view className={cn('flex-1')}>
                  <Field name="icon" label="Icon text" />
                </view>
                <view className={cn('flex-1')}>
                  <Field name="color" label="Color · hex" />
                </view>
              </view>
              <FormDescription>
                Changes apply to new tabs. SFTP uses the host's SSH configuration.
              </FormDescription>
              {editor.error ? (
                <text
                  id="editor-error"
                  className={cn('text-[11px] text-[#e4a4a4] leading-[18px] mt-[12px] break-all')}
                >
                  {editor.error}
                </text>
              ) : null}
              <view className={cn('flex flex-row items-center gap-[14px] mt-[20px]')}>
                <FormSubmit id="save-workspace">
                  {editor.saving ? 'Saving…' : draft.isNew ? 'Add workspace' : 'Save workspace'}
                </FormSubmit>
              </view>
            </Form>
          </view>
          <text id="config-path" className={cn('text-[10px] text-[#7d8e9c] mt-[20px] break-all')}>
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
            <Input id={`profile-${name}`} {...field} />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
