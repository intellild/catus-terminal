import { useTranslation } from '../i18n';
export function StatusBar({
  workspaceCount = 0,
  tabCount = 0,
  hasSession = false,
}: {
  workspaceCount?: number;
  tabCount?: number;
  hasSession?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      <view className="flex flex-row items-center gap-[8px]">
        <view className="w-[5px] h-[5px] rounded-[3px] bg-[#859e94]" />
        <text id="session-summary" className="text-[10px] text-[#8997a2]">
          {t('status.summary', {
            workspaces: t('status.workspaces', { count: workspaceCount }),
            tabs: t('tabs.count', { count: tabCount }),
          })}
        </text>
      </view>
      <text className="text-[10px] text-[#606d7b]">
        {t(hasSession ? 'status.localSession' : 'status.ready')}
      </text>
    </>
  );
}
