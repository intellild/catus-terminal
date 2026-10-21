import defaults from '../../../config/hosts.json';
import { parseHostsConfig } from '../../shared/hosts';
import type { HostService, HostsConfigPayload } from '../../shared/hosts';
import type { TerminalHost } from '../state/terminal-sessions';
import type { SftpHost } from '../../shared/sftp';

// Preview configuration belongs to this browser runtime, never the desktop config file.
export function createWebHost(): HostService & TerminalHost & SftpHost {
  let config = parseHostsConfig(defaults);
  const payload = (): HostsConfigPayload => ({
    config,
    path: 'web preview (in memory)',
    environment: { shell: '/bin/sh', home: '~' },
  });
  return {
    async loadHosts() {
      return payload();
    },
    async saveHosts(value) {
      config = parseHostsConfig(value);
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
