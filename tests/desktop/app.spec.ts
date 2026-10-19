import { _electron as electron, type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { demoDatabase } from '../../src/demo';
import { setLocale, tr } from '../../shared/i18n';
import { databaseSchema, emptyDatabase } from '../../shared/model';
import { createStoriesTransfer } from '../../shared/transfer';
import { messages as creatorMessages } from '../../modules/investigation-creator/messages';
import { emptyPlan } from '../../shared/legacy-investigation';
import { convergingInvestigation, convergingNames } from '../fixtures/converging';
import { parentsOf } from '../../shared/investigation';

let app: ElectronApplication, page: Page, directory: string;
const root = process.cwd();

async function launch(locale: 'en' | 'ru' = 'en', data?: unknown) {
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
  // The group includes a non-interactive label; target the circle at any SVG scale.
  const node = page.locator(`[data-node-id="${id}"]`);
  await node.hover();
  const box = await node.locator('circle').first().boundingBox();
  if (!box) throw new Error('Missing node');
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  // Convert board units to screen pixels so drag distances are independent of viewport and zoom.
  const delta = await node.evaluate(
    (element, { dx, dy }) => {
      const matrix = (element as SVGGElement).ownerSVGElement?.getScreenCTM();
      if (!matrix) throw new Error('Missing diagram transform');
      return { x: matrix.a * dx + matrix.c * dy, y: matrix.b * dx + matrix.d * dy };
    },
    { dx, dy },
  );
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta.x, y + delta.y, { steps: 10 });
  await page.mouse.up();
}

test.afterEach(async () => {
  await app?.close();
});

for (const locale of ['en', 'ru'] as const) {
  test(`bulk deletion is scoped to visible library objects and persists in ${locale}`, async () => {
    setLocale(locale);
    const data = demoDatabase();
    data.boards.push({ ...structuredClone(data.boards[0]), id: 'second' });
    const categories = [
      { kind: 'person', tab: 'navigation.characters' },
      { kind: 'evidence', tab: 'trace.evidenceTab' },
      { kind: 'location', tab: 'trace.locations' },
      { kind: 'event', tab: 'trace.events' },
    ] as const;
    const targets = categories.map((category) => {
      const nodes = data.characters.filter((node) => node.kind === category.kind).slice(0, 2);
      const folderId = `bulk-${category.kind}`;
      const folderName = `Bulk ${category.kind}`;
      data.folders.push({
        id: folderId,
        name: folderName,
        parentId: category.kind,
        kind: category.kind,
      });
      nodes.forEach((node, index) => {
        node.folderId = folderId;
        node.name = `Batch ${category.kind} ${index + 1}`;
      });
      return { ...category, nodes, folderId, folderName };
    });
    await launch(locale, data);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.library-selection-toolbar')).toHaveCount(0);
    await expect(page.locator('.character-select')).toHaveCount(0);
    const selectTab = async (tab: (typeof categories)[number]['tab']) => {
      await page
        .locator('.rail')
        .getByRole('button', { name: tr(tab), exact: true })
        .click();
    };
    const removed = new Set<string>();
    for (const target of targets) {
      await selectTab(target.tab);
      const toolbar = page.getByRole('group', { name: tr('characters.selectionLabel') });
      await page
        .getByRole('checkbox', {
          name: tr('characters.selectLabel', target.nodes[0].name),
          exact: true,
        })
        .check();
      await expect(toolbar).toContainText(tr('characters.selectedCount', 1));
      await toolbar
        .getByRole('button', { name: tr('actions.clearSelection'), exact: true })
        .click();
      await expect(page.locator('.character-select:checked')).toHaveCount(0);

      await toolbar
        .getByRole('button', { name: tr('characters.selectAllVisible'), exact: true })
        .click();
      await page
        .getByRole('textbox', { name: tr('characters.searchLabel') })
        .fill(target.nodes[0].name);
      await expect(toolbar).toContainText(tr('characters.selectedCount', 0));
      await toolbar
        .getByRole('button', { name: tr('characters.selectAllVisible'), exact: true })
        .click();
      await expect(page.locator('.character-select:checked')).toHaveCount(1);
      await page.getByRole('textbox', { name: tr('characters.searchLabel') }).fill('');
      await expect(page.locator('.character-select:checked')).toHaveCount(0);

      // Match the leaf name without depending on translated ancestor names.
      await page
        .locator('.folder-navigation')
        .filter({ has: page.locator('span', { hasText: target.folderName }) })
        .click();
      await expect(page.locator('.character-card')).toHaveCount(2);
      await toolbar
        .getByRole('button', { name: tr('characters.selectAllVisible'), exact: true })
        .click();
      await selectTab(target.kind === 'person' ? 'trace.evidenceTab' : 'navigation.characters');
      await selectTab(target.tab);
      await expect(page.locator('.character-select:checked')).toHaveCount(0);
      await toolbar
        .getByRole('button', { name: tr('characters.selectAllVisible'), exact: true })
        .click();
      await toolbar
        .getByRole('button', { name: tr('characters.deleteSelected', 2), exact: true })
        .click();
      let dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(tr('characters.deleteSelectedMessage', 2));
      await dialog.getByRole('button', { name: tr('actions.cancel'), exact: true }).click();
      expect((await persisted()).characters).toEqual(
        data.characters.filter((node) => !removed.has(node.id)),
      );
      await expect(page.locator('.character-select:checked')).toHaveCount(2);
      await toolbar
        .getByRole('button', { name: tr('characters.deleteSelected', 2), exact: true })
        .click();
      dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: tr('actions.delete'), exact: true }).click();
      target.nodes.forEach((node) => removed.add(node.id));
      await expect(page.locator('.character-card')).toHaveCount(0);
      const saved = await persisted();
      expect(saved.characters).toEqual(data.characters.filter((node) => !removed.has(node.id)));
      expect(saved.folders).toEqual(data.folders);
      for (const board of saved.boards) {
        expect(board.characterIds).toEqual(
          data.boards[0].characterIds.filter((id) => !removed.has(id)),
        );
        for (const id of removed) expect(board.layout).not.toHaveProperty(id);
      }
    }
    await app.close();
    await reopen();
    expect((await persisted()).characters).toEqual(
      data.characters.filter((node) => !removed.has(node.id)),
    );
    await expect(page.locator('.library-selection-toolbar')).toHaveCount(0);
  });

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
  expect(saved.boards).toEqual(data.boards);
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
  await expect(page.locator('.investigation-creator-mode')).toBeVisible();
  await page
    .getByRole('button', { name: creatorMessages('ru')('backToBoard'), exact: true })
    .click();
  await page.getByRole('button', { name: tr('trace.story'), exact: true }).click();
  await expect(page.locator('.board-story p')).toHaveText(data.boards[0].description.split('\n'));
  await page.screenshot({ path: path.join(root, 'test-results/dead-witness-board.png') });
  await app.close();
  await reopen();
  expect((await persisted()).characters).toEqual(data.characters);
});

test('imports a case JSON into an existing library without replacing its board', async () => {
  const existing = emptyDatabase();
  existing.boards = [
    {
      id: 'existing',
      name: 'Existing case',
      description: 'User notes',
      characterIds: [],
      connections: [],
    },
  ];
  existing.activeBoardId = 'existing';
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
  expect(imported.boards).toHaveLength(2);
  expect(imported.boards[0]).toEqual(existing.boards[0]);
  expect(imported.characters).toEqual(incoming.characters);
  expect(imported.boards[1]).toEqual(incoming.boards[0]);
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
  await expect(page.locator('.investigation-creator-mode')).toBeVisible();
  await expect(page.locator('.editor-layout')).toHaveCount(0);
});

for (const { height, zoom } of [
  { height: 1000, zoom: 100 },
  { height: 950, zoom: 50 },
]) {
  test(`dragging, locking, independent board layouts and reopening preserve saved positions at ${height}px window height and ${zoom}% zoom`, async () => {
    setLocale('en');
    await launch('en', demoDatabase());
    await app.evaluate(
      ({ BrowserWindow }, height) => BrowserWindow.getAllWindows()[0].setSize(1500, height),
      height,
    );
    for (let current = 100; current > zoom; current -= 10)
      await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await expect(page.locator('.zoom-controls > span')).toHaveText(`${zoom}%`);
    await drag('domye');
    let data = await persisted();
    const first = data.boards[0].layout!.domye;
    expect(first.x).toBeCloseTo(235, 2);
    expect(first.y).toBeCloseTo(255, 2);
    await page.locator('[data-node-id="domye"]').click();
    await page.getByRole('button', { name: 'Lock position', exact: true }).click();
    await persisted();
    await drag('domye', 90, -30);
    data = await persisted();
    expect(data.boards[0].layout!.domye.x).toBe(first.x);
    expect(data.boards[0].layout!.domye.y).toBe(first.y);
    await page.getByRole('button', { name: 'Unlock position', exact: true }).click();
    await drag('domye', 30, 20);
    const moved = (await persisted()).boards[0].layout!.domye;
    expect(moved.x).toBeCloseTo(265, 2);
    expect(moved.y).toBeCloseTo(275, 2);
    const center = await page.locator('[data-node-id="__culprit__"]').getAttribute('transform');
    await drag('__culprit__');
    expect(await page.locator('[data-node-id="__culprit__"]').getAttribute('transform')).toBe(
      center,
    );
    // A new board uses an independent layout for the same library nodes.
    await page.getByRole('button', { name: 'New board', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Board name').fill('Second board');
    await page.getByRole('button', { name: 'Create board', exact: true }).click();
    await page
      .locator('.inspector')
      .getByRole('button', { name: 'Add nodes', exact: true })
      .click();
    await page.getByRole('dialog').getByRole('checkbox').first().check();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Add to board/ })
      .click();
    data = await persisted();
    expect(data.boards[1].layout).toEqual({});
    await page.locator('.board-list-item').first().click();
    await persisted();
    await app.close();
    await reopen();
    expect((await persisted()).boards[0].layout!.domye).toEqual(moved);
    await expect(page.locator('[data-node-id="domye"]')).toHaveAttribute(
      'transform',
      `translate(${moved.x}, ${moved.y})`,
    );
  });
}

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
  await dialog
    .getByRole('checkbox', {
      name: demoDatabase().characters.find((n) => n.id === 'apartment')!.name,
      exact: true,
    })
    .uncheck();
  await dialog
    .getByRole('checkbox', {
      name: demoDatabase().characters.find((n) => n.id === 'celine')!.name,
      exact: true,
    })
    .check();
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  expect((await persisted()).boards[0].layout!.door.parentId).toBe('celine');
  await page.locator('[data-node-id="domye"]').click();
  await page.locator('.inspector').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Suspect', { exact: true }).uncheck();
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes', exact: true }).click();
  await persisted();
  await expect(
    page.locator('.diagram-edge').filter({ has: page.locator('path[stroke="#4C9A2A"]') }),
  ).toHaveCount(3);
  await expect(
    page.locator('.diagram-edge').filter({ has: page.locator('path[stroke="#64748B"]') }),
  ).toHaveCount(2);
});

for (const locale of ['en', 'ru'] as const) {
  test(`three clues converge on one station through assembly, editing and restart in ${locale}`, async () => {
    setLocale(locale);
    const data = convergingInvestigation(),
      t = creatorMessages(locale);
    await launch(locale, data);
    await page.locator('[data-node-id="__culprit__"]').click();
    const mode = page.locator('.investigation-creator-mode');
    await mode
      .locator('footer')
      .getByRole('button', { name: t('assemble'), exact: true })
      .click();
    await expect(mode).toHaveCount(0);
    await expect(page.locator('[data-node-id="station"]')).toHaveCount(1);
    const incoming = () =>
      page.locator('.diagram-edge title').filter({ hasText: `→ ${convergingNames.station}:` });
    await expect(incoming()).toHaveCount(3);
    expect(parentsOf((await persisted()).boards[0], 'station').sort()).toEqual([
      'invoices',
      'navigator',
      'phone',
    ]);
    await page.screenshot({ path: `test-results/converging-station-${locale}.png` });
    await page.locator('[data-node-id="station"]').press('Enter');
    await page
      .locator('.inspector')
      .getByRole('button', { name: tr('actions.connect'), exact: true })
      .click();
    let dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('checkbox', { name: convergingNames.station, exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole('checkbox', { name: convergingNames.records, exact: true }),
    ).toHaveCount(1);
    await dialog.getByRole('checkbox', { name: convergingNames.invoices, exact: true }).uncheck();
    await dialog
      .getByRole('textbox', { name: tr('members.searchLabel'), exact: true })
      .fill(convergingNames.phone.slice(0, 4));
    await expect(
      dialog.getByRole('checkbox', { name: convergingNames.phone, exact: true }),
    ).toBeChecked();
    await dialog.getByRole('button', { name: tr('actions.connect'), exact: true }).click();
    await expect(incoming()).toHaveCount(2);
    expect(parentsOf((await persisted()).boards[0], 'station').sort()).toEqual([
      'navigator',
      'phone',
    ]);
    await app.close();
    await reopen();
    await expect(incoming()).toHaveCount(2);
    await page.locator('[data-node-id="station"]').press('Enter');
    await page
      .locator('.inspector')
      .getByRole('button', { name: tr('actions.connect'), exact: true })
      .click();
    dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('checkbox', { name: convergingNames.navigator, exact: true }),
    ).toBeChecked();
    await dialog.getByRole('checkbox', { name: convergingNames.invoices, exact: true }).check();
    await dialog.getByRole('button', { name: tr('actions.connect'), exact: true }).click();
    await expect(incoming()).toHaveCount(3);
    expect(parentsOf((await persisted()).boards[0], 'station')).toHaveLength(3);
  });
}

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
    .getByRole('button', { name: tr('navigation.boards'), exact: true })
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

test('short captions allow straight arrows and editing a caption restores the required detour', async () => {
  const data = emptyDatabase();
  data.characters = ['a', 'b', 'clue'].map((id, index) => ({
    id, name: ['Source', 'Target', 'Clue'][index], kind: 'evidence',
    color: '#D93846', notes: '', folderId: null,
  }));
  data.boards = [{
    id: 'routing', name: 'Caption routing', description: '',
    characterIds: ['a', 'b', 'clue'], connections: [],
    layout: {
      a: { x: 220, y: -100, parentId: '__culprit__' },
      b: { x: 700, y: 100, parentId: 'a' },
      clue: { x: 520, y: -54, parentId: 'a' },
    },
  }];
  data.activeBoardId = 'routing';
  await launch('en', data);
  const arrow = page.locator('[data-source-id="a"][data-target-id="b"] > path').first();
  await expect(arrow).toHaveAttribute('d', /^M [\d. -]+ L [\d. -]+$/);
  const straight = await arrow.getAttribute('d');
  await page.screenshot({ path: 'test-results/caption-straight.png' });

  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({
      canceled: false, filePath: process.env.TRACE_DATA_DIR + '/straight.svg',
    });
  });
  await page.getByRole('button', { name: tr('actions.export'), exact: true }).click();
  await page.getByRole('button', { name: new RegExp('SVG') }).click();
  await expect(page.locator('.toast')).toContainText('SVG');
  expect(await readFile(path.join(directory, 'straight.svg'), 'utf8')).toContain(`d="${straight}"`);

  await page.locator('[data-node-id="clue"]').click();
  await page.locator('.inspector').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name / title', { exact: true }).fill('WWWWWWWWWWWW');
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(arrow).not.toHaveAttribute('d', straight!);
  await page.screenshot({ path: 'test-results/caption-detour.png' });
  await persisted();
  await app.close();
  await reopen();
  await expect(page.locator('[data-source-id="a"][data-target-id="b"] > path').first())
    .not.toHaveAttribute('d', straight!);
});

test('portrait editing and board renaming preserve image metadata, answers and locked layout', async () => {
  setLocale('en');
  const data = demoDatabase();
  data.boards[0].layout!.domye.locked = true;
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
  expect(saved.boards[0].layout?.domye.locked).toBe(true);
  expect(saved.characters[0].answers?.alibi).toBe('Platform 2');
});

for (const [version, field] of [
  [3, 'circles'],
  [4, 'clubs'],
] as const) {
  test(`opens version ${version} ${field} JSON and saves boards without losing case content`, async () => {
    const current = demoDatabase();
    await launch('en', current);
    await app.close();
    const { boards, activeBoardId, ...rest } = current;
    const legacy = {
      ...rest,
      version,
      [field]: boards,
      [field === 'clubs' ? 'activeClubId' : 'activeCircleId']: activeBoardId,
    };
    await writeFile(path.join(directory, 'library.json'), JSON.stringify(legacy));
    await reopen();
    await expect(page.locator('.board-list-item')).toHaveCount(1);
    await expect(page.locator('[data-node-id="domye"]')).toBeVisible();
    await page.locator('.board-list-item').first().click();
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(path.join(directory, 'library.json'), 'utf8')).version,
      )
      .toBe(5);
    const saved = JSON.parse(await readFile(path.join(directory, 'library.json'), 'utf8'));
    expect(saved).toEqual(current);
    expect(saved).not.toHaveProperty('clubs');
    expect(saved).not.toHaveProperty('circles');
    expect(saved).not.toHaveProperty('activeClubId');
    expect(saved).not.toHaveProperty('activeCircleId');
    expect(
      JSON.parse(
        await readFile(
          path.join(
            directory,
            (await readdir(directory)).find((file) => file.includes('.pre-migration-'))!,
          ),
          'utf8',
        ),
      ),
    ).toEqual(legacy);
    await app.close();
    await reopen();
    expect(await persisted()).toEqual(current);
  });
}

for (const version of [4, 5]) {
  test(`opens version ${version} libraries automatically and retains investigation data after editing and reopening`, async () => {
    setLocale('en');
    const data = demoDatabase();
    data.boards[0].investigation = emptyPlan();
    data.boards[0].investigation.crime.motive = 'Retain this investigation material';
    const { boards, activeBoardId, ...rest } = data;
    const source =
      version === 4 ? { ...rest, version: 4, clubs: boards, activeClubId: activeBoardId } : data;
    await launch('en', source);
    await expect(page.locator('.diagram-node')).toHaveCount(data.boards[0].characterIds.length + 1);
    if (version === 4) {
      const originals = (await readdir(directory)).filter((file) =>
        file.includes('.pre-migration-'),
      );
      expect(originals).toHaveLength(1);
      expect(JSON.parse(await readFile(path.join(directory, originals[0]), 'utf8'))).toEqual(
        source,
      );
    }
    await page.getByRole('button', { name: 'Board actions', exact: true }).click();
    await page.getByRole('button', { name: 'Edit board', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Board name').fill('Migrated investigation');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Save changes', exact: true })
      .click();
    const saved = await persisted();
    expect(saved.version).toBe(5);
    expect(saved.boards[0].investigation).toEqual(data.boards[0].investigation);
    expect(saved).not.toHaveProperty('clubs');
    await app.close();
    await reopen();
    expect((await persisted()).boards[0].investigation).toEqual(data.boards[0].investigation);
  });
}
