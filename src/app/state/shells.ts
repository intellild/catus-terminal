import 'background-only';
import '../runtime';
import * as Atom from 'effect/reactivity/Atom';
import * as Effect from 'effect/Effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import * as Cause from 'effect/Cause';
import type { ShellHost, ShellOption } from '../../shared/shells';
import { editorAtom } from './session';
import { workspaceHostAtom, nativeWorkspaceHost } from './workspaceHost';

export const shellHostAtom = Atom.make<ShellHost | undefined>(undefined).pipe(Atom.keepAlive);
// The standalone session runtime mounts this atom. Dependencies cancel stale
// effects on host/type changes; no React effect owns the asynchronous result.
const shellRequestAtom = Atom.make((get) => {
  const editor = get(editorAtom);
  if (!editor.open || !editor.draft) return null;
  return editor.draft.type === 'ssh' ? `ssh:${editor.draft.host.trim()}` : 'local';
});
export const shellsAtom = Atom.make<
  { request: string | null; options: readonly ShellOption[] },
  unknown
>((get) => {
  const request = get(shellRequestAtom);
  if (request === null || request === 'ssh:') return Effect.succeed({ request, options: [] });
  const destination = request === 'local' ? undefined : request.slice(4);
  const host = get(shellHostAtom) ?? get(workspaceHostAtom) ?? nativeWorkspaceHost();
  return Effect.gen(function* () {
    // Avoid opening an SSH process for each keystroke in the Host field.
    if (destination !== undefined) yield* Effect.sleep('400 millis');
    const options = yield* Effect.tryPromise(() => host.listShells!(destination));
    return { request, options };
  });
});
export const shellOptionsAtom = Atom.make((get) => {
  const result = get(shellsAtom);
  return {
    options:
      AsyncResult.isSuccess(result) && result.value.request === get(shellRequestAtom)
        ? result.value.options
        : [],
    loading: result.waiting,
    error: AsyncResult.isFailure(result) && !result.waiting ? Cause.pretty(result.cause) : '',
  };
});
