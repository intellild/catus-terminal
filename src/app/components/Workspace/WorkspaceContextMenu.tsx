import 'background-only';
import { useAtomSet } from '@effect/atom-react';
import { sessionActionsAtom } from '../../state/sessionActions';
import { useTranslation } from '../../i18n';
import { ContextMenuContent, ContextMenuItem } from '../ui/ContextMenu';
import { Dialog } from '../ui/Dialog';
import {
  useWorkspaceSettingsDialog,
  WorkspaceSettingsDialogContent,
} from './WorkspaceSettingsDialog';

export function WorkspaceContextMenu({
  id,
  point,
  onEdit,
}: {
  id: string;
  point: { x: number; y: number } | null;
  onEdit(): void;
}) {
  return point ? <WorkspaceMenuItems id={id} point={point} onEdit={onEdit} /> : null;
}
function WorkspaceMenuItems({
  id,
  point,
  onEdit,
}: {
  id: string;
  point: { x: number; y: number };
  onEdit(): void;
}) {
  const dialog = useWorkspaceSettingsDialog(id);
  const { editor, canDelete } = dialog;
  const dispatch = useAtomSet(sessionActionsAtom);
  const { t } = useTranslation();
  const busy = editor.saving;
  const error = editor.error;
  return (
    <Dialog open={dialog.open} onOpenChange={dialog.onOpenChange}>
      <ContextMenuContent
        point={point}
        data-automation-id="workspace-context-menu"
        dismissClassName="workspace-menu-dismiss"
      >
        <ContextMenuItem
          data-automation-id="workspace-menu-edit"
          disabled={busy}
          onSelect={() => {
            onEdit();
            dialog.onOpenChange(true);
          }}
        >
          {t('workspace.edit')}
        </ContextMenuItem>
        <ContextMenuItem
          data-automation-id="workspace-menu-delete"
          disabled={busy || !canDelete}
          destructive
          closeOnSelect={false}
          onSelect={() => dispatch({ type: 'deleteWorkspace', id })}
        >
          {busy ? t('common.saving') : t('workspace.delete')}
        </ContextMenuItem>
        {error ? (
          <text
            data-automation-id="workspace-menu-error"
            className="text-[11px] text-[#e4a4a4] break-all px-[12px]"
          >
            {error}
          </text>
        ) : null}
      </ContextMenuContent>
      <WorkspaceSettingsDialogContent dialog={dialog} />
    </Dialog>
  );
}
