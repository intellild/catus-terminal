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
      <scroll-view scroll-y className="w-14 flex-1 min-h-0">
        <view className="flex flex-col items-center gap-[8px] py-[4px]">
          {loading &&
            [0, 1, 2].map((index) => (
              <view key={index} className="w-10 h-10 rounded-[10px] bg-[#25292f]" />
            ))}
          {children}
        </view>
      </scroll-view>
      <Button
        variant="secondary"
        size="icon"
        id="add-workspace"
        accessibility-label={t('workspace.add')}
        className="w-10 h-10 rounded-[10px] mt-[8px] mb-[4px]"
        bindtap={onAdd}
      >
        <text className="text-[22px] text-[#969fab]">+</text>
      </Button>
    </>
  );
}
