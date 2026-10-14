import * as Schema from 'effect/Schema';
import * as SchemaGetter from 'effect/SchemaGetter';

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
  tmux: Schema.optional(Schema.Boolean),
  tmuxSessionName: Schema.optional(
    NonBlank.check(Schema.isPattern(/^[^.:\r\n\0]+$/, { message: 'validation.tmuxSessionName' })),
  ),
  // $SHELL uses the account default; custom uses the command field.
  shell: Schema.optional(
    Schema.String.check(
      Schema.isPattern(/^(?:\$SHELL|custom|\/[^\s\0]*)$/, { message: 'validation.shell' }),
    ),
  ),
  command: NonBlank,
  args: Schema.Array(Schema.String),
  cwd: NonBlank,
};
export const WorkspaceSettingsSchema = Schema.Struct(fields).check(HostCheck);

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
  tmuxSessionName: Schema.Trim.pipe(Schema.decodeTo(Schema.required(fields.tmuxSessionName))),
  tmux: Schema.Literals(['true', 'false']).pipe(
    Schema.decodeTo(Schema.Boolean, {
      decode: SchemaGetter.transform((value) => value === 'true'),
      encode: SchemaGetter.transform((value) => (value ? ('true' as const) : ('false' as const))),
    }),
  ),
  args: Schema.fromJsonString(fields.args).annotate({ message: 'validation.arguments' }),
  isNew: Schema.Boolean,
}).check(HostCheck);
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

export function parseWorkspaceConfig(value: unknown): WorkspaceConfig {
  return Schema.decodeUnknownSync(WorkspaceConfigSchema)(value);
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
