import * as Schema from 'effect/Schema';

const NonEmpty = Schema.String.check(Schema.isMinLength(1));
export const WorkspaceSchema = Schema.Struct({
  id: NonEmpty,
  name: NonEmpty,
  icon: NonEmpty,
  color: Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)),
  command: NonEmpty,
  args: Schema.Array(Schema.String),
  cwd: NonEmpty,
});
export const WorkspaceConfigSchema = Schema.Struct({
  version: Schema.Literal(1),
  workspaces: Schema.Array(WorkspaceSchema).check(Schema.isMinLength(1)),
});
export type Workspace = typeof WorkspaceSchema.Type;
export type WorkspaceConfig = typeof WorkspaceConfigSchema.Type;

export function parseWorkspaceConfig(value: unknown): WorkspaceConfig {
  const config = Schema.decodeUnknownSync(WorkspaceConfigSchema)(value);
  const ids = new Set<string>();
  for (const workspace of config.workspaces) {
    if (!/^[a-zA-Z0-9_-]+$/.test(workspace.id)) throw new Error('Workspace ID must use letters, numbers, _ or -');
    if (ids.has(workspace.id)) throw new Error(`Duplicate workspace ID: ${workspace.id}`);
    if (!workspace.name.trim() || !workspace.command.trim() || !workspace.cwd.trim()) {
      throw new Error('Workspace name, command and directory cannot be blank');
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
  loadWorkspaces(): Promise<WorkspaceConfigPayload>;
  saveWorkspaces(config: WorkspaceConfig): Promise<WorkspaceConfigPayload>;
}

export function resolveLaunch(workspace: Workspace, environment: WorkspaceEnvironment) {
  return {
    command: workspace.command === '$SHELL' ? environment.shell : workspace.command,
    args: workspace.args,
    cwd: workspace.cwd === '~' ? environment.home
      : workspace.cwd.startsWith('~/') ? environment.home + workspace.cwd.slice(1) : workspace.cwd,
  };
}
