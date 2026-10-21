import type { ReactNode } from '@lynx-js/react';
import { useTranslation } from '../../i18n';
import { cn } from '../../lib/utils';
import { FileItem } from './file-item';
import type { FileEntry } from './types';

export { FileItem } from './file-item';
export type { FileItemProps } from './file-item';
export type { FileEntry } from './types';

export interface FileExplorerProps {
  entries: readonly FileEntry[];
  loading?: boolean;
  error?: string;
  selected?: string;
  showHiddenFiles?: boolean;
  disabled?: boolean;
  itemSize?: number;
  automationId?: string;
  className?: string;
  onOpen(entry: FileEntry): void;
  /** Stable key for list virtualization; defaults to the entry name. */
  itemKey?: (entry: FileEntry) => string;
  /** Render a caller-specific leading action for each row, such as download. */
  renderLeadingAction?: (entry: FileEntry, index: number) => ReactNode;
}

export function FileExplorer({
  entries,
  loading = false,
  error = '',
  selected,
  showHiddenFiles = false,
  disabled = false,
  itemSize = 38,
  automationId = 'file-explorer',
  className,
  onOpen,
  itemKey,
  renderLeadingAction,
}: FileExplorerProps) {
  const { t } = useTranslation();
  const visibleEntries = showHiddenFiles
    ? entries
    : entries.filter((entry) => !entry.name.startsWith('.'));
  return (
    <>
      {error ? (
        <text
          data-automation-id={`${automationId}-error`}
          className="text-[12px] text-[#e4a4a4] leading-[18px] mb-[12px] break-all"
        >
          {error}
        </text>
      ) : null}
      {loading ? (
        <text data-automation-id={`${automationId}-loading`} className="text-[12px] text-[#8c99a7]">
          {t('files.loading')}
        </text>
      ) : null}
      <list
        data-automation-id={`${automationId}-list`}
        list-type="single"
        scroll-orientation="vertical"
        className={cn('flex-1 min-h-0', className)}
      >
        {!loading && !error && !visibleEntries.length ? (
          <list-item key="empty" item-key="empty" estimated-main-axis-size-px={18}>
            <text
              data-automation-id={`${automationId}-empty`}
              className="text-[12px] text-[#8c99a7]"
            >
              {t('files.empty')}
            </text>
          </list-item>
        ) : null}
        {visibleEntries.map((entry, index) => {
          const key = itemKey?.(entry) ?? entry.name;
          return (
            <list-item key={key} item-key={key} estimated-main-axis-size-px={itemSize}>
              <FileItem
                entry={entry}
                selected={selected === entry.name}
                disabled={disabled}
                action={renderLeadingAction?.(entry, index)}
                reserveAction={renderLeadingAction !== undefined}
                automationId={`${automationId}-entry-${index}`}
                onOpen={onOpen}
              />
            </list-item>
          );
        })}
      </list>
    </>
  );
}
