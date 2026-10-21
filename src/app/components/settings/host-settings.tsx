import 'background-only';
import { useState } from '@lynx-js/react';
import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { useTranslation } from '../../i18n';
import { cn } from '../../lib/utils';
import { sessionActionsAtom } from '../../state/session-actions';
import { settingsViewAtom } from '../../state/session-views';
import { shellOptionsAtom } from '../../state/shells';
import type { HostProfile } from '../../../shared/hosts';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { Popover, PopoverAnchor, PopoverContent, usePopoverClickTrigger } from '../ui/popover';
import { HostForm } from '../host/host-form';

/** Host list plus the editor for the selected host. */
export function HostSettings() {
  const view = useAtomValue(settingsViewAtom);
  const shells = useAtomValue(shellOptionsAtom);
  const dispatch = useAtomSet(sessionActionsAtom);
  const { t } = useTranslation();
  const draft = view.editor.draft;
  const select = (id: string) => {
    'background only';
    dispatch({ type: 'selectHost', id });
  };
  return (
    <>
      <view className="w-[198px] shrink-0 flex flex-col border-r border-solid border-[#2c333b] bg-[#1b2026]">
        <text className="px-[16px] pt-[16px] pb-[8px] text-[11px] text-[#717b88]">
          {t('settings.hosts')}
        </text>
        <scroll-view scroll-y className="flex-1 min-h-0">
          <view className="flex flex-col gap-[2px] px-[8px] pb-[8px]">
            {view.hosts.map((host) => (
              <HostRow
                key={host.id}
                host={host}
                active={draft?.id === host.id}
                canDelete={view.canDelete && !view.editor.saving}
                onSelect={select}
                onDelete={() => {
                  'background only';
                  dispatch({ type: 'deleteHost', id: host.id });
                }}
              />
            ))}
            {draft?.isNew ? (
              <view
                data-automation-id={`settings-host-${draft.id}`}
                className="h-[32px] flex flex-row items-center rounded-[6px] bg-[#2b333b] px-[10px]"
              >
                <text className="text-[12px] text-[#dce4e9]">{draft.name}</text>
              </view>
            ) : null}
          </view>
        </scroll-view>
        <view className="p-[8px]">
          <Button
            variant="ghost"
            data-automation-id="add-host"
            accessibility-label={t('settings.addHost')}
            className="w-full h-[30px] px-[10px] justify-start gap-[8px] rounded-[6px] bg-[#232a31] hover:bg-[#2b333b]"
            bindtap={() => {
              'background only';
              dispatch({ type: 'addHost' });
            }}
          >
            <Icon name="plus" size={14} color="#a8e6cf" />
            <text className="text-[12px] text-[#dce4e9]">{t('settings.addHost')}</text>
          </Button>
        </view>
      </view>
      <view className="flex-1 min-w-0 flex flex-col px-[24px] py-[18px]">
        {draft ? (
          <HostForm
            key={draft.id}
            draft={draft}
            saving={view.editor.saving}
            error={view.editor.error}
            shells={shells}
            configPath={view.configPath}
            environment={view.environment}
            onRetryShells={() => {
              'background only';
              dispatch({ type: 'retryShells' });
            }}
            onChange={(field, value) => {
              'background only';
              dispatch({ type: 'updateDraft', field, value });
            }}
            onSave={() => {
              'background only';
              dispatch({ type: 'saveDraft' });
            }}
          />
        ) : (
          <text className="text-[12px] text-[#717b88]">{t('settings.noHosts')}</text>
        )}
      </view>
    </>
  );
}

function HostRow({
  host,
  active,
  canDelete,
  onSelect,
  onDelete,
}: {
  host: HostProfile;
  active: boolean;
  canDelete: boolean;
  onSelect(id: string): void;
  onDelete(): void;
}) {
  const [hover, setHover] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <view
      className={cn(
        'h-[32px] flex flex-row items-center rounded-[6px]',
        active ? 'bg-[#2b333b]' : hover && 'bg-[#232a31]',
      )}
      bindmouseenter={() => setHover(true)}
      bindmouseleave={() => setHover(false)}
    >
      <view
        data-automation-id={`settings-host-${host.id}`}
        className="flex-1 min-w-0 h-full flex flex-row items-center gap-[8px] px-[10px]"
        bindtap={() => {
          'background only';
          onSelect(host.id);
        }}
      >
        <text
          className="text-[12px] font-bold text-[color:var(--host-color)]"
          style={`--host-color: ${active ? host.color : '#aeb7c4'}`}
        >
          {host.icon}
        </text>
        <text className="text-[12px] text-[#dce4e9]">{host.name}</text>
      </view>
      {canDelete && (hover || confirming) ? (
        <DeleteHostButton
          host={host}
          onOpenChange={setConfirming}
          onConfirm={() => {
            'background only';
            onDelete();
          }}
        />
      ) : null}
    </view>
  );
}

// Two-step delete: the popover owns the confirmation, the row only decides when
// the affordance is visible.
function DeleteHostButton({
  host,
  onOpenChange,
  onConfirm,
}: {
  host: HostProfile;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const change = (next: boolean) => {
    setOpen(next);
    onOpenChange(next);
  };
  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverAnchor className="overflow-visible">
        <DeleteHostTrigger label={t('settings.deleteHost', { name: host.name })} id={host.id} />
      </PopoverAnchor>
      <PopoverContent
        data-automation-id="delete-host-popover"
        side="right"
        align="center"
        sideOffset={8}
        className="w-[220px] p-[12px] flex flex-col gap-[10px]"
      >
        <text className="text-[13px] text-[#e2e8ed]">
          {t('settings.deleteHostTitle', { name: host.name })}
        </text>
        <text className="text-[11px] text-[#9ca6b2] leading-[17px]">
          {t('settings.deleteHostDescription')}
        </text>
        <view className="flex flex-row justify-end gap-[8px]">
          <Button
            variant="ghost"
            data-automation-id="cancel-delete-host"
            className="h-[26px] px-[10px] rounded-[6px]"
            bindtap={() => {
              'background only';
              change(false);
            }}
          >
            <text className="text-[12px] text-[#c3cbd4]">{t('common.cancel')}</text>
          </Button>
          <Button
            variant="ghost"
            data-automation-id="confirm-delete-host"
            className="h-[26px] px-[10px] rounded-[6px] bg-[#59343c] hover:bg-[#6b3d46]"
            bindtap={() => {
              'background only';
              change(false);
              onConfirm();
            }}
          >
            <text className="text-[12px] text-[#f2d7d7]">{t('common.delete')}</text>
          </Button>
        </view>
      </PopoverContent>
    </Popover>
  );
}

function DeleteHostTrigger({ id, label }: { id: string; label: string }) {
  const trigger = usePopoverClickTrigger();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      ref={trigger.ref}
      data-automation-id={`delete-host-${id}`}
      accessibility-label={label}
      className="w-[24px] h-[24px] mr-[4px] rounded-[5px]"
      bindtap={trigger.onTap}
      bindlayoutchange={trigger.onLayoutChange}
    >
      <Icon name="trash-2" size={13} color="#9ca6b2" />
    </Button>
  );
}
