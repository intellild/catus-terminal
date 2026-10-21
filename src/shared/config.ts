import * as Schema from 'effect/Schema';
import { HostProfileSchema } from './hosts';
import type { HostEnvironment } from './hosts';
import type { TmuxSessionHost } from './tmux';

// Persisted preferences that are not tied to a single host.
export const DisplayPreferencesSchema = Schema.Struct({
  language: Schema.String.check(
    Schema.makeFilter((value) => !!value.trim(), { message: 'validation.required' }),
  ),
});
export type DisplayPreferences = typeof DisplayPreferencesSchema.Type;

// One config file holds every persisted setting; only hosts are structured today.
export const AppConfigSchema = Schema.Struct({
  version: Schema.Literal(1),
  hosts: Schema.Array(HostProfileSchema).check(Schema.isMinLength(1)),
  display: DisplayPreferencesSchema,
}).check(
  Schema.makeFilter((config) => {
    const ids = new Set<string>();
    const issues: Schema.FilterIssue[] = [];
    config.hosts.forEach((host, index) => {
      if (ids.has(host.id)) {
        issues.push({
          path: ['hosts', index, 'id'],
          issue: `Duplicate host ID: ${host.id}`,
        });
      }
      ids.add(host.id);
    });
    return issues;
  }),
);
export type AppConfig = typeof AppConfigSchema.Type;

export function parseConfig(value: unknown): AppConfig {
  return Schema.decodeUnknownSync(AppConfigSchema)(value);
}

export interface AppConfigPayload {
  readonly config: AppConfig;
  readonly path: string;
  readonly environment: HostEnvironment;
}

export interface HostService extends TmuxSessionHost {
  listShells?(destination?: string): Promise<readonly import('./shells').ShellOption[]>;
  loadConfig(): Promise<AppConfigPayload>;
  saveConfig(config: AppConfig): Promise<AppConfigPayload>;
}
