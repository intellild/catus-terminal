import 'background-only';
import { useTranslation } from '../../i18n';
import { Dialog, DialogTrigger } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import {
  useWorkspaceSettingsDialog,
  WorkspaceSettingsDialogContent,
} from './WorkspaceSettingsDialog';

export function WorkspaceAdd() {
  const { t } = useTranslation();
  const dialog = useWorkspaceSettingsDialog();
  return (
    <Dialog open={dialog.open} onOpenChange={dialog.onOpenChange}>
      <DialogTrigger
        variant="secondary"
        size="icon"
        data-automation-id="add-workspace"
        accessibility-label={t('workspace.add')}
        className="w-9 h-9 rounded-[9px] mt-[6px] mb-[2px]"
      >
        <Icon name="plus" size={18} color="#969fab" />
      </DialogTrigger>
      <WorkspaceSettingsDialogContent dialog={dialog} />
    </Dialog>
  );
}
