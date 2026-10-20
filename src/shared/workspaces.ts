import * as Schema from 'effect/Schema';
import { tabKinds } from './tabs';
import type { TabKind } from './tabs';
import type { TmuxSessionHost } from './tmux';

const NonBlank = Schema.String.check(
  Schema.makeFilter((value) => !!value.trim(), { message: 'validation.required' }),
);
const Host = NonBlank.check(
  Schema.isPattern(/^(?![\s-])(?!.*[\r\n\0])[\s\S]+$/, { message: 'validation.host' }),
);
const isHost = Schema.is(Host);
const HostCheck = Schema.makeFilter<{ type?: string; host?: string }>((workspace) =>
  workspace.type !== 'ssh' || isHost(workspace.host)
    ? undefined
    : { path: ['host'], issue: 'validation.host' },
);
// New tmux sessions are named `prefix + index`; tmux reserves `:` and spaces.
const TmuxPrefix = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]+$/, { message: 'validation.tmuxPrefix' }),
);
const DefaultTabCheck = Schema.makeFilter<{ type?: string; defaultTab?: TabKind }>((workspace) =>
  workspace.defaultTab !== 'sftp' || workspace.type === 'ssh'
    ? undefined
    : { path: ['defaultTab'], issue: 'validation.sftpDefault' },
);
const fields = {
  id: NonBlank.check(Schema.isPattern(/^[a-zA-Z0-9_-]+$/, { message: 'validation.workspaceId' })),
  name: NonBlank,
  icon: NonBlank,
  color: Schema.String.check(
    Schema.isPattern(/^#[0-9a-fA-F]{6}$/, { message: 'validation.color' }),
  ),
  type: Schema.optional(Schema.Literals(['local', 'ssh'])),
  host: Schema.optional(Schema.String),
  remoteCommand: Schema.optional(Schema.String),
  defaultTab: Schema.Literals(tabKinds),
  // $SHELL uses the account default; custom uses the command field.
  shell: Schema.optional(
    Schema.String.check(
      Schema.isPattern(/^(?:\$SHELL|custom|\/[^\s\0]*)$/, { message: 'validation.shell' }),
    ),
  ),
  command: NonBlank,
  args: Schema.Array(Schema.String),
  cwd: NonBlank,
  // Sessions created for this host start with this prefix; old files omit it.
  tmuxPrefix: Schema.optional(TmuxPrefix),
};
export const WorkspaceSettingsSchema = Schema.Struct(fields)
  .check(HostCheck)
  .check(DefaultTabCheck);

// The form keeps string values for Lynx controls; decoding produces launch settings.
export const WorkspaceFormSchema = Schema.Struct({
  ...fields,
  name: Schema.Trim.pipe(Schema.decodeTo(fields.name)),
  icon: Schema.Trim.pipe(Schema.decodeTo(fields.icon)),
  command: Schema.Trim.pipe(Schema.decodeTo(fields.command)),
  cwd: Schema.Trim.pipe(Schema.decodeTo(fields.cwd)),
  type: Schema.Literals(['local', 'ssh']),
  host: Schema.Trim,
  remoteCommand: Schema.String,
  shell: Schema.required(fields.shell),
  args: Schema.fromJsonString(fields.args).annotate({ message: 'validation.arguments' }),
  tmuxPrefix: Schema.Trim.pipe(Schema.decodeTo(TmuxPrefix)),
  isNew: Schema.Boolean,
})
  .check(HostCheck)
  .check(DefaultTabCheck);
export type WorkspaceFormValues = typeof WorkspaceFormSchema.Encoded;

export const WorkspaceConfigSchema = Schema.Struct({
  version: Schema.Literal(1),
  workspaces: Schema.Array(WorkspaceSettingsSchema).check(Schema.isMinLength(1)),
}).check(
  Schema.makeFilter((config) => {
    const ids = new Set<string>();
    const issues: Schema.FilterIssue[] = [];
    config.workspaces.forEach((workspace, index) => {
      if (ids.has(workspace.id)) {
        issues.push({
          path: ['workspaces', index, 'id'],
          issue: `Duplicate workspace ID: ${workspace.id}`,
        });
      }
      ids.add(workspace.id);
    });
    return issues;
  }),
);
export type WorkspaceSettings = typeof WorkspaceSettingsSchema.Type;
export type WorkspaceConfig = typeof WorkspaceConfigSchema.Type;

// Version 1 used a per-workspace "Use tmux" flag. Tab kinds now select tmux
// per tab; migrate the old flag and drop the retired fields before decoding.
function migrateWorkspace(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }
  const workspace = value as Record<string, unknown>;
  const { tmux, tmuxSessionName: _tmuxSessionName, ...rest } = workspace;
  return {
    ...rest,
    defaultTab: workspace.defaultTab ?? (tmux === true ? 'tmux' : 'shell'),
  };
}

export function parseWorkspaceConfig(value: unknown): WorkspaceConfig {
  if (!value || typeof value !== 'object') {
    return Schema.decodeUnknownSync(WorkspaceConfigSchema)(value);
  }
  const config = value as Record<string, unknown>;
  const workspaces = Array.isArray(config.workspaces)
    ? config.workspaces.map(migrateWorkspace)
    : config.workspaces;
  return Schema.decodeUnknownSync(WorkspaceConfigSchema)({ ...config, workspaces });
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
export interface WorkspaceHost extends TmuxSessionHost {
  listShells?(destination?: string): Promise<readonly import('./shells').ShellOption[]>;
  loadWorkspaces(): Promise<WorkspaceConfigPayload>;
  saveWorkspaces(config: WorkspaceConfig): Promise<WorkspaceConfigPayload>;
}

export { resolveLaunch, launchPreview, quoteShell } from './launch';
