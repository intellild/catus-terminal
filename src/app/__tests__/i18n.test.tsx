import { expect, rstest, test } from '@rstest/core';
import { act, render } from '@lynx-js/react/testing-library';
import { i18n } from '../i18n';
import { StatusBar } from '../components/status-bar';
import english from '../../../locales/en.toml';

// These imports go through the same TOML rule as the production Lynx bundle.
test('English resources are ready synchronously before the first render', () => {
  expect(i18n.isInitialized).toBe(true);
  expect(i18n.language).toBe('en');
  expect(i18n.options.fallbackLng).toEqual(['en']);
  expect(i18n.t('workspace.add')).toBe('Add workspace');
  expect(i18n.t('workspace.hostDescription')).toContain('~/.ssh/config');
  function checkResources(value: unknown, path = '') {
    if (typeof value === 'string') {
      expect(i18n.exists(path)).toBe(true);
      return;
    }
    expect(value).toBeTypeOf('object');
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      checkResources(child, path ? `${path}.${key}` : key);
    }
  }
  checkResources(english);
});

test('counts use English plural rules including zero', () => {
  expect(i18n.t('tabs.count', { count: 0 })).toBe('0 tabs');
  expect(i18n.t('tabs.count', { count: 1 })).toBe('1 tab');
  expect(i18n.t('tabs.count', { count: 2 })).toBe('2 tabs');
  expect(
    i18n.t('status.summary', {
      workspaces: i18n.t('status.workspaces', { count: 1 }),
      tabs: i18n.t('tabs.count', { count: 2 }),
    }),
  ).toBe('1 workspace open · 2 tabs');
});

test('user names interpolate literally and do not trigger recursive interpolation', () => {
  expect(i18n.t('tabs.sftpTitle', { name: '<dev> & {{host}}', number: 3 })).toBe(
    'SFTP · <dev> & {{host}} 3',
  );
  expect(i18n.t('terminal.sshHost', { host: '用户@example.com' })).toBe('SSH · 用户@example.com');
  expect(i18n.t('terminal.session', { number: '01' })).toBe('SESSION 01');
});

test('translations and plural rules work in a runtime without Intl', async () => {
  rstest.resetModules();
  rstest.stubGlobal('Intl', undefined);
  try {
    const { i18n: instance } = await import('../i18n');
    const translate = instance.t.bind(instance);
    expect(typeof Intl.PluralRules).toBe('function');
    expect(translate('tabs.count', { count: 1 })).toBe('1 tab');
    expect(translate('tabs.count', { count: 0 })).toBe('0 tabs');
    expect(translate('tabs.count', { count: 2 })).toBe('2 tabs');
  } finally {
    rstest.unstubAllGlobals();
    rstest.resetModules();
  }
});

test('mounted components update on language changes and unsubscribe on unmount', async () => {
  // A test-only locale exercises switching; production still ships only English.
  i18n.addResourceBundle('de', 'translation', {
    status: {
      summary: '{{workspaces}} / {{tabs}}',
      workspaces_one: '{{count}} workspace',
      ready: 'Translated ready',
    },
    tabs: { count_one: '{{count}} terminal' },
  });
  const off = rstest.spyOn(i18n, 'off');
  const { unmount } = render(<StatusBar workspaceCount={1} tabCount={1} />, {
    enableMainThread: true,
  });
  try {
    expect(
      elementTree.root!.querySelector('[data-automation-id=session-summary]')?.textContent,
    ).toBe('1 workspace open · 1 tab');
    await act(async () => {
      await i18n.changeLanguage('de');
    });
    expect(
      elementTree.root!.querySelector('[data-automation-id=session-summary]')?.textContent,
    ).toBe('1 workspace / 1 terminal');
    expect(elementTree.root!.textContent).toContain('Translated ready');
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    expect(
      elementTree.root!.querySelector('[data-automation-id=session-summary]')?.textContent,
    ).toBe('1 workspace open · 1 tab');
    unmount();
    expect(off).toHaveBeenCalledWith('languageChanged', expect.any(Function));
  } finally {
    unmount();
    await i18n.changeLanguage('en');
    i18n.removeResourceBundle('de', 'translation');
    off.mockRestore();
  }
});
