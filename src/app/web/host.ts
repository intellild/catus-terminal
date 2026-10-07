import defaults from '../../../config/workspaces.json';
import { parseWorkspaceConfig } from '../../shared/workspaces';
import type { WorkspaceHost, WorkspaceConfigPayload } from '../../shared/workspaces';
import type { TerminalHost } from '../state/terminalSessions';
import type { SftpHost } from '../../shared/sftp';

// Preview configuration belongs to this browser runtime, never the desktop config file.
export function createWebHost(): WorkspaceHost & TerminalHost & SftpHost {
  let config = parseWorkspaceConfig(defaults);
  const payload = (): WorkspaceConfigPayload => ({
    config,
    path: 'web preview (in memory)',
    environment: { shell: '/bin/sh', home: '~' },
  });
  return {
    async loadWorkspaces() {
      return payload();
    },
    async saveWorkspaces(value) {
      config = parseWorkspaceConfig(value);
      return payload();
    },
    async listShells() {
      // The browser cannot detect shells on either the local or remote machine.
      return [];
    },
    createTerminalSession() {},
    closeTerminalSession() {},
    async connectSftp() {
      throw new Error('SFTP is unavailable in web preview');
    },
  };
}
