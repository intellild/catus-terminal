import * as Schema from 'effect/Schema';
import { tabKinds } from './tabs';
import type { TabKind } from './tabs';

const NonBlank = Schema.String.check(
  Schema.makeFilter((value) => !!value.trim(), { message: 'validation.required' }),
);
const Host = NonBlank.check(
  Schema.isPattern(/^(?![\s-])(?!.*[\r\n\0])[\s\S]+$/, { message: 'validation.host' }),
);
const isHost = Schema.is(Host);
const HostCheck = Schema.makeFilter<{ type?: string; host?: string }>((host) =>
  host.type !== 'ssh' || isHost(host.host)
    ? undefined
    : { path: ['host'], issue: 'validation.host' },
);
// New tmux sessions are named `prefix + index`; tmux reserves `:` and spaces.
const TmuxPrefix = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]+$/, { message: 'validation.tmuxPrefix' }),
);
const DefaultTabCheck = Schema.makeFilter<{ type?: string; defaultTab?: TabKind }>((host) =>
  host.defaultTab !== 'sftp' || host.type === 'ssh'
    ? undefined
    : { path: ['defaultTab'], issue: 'validation.sftpDefault' },
);
const fields = {
  id: NonBlank.check(Schema.isPattern(/^[a-zA-Z0-9_-]+$/, { message: 'validation.hostId' })),
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
export const HostProfileSchema = Schema.Struct(fields).check(HostCheck).check(DefaultTabCheck);

// The form keeps string values for Lynx controls; decoding produces launch settings.
export const HostFormSchema = Schema.Struct({
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
export type HostFormValues = typeof HostFormSchema.Encoded;
export type HostProfile = typeof HostProfileSchema.Type;

export interface HostEnvironment {
  readonly shell: string;
  readonly home: string;
}

export { resolveLaunch, launchPreview, quoteShell } from './launch';
