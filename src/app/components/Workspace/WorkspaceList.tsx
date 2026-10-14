import { Button } from '../ui/Button';
import type { ReactNode } from '@lynx-js/react';
import { useTranslation } from '../../i18n';

export function WorkspaceList({
  children,
  loading = false,
  onAdd,
}: {
  children?: ReactNode;
  loading?: boolean;
  onAdd?(): void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <scroll-view scroll-y className="w-12 flex-1 min-h-0">
        <view className="flex flex-col items-center gap-[6px] py-[2px]">
          {loading &&
            [0, 1, 2].map((index) => (
              <view key={index} className="w-9 h-9 rounded-[9px] bg-[#25292f]" />
            ))}
          {children}
        </view>
      </scroll-view>
      <Button
        variant="secondary"
        size="icon"
        data-automation-id="add-workspace"
        accessibility-label={t('workspace.add')}
        className="w-9 h-9 rounded-[9px] mt-[6px] mb-[2px]"
        bindtap={onAdd}
      >
        <text className="text-[18px] text-[#969fab]">+</text>
      </Button>
    </>
  );
}
