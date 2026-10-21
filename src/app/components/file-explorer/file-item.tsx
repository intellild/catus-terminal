import type { ReactNode } from '@lynx-js/react';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import type { FileEntry } from './types';

export interface FileItemProps {
  entry: FileEntry;
  selected?: boolean;
  disabled?: boolean;
  /** Caller-provided leading action, such as download. */
  action?: ReactNode;
  /** Keep the leading action slot even when this row has no action. */
  reserveAction?: boolean;
  automationId?: string;
  className?: string;
  onOpen(entry: FileEntry): void;
}

export function FileItem({
  entry,
  selected = false,
  disabled = false,
  action,
  reserveAction = false,
  automationId,
  className,
  onOpen,
}: FileItemProps) {
  const { t } = useTranslation();
  const showActionSlot = reserveAction || action !== undefined;
  return (
    <Button
      variant="ghost"
      disabled={disabled}
      data-automation-id={automationId}
      data-filename={entry.name}
      className={cn(
        'w-full h-auto justify-start gap-0 py-[8px] px-[10px] rounded-[6px] font-normal',
        selected ? 'bg-[#35483f]' : 'bg-[#111419]',
        className,
      )}
      bindtap={() => {
        onOpen(entry);
      }}
    >
      {showActionSlot ? (
        <view className="w-[22px] h-[22px] shrink-0 flex items-center justify-center">
          {action}
        </view>
      ) : null}
      <view className="w-[22px] h-[22px] shrink-0 flex items-center justify-center">
        <Icon
          name={entry.directory ? 'folder' : entry.symlink ? 'link' : 'file'}
          size={14}
          color="#a8e6cf"
        />
      </view>
      <text className="flex-1 text-[12px] text-[#dce4e9]">{entry.name}</text>
      <text className="text-[10px] text-[#8c99a7]">
        {t(entry.directory ? 'files.directory' : entry.symlink ? 'files.link' : 'files.file')}
      </text>
    </Button>
  );
}
