// TabActions renders the tmux session button and its menu, which imports the
// Effect-backed popover primitives. Keep it out of TabBar/index.tsx so those
// modules never enter the main-thread bundle.
import { Button } from '../ui/button';
import { ButtonGroup } from '../ui/button-group';
import type { IconName } from '../ui/icons';
import { Icon } from '../ui/icon';
import { useTranslation } from '../../i18n';
import { tabKinds } from '../../../shared/tabs';
import type { TabKind } from '../../../shared/tabs';
import { TmuxTabButton } from './tmux-session-menu';
import type { TmuxSessionsProps } from './tmux-session-menu';

const kindIcons: Record<TabKind, { icon: IconName; color: string }> = {
  shell: { icon: 'square-terminal', color: '#a8e6cf' },
  tmux: { icon: 'panels-top-left', color: '#c9b8ff' },
  sftp: { icon: 'folder', color: '#a8e6cf' },
};

export function TabActions({
  defaultKind = 'shell',
  ssh = false,
  onAdd,
  tmux,
}: {
  defaultKind?: TabKind;
  ssh?: boolean;
  onAdd?(kind: TabKind): void;
  tmux?: TmuxSessionsProps;
}) {
  const { t } = useTranslation();
  const others = tabKinds.filter((kind) => kind !== defaultKind && (kind !== 'sftp' || ssh));
  return (
    <ButtonGroup className="h-full items-end pb-[4px] ml-[4px] gap-[1px]">
      {[defaultKind, ...others].map((kind, index) => {
        const id = index === 0 ? 'new-tab' : `new-${kind}-tab`;
        const label = t(index === 0 ? 'tabs.newDefault' : 'tabs.newKind', {
          kind: t(`tabs.kind.${kind}`),
        });
        return kind === 'tmux' ? (
          <TmuxTabButton
            key={id}
            id={id}
            label={label}
            tmux={tmux}
            onAdd={() => {
              'background only';
              onAdd?.(kind);
            }}
          />
        ) : (
          <Button
            key={id}
            variant="ghost"
            size="icon-sm"
            data-automation-id={id}
            accessibility-label={label}
            className="w-[24px] h-[24px] rounded-[6px]"
            bindtap={() => {
              'background only';
              onAdd?.(kind);
            }}
          >
            {index === 0 ? (
              <Icon name="plus" size={16} color="#c1c7d0" />
            ) : (
              <Icon name={kindIcons[kind].icon} size={15} color={kindIcons[kind].color} />
            )}
          </Button>
        );
      })}
    </ButtonGroup>
  );
}
