import {
  _electron as electron,
  type ElectronApplication,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { demoDatabase } from '../../src/demo';
import { setLocale, tr } from '../../shared/i18n';
import { type Database, databaseSchema, emptyDatabase } from '../../shared/model';
import { createStoriesTransfer } from '../../shared/transfer';

let app: ElectronApplication, page: Page, directory: string;
const root = process.cwd();

async function launch(locale: 'en' | 'ru' = 'en', data?: Database) {
  await mkdir(path.join(root, '.test-data'), { recursive: true });
  directory = await mkdtemp(path.join(root, '.test-data', 'trace-'));
  await writeFile(path.join(directory, 'preferences.json'), JSON.stringify({ language: locale }));
  if (data) await writeFile(path.join(directory, 'library.json'), JSON.stringify(data));
  await reopen();
}

async function reopen() {
  setLocale(JSON.parse(await readFile(path.join(directory, 'preferences.json'), 'utf8')).language);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (value && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  env.TRACE_DATA_DIR = directory;
  const executablePath = process.env.TRACE_TEST_EXECUTABLE;
  app = await electron.launch({ executablePath, args: executablePath ? [] : [root], env });
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

async function drag(id: string, dx = 75, dy = 45) {
  const node = page.locator(`[data-node-id="${id}"]`);
  const box = await node.boundingBox();
  if (!box) throw new Error('Missing node');
  const x = box.x + box.width / 2,
    y = box.y + 32;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}

test.afterEach(async () => {
  await app?.close();
});

for (const locale of ['en', 'ru'] as const) {
  test(`folders stay isolated by category through creation, editing and reopen in ${locale}`, async () => {
    await launch(locale);
    const categories = [
      { kind: 'person', tab: 'navigation.characters', create: 'characters.new' },
      { kind: 'evidence', tab: 'trace.evidenceTab', create: 'trace.evidenceNew' },
      { kind: 'location', tab: 'trace.locations', create: 'trace.locationNew' },
      { kind: 'event', tab: 'trace.events', create: 'trace.eventNew' },
    ] as const;
    const selectCategory = async (category: (typeof categories)[number]) => {
      await page
        .locator('.rail')
        .getByRole('button', { name: tr(category.tab), exact: true })
        .click();
    };
    for (const category of categories) {
      await selectCategory(category);
      await expect(page.locator('.folder-row')).toHaveCount(0);
      await page
        .getByRole('button', { name: tr('folders.createCharacterFolder'), exact: true })
        .click();
      let dialog = page.getByRole('dialog');
      await expect(dialog.getByLabel(tr('folders.parentLabel')).locator('option')).toHaveCount(1);
      await dialog.getByLabel(tr('folders.nameLabel')).fill('Case folders');
      await dialog.getByRole('button', { name: tr('folders.create'), exact: true }).click();
      await persisted();
      await page
        .getByRole('button', {
          name: tr('folders.createSubfolderLabel', 'Case folders'),
          exact: true,
        })
        .click();
      dialog = page.getByRole('dialog');
      await expect(dialog.getByLabel(tr('folders.parentLabel')).locator('option')).toHaveCount(2);
      await dialog.getByLabel(tr('folders.nameLabel')).fill(`Only ${category.kind}`);
      await dialog.getByRole('button', { name: tr('folders.create'), exact: true }).click();
      await persisted();
      await expect(page.locator('.folder-row')).toHaveCount(2);
      await page
        .locator('.header-actions')
        .getByRole('button', { name: tr(category.create), exact: true })
        .click();
      dialog = page.getByRole('dialog');
      const folderSelect = dialog.getByLabel(tr('characters.folderLabel'));
      await expect(folderSelect.locator('option')).toHaveText([
        tr('folders.unfiled'),
        'Case folders',
        `Case folders / Only ${category.kind}`,
      ]);
      const saved = await persisted();
      const child = saved.folders.find((folder) => folder.name === `Only ${category.kind}`)!;
      await expect(folderSelect).toHaveValue(child.id);
      await dialog.getByLabel(tr('characters.nameLabel')).fill(`Node ${category.kind}`);
      await dialog.getByRole('button', { name: tr('characters.create'), exact: true }).click();
      await persisted();
    }
    for (const category of categories) {
      await selectCategory(category);
      await expect(page.locator('.folder-row')).toHaveCount(2);
      await expect(page.locator('.folder-row.active')).toContainText(`Only ${category.kind}`);
      await expect(page.locator('.character-card h2')).toHaveText([`Node ${category.kind}`]);
    }
    await selectCategory(categories[0]);
    await page
      .getByRole('button', { name: tr('characters.editLabel', 'Node person'), exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(tr('trace.kind')).selectOption('evidence');
    await expect(dialog.getByLabel(tr('characters.folderLabel'))).toHaveValue('');
    await expect(dialog.getByLabel(tr('characters.folderLabel')).locator('option')).toHaveText([
      tr('folders.unfiled'),
      'Case folders',
      'Case folders / Only evidence',
    ]);
    await dialog.getByRole('button', { name: tr('actions.saveChanges'), exact: true }).click();
    const data = await persisted();
    expect(data.folders).toHaveLength(8);
    expect(data.characters.find((node) => node.name === 'Node person')?.folderId).toBeNull();
    await app.close();
    await reopen();
    for (const category of categories) {
      await selectCategory(category);
      await expect(page.locator('.folder-row')).toHaveCount(2);
      const names = await page
        .locator('.folder-row .folder-navigation > span:not(.count)')
        .allTextContents();
      expect(names).toEqual(['Case folders', `Only ${category.kind}`]);
    }
    expect((await persisted()).folders).toEqual(data.folders);
  });
}

test('opens a legacy shared folder tree as independent category trees and saves the migration', async () => {
  setLocale('en');
  const data = demoDatabase();
  data.folders = [
    { id: 'legacy-case', name: 'Old case', parentId: null },
    ...data.folders
      .filter((folder) => data.characters.some((node) => node.folderId === folder.id))
      .map(({ kind: _kind, ...folder }) => ({ ...folder, parentId: 'legacy-case' })),
  ];
  await launch('en', data);
  for (const [kind, tab] of [
    ['person', 'navigation.characters'],
    ['evidence', 'trace.evidenceTab'],
    ['location', 'trace.locations'],
    ['event', 'trace.events'],
  ] as const) {
    await page
      .locator('.rail')
      .getByRole('button', { name: tr(tab), exact: true })
      .click();
    await expect(page.locator('.folder-row')).toHaveCount(2);
    await expect(page.locator('.character-card')).toHaveCount(
      data.characters.filter((node) => node.kind === kind).length,
    );
    const folder = data.folders.find((folder) => folder.id === kind)!;
    await expect(page.locator('.folder-row .folder-navigation > span:not(.count)')).toHaveText([
      'Old case',
      folder.name,
    ]);
  }
  await page
    .getByRole('button', { name: tr('folders.createSubfolderLabel', 'Old case'), exact: true })
    .click();
  await page.getByRole('dialog').getByLabel(tr('folders.nameLabel')).fill('New event folder');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: tr('folders.create'), exact: true })
    .click();
  const saved = await persisted();
  expect(saved.characters).toEqual(data.characters);
  expect(saved.clubs).toEqual(data.clubs);
  expect(saved.folders).toHaveLength(9);
  expect(saved.folders.find((folder) => folder.name === 'New event folder')?.kind).toBe('event');
  await app.close();
  await reopen();
  await page
    .locator('.rail')
    .getByRole('button', { name: tr('trace.events'), exact: true })
    .click();
  await expect(page.locator('.folder-row')).toHaveCount(3);
  expect((await persisted()).folders).toEqual(saved.folders);
});

test('loads the dead witness example from onboarding with all guiding answers and saves it on reopen', async () => {
  await launch('ru');
  await page.getByRole('button', { name: tr('demo.explore'), exact: true }).click();
  const data = await persisted();
  expect(data.characters).toHaveLength(32);
  await expect(page.locator('.diagram-node')).toHaveCount(33);
  await expect(page.locator('.diagram-edge')).toHaveCount(32);
  for (const node of data.characters) {
    await page.locator(`[data-node-id="${node.id}"]`).click();
    await expect(page.locator('.node-answers > div')).toHaveCount(5);
    await expect(page.locator('.node-answers p')).toHaveText(Object.values(node.answers!));
  }
  await page.locator('[data-node-id="domye"]').click();
  await page
    .locator('.inspector')
    .getByRole('button', { name: tr('actions.edit'), exact: true })
    .click();
  await expect(page.getByRole('dialog').getByLabel(tr('trace.question.alibi'))).toHaveValue(
    data.characters[0].answers!.alibi,
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: tr('actions.cancel'), exact: true })
    .click();
  await page.locator('[data-node-id="__culprit__"]').click();
  await page.getByRole('button', { name: tr('actions.clearSelection'), exact: true }).click();
  await page.getByRole('button', { name: tr('trace.story'), exact: true }).click();
  await expect(page.locator('.board-story p')).toHaveText(data.clubs[0].description.split('\n'));
  await page.screenshot({ path: path.join(root, 'test-results/dead-witness-board.png') });
  await app.close();
  await reopen();
  expect((await persisted()).characters).toEqual(data.characters);
});

test('imports a case JSON into an existing library without replacing its board', async () => {
  const existing = emptyDatabase();
  existing.clubs = [
    {
      id: 'existing',
      name: 'Existing case',
      description: 'User notes',
      characterIds: [],
      connections: [],
    },
  ];
  existing.activeClubId = 'existing';
  await launch('ru', existing);
  const incoming = demoDatabase();
  const file = path.join(directory, 'incoming.trace.json');
  await writeFile(file, JSON.stringify(createStoriesTransfer(incoming)));
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, file);
  await page
    .locator('.rail')
    .getByRole('button', { name: tr('navigation.settings'), exact: true })
    .click();
  await page.getByRole('button', { name: tr('transfer.import'), exact: true }).click();
  await expect(page.locator('.toast')).toContainText(String(incoming.characters.length));
  const imported = await persisted();
  expect(imported.clubs).toHaveLength(2);
  expect(imported.clubs[0]).toEqual(existing.clubs[0]);
  expect(imported.characters).toEqual(incoming.characters);
  expect(imported.clubs[1]).toEqual(incoming.clubs[0]);
});

test('create a board, all node types, guiding answers and both person roles without a relationship editor', async () => {
  await launch();
  await expect(page).toHaveTitle('Trace');
  await expect(page.getByRole('button', { name: 'Relationships', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Board name').fill('A missing passenger');
  await dialog.getByRole('button', { name: 'Create board', exact: true }).click();
  await expect(page.locator('[data-node-id="__culprit__"]')).toBeVisible();
  for (const kind of ['person', 'evidence', 'location', 'event']) {
    await page.locator('.inspector').getByRole('button', { name: 'New node', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Node type').selectOption(kind);
    await dialog.getByLabel('Name / title').fill(`Test ${kind}`);
    await expect(dialog.locator('.question-heading')).toContainText('Guiding questions');
    const questions = dialog.locator('textarea');
    await expect(questions).toHaveCount(6);
    await questions.first().fill(`Facts about ${kind}`);
    if (kind === 'person') await dialog.getByLabel('Witness', { exact: true }).check();
    await dialog.getByRole('button', { name: 'Create node', exact: true }).click();
    await persisted();
  }
  const data = await persisted();
  expect(data.characters).toHaveLength(4);
  expect(data.characters[0].suspect && data.characters[0].witness).toBe(true);
  expect(data.characters[1].answers?.found).toBe('Facts about evidence');
  await expect(page.locator('.diagram-node')).toHaveCount(5);
  await expect(page.locator('.diagram-edge')).toHaveCount(4);
  await page.locator('[data-node-id="__culprit__"]').click();
  await expect(page.locator('.inspector')).toContainText('Fixed at the center');
});

test('dragging, locking, independent board layouts and reopening preserve saved positions', async () => {
  setLocale('en');
  await launch('en', demoDatabase());
  await drag('domye');
  let data = await persisted();
  const first = data.clubs[0].layout!.domye;
  expect(first.x).not.toBe(160);
  await page.locator('[data-node-id="domye"]').click();
  await page.getByRole('button', { name: 'Lock position', exact: true }).click();
  await persisted();
  await drag('domye', 90, -30);
  data = await persisted();
  expect(data.clubs[0].layout!.domye.x).toBe(first.x);
  await page.getByRole('button', { name: 'Unlock position', exact: true }).click();
  await drag('domye', 30, 20);
  const moved = (await persisted()).clubs[0].layout!.domye;
  expect(moved.x).not.toBe(first.x);
  const center = await page.locator('[data-node-id="__culprit__"]').getAttribute('transform');
  await drag('__culprit__');
  expect(await page.locator('[data-node-id="__culprit__"]').getAttribute('transform')).toBe(center);
  // A new board uses an independent layout for the same library nodes.
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Board name').fill('Second board');
  await page.getByRole('button', { name: 'Create board', exact: true }).click();
  await page.locator('.inspector').getByRole('button', { name: 'Add nodes', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox').first().check();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Add to board/ })
    .click();
  data = await persisted();
  expect(data.clubs[1].layout).toEqual({});
  await page.locator('.club-list-item').first().click();
  await persisted();
  await app.close();
  await reopen();
  expect((await persisted()).clubs[0].layout!.domye).toEqual(moved);
  await expect(page.locator('[data-node-id="domye"]')).toHaveAttribute(
    'transform',
    `translate(${moved.x}, ${moved.y})`,
  );
});

test('branch editing updates the tree and automatic colors, then changing roles updates person colors', async () => {
  setLocale('en');
  await launch('en', demoDatabase());
  await expect(
    page.locator('.diagram-edge').filter({ has: page.locator('path[stroke="#D93846"]') }),
  ).toHaveCount(demoDatabase().characters.filter((n) => n.kind === 'evidence').length);
  await expect(
    page.locator('.diagram-edge').filter({ has: page.locator('path[stroke="#E68A22"]') }),
  ).toHaveCount(demoDatabase().characters.filter((n) => n.kind === 'location').length);
  await page.locator('[data-node-id="door"]').click();
  await page.locator('.inspector').getByRole('button', { name: 'Connect', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Attach to', { exact: false }).selectOption('celine');
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  expect((await persisted()).clubs[0].layout!.door.parentId).toBe('celine');
  await page.locator('[data-node-id="domye"]').click();
  await page.locator('.inspector').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Suspect', { exact: true }).uncheck();
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes', exact: true }).click();
  await persisted();
  await expect(
    page.locator('.diagram-edge').filter({ has: page.locator('path[stroke="#4C9A2A"]') }),
  ).toHaveCount(4);
});

test('localized tabs, role filters, screenshots and SVG/PNG exports work in Electron', async () => {
  setLocale('en');
  await launch('en', demoDatabase());
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mkdir(path.join(root, 'docs', 'screenshots'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'docs/screenshots/trace-en.png') });
  await page.locator('.rail').getByRole('button', { name: 'People', exact: true }).click();
  await expect(page.locator('.character-card')).toHaveCount(7);
  await page.getByRole('button', { name: 'Witnesses', exact: true }).click();
  await expect(page.locator('.character-card')).toHaveCount(7);
  await page.getByRole('button', { name: 'Suspects', exact: true }).click();
  await expect(page.locator('.character-card')).toHaveCount(4);
  for (const [label, kind] of [
    ['Evidence', 'evidence'],
    ['Locations', 'location'],
    ['Events', 'event'],
  ]) {
    await page.locator('.rail').getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator('.character-card')).toHaveCount(
      demoDatabase().characters.filter((n) => n.kind === kind).length,
    );
  }
  await page.locator('.rail').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Interface language', { exact: true }).selectOption('ru');
  setLocale('ru');
  await expect(page).toHaveTitle(tr('app.name'));
  await page
    .locator('.rail')
    .getByRole('button', { name: tr('navigation.clubs'), exact: true })
    .click();
  await page.screenshot({ path: path.join(root, 'docs/screenshots/trace-ru.png') });
  await page.locator('[data-node-id="door"]').click();
  await expect(page.locator('.inspector')).toContainText(tr('trace.question.found'));
  await page.screenshot({ path: path.join(root, 'docs/screenshots/trace-evidence-ru.png') });
  // Invoke the real renderer exporter while intercepting only the save dialog.
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: process.env.TRACE_DATA_DIR + '/board.svg',
    });
  });
  await page.getByRole('button', { name: tr('actions.export'), exact: true }).click();
  await page.getByRole('button', { name: new RegExp('SVG') }).click();
  await expect(page.locator('.toast')).toContainText('SVG');
  const svg = await readFile(path.join(directory, 'board.svg'), 'utf8');
  expect(svg).toContain(tr('trace.culprit'));
  expect(svg).not.toMatch(/NaN|Infinity/);
  expect(svg).toContain('#D93846');
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: process.env.TRACE_DATA_DIR + '/board.png',
    });
  });
  await page.getByRole('button', { name: tr('actions.export'), exact: true }).click();
  await page.getByRole('button', { name: new RegExp('PNG') }).click();
  await expect(page.locator('.toast')).toContainText('PNG');
  const png = await readFile(path.join(directory, 'board.png'));
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(errors).toEqual([]);
  // Capture localized example content in a separate test profile for documentation.
  await app.close();
  setLocale('ru');
  await launch('ru', demoDatabase());
  await page.screenshot({ path: path.join(root, 'docs/screenshots/trace-ru.png') });
  await page.locator('[data-node-id="door"]').click();
  await page.screenshot({ path: path.join(root, 'docs/screenshots/trace-evidence-ru.png') });
});

test('portrait editing and board renaming preserve image metadata, answers and locked layout', async () => {
  setLocale('en');
  const data = demoDatabase();
  data.clubs[0].layout!.domye.locked = true;
  await launch('en', data);
  await page.locator('[data-node-id="domye"]').click();
  await page.locator('.inspector').getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type=file]').setInputFiles(path.join(root, 'resources/icon.png'));
  await dialog.getByRole('button', { name: 'Apply portrait', exact: true }).click();
  await dialog.getByLabel('Where were they at the relevant time?').fill('Platform 2');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect((await persisted()).characters[0].portrait?.source).toContain('data:image');
  await page.getByRole('button', { name: 'Board actions', exact: true }).click();
  await page.getByRole('button', { name: 'Edit board', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Board name').fill('Renamed investigation');
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes', exact: true }).click();
  const saved = await persisted();
  expect(saved.clubs[0].layout?.domye.locked).toBe(true);
  expect(saved.characters[0].answers?.alibi).toBe('Platform 2');
});
