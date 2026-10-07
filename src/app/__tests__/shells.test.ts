import { expect, rstest, test } from '@rstest/core';
import * as AtomRegistry from 'effect/reactivity/AtomRegistry';
import { editorAtom, editWorkspace } from '../state/session';
import { shellHostAtom, shellOptionsAtom, shellsAtom } from '../state/shells';
import defaults from '../../../tests/fixtures/workspaces.json';
import { parseWorkspaceConfig } from '../../shared/workspaces';

// A pending host response must not overwrite candidates for a newer Host.
test('Effect owns loading, failures, retry and stale remote shell responses', async () => {
  const registry = AtomRegistry.make();
  let finishOld!: (options: { value: string; label: string }[]) => void;
  const old = new Promise<{ value: string; label: string }[]>((resolve) => {
    finishOld = resolve;
  });
  const listShells = rstest.fn(async (destination?: string) => {
    if (destination === 'old') {
      return old;
    }
    if (destination === 'broken') {
      throw new Error('SSH failed');
    }
    return [{ value: '/bin/zsh', label: 'zsh' }];
  });
  registry.set(shellHostAtom, { listShells });
  const release = registry.mount(shellOptionsAtom);
  try {
    registry.set(editorAtom, editWorkspace(parseWorkspaceConfig(defaults).workspaces[0]!));
    await rstest.waitFor(() => expect(registry.get(shellOptionsAtom).options).toHaveLength(1));
    expect(listShells).toHaveBeenLastCalledWith(undefined);
    const calls = listShells.mock.calls.length;
    registry.update(editorAtom, (editor) => ({
      ...editor,
      draft: { ...editor.draft!, name: 'Renamed' },
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listShells).toHaveBeenCalledTimes(calls);
    registry.update(editorAtom, (editor) => ({
      ...editor,
      draft: { ...editor.draft!, type: 'ssh' as const, host: 'old' },
    }));
    await rstest.waitFor(() => expect(listShells).toHaveBeenLastCalledWith('old'));
    registry.update(editorAtom, (editor) => ({
      ...editor,
      draft: { ...editor.draft!, host: 'new' },
    }));
    await rstest.waitFor(() => expect(listShells).toHaveBeenLastCalledWith('new'));
    await rstest.waitFor(() => expect(registry.get(shellOptionsAtom).loading).toBe(false));
    finishOld([{ value: '/bin/old', label: 'old' }]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(registry.get(shellOptionsAtom).options[0]?.value).toBe('/bin/zsh');
    registry.update(editorAtom, (editor) => ({
      ...editor,
      draft: { ...editor.draft!, host: 'broken' },
    }));
    await rstest.waitFor(() =>
      expect(registry.get(shellOptionsAtom).error).toContain('SSH failed'),
    );
    listShells.mockResolvedValue([{ value: '/bin/bash', label: 'bash' }]);
    registry.refresh(shellsAtom);
    await rstest.waitFor(() =>
      expect(registry.get(shellOptionsAtom).options[0]?.value).toBe('/bin/bash'),
    );
  } finally {
    release();
    registry.dispose();
  }
});
