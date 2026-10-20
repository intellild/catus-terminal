import { Button } from '../ui/Button';
import { ButtonGroup } from '../ui/ButtonGroup';
import { Icon } from '../ui/Icon';
import { useTranslation } from '../../i18n';
import { cn } from '../../lib/utils';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/Select';
import { Input, InputGroup } from '../ui/Input';
import { useEffect, useMemo } from '@lynx-js/react';
import { useForm } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import * as Schema from 'effect/Schema';
import * as SchemaIssue from 'effect/SchemaIssue';
import { WorkspaceFormSchema } from '../../../shared/workspaces';
import type { ShellOption } from '../../../shared/shells';
import type { WorkspaceEnvironment } from '../../../shared/workspaces';
import { launchPreview } from '../../../shared/launch';
import type { WorkspaceDraft } from '../../state/session';
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

interface WorkspaceSettingsProps {
  draft: WorkspaceDraft;
  saving: boolean;
  error: string;
  shells: { options: readonly ShellOption[]; loading: boolean; error: string };
  onRetryShells(): void;
  configPath?: string;
  environment?: WorkspaceEnvironment;
  onChange(field: keyof WorkspaceDraft, value: string): void;
  onSave(): void;
}

export function WorkspaceSettings({
  saving,
  error,
  shells,
  onRetryShells,
  configPath,
  environment,
  onChange,
  onSave,
  draft,
}: WorkspaceSettingsProps) {
  const { t } = useTranslation();
  const resolver = useMemo(() => {
    const translateIssue = (message: string) =>
      message.startsWith('validation.') ? t(message) : message;
    return standardSchemaResolver<WorkspaceDraft, unknown, typeof WorkspaceFormSchema.Type>(
      Schema.toStandardSchemaV1(WorkspaceFormSchema.annotate({}), {
        leafHook: (issue) => translateIssue(SchemaIssue.defaultLeafHook(issue)),
        checkHook: (issue) => {
          const message = SchemaIssue.defaultCheckHook(issue);
          return message === undefined ? undefined : translateIssue(message);
        },
      }),
    );
  }, [t]);
  const form = useForm<WorkspaceDraft, unknown, typeof WorkspaceFormSchema.Type>({
    defaultValues: draft,
    resolver,
    shouldFocusError: false,
  });
  useEffect(() => {
    // Registry commands can update dependent fields (shell, command and args).
    // Sync only those values; resetting on every input cancels RHF revalidation.
    let changed = false;
    for (const name of Object.keys(draft) as (keyof WorkspaceDraft)[]) {
      if (form.getValues(name) !== draft[name]) {
        form.setValue(name, draft[name]);
        changed = true;
      }
    }
    if (changed && form.formState.isSubmitted) {
      void form.trigger();
    }
  }, [draft, form]);
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
      ? launchPreview({ ...draft, args: [] }, environment, draft.defaultTab)
      : '';
  return (
    <scroll-view scroll-y className="shrink min-h-0">
      <view key={draft.id} data-automation-id="workspace-editor-form">
        <Form
          control={form.control}
          disabled={saving}
          onChange={(name, value) => {
            'background only';
            onChange(name as keyof WorkspaceDraft, value);
          }}
          onSubmit={() => {
            'background only';
            return form.handleSubmit(onSave)();
          }}
        >
          <Field name="name" label={t('workspace.name')} />
          <view className="flex flex-row gap-[8px] p-[4px] bg-[#14191f] rounded-[8px] mb-[20px]">
            {(['local', 'ssh'] as const).map((type) => (
              <Button
                variant="ghost"
                disabled={saving}
                data-automation-id={`workspace-type-${type}`}
                key={type}
                className={cn(
                  'flex-1 h-auto py-[7px] rounded-[6px] font-normal',
                  draft.type === type ? 'bg-[#35483f]' : 'bg-[#14191f]',
                )}
                bindtap={() => {
                  if (!saving) {
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
                    <SelectTrigger data-automation-id="profile-shell">
                      <SelectValue>
                        {shellOptions.find((option) => option.value === field.value)?.label}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent
                      data-automation-id="profile-shell-content"
                      dismissClassName="profile-shell-dismiss"
                    >
                      {shellOptions.map((option, index) => (
                        <SelectItem
                          key={option.value}
                          value={option.value}
                          data-automation-id={`profile-shell-option-${option.value === 'custom' ? 'custom' : index}`}
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
                      data-automation-id="shell-load-error"
                      className="text-[11px] text-[#e4a4a4] break-all"
                    >
                      {shells.error}
                    </text>
                    <Button
                      variant="link"
                      size="sm"
                      data-automation-id="retry-shells"
                      disabled={shells.loading || saving}
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
                  data-automation-id="ssh-command-preview"
                  className="text-[12px] text-[#a8e6cf] break-all leading-[19px]"
                >
                  {preview || t('workspace.enterHost')}
                </text>
              </FormItem>
            </>
          ) : null}
          <Field name="cwd" label={t('workspace.cwd')} />
          <Field
            name="tmuxPrefix"
            label={t('workspace.tmuxPrefix')}
            description={t('workspace.tmuxPrefixDescription')}
          />
          <FormField
            name="defaultTab"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('workspace.defaultTab')}</FormLabel>
                <FormControl>
                  <ButtonGroup className="w-full gap-[2px]">
                    {(['shell', 'tmux', 'sftp'] as const).map((kind) => {
                      const disabled = field.disabled || (kind === 'sftp' && draft.type !== 'ssh');
                      return (
                        <Button
                          key={kind}
                          variant="ghost"
                          disabled={disabled}
                          data-automation-id={`profile-default-tab-${kind}`}
                          accessibility-label={t(`tabs.kind.${kind}`)}
                          className={cn(
                            'flex-1 h-auto py-[7px] rounded-[6px] font-normal',
                            field.value === kind ? 'bg-[#35483f]' : 'bg-[#14191f]',
                          )}
                          bindtap={() => {
                            if (!disabled && field.value !== kind) {
                              field.onChange(kind);
                            }
                          }}
                        >
                          <Icon
                            name={
                              kind === 'shell'
                                ? 'square-terminal'
                                : kind === 'tmux'
                                  ? 'panels-top-left'
                                  : 'folder'
                            }
                            size={14}
                            color={field.value === kind ? '#a8e6cf' : '#8c99a7'}
                          />
                          <text
                            className={cn(
                              'text-[12px]',
                              field.value === kind ? 'text-[#e1e8e5]' : 'text-[#8c99a7]',
                            )}
                          >
                            {t(`tabs.kind.${kind}`)}
                          </text>
                        </Button>
                      );
                    })}
                  </ButtonGroup>
                </FormControl>
                <FormDescription>
                  {draft.type === 'ssh'
                    ? t('workspace.defaultTabDescription')
                    : t('workspace.defaultTabDescriptionLocal')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <view className="flex flex-row gap-[14px]">
            <view className="flex-1">
              <Field name="icon" label={t('workspace.icon')} />
            </view>
            <view className="flex-1">
              <Field name="color" label={t('workspace.color')} />
            </view>
          </view>
          <FormDescription>{t('workspace.changes')}</FormDescription>
          {error || Object.keys(form.formState.errors).length ? (
            <text
              data-automation-id="editor-error"
              className="text-[11px] text-[#e4a4a4] leading-[18px] mt-[12px] break-all"
            >
              {error || t('validation.fields')}
            </text>
          ) : null}
          <view className="flex flex-row items-center gap-[14px] mt-[20px]">
            <FormSubmit data-automation-id="save-workspace">
              {saving ? t('common.saving') : draft.isNew ? t('workspace.add') : t('workspace.save')}
            </FormSubmit>
          </view>
        </Form>
      </view>
      <text
        data-automation-id="config-path"
        className="text-[10px] text-[#7d8e9c] mt-[20px] break-all"
      >
        {configPath}
      </text>
    </scroll-view>
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
            <InputGroup data-automation-id={`profile-${name}-group`} disabled={field.disabled}>
              <Input data-automation-id={`profile-${name}`} {...field} />
            </InputGroup>
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
