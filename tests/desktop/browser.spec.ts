import {
  _electron as electron,
  type ElectronApplication,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { setLocale, tr } from '../../shared/i18n';

let app: ElectronApplication, page: Page;
test.beforeEach(async () => {
  setLocale('en');
  await mkdir('.test-data', { recursive: true });
  const directory = await mkdtemp(path.resolve('.test-data/qa-browser-'));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => value && key !== 'ELECTRON_RUN_AS_NODE'),
  ) as Record<string, string>;
  env.TRACE_DATA_DIR = directory;
  env.TRACE_DEV_URL = 'http://127.0.0.1:4173';
  app = await electron.launch({ args: [process.cwd()], env });
  await app.firstWindow();
  const opened = app.waitForEvent('window');
  await app.evaluate(async ({ BrowserWindow }) => {
    const browser = new BrowserWindow({
      width: 1500,
      height: 1000,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: 'browser-qa',
      },
    });
    await browser.loadURL('http://127.0.0.1:4173');
  });
  page = await opened;
  expect(
    await page.evaluate(() => typeof (window as unknown as { desktop?: unknown }).desktop),
  ).toBe('undefined');
  await expect(page.locator('.save-status')).toHaveText(tr('save.saved'));
});
test.afterEach(async () => {
  await app?.close();
});

test('browser fallback creates nodes in IndexedDB and preserves them after reload', async () => {
  await page.getByRole('button', { name: tr('clubs.createFirst'), exact: true }).click();
  await page.getByRole('dialog').getByLabel(tr('clubs.nameLabel')).fill('Browser QA board');
  await page.getByRole('dialog').locator('button[type=submit]').click();
  await page
    .locator('.inspector')
    .getByRole('button', { name: tr('trace.newNode'), exact: true })
    .click();
  await page.getByRole('dialog').getByLabel(tr('characters.nameLabel')).fill('Browser QA node');
  await page.getByRole('dialog').getByLabel(tr('trace.question.alibi')).fill('Stored in IndexedDB');
  await page.getByRole('dialog').locator('button[type=submit]').click();
  await expect(page.locator('.save-status')).toHaveText(tr('save.saved'));
  await page.reload();
  await expect(page.locator('.diagram-node')).toHaveCount(2);
  await page.locator('.diagram-node:not(.culprit-node)').press('Enter');
  await expect(page.locator('.node-answers')).toContainText('Stored in IndexedDB');
});

test('browser malformed transfer import preserves IndexedDB and shows an error', async () => {
  await page.getByRole('button', { name: tr('demo.explore'), exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText(tr('save.saved'));
  await page.getByRole('button', { name: tr('actions.export'), exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: new RegExp(tr('transfer.import')) }).click();
  await (
    await chooser
  ).setFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{invalid'),
  });
  await expect(page.locator('.toast')).toBeVisible();
  await page.reload();
  await expect(page.locator('.diagram-node')).toHaveCount(33);
});
