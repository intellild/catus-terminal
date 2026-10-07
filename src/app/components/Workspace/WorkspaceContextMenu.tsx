import 'background-only';
import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { settingsViewAtom } from '../../state/sessionViews';
import { sessionActionsAtom } from '../../state/sessionActions';
import { useTranslation } from '../../i18n';
import { ContextMenuContent, ContextMenuItem } from '../ui/ContextMenu';

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
  const { editor, canDelete } = useAtomValue(settingsViewAtom);
  const dispatch = useAtomSet(sessionActionsAtom);
  const { t } = useTranslation();
  const busy = editor.saving;
  const error = editor.error;
  return (
    <ContextMenuContent
      point={point}
      id="workspace-context-menu"
      dismissClassName="workspace-menu-dismiss"
    >
      <ContextMenuItem
        id="workspace-menu-edit"
        disabled={busy}
        onSelect={() => {
          onEdit();
          dispatch({ type: 'editWorkspace', id });
        }}
      >
        {t('workspace.edit')}
      </ContextMenuItem>
      <ContextMenuItem
        id="workspace-menu-delete"
        disabled={busy || !canDelete}
        destructive
        closeOnSelect={false}
        onSelect={() => dispatch({ type: 'deleteWorkspace', id })}
      >
        {busy ? t('common.saving') : t('workspace.delete')}
      </ContextMenuItem>
      {error ? (
        <text id="workspace-menu-error" className="text-[11px] text-[#e4a4a4] break-all px-[12px]">
          {error}
        </text>
      ) : null}
    </ContextMenuContent>
  );
}
