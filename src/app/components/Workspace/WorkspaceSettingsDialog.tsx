import 'background-only';
import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { useTranslation } from '../../i18n';
import { sessionActionsAtom } from '../../state/sessionActions';
import { settingsViewAtom } from '../../state/sessionViews';
import { shellOptionsAtom } from '../../state/shells';
import { DialogContent, DialogHeader, DialogTitle } from '../ui/Dialog';
import { WorkspaceSettings } from './WorkspaceSettings';

// The registry owns a single draft; each trigger only opens its matching dialog.
export function useWorkspaceSettingsDialog(workspaceId?: string) {
  const view = useAtomValue(settingsViewAtom);
  const dispatch = useAtomSet(sessionActionsAtom);
  const draft = view.editor.draft;
  const matches =
    workspaceId === undefined ? draft?.isNew : !draft?.isNew && draft?.id === workspaceId;
  return {
    ...view,
    open: view.editor.open && !!matches,
    onOpenChange(open: boolean) {
      'background only';
      if (open) {
        dispatch(
          workspaceId === undefined
            ? { type: 'addWorkspace' }
            : { type: 'editWorkspace', id: workspaceId },
        );
      } else if (matches) {
        dispatch({ type: 'closeSettings' });
      }
    },
  };
}

export function WorkspaceSettingsDialogContent({
  dialog,
}: {
  dialog: ReturnType<typeof useWorkspaceSettingsDialog>;
}) {
  const shells = useAtomValue(shellOptionsAtom);
  const dispatch = useAtomSet(sessionActionsAtom);
  const { t } = useTranslation();
  const draft = dialog.editor.draft;
  if (!dialog.open || !draft) {
    return null;
  }
  return (
    <DialogContent
      data-automation-id="workspace-dialog"
      overlayProps={{ 'data-automation-id': 'workspace-dialog-overlay' }}
      closeButtonProps={{ 'data-automation-id': 'close-settings' }}
    >
      <DialogHeader>
        <DialogTitle>{draft.isNew ? t('workspace.add') : t('workspace.edit')}</DialogTitle>
      </DialogHeader>
      <WorkspaceSettings
        key={draft.id}
        draft={draft}
        saving={dialog.editor.saving}
        error={dialog.editor.error}
        shells={shells}
        configPath={dialog.configPath}
        environment={dialog.environment}
        onRetryShells={() => {
          'background only';
          dispatch({ type: 'retryShells' });
        }}
        onChange={(field, value) => {
          'background only';
          dispatch({ type: 'updateDraft', field, value });
        }}
        onSave={() => {
          'background only';
          dispatch({ type: 'saveDraft' });
        }}
      />
    </DialogContent>
  );
}
