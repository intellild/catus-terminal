import { Button } from './ui/Button';
import { Icon } from './ui/Icon';
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
import 'background-only';
import { useEffect, useRef, useState } from '@lynx-js/react';
import { useAtomValue } from '@effect/atom-react';
import { terminalSessionsAtom } from '../state/terminalSessions';
import { sftpClient } from '../api/sftp';
import type { RemoteFs } from '../../shared/sftp';
import { FileExplorer } from './FileExplorer';
import type { FileEntry } from './FileExplorer';

interface Listing {
  path: string;
  entries: FileEntry[];
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
  const [downloading, setDownloading] = useState('');
  const transferring = uploading || !!downloading;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [showHiddenFiles, setShowHiddenFiles] = useState(false);
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
    if (transferring || listing.loading || !listing.path) {
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
  const download = async (entry: FileEntry) => {
    'background only';
    if (transferring || listing.loading || entry.directory) {
      return;
    }
    setDownloading(entry.name);
    setListing((current) => ({ ...current, error: '' }));
    try {
      const remotePath = joinPath(listing.path, entry.name);
      if (entry.symlink && (await (await sessions.connection(id)).stat(remotePath)).isDirectory()) {
        throw new Error(t('sftp.downloadFileOnly'));
      }
      await sftpClient.downloadFile(host, remotePath);
    } catch (error) {
      if (mounted.current) {
        setListing((current) => ({ ...current, error: String(error) }));
      }
    } finally {
      if (mounted.current) {
        setDownloading('');
      }
    }
  };
  const open = async (entry: FileEntry) => {
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
      data-automation-id="sftp-browser"
      className="flex-1 min-h-0 flex flex-col p-[16px] [-x-app-region:no-drag]"
    >
      <view
        data-automation-id="sftp-toolbar"
        className="shrink-0 flex flex-row items-center gap-[8px] pb-[12px] mb-[12px] border-b border-solid border-[#29313a]"
      >
        <Button
          variant="link"
          size="sm"
          disabled={transferring || listing.loading || !listing.path}
          data-automation-id="sftp-up"
          bindtap={() => {
            if (!transferring && !listing.loading && listing.path) {
              setPath(joinPath(listing.path, '..'));
            }
          }}
        >
          <text className="text-[12px] text-[#a8e6cf]">{t('sftp.up')}</text>
        </Button>
        <Breadcrumb
          data-automation-id="sftp-path"
          className="flex-1"
          accessibility-label={t('sftp.currentDirectory', { host, path: listing.path || '.' })}
        >
          <BreadcrumbList>
            {parts.length > 3 ? (
              <>
                <BreadcrumbItem>
                  <BreadcrumbEllipsis data-automation-id="sftp-breadcrumb-ellipsis" />
                </BreadcrumbItem>
                <BreadcrumbSeparator />
              </>
            ) : null}
            {breadcrumbs.map((crumb, index) => (
              <Fragment key={crumb.path}>
                {index ? <BreadcrumbSeparator /> : null}
                <BreadcrumbItem>
                  {index === breadcrumbs.length - 1 ? (
                    <BreadcrumbPage data-automation-id="sftp-breadcrumb-current">
                      {crumb.name}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink
                      data-automation-id={`sftp-breadcrumb-${index}`}
                      disabled={transferring || listing.loading}
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
          data-automation-id="sftp-show-hidden"
          className="shrink-0"
          checked={showHiddenFiles}
          onCheckedChange={setShowHiddenFiles}
        >
          <text className="text-[11px] text-[#c3cdd6]">{t('sftp.showHiddenFiles')}</text>
        </Checkbox>
        <Button
          variant="link"
          size="sm"
          disabled={transferring || listing.loading || !listing.path}
          data-automation-id="sftp-upload"
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
          disabled={transferring || listing.loading}
          data-automation-id="sftp-refresh"
          bindtap={() => {
            if (!listing.loading) {
              setRefresh((value) => value + 1);
            }
          }}
        >
          <text className="text-[12px] text-[#a8e6cf]">{t('sftp.refresh')}</text>
        </Button>
      </view>
      <FileExplorer
        automationId="sftp"
        entries={listing.entries}
        loading={listing.loading}
        error={listing.error}
        selected={selected}
        showHiddenFiles={showHiddenFiles}
        disabled={transferring || listing.loading}
        itemKey={(entry) => joinPath(listing.path, entry.name)}
        onOpen={(entry) => {
          void open(entry);
        }}
        renderLeadingAction={(entry, index) =>
          entry.directory ? null : (
            <Button
              data-automation-id={`sftp-download-${index}`}
              data-downloadfile={entry.name}
              accessibility-label={t(
                downloading === entry.name ? 'sftp.downloading' : 'sftp.download',
              )}
              variant="ghost"
              size="icon-sm"
              className="w-[22px] h-[22px] p-0 rounded-[5px]"
              disabled={transferring || listing.loading}
              catchtap={() => {
                void download(entry);
              }}
            >
              <Icon
                name={downloading === entry.name ? 'loader-circle' : 'download'}
                size={14}
                color={downloading === entry.name ? '#a8e6cf' : '#8c99a7'}
              />
            </Button>
          )
        }
      />
    </view>
  );
}
function joinPath(parent: string, name: string) {
  return `${parent === '/' ? '' : parent}/${name}`;
}
