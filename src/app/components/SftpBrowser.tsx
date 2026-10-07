import { Button } from './ui/Button';
import { Checkbox } from './ui/Checkbox';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
} from './ui/Breadcrumb';
import { Fragment } from '@lynx-js/react';
import { useTranslation } from '../i18n';
import { cn } from '../lib/utils';
import 'background-only';
import { useEffect, useRef, useState } from '@lynx-js/react';
import { useAtomValue } from '@effect/atom-react';
import { terminalSessionsAtom } from '../state/terminalSessions';
import { sftpClient } from '../api/sftp';
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
  const [uploading, setUploading] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [showHiddenFiles, setShowHiddenFiles] = useState(false);
  const entries = listing.entries.filter((entry) => showHiddenFiles || !entry.name.startsWith('.'));
  const parts = listing.path.split('/').filter(Boolean);
  const breadcrumbs = parts.length
    ? parts
        .map((name, index) => ({ name, path: `/${parts.slice(0, index + 1).join('/')}` }))
        .slice(-3)
    : [{ name: listing.path || '.', path: listing.path || '.' }];
  useEffect(() => {
    'background only';
    let disposed = false;
    setListing((current) => ({ ...current, loading: true, error: '' }));
    const load = async () => {
      const fs = await sessions.connection(id);
      const resolved = await fs.realpath(path);
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      if (disposed) {
        return;
      }
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
      if (!disposed) {
        setListing((current) => ({ ...current, loading: false, error: String(error) }));
      }
    });
    return () => {
      disposed = true;
    };
  }, [id, path, refresh, sessions]);
  const upload = async () => {
    'background only';
    if (uploading || listing.loading || !listing.path) {
      return;
    }
    setUploading(true);
    setListing((current) => ({ ...current, error: '' }));
    try {
      if (await sftpClient.uploadFiles(host, listing.path)) {
        if (mounted.current) {
          setRefresh((value) => value + 1);
        }
      }
    } catch (error) {
      if (mounted.current) {
        setListing((current) => ({ ...current, error: String(error) }));
      }
    } finally {
      if (mounted.current) {
        setUploading(false);
      }
    }
  };
  const open = async (entry: Entry) => {
    'background only';
    if (listing.loading || uploading) {
      return;
    }
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
      <view
        id="sftp-toolbar"
        className="shrink-0 flex flex-row items-center gap-[8px] pb-[12px] mb-[12px] border-b border-solid border-[#29313a]"
      >
        <Button
          variant="link"
          size="sm"
          disabled={uploading || listing.loading || !listing.path}
          id="sftp-up"
          bindtap={() => {
            if (!uploading && !listing.loading && listing.path) {
              setPath(joinPath(listing.path, '..'));
            }
          }}
        >
          <text className="text-[12px] text-[#a8e6cf]">{t('sftp.up')}</text>
        </Button>
        <Breadcrumb
          id="sftp-path"
          className="flex-1"
          accessibility-label={t('sftp.currentDirectory', { host, path: listing.path || '.' })}
        >
          <BreadcrumbList>
            {parts.length > 3 ? (
              <>
                <BreadcrumbItem>
                  <BreadcrumbEllipsis id="sftp-breadcrumb-ellipsis" />
                </BreadcrumbItem>
                <BreadcrumbSeparator />
              </>
            ) : null}
            {breadcrumbs.map((crumb, index) => (
              <Fragment key={crumb.path}>
                {index ? <BreadcrumbSeparator /> : null}
                <BreadcrumbItem>
                  {index === breadcrumbs.length - 1 ? (
                    <BreadcrumbPage id="sftp-breadcrumb-current">{crumb.name}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink
                      id={`sftp-breadcrumb-${index}`}
                      disabled={uploading || listing.loading}
                      bindtap={() => setPath(crumb.path)}
                    >
                      <text className="text-[12px] truncate">{crumb.name}</text>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
        <Checkbox
          id="sftp-show-hidden"
          className="shrink-0"
          checked={showHiddenFiles}
          onCheckedChange={setShowHiddenFiles}
        >
          <text className="text-[11px] text-[#c3cdd6]">{t('sftp.showHiddenFiles')}</text>
        </Checkbox>
        <Button
          variant="link"
          size="sm"
          disabled={uploading || listing.loading || !listing.path}
          id="sftp-upload"
          bindtap={() => {
            void upload();
          }}
        >
          <text className="text-[12px] text-[#a8e6cf]">
            {t(uploading ? 'sftp.uploading' : 'sftp.upload')}
          </text>
        </Button>
        <Button
          variant="link"
          size="sm"
          disabled={uploading || listing.loading}
          id="sftp-refresh"
          bindtap={() => {
            if (!listing.loading) {
              setRefresh((value) => value + 1);
            }
          }}
        >
          <text className="text-[12px] text-[#a8e6cf]">{t('sftp.refresh')}</text>
        </Button>
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
      <list
        id="sftp-list"
        list-type="single"
        scroll-orientation="vertical"
        className="flex-1 min-h-0"
      >
        {!listing.loading && !listing.error && !entries.length ? (
          <list-item key="empty" item-key="empty" estimated-main-axis-size-px={18}>
            <text id="sftp-empty" className="text-[12px] text-[#8c99a7]">
              {t('sftp.empty')}
            </text>
          </list-item>
        ) : null}
        {entries.map((entry, index) => (
          <list-item
            key={joinPath(listing.path, entry.name)}
            item-key={joinPath(listing.path, entry.name)}
            estimated-main-axis-size-px={40}
          >
            <Button
              variant="ghost"
              disabled={uploading || listing.loading}
              id={`sftp-entry-${index}`}
              data-filename={entry.name}
              className={cn(
                'w-full h-auto justify-start gap-0 py-[10px] px-[12px] rounded-[6px] font-normal',
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
            </Button>
          </list-item>
        ))}
      </list>
    </view>
  );
}
function joinPath(parent: string, name: string) {
  return `${parent === '/' ? '' : parent}/${name}`;
}
