import defaults from '../../../config/catus-terminal/config.json';
import { parseConfig } from '../../shared/config';
import type { HostService, AppConfigPayload } from '../../shared/config';
import type { TerminalHost } from '../state/terminal-sessions';
import type { SftpHost } from '../../shared/sftp';

// Preview configuration belongs to this browser runtime, never the desktop config file.
export function createWebHost(): HostService & TerminalHost & SftpHost {
  let config = parseConfig(defaults);
  const payload = (): AppConfigPayload => ({
    config,
    path: 'web preview (in memory)',
    environment: { shell: '/bin/sh', home: '~' },
  });
  return {
    async loadConfig() {
      return payload();
    },
    async saveConfig(value) {
      config = parseConfig(value);
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
