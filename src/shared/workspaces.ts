import * as Schema from 'effect/Schema';

const NonEmpty = Schema.String.check(Schema.isMinLength(1));
export const WorkspaceSettingsSchema = Schema.Struct({
  id: NonEmpty,
  name: NonEmpty,
  icon: NonEmpty,
  color: Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)),
  type: Schema.optional(Schema.Literals(['local', 'ssh'])),
  host: Schema.optional(Schema.String),
  remoteCommand: Schema.optional(Schema.String),
  tmux: Schema.optional(Schema.Boolean),
  // $SHELL uses the account default; custom uses the command field.
  shell: Schema.optional(NonEmpty),
  command: NonEmpty,
  args: Schema.Array(Schema.String),
  cwd: NonEmpty,
});
export const WorkspaceConfigSchema = Schema.Struct({
  version: Schema.Literal(1),
  workspaces: Schema.Array(WorkspaceSettingsSchema).check(Schema.isMinLength(1)),
});
export type WorkspaceSettings = typeof WorkspaceSettingsSchema.Type;
export type WorkspaceConfig = typeof WorkspaceConfigSchema.Type;

export function parseWorkspaceConfig(value: unknown): WorkspaceConfig {
  const config = Schema.decodeUnknownSync(WorkspaceConfigSchema)(value);
  const ids = new Set<string>();
  for (const workspace of config.workspaces) {
    if (!/^[a-zA-Z0-9_-]+$/.test(workspace.id)) {
      throw new Error('Workspace ID must use letters, numbers, _ or -');
    }
    if (ids.has(workspace.id)) {
      throw new Error(`Duplicate workspace ID: ${workspace.id}`);
    }
    if (!workspace.name.trim() || !workspace.command.trim() || !workspace.cwd.trim()) {
      throw new Error('Workspace name, command and directory cannot be blank');
    }
    if (
      workspace.type === 'ssh' &&
      (!workspace.host?.trim() || /^[\s-]|[\r\n\0]/.test(workspace.host))
    ) {
      throw new Error('SSH host must be a hostname, user@host or SSH config alias');
    }
    if (
      workspace.shell &&
      workspace.shell !== '$SHELL' &&
      workspace.shell !== 'custom' &&
      (!workspace.shell.startsWith('/') || /[\s\0]/.test(workspace.shell))
    ) {
      throw new Error('Shell must be an absolute executable path, $SHELL or custom');
    }
    ids.add(workspace.id);
  }
  return config;
}

export interface WorkspaceEnvironment {
  readonly shell: string;
  readonly home: string;
}
export interface WorkspaceConfigPayload {
  readonly config: WorkspaceConfig;
  readonly path: string;
  readonly environment: WorkspaceEnvironment;
}
export interface WorkspaceHost {
  listShells?(destination?: string): Promise<readonly import('./shells').ShellOption[]>;
  loadWorkspaces(): Promise<WorkspaceConfigPayload>;
  saveWorkspaces(config: WorkspaceConfig): Promise<WorkspaceConfigPayload>;
}

export { resolveLaunch, launchPreview, quoteShell } from './launch';
