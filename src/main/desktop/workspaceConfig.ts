import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import defaults from '../../../config/workspaces.json';
import { parseWorkspaceConfig } from '../../shared/workspaces';
import type {
  WorkspaceConfig,
  WorkspaceConfigPayload,
  WorkspaceEnvironment,
  WorkspaceHost,
} from '../../shared/workspaces';

export function createWorkspaceHost(
  configPath = process.env.CATUS_WORKSPACES_FILE ??
    path.join(homedir(), '.config', 'catus-terminal', 'workspaces.json'),
  environment: WorkspaceEnvironment = {
    shell: userInfo().shell || process.env.SHELL || '/bin/sh',
    home: homedir(),
  },
): WorkspaceHost {
  const payload = (config: WorkspaceConfig): WorkspaceConfigPayload => ({
    config,
    path: configPath,
    environment,
  });
  async function loadWorkspaces(): Promise<WorkspaceConfigPayload> {
    try {
      return payload(parseWorkspaceConfig(JSON.parse(await readFile(configPath, 'utf8'))));
    } catch (error) {
      // An invalid existing file is reported, never replaced by defaults.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(path.dirname(configPath), { recursive: true });
      try {
        await writeFile(configPath, JSON.stringify(defaults, null, 2) + '\n', {
          flag: 'wx',
          mode: 0o600,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      return payload(parseWorkspaceConfig(JSON.parse(await readFile(configPath, 'utf8'))));
    }
  }
  async function saveWorkspaces(value: WorkspaceConfig): Promise<WorkspaceConfigPayload> {
    const config = parseWorkspaceConfig(value);
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
  return { loadWorkspaces, saveWorkspaces };
}
