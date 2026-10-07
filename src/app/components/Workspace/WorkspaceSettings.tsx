import { Button } from '../ui/Button';
import { useTranslation } from '../../i18n';
import { cn } from '../../lib/utils';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/Select';
import { Input } from '../ui/Input';
import type { ShellOption } from '../../../shared/shells';
import type { WorkspaceEnvironment } from '../../../shared/workspaces';
import { launchPreview } from '../../../shared/launch';
import type { EditorState, WorkspaceDraft } from '../../state/session';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  FormDescription,
  FormSubmit,
} from '../ui/Form';

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
  const { t } = useTranslation();
  const draft = editor.draft;
  if (!editor.open || !draft) {
    return null;
  }
  const shellOptions = [
    { value: '$SHELL', label: t('workspace.defaultShell') },
    ...shells.options,
    ...(draft.shell !== '$SHELL' &&
    draft.shell !== 'custom' &&
    !shells.options.some((option) => option.value === draft.shell)
      ? [{ value: draft.shell, label: draft.shell }]
      : []),
    { value: 'custom', label: t('workspace.customCommand') },
  ];
  const preview =
    draft.type === 'ssh' && draft.host.trim() && environment
      ? launchPreview({ ...draft, args: [] }, environment)
      : '';
  return (
    <view className="absolute inset-0 flex items-center justify-center [-x-app-region:no-drag]">
      <view className="absolute inset-0 bg-[#00000080]" bindtap={onClose} />
      <view className="w-[520px] max-h-[90%] bg-[#20262d] border border-solid border-[#39444e] rounded-[14px] flex flex-col p-[24px]">
        <view className="flex flex-row justify-between items-center mb-[18px]">
          <text className="text-[21px] text-[#e2e8ed]">
            {draft.isNew ? t('workspace.add') : t('workspace.edit')}
          </text>
          <Button variant="ghost" size="icon-sm" id="close-settings" bindtap={onClose}>
            <text className="text-[22px] text-[#9ca6b2]">×</text>
          </Button>
        </view>
        <scroll-view scroll-y className="shrink min-h-0">
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
              <Field name="name" label={t('workspace.name')} />
              <view className="flex flex-row gap-[8px] p-[4px] bg-[#14191f] rounded-[8px] mb-[20px]">
                {(['local', 'ssh'] as const).map((type) => (
                  <Button
                    variant="ghost"
                    disabled={editor.saving}
                    id={`workspace-type-${type}`}
                    key={type}
                    className={cn(
                      'flex-1 h-auto py-[9px] rounded-[6px] font-normal',
                      draft.type === type ? 'bg-[#35483f]' : 'bg-[#14191f]',
                    )}
                    bindtap={() => {
                      if (!editor.saving) {
                        onChange('type', type);
                      }
                    }}
                  >
                    <text className="text-[12px] text-[#dce4e9]">
                      {t(type === 'local' ? 'common.local' : 'common.ssh')}
                    </text>
                  </Button>
                ))}
              </view>
              {draft.type === 'ssh' ? (
                <Field
                  name="host"
                  label={t('workspace.host')}
                  description={t('workspace.hostDescription')}
                />
              ) : null}
              <FormField
                name="shell"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('workspace.shell')}</FormLabel>
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
                        <SelectContent
                          id="profile-shell-content"
                          dismissClassName="profile-shell-dismiss"
                        >
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
                        ? t('workspace.detectingShells')
                        : draft.type === 'ssh'
                          ? t('workspace.remoteShells')
                          : t('workspace.localShells')}
                    </FormDescription>
                    {shells.error ? (
                      <view>
                        <text
                          id="shell-load-error"
                          className="text-[11px] text-[#e4a4a4] break-all"
                        >
                          {shells.error}
                        </text>
                        <Button
                          variant="link"
                          size="sm"
                          id="retry-shells"
                          disabled={shells.loading || editor.saving}
                          bindtap={onRetryShells}
                        >
                          <text className="text-[12px] text-[#a8e6cf]">{t('common.retry')}</text>
                        </Button>
                      </view>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
              {draft.shell === 'custom' ? (
                <Field
                  name="command"
                  label={t('workspace.customCommand')}
                  description={t('workspace.customDescription')}
                />
              ) : null}
              {draft.type === 'ssh' ? (
                <>
                  <Field
                    name="remoteCommand"
                    label={t('workspace.extraCommand')}
                    description={t('workspace.extraDescription')}
                  />
                  <FormItem>
                    <FormLabel>{t('workspace.commandPreview')}</FormLabel>
                    <text
                      id="ssh-command-preview"
                      className="text-[12px] text-[#a8e6cf] break-all leading-[19px]"
                    >
                      {preview || t('workspace.enterHost')}
                    </text>
                  </FormItem>
                </>
              ) : null}
              <Field name="cwd" label={t('workspace.cwd')} />
              <view className="flex flex-row gap-[14px]">
                <view className="flex-1">
                  <Field name="icon" label={t('workspace.icon')} />
                </view>
                <view className="flex-1">
                  <Field name="color" label={t('workspace.color')} />
                </view>
              </view>
              <FormDescription>{t('workspace.changes')}</FormDescription>
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
                  {editor.saving
                    ? t('common.saving')
                    : draft.isNew
                      ? t('workspace.add')
                      : t('workspace.save')}
                </FormSubmit>
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
            <Input id={`profile-${name}`} {...field} />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
