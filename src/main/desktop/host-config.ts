import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import defaults from '../../../config/hosts.json';
import { parseHostsConfig } from '../../shared/hosts';
import type {
  HostsConfig,
  HostsConfigPayload,
  HostEnvironment,
  HostService,
} from '../../shared/hosts';

export function createHostService(
  configPath = process.env.CATUS_HOSTS_FILE ??
    path.join(homedir(), '.config', 'catus-terminal', 'hosts.json'),
  environment: HostEnvironment = {
    shell: userInfo().shell || process.env.SHELL || '/bin/sh',
    home: homedir(),
  },
): HostService {
  const payload = (config: HostsConfig): HostsConfigPayload => ({
    config,
    path: configPath,
    environment,
  });
  async function loadHosts(): Promise<HostsConfigPayload> {
    try {
      return payload(parseHostsConfig(JSON.parse(await readFile(configPath, 'utf8'))));
    } catch (error) {
      // An invalid existing file is reported, never replaced by defaults.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      await mkdir(path.dirname(configPath), { recursive: true });
      try {
        await writeFile(configPath, JSON.stringify(defaults, null, 2) + '\n', {
          flag: 'wx',
          mode: 0o600,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }
      }
      return payload(parseHostsConfig(JSON.parse(await readFile(configPath, 'utf8'))));
    }
  }
  async function saveHosts(value: HostsConfig): Promise<HostsConfigPayload> {
    const config = parseHostsConfig(value);
    await mkdir(path.dirname(configPath), { recursive: true });
    const temporaryPath = `${configPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify(config, null, 2) + '\n', {
        flag: 'wx',
        mode: 0o600,
      });
      await rename(temporaryPath, configPath);
    } finally {
      await unlink(temporaryPath).catch(() => {});
    }
    return payload(config);
  }
  return { loadHosts, saveHosts };
}
