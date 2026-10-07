import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { createDefaultConnector, evaluateExpression } from 'agent-lynx/connector';
import { colorPixels } from './screenshots';

interface NodeInfo {
  nodeId: number;
  attributes?: string[];
  children?: NodeInfo[];
}
interface Evaluation {
  result?: { value?: string };
  exceptionDetails?: unknown;
}

export async function waitFor<T>(
  description: string,
  read: () => Promise<T | undefined>,
  timeout = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  do {
    const value = await read();
    if (value !== undefined) {
      return value;
    }
    await setTimeout(50);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${description}`);
}

export class LynxApp {
  private connector = createDefaultConnector();
  private child?: ChildProcess;
  private temporary = '';
  private client = '';
  private session = 0;
  private operation = 0;

  async start(options: { ssh?: boolean } = {}) {
    if (process.platform !== 'darwin') {
      throw new Error('Native terminal E2E requires macOS + Metal.');
    }
    await mkdir('.tmp/e2e/artifacts', { recursive: true });
    this.temporary = await mkdtemp(path.join(tmpdir(), 'catus-e2e-'));
    const configuration = path.join(this.temporary, 'workspaces.json');
    await writeFile(
      configuration,
      JSON.stringify({
        version: 1,
        workspaces: [
          {
            id: 'test',
            name: 'Test',
            icon: '>_',
            color: '#a8e6cf',
            command: '$SHELL',
            args: [],
            cwd: '~',
          },
          {
            ...(options.ssh
              ? { type: 'ssh', host: 'e2e-alias', remoteCommand: 'exec bash -l' }
              : {}),
            id: 'other',
            name: 'Other',
            icon: 'O',
            color: '#9eb9e8',
            command: '$SHELL',
            args: [],
            cwd: '~',
          },
        ],
      }),
    );
    let fixturePath = process.env.PATH;
    if (options.ssh) {
      const bin = path.join(this.temporary, 'bin');
      const remote = path.join(this.temporary, 'remote');
      await mkdir(bin);
      await mkdir(remote);
      await mkdir(path.join(remote, 'docs'));
      await writeFile(path.join(remote, 'readme.txt'), 'SFTP fixture');
      await writeFile(
        path.join(bin, 'ssh'),
        '#!/bin/sh\nfor arg in "$@"; do\n  case "$arg" in */etc/shells*) printf "/bin/zsh\\n/bin/bash\\n"; exit 0 ;; esac\ndone\nexec /usr/libexec/sftp-server -d "$CATUS_SFTP_DIRECTORY"\n',
      );
      await chmod(path.join(bin, 'ssh'), 0o755);
      fixturePath = `${bin}${path.delimiter}${fixturePath}`;
    }
    const existing = await this.connector.listClients();
    if (existing.some((client) => client.info?.App === 'catus-terminal')) {
      throw new Error(
        'Close the existing catus-terminal app before running E2E; tests only own their test process.',
      );
    }
    const launch = () => {
      const require = createRequire(import.meta.url);
      const cli = path.join(
        path.dirname(require.resolve('@lynx-js/lynxtron/package.json')),
        'cli.js',
      );
      this.child = spawn(process.execPath, [cli, 'dist/desktop'], {
        detached: true,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          PATH: fixturePath,
          CATUS_SFTP_DIRECTORY: path.join(this.temporary, 'remote'),
          CATUS_WORKSPACES_FILE: configuration,
          CATUS_E2E_PTY: path.resolve('tests/fixtures/fake-pty.mjs'),
          CATUS_E2E_NODE: process.execPath,
          CATUS_E2E_WINDOWLESS: process.env.CATUS_E2E_WINDOWLESS ?? '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const log = createWriteStream('.tmp/e2e/artifacts/lynxtron.log', { flags: 'a' });
      this.child.stdout!.pipe(log, { end: false });
      this.child.stderr!.pipe(log, { end: false });
      this.child.once('close', () => log.end());
    };
    launch();
    this.client = await waitFor(
      'Lynxtron DevTool client',
      async () => {
        if (this.child?.exitCode !== null) {
          throw new Error('Lynxtron exited; see .tmp/e2e/artifacts/lynxtron.log');
        }
        const clients = await this.connector.listClients();
        return clients.find((client) => client.info?.App === 'catus-terminal')?.id;
      },
      30_000,
    );
    const readSessions = async () => {
      try {
        return await this.connector.sendListSessionMessage(this.client);
      } catch (error) {
        // Discovery can advertise the client before its CDP subscription is ready.
        if (error instanceof Error && error.message.includes('Failed to subscribe')) {
          return undefined;
        }
        throw error;
      }
    };
    let sessions = await waitFor('DevTool subscription', readSessions, 15_000);
    // First connection can enable DevTool only after the window already exists.
    if (!sessions.length) {
      await this.stopProcess();
      launch();
      sessions = await waitFor(
        'restarted Lynx window',
        async () => {
          const sessions = await readSessions();
          return sessions?.length ? sessions : undefined;
        },
        15_000,
      );
    }
    this.session = sessions.at(-1)!.session_id;
    await this.cdp('DOM.enable', { useCompression: false });
    await waitFor('bound terminal session', async () => {
      const terminal = await this.node('#terminal-surface');
      return terminal && Number(this.attribute(terminal, 'terminal-id')) > 0 ? terminal : undefined;
    });
  }

  async stopProcess() {
    const child = this.child;
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    const closed = once(child, 'close');
    process.kill(-child.pid, 'SIGTERM');
    const timer = globalThis.setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        process.kill(-child.pid!, 'SIGKILL');
      }
    }, 3_000);
    try {
      await closed;
    } finally {
      globalThis.clearTimeout(timer);
    }
  }

  async close() {
    try {
      if (this.session) {
        const document = await this.cdp('DOM.getDocument', { depth: -1 });
        await writeFile('.tmp/e2e/artifacts/final-dom.json', JSON.stringify(document, null, 2));
        await writeFile('.tmp/e2e/artifacts/final.png', await this.screenshot());
      }
    } finally {
      await this.stopProcess();
      if (this.temporary) {
        await rm(this.temporary, { recursive: true, force: true });
      }
    }
  }

  async cdp<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.connector.sendCDPMessage<T, Record<string, unknown>>(
      this.client,
      this.session,
      method,
      params,
    );
  }

  async evaluate(expression: string) {
    const result = (await evaluateExpression(
      this.connector,
      this.client,
      this.session,
      expression,
    )) as Evaluation;
    if (result.exceptionDetails) {
      throw new Error(JSON.stringify(result.exceptionDetails));
    }
    return result.result?.value;
  }

  async node(selector: string) {
    return (await this.nodePath(selector))?.at(-1);
  }

  private async nodePath(selector: string) {
    const { root } = await this.cdp<{ root: NodeInfo }>('DOM.getDocument', { depth: -1 });
    const id = selector.slice(1);
    const find = (node: NodeInfo, ancestors: NodeInfo[]): NodeInfo[] | undefined => {
      const nodes = [...ancestors, node];
      if (this.attribute(node, 'idSelector') === id) {
        return nodes;
      }
      for (const child of node.children ?? []) {
        const result = find(child, nodes);
        if (result) {
          return result;
        }
      }
    };
    return find(root, []);
  }

  async sessionExists(id: number) {
    const result = await this.evaluate(`(()=>{try {
      globalThis.multiApps[globalThis.currentDebugAppId || globalThis.currentAppId]
        .NativeModules.nodejs.exposed.getTerminalSessionInfo(${id});
      return 'present';
    } catch (error) {
      return String(error);
    }})()`);
    if (result === 'present') {
      return true;
    }
    if (result?.includes(`Unknown or released terminal session: ${id}`)) {
      return false;
    }
    throw new Error(`Unexpected session lookup result: ${result}`);
  }

  attribute(node: NodeInfo, name: string) {
    const index =
      node.attributes?.findIndex((value, index) => index % 2 === 0 && value === name) ?? -1;
    return index === -1 ? undefined : node.attributes![index + 1];
  }

  async tap(selector: string) {
    await this.click(selector, 'left');
  }

  async rightClick(selector: string) {
    await this.click(selector, 'right');
  }

  async hover(selector: string) {
    const { x, y } = await this.visibleTarget(selector);
    // The desktop InspectorInputAgent supports dispatchMouseEvent; touch
    // emulation does not produce the native mouseenter/mouseleave events.
    await this.cdp('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
      timestamp: Date.now() / 1000,
    });
  }

  async visibleTarget(selector: string) {
    return waitFor(`visible hit target ${selector}`, async () => {
      const nodes = await this.nodePath(selector);
      const node = nodes?.at(-1);
      if (!node) {
        return undefined;
      }
      // Clay hit-testing can find a descendant of a hidden Presence wrapper.
      // Wait for its ancestor visibility as well as the target's own styles.
      if (
        nodes?.some((ancestor) =>
          /(?:^|;)\s*(?:visibility\s*:\s*hidden|display\s*:\s*none)\s*(?:;|$)/.test(
            this.attribute(ancestor, 'style') ?? '',
          ),
        )
      ) {
        return undefined;
      }
      const { computedStyle } = await this.cdp<{
        computedStyle: { name: string; value: string }[];
      }>('CSS.getComputedStyleForNode', { nodeId: node.nodeId });
      if (
        computedStyle.some(
          ({ name, value }) =>
            (name === 'visibility' && value === 'hidden') ||
            (name === 'display' && value === 'none'),
        )
      ) {
        return undefined;
      }
      const { model } = await this.cdp<{ model: { content: number[] } }>('DOM.getBoxModel', {
        nodeId: node.nodeId,
      });
      const xs = model.content.filter((_, index) => index % 2 === 0);
      const ys = model.content.filter((_, index) => index % 2 === 1);
      if (Math.max(...xs) <= Math.min(...xs) || Math.max(...ys) <= Math.min(...ys)) {
        return undefined;
      }
      const left = Math.min(...xs),
        right = Math.max(...xs);
      const top = Math.min(...ys),
        bottom = Math.max(...ys);
      const inset = Math.min(4, (right - left) / 4, (bottom - top) / 4);
      const points = [
        [(left + right) / 2, (top + bottom) / 2],
        [left + inset, top + inset],
        [right - inset, top + inset],
        [left + inset, bottom - inset],
        [right - inset, bottom - inset],
      ];
      for (const [x, y] of points) {
        const hit = await this.cdp<{ nodeId: number }>('DOM.getNodeForLocation', { x, y });
        const contains = (target: NodeInfo): boolean =>
          target.nodeId === hit.nodeId || !!target.children?.some(contains);
        // Presence mounts hidden content before positioning it. Backdrops can
        // have their center covered by content, so also check inset corners.
        if (contains(node)) {
          return { x: x!, y: y! };
        }
      }
      return undefined;
    });
  }

  private async click(selector: string, button: 'left' | 'right') {
    const { x, y } = await this.visibleTarget(selector);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.cdp('Input.emulateTouchFromMouseEvent', {
        type,
        x,
        y,
        button,
        timestamp: Date.now() / 1000,
        clickCount: 1,
      });
      if (type === 'mousePressed') {
        await setTimeout(50);
      }
    }
  }

  async invoke<T>(
    selector: string,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const key = `__catus_e2e_${++this.operation}`;
    await this.evaluate(`(()=>{globalThis[${JSON.stringify(key)}]=null;lynx.createSelectorQuery()
      .select(${JSON.stringify(selector)}).invoke({method:${JSON.stringify(method)},params:${JSON.stringify(params)},
        success:r=>globalThis[${JSON.stringify(key)}]={result:r},
        fail:r=>globalThis[${JSON.stringify(key)}]={error:r}}).exec();return 'requested'})()`);
    // UI invoke is asynchronous; evaluate's promise flag does not await it on this runtime.
    const response = await waitFor(`${selector}.${method}`, async () => {
      const json = await this.evaluate(`JSON.stringify(globalThis[${JSON.stringify(key)}])`);
      return json && json !== 'null'
        ? (JSON.parse(json) as { result?: T; error?: unknown })
        : undefined;
    });
    await this.evaluate(`delete globalThis[${JSON.stringify(key)}]`);
    if (response.error) {
      throw new Error(`${selector}.${method}: ${JSON.stringify(response.error)}`);
    }
    return response.result as T;
  }

  async screenshot(selector = '#application-layout') {
    const result = await this.invoke<{ data: string; width: number; height: number }>(
      selector,
      'takeScreenshot',
      { format: 'png', scale: 1 },
    );
    if (!result.data || !result.width || !result.height) {
      throw new Error('Invalid Lynx screenshot');
    }
    return Buffer.from(result.data.replace(/^data:[^,]*,/, ''), 'base64');
  }

  async terminalFrame(color: readonly number[]) {
    // Wait on pixels actually presented in Lynx, rather than just PTY/parser readiness.
    let last: Buffer | undefined;
    try {
      return await waitFor('RAF presentation', async () => {
        last = await this.screenshot('#terminal-viewport');
        return colorPixels(last, color) > 100 ? last : undefined;
      });
    } catch (error) {
      if (last) {
        await writeFile('.tmp/e2e/artifacts/presentation-timeout.png', last);
      }
      throw error;
    }
  }
}
