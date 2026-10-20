import { Button } from '../ui/Button';
import { ButtonGroup } from '../ui/ButtonGroup';
import type { IconName } from '../ui/icons';
import { Icon } from '../ui/Icon';
import type { ReactNode } from '@lynx-js/react';
import { useTranslation } from '../../i18n';
import { tabKinds } from '../../../shared/tabs';
import type { TabKind } from '../../../shared/tabs';
import { TmuxTabButton } from './TmuxSessionMenu';
import type { TmuxSessionsProps } from './TmuxSessionMenu';

export function TabBar({ children }: { children?: ReactNode }) {
  return (
    <scroll-view data-automation-id="tab-bar-scroll" scroll-x className="shrink min-w-0 h-full">
      {children}
    </scroll-view>
  );
}

export function TabList({
  children,
  tabCount = 0,
  loading = false,
}: {
  children?: ReactNode;
  tabCount?: number;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const width = Math.max(tabCount * 184 + 6, 184);
  return (
    <view
      className="h-full flex flex-row items-end pl-[6px] gap-[4px] w-[var(--tab-width)]"
      style={`--tab-width: ${width}px`}
    >
      {children}
      {!tabCount && (
        <view className="h-[32px] flex flex-row items-center px-[10px]">
          <text className="text-[12px] text-[#7f8996]">
            {t(loading ? 'tabs.opening' : 'tabs.empty')}
          </text>
        </view>
      )}
    </view>
  );
}

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
