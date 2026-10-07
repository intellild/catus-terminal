import { useTranslation } from '../../i18n';
import { ContextMenu, ContextMenuContent, ContextMenuItem } from '../ui/ContextMenu';

export function WorkspaceContextMenu({
  menu,
  canDelete,
  busy,
  error,
  onClose,
  onEdit,
  onDelete,
}: {
  menu: { id: string; x: number; y: number } | null;
  canDelete: boolean;
  busy: boolean;
  error: string;
  onClose(): void;
  onEdit(id: string): void;
  onDelete(id: string): void;
}) {
  const { t } = useTranslation();
  if (!menu) {
    return null;
  }
  return (
    <ContextMenu
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ContextMenuContent
        point={menu}
        id="workspace-context-menu"
        dismissClassName="workspace-menu-dismiss"
      >
        <ContextMenuItem id="workspace-menu-edit" disabled={busy} onSelect={() => onEdit(menu.id)}>
          {t('workspace.edit')}
        </ContextMenuItem>
        <ContextMenuItem
          id="workspace-menu-delete"
          disabled={busy || !canDelete}
          destructive
          closeOnSelect={false}
          onSelect={() => onDelete(menu.id)}
        >
          {busy ? t('common.saving') : t('workspace.delete')}
        </ContextMenuItem>
        {error ? (
          <text
            id="workspace-menu-error"
            className="text-[11px] text-[#e4a4a4] break-all px-[12px]"
          >
            {error}
          </text>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}
