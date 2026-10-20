import 'background-only';
import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { sessionActionsAtom } from '../../state/sessionActions';
import { settingsViewAtom } from '../../state/sessionViews';
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
  const view = useAtomValue(settingsViewAtom);
  const dispatch = useAtomSet(sessionActionsAtom);
  const { t } = useTranslation();
  const busy = view.editor.saving;
  const error = view.editor.error;
  return (
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
          dispatch({ type: 'editWorkspace', id });
        }}
      >
        {t('workspace.edit')}
      </ContextMenuItem>
      <ContextMenuItem
        data-automation-id="workspace-menu-delete"
        disabled={busy || !view.canDelete}
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
  );
}
