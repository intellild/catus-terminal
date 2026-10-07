import { useTranslation } from '../i18n';
import { cn } from '../lib/utils';
import 'background-only';
import { useEffect, useState } from '@lynx-js/react';
import { useAtomValue } from '@effect/atom-react';
import { terminalSessionsAtom } from '../state/terminalSessions';
import type { RemoteFs } from '../../shared/sftp';

interface Entry {
  name: string;
  directory: boolean;
  symlink: boolean;
}
interface Listing {
  path: string;
  entries: Entry[];
  loading: boolean;
  error: string;
}
export function SftpBrowser({ id, host }: { id: number; host: string }) {
  const { t } = useTranslation();
  const sessions = useAtomValue(terminalSessionsAtom);
  const [path, setPath] = useState('.');
  const [refresh, setRefresh] = useState(0);
  const [listing, setListing] = useState<Listing>({
    path: '',
    entries: [],
    loading: true,
    error: '',
  });
  const [selected, setSelected] = useState('');
  useEffect(() => {
    'background only';
    let disposed = false;
    setListing((current) => ({ ...current, loading: true, error: '' }));
    const load = async () => {
      const fs = await sessions.connection(id);
      const resolved = await fs.realpath(path);
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      if (disposed) return;
      setListing({
        path: resolved,
        entries: entries
          .map((entry) => ({
            name: entry.name,
            directory: entry.isDirectory(),
            symlink: entry.isSymbolicLink(),
          }))
          .sort(
            (a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name),
          ),
        loading: false,
        error: '',
      });
      setSelected('');
    };
    void load().catch((error) => {
      if (!disposed)
        setListing((current) => ({ ...current, loading: false, error: String(error) }));
    });
    return () => {
      disposed = true;
    };
  }, [id, path, refresh, sessions]);
  const open = async (entry: Entry) => {
    'background only';
    if (listing.loading) return;
    const next = joinPath(listing.path, entry.name);
    if (entry.directory) {
      setPath(next);
      return;
    }
    if (entry.symlink) {
      try {
        const fs: RemoteFs = await sessions.connection(id);
        if ((await fs.stat(next)).isDirectory()) {
          setPath(next);
          return;
        }
      } catch (error) {
        setListing((current) => ({ ...current, error: String(error) }));
        return;
      }
    }
    setSelected(entry.name);
  };
  return (
    <view
      id="sftp-browser"
      className="flex-1 min-h-0 flex flex-col p-[16px] [-x-app-region:no-drag]"
    >
      <view className="flex flex-row items-center gap-[14px] mb-[14px]">
        <view
          id="sftp-up"
          bindtap={() => {
            if (!listing.loading && listing.path) setPath(joinPath(listing.path, '..'));
          }}
        >
          <text className="text-[12px] text-[#a8e6cf]">{t('sftp.up')}</text>
        </view>
        <text id="sftp-path" className="flex-1 text-[12px] text-[#c3cdd6] break-all">
          {host}: {listing.path || '.'}
        </text>
        <view
          id="sftp-refresh"
          bindtap={() => {
            if (!listing.loading) setRefresh((value) => value + 1);
          }}
        >
          <text className="text-[12px] text-[#a8e6cf]">{t('sftp.refresh')}</text>
        </view>
      </view>
      {listing.error ? (
        <text
          id="sftp-error"
          className="text-[12px] text-[#e4a4a4] leading-[18px] mb-[12px] break-all"
        >
          {listing.error}
        </text>
      ) : null}
      {listing.loading ? (
        <text id="sftp-loading" className="text-[12px] text-[#8c99a7]">
          {t('sftp.loading')}
        </text>
      ) : null}
      <scroll-view id="sftp-list" scroll-y className="flex-1 min-h-0">
        {!listing.loading && !listing.error && !listing.entries.length ? (
          <text id="sftp-empty" className="text-[12px] text-[#8c99a7]">
            {t('sftp.empty')}
          </text>
        ) : null}
        {listing.entries.map((entry, index) => (
          <view
            id={`sftp-entry-${index}`}
            key={entry.name}
            className={cn(
              'flex flex-row items-center py-[10px] px-[12px] rounded-[6px]',
              selected === entry.name ? 'bg-[#35483f]' : 'bg-[#111419]',
            )}
            bindtap={() => {
              void open(entry);
            }}
          >
            <text className="w-[28px] text-[12px] text-[#a8e6cf]">
              {entry.directory ? '▸' : entry.symlink ? '↗' : '·'}
            </text>
            <text className="flex-1 text-[12px] text-[#dce4e9]">{entry.name}</text>
            <text className="text-[10px] text-[#8c99a7]">
              {t(entry.directory ? 'sftp.directory' : entry.symlink ? 'sftp.link' : 'sftp.file')}
            </text>
          </view>
        ))}
      </scroll-view>
    </view>
  );
}
function joinPath(parent: string, name: string) {
  return `${parent === '/' ? '' : parent}/${name}`;
}
