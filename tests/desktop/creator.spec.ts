import { _electron as electron, type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { demoDatabase } from '../../src/demo';
import { setLocale, tr } from '../../shared/i18n';
import { type Database, databaseSchema, emptyDatabase } from '../../shared/model';
import { messages } from '../../modules/investigation-creator/messages';

let app: ElectronApplication, page: Page, directory: string;

async function launch(data: Database, locale: 'ru' | 'en') {
  await mkdir('.test-data', { recursive: true });
  directory = await mkdtemp(path.resolve('.test-data/creator-'));
  await writeFile(path.join(directory, 'library.json'), JSON.stringify(data));
  await writeFile(path.join(directory, 'preferences.json'), JSON.stringify({ language: locale }));
  await reopen();
}

async function reopen() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => value && key !== 'ELECTRON_RUN_AS_NODE'),
  ) as Record<string, string>;
  env.TRACE_DATA_DIR = directory;
  app = await electron.launch({ args: [process.cwd()], env });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 1000));
  await expect(page.locator('.save-status')).toHaveText(tr('save.saved'));
}

async function persisted() {
  await expect(page.locator('.save-status')).toHaveText(tr('save.saved'));
  return databaseSchema.parse(
    JSON.parse(await readFile(path.join(directory, 'library.json'), 'utf8')),
  );
}

test.afterEach(async () => {
  await app?.close();
});

for (const locale of ['en', 'ru'] as const) {
  test(`empty board opens an instructor; adding a node changes the next entry to checker in ${locale}`, async () => {
    setLocale(locale);
    const t = messages(locale),
      data = emptyDatabase();
    data.boards = [
      { id: 'new-case', name: 'New case', description: '', characterIds: [], connections: [] },
    ];
    data.activeBoardId = 'new-case';
    await launch(data, locale);
    await page.locator('[data-node-id="__culprit__"]').press('Enter');
    const mode = page.locator('.investigation-creator-mode');
    await expect(mode).toBeVisible();
    await expect(page.locator('.editor-layout')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(mode.locator('nav button[aria-current]')).toContainText(t('crime'));
    await mode
      .getByRole('button', { name: `${t('newNode')} · ${t('person')}`, exact: true })
      .click();
    await mode.getByLabel(tr('characters.nameLabel')).fill('Witness');
    await mode.locator('button[type=submit]').click();
    await mode.getByLabel(t('motive'), { exact: true }).fill('An authored motive');
    await mode.getByRole('button', { name: t('next'), exact: true }).click();
    await expect(mode.locator('nav button[aria-current]')).toContainText(t('matrix'));
    await mode.getByRole('button', { name: t('backToBoard'), exact: true }).click();
    expect((await persisted()).characters[0].name).toBe('Witness');
    await page.locator('[data-node-id="__culprit__"]').click();
    await expect(mode.locator('.creator-mode-heading')).toContainText(t('auditTitle'));
    await expect(mode.locator('nav button[aria-current]')).toContainText(t('completeness'));
    await expect(mode.getByRole('button', { name: t('next'), exact: true })).toHaveCount(0);
    await mode.getByRole('button', { name: t('backToBoard'), exact: true }).click();
    await app.close();
    await reopen();
    expect((await persisted()).boards[0].investigation!.crime.motive).toBe('An authored motive');
  });
  test(`populated example opens checker and accepts fewer than three clues in ${locale}`, async () => {
    setLocale(locale);
    const t = messages(locale),
      data = demoDatabase();
    await launch(data, locale);
    await page.locator('[data-node-id="__culprit__"]').click();
    const mode = page.locator('.investigation-creator-mode');
    await expect(mode.locator('nav button[aria-current]')).toContainText(t('completeness'));
    await expect(mode.locator('.ic-report .ic-issue.error')).toHaveCount(0);
    await expect(mode.locator('.ic-report')).toContainText(
      data.characters.find((n) => n.id === 'archive')!.name,
    );
    await mode
      .locator('nav')
      .getByRole('button', { name: t('matrix'), exact: true })
      .click();
    const links = mode
      .locator('.ic-section')
      .filter({ has: page.getByRole('heading', { name: new RegExp(`^${t('evidence')}`) }) });
    await links.locator('summary').first().click();
    await links
      .locator('details[open]')
      .getByRole('textbox', { name: t('explanation'), exact: true })
      .fill('Edited clue interpretation');
    await mode.getByRole('button', { name: t('save'), exact: true }).click();
    expect((await persisted()).boards[0].investigation!.evidence[0].explanation).toBe(
      'Edited clue interpretation',
    );
    await mode.getByRole('button', { name: t('backToBoard'), exact: true }).click();
    await app.close();
    await reopen();
    await page.locator('[data-node-id="__culprit__"]').click();
    await expect(
      page.locator('.investigation-creator-mode nav button[aria-current]'),
    ).toContainText(t('completeness'));
    expect((await persisted()).boards[0].investigation!.evidence[0].explanation).toBe(
      'Edited clue interpretation',
    );
    await page.screenshot({ path: `test-results/creator-checker-${locale}.png` });
  });
}
