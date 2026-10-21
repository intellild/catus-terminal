import 'background-only';
import '../../runtime';
import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { hostViewAtom } from '../../state/session-views';
import { sessionActionsAtom } from '../../state/session-actions';
import { memo } from '@lynx-js/react';
import { useTranslation } from '../../i18n';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { Popover, PopoverAnchor, usePopoverHoverTrigger, PopoverContent } from '../ui/popover';

export const HostItem = memo(function HostItem({ id }: { id: string }) {
  return (
    <Popover>
      <HostItemContent id={id} />
    </Popover>
  );
});

function HostItemContent({ id }: { id: string }) {
  const { host, active, running } = useAtomValue(hostViewAtom(id));
  const dispatch = useAtomSet(sessionActionsAtom);
  const { t } = useTranslation();
  const hover = usePopoverHoverTrigger();
  if (!host) {
    return null;
  }
  const shell =
    host.command === '$SHELL' ? t('host.defaultShell') : [host.command, ...host.args].join(' ');
  return (
    <>
      <PopoverAnchor className="w-9 h-9 overflow-visible">
        <Button
          variant="ghost"
          ref={hover.ref}
          bindmouseenter={hover.onMouseEnter}
          bindmouseleave={hover.onMouseLeave}
          data-automation-id={`host-${host.id}`}
          accessibility-label={host.name}
          className={cn(
            'w-9 h-9 p-0 rounded-[9px] relative',
            active && 'bg-[#303b40] hover:bg-[#3a474d]',
          )}
          bindtap={() => {
            hover.close();
            dispatch({ type: 'openHost', id });
          }}
        >
          <text
            className="text-[15px] font-bold text-[color:var(--host-color)]"
            style={`--host-color: ${active ? host.color : '#aeb7c4'}`}
          >
            {host.icon}
          </text>
          {running && (
            <view
              data-automation-id={`running-${host.id}`}
              className="absolute bottom-[2px] left-[16px] w-[4px] h-[4px] rounded-full bg-[var(--host-color)]"
              style={`--host-color: ${host.color}`}
            />
          )}
        </Button>
        <PopoverContent
          data-automation-id={`host-details-${host.id}`}
          side="right"
          align="center"
          sideOffset={12}
          modal={false}
          interactive={false}
          className="w-[240px] p-[12px] flex flex-col gap-[8px]"
        >
          <text className="text-[13px] font-bold text-[#e2e8ed] break-all">{host.name}</text>
          <text className="text-[11px] text-[#a8e6cf]">
            {t(host.type === 'ssh' ? 'common.ssh' : 'common.local')}
          </text>
          {host.type === 'ssh' && (
            <text className="text-[11px] text-[#a0a8b5] break-all">
              {t('host.host')} · {host.host}
            </text>
          )}
          <text className="text-[11px] text-[#a0a8b5] break-all">
            {t('host.shell')} · {shell}
          </text>
          <text className="text-[11px] text-[#a0a8b5] break-all">
            {t('host.defaultTab')} · {t(`tabs.kind.${host.defaultTab}`)}
          </text>
          {host.remoteCommand && (
            <text className="text-[11px] text-[#a0a8b5] break-all">
              {t('host.extraCommand')} · {host.remoteCommand}
            </text>
          )}
          <text className="text-[11px] text-[#a0a8b5] break-all">
            {t('host.cwd')} · {host.cwd}
          </text>
        </PopoverContent>
      </PopoverAnchor>
    </>
  );
}
