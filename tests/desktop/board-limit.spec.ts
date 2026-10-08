import {
  _electron as electron,
  type ElectronApplication,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setLocale, tr } from '../../shared/i18n';
import { stressDatabase } from '../stress-fixtures';
import { createStoriesTransfer } from '../../shared/transfer';

let app: ElectronApplication, page: Page, directory: string;

async function launch(count: number, locale: 'en' | 'ru' = 'en') {
  setLocale(locale);
  await mkdir('.test-data', { recursive: true });
  directory = await mkdtemp(path.resolve('.test-data/qa-board-limit-'));
  await writeFile(path.join(directory, 'preferences.json'), JSON.stringify({ language: locale }));
  await writeFile(path.join(directory, 'library.json'), JSON.stringify(stressDatabase(1, count)));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => value && key !== 'ELECTRON_RUN_AS_NODE'),
  ) as Record<string, string>;
  env.TRACE_DATA_DIR = directory;
  const executablePath = process.env.TRACE_TEST_EXECUTABLE;
  app = await electron.launch({ executablePath, args: executablePath ? [] : [process.cwd()], env });
  page = await app.firstWindow();
  await expect(page.locator('.save-status')).toHaveText(tr('save.saved'));
}

async function saved() {
  await expect(page.locator('.save-status')).toHaveText(tr('save.saved'));
  return JSON.parse(await readFile(path.join(directory, 'library.json'), 'utf8'));
}

test.afterEach(async () => {
  await app?.close();
});

for (const locale of ['en', 'ru'] as const) {
  test(`board creation and duplication stop at 100; editing and deletion still work in ${locale}`, async () => {
    await launch(99, locale);
    await page.locator('.new-club').click();
    await page.getByRole('dialog').getByLabel(tr('clubs.nameLabel')).fill('Board 100');
    await page.getByRole('dialog').locator('button[type=submit]').click();
    expect((await saved()).clubs).toHaveLength(100);
    await expect(page.locator('.new-club')).toBeDisabled();
    await expect(page.getByText(tr('validation.boardLimit', 100), { exact: true })).toBeVisible();
    await page.getByRole('button', { name: tr('clubs.actionsLabel'), exact: true }).click();
    await expect(
      page.getByRole('button', { name: tr('actions.duplicate'), exact: true }),
    ).toBeDisabled();
    await page.getByRole('button', { name: tr('clubs.edit'), exact: true }).click();
    await page.getByRole('dialog').getByLabel(tr('clubs.nameLabel')).fill('Edited at limit');
    await page.getByRole('dialog').locator('button[type=submit]').click();
    expect((await saved()).clubs.at(-1).name).toBe('Edited at limit');
    await page.getByRole('button', { name: tr('clubs.actionsLabel'), exact: true }).click();
    await page.getByRole('button', { name: tr('clubs.delete'), exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: tr('actions.delete'), exact: true })
      .click();
    expect((await saved()).clubs).toHaveLength(99);
    await expect(page.locator('.new-club')).toBeEnabled();
    await page.getByRole('button', { name: tr('clubs.actionsLabel'), exact: true }).click();
    await page.getByRole('button', { name: tr('actions.duplicate'), exact: true }).click();
    expect((await saved()).clubs).toHaveLength(100);
    await expect(page.locator('.new-club')).toBeDisabled();
  });
}

test('older libraries above 100 boards open and remain editable', async () => {
  await launch(101);
  await expect(page.locator('.club-list-item')).toHaveCount(101);
  await expect(page.locator('.new-club')).toBeDisabled();
  await page.getByRole('button', { name: tr('clubs.actionsLabel'), exact: true }).click();
  await page.getByRole('button', { name: tr('clubs.edit'), exact: true }).click();
  await page.getByRole('dialog').getByLabel(tr('clubs.nameLabel')).fill('Legacy board');
  await page.getByRole('dialog').locator('button[type=submit]').click();
  expect((await saved()).clubs).toHaveLength(101);
  expect((await saved()).clubs[0].name).toBe('Legacy board');
});

test('import cannot create board 101 and leaves the current library intact', async () => {
  await launch(100);
  const before = await saved();
  const incoming = stressDatabase(1);
  incoming.clubs[0].id = 'incoming';
  incoming.clubs[0].name = 'Incoming';
  incoming.activeClubId = 'incoming';
  const filePath = path.join(directory, 'incoming.json');
  await writeFile(filePath, JSON.stringify(createStoriesTransfer(incoming)));
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, filePath);
  await page.getByRole('button', { name: tr('actions.export'), exact: true }).click();
  await page.getByRole('button', { name: new RegExp(tr('transfer.import')) }).click();
  await expect(page.locator('.toast')).toContainText(tr('validation.boardLimit', 100));
  expect(await saved()).toEqual(before);
});
