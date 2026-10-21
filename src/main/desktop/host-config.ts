import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
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
  async function readHosts(): Promise<HostsConfig> {
    return parseHostsConfig(JSON.parse(await readFile(configPath, 'utf8')));
  }
  async function writeDefaults(): Promise<HostsConfig> {
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
    return readHosts();
  }
  async function backupPath(): Promise<string> {
    let index = 0;
    while (true) {
      const candidate = index === 0 ? `${configPath}.bak` : `${configPath}.${index}.bak`;
      try {
        await stat(candidate);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return candidate;
        }
        throw error;
      }
      index += 1;
    }
  }
  async function loadHosts(): Promise<HostsConfigPayload> {
    let contents: string;
    try {
      contents = await readFile(configPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      return payload(await writeDefaults());
    }
    try {
      return payload(parseHostsConfig(JSON.parse(contents)));
    } catch {
      // Keep the broken file beside the config, then start from defaults.
      await rename(configPath, await backupPath());
      return payload(await writeDefaults());
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
