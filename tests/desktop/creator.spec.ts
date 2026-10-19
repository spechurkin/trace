import { _electron as electron, type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { demoDatabase } from '../../src/demo';
import { setLocale, tr } from '../../shared/i18n';
import { type Board, type Database, databaseSchema, emptyDatabase } from '../../shared/model';
import { messages } from '../../modules/investigation-creator/messages';
import { emptyPlan } from '../../modules/investigation-creator/schema';
import { buildInvestigationDiagram } from '../../modules/investigation-creator/diagram';
import { applyCreatorDiagram } from '../../src/creator-diagram';
import { observationsInvestigation } from '../fixtures/observations';
import { pathCrossings } from '../diagram-metrics';
import { boardEdges, parentsOf } from '../../shared/investigation';
import { boardPositions } from '../../src/geometry';

let app: ElectronApplication, page: Page, directory: string;

async function launch(data: Database, locale: 'ru' | 'en') {
  await mkdir('.test-data', { recursive: true });
  directory = await mkdtemp(path.resolve('.test-data/creator-'));
  await writeFile(path.join(directory, 'library.json'), JSON.stringify(data));
  await writeFile(path.join(directory, 'preferences.json'), JSON.stringify({ language: locale }));
  await reopen();
}

test('autosaves collection additions, choices, numbers and removals, recovering after invalid input', async () => {
  setLocale('en');
  const t = messages('en'),
    data = demoDatabase();
  await launch(data, 'en');
  await page.locator('[data-node-id="__culprit__"]').click();
  const mode = page.locator('.investigation-creator-mode');
  await mode
    .locator('nav')
    .getByRole('button', { name: t('matrix'), exact: true })
    .click();
  const conclusions = mode.locator('.ic-section').filter({
    has: page.getByRole('heading', { name: new RegExp(`^${t('conclusions')}`) }),
  });
  const originalCount = data.boards[0].investigation!.conclusions.length;
  await conclusions.getByRole('button', { name: t('add'), exact: true }).click();
  await expect
    .poll(async () => (await persisted()).boards[0].investigation!.conclusions.length)
    .toBe(originalCount + 1);
  const row = conclusions.locator('details[open]');
  await row.getByLabel(t('required'), { exact: true }).check();
  await row.getByRole('combobox', { name: t('truth') }).selectOption('false');
  await row.getByLabel(t('threshold'), { exact: true }).fill('3');
  await expect
    .poll(async () => (await persisted()).boards[0].investigation!.conclusions.at(-1))
    .toMatchObject({ required: true, truth: 'false', threshold: 3 });

  await row.getByLabel(t('threshold'), { exact: true }).fill('');
  await expect(mode.locator('.ic-error')).toContainText(t('saveError'));
  expect((await persisted()).boards[0].investigation!.conclusions.at(-1)!.threshold).toBe(3);
  await row.getByLabel(t('threshold'), { exact: true }).fill('2');
  await expect
    .poll(async () => (await persisted()).boards[0].investigation!.conclusions.at(-1)!.threshold)
    .toBe(2);
  await expect(mode.locator('.ic-error')).toHaveCount(0);
  await row.getByRole('button', { name: t('remove'), exact: true }).click();
  await expect
    .poll(async () => (await persisted()).boards[0].investigation!.conclusions.length)
    .toBe(originalCount);
});

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

async function renderedCrossings() {
  const paths = await page.locator('.diagram-edge').evaluateAll((groups) =>
    groups.map((group) => {
      const path = group.querySelector<SVGPathElement>('path[marker-end]')!;
      const length = path.getTotalLength();
      return {
        sourceId: group.getAttribute('data-source-id')!,
        targetId: group.getAttribute('data-target-id')!,
        samples: Array.from({ length: 81 }, (_, i) => {
          const p = path.getPointAtLength((length * i) / 80);
          return { x: p.x, y: p.y };
        }),
      };
    }),
  );
  return pathCrossings(paths);
}

function longestLink(board: Board, data: Database) {
  const positions = boardPositions(board);
  return Math.max(
    0,
    ...boardEdges(board, data.characters).map((edge) => {
      const a = positions.get(edge.sourceId)!,
        b = positions.get(edge.targetId)!;
      return Math.hypot(a.x - b.x, a.y - b.y);
    }),
  );
}

test.afterEach(async () => {
  await app?.close();
});

for (const includeLocation of [false, true]) {
  test(`assembly follows edited ${includeLocation ? 'combined' : 'single'} discovery prerequisites instead of a shared location`, async () => {
    setLocale('ru');
    const t = messages('ru'),
      data = emptyDatabase(),
      plan = emptyPlan();
    data.characters = [
      {
        id: 'place',
        name: 'Workshop',
        kind: 'location',
        color: '#123456',
        notes: '',
        folderId: null,
      },
      {
        id: 'witness',
        name: 'Fabrice',
        kind: 'person',
        color: '#123456',
        notes: '',
        folderId: null,
      },
      {
        id: 'watch',
        name: 'Wristwatch',
        kind: 'evidence',
        color: '#123456',
        notes: '',
        folderId: null,
      },
    ];
    plan.entries = ['place'];
    plan.access = [
      {
        id: 'meet',
        targetId: 'witness',
        requires: ['place'],
        conclusions: [],
        method: 'Find the witness',
      },
    ];
    plan.evidence = [
      {
        id: 'watch-source',
        nodeId: 'watch',
        locationId: 'place',
        conclusionId: '',
        effect: 'supports',
        certainty: 'confirmed',
        explanation: '',
      },
    ];
    const board = applyCreatorDiagram(
      {
        id: 'case',
        name: 'Investigation',
        description: '',
        connections: [],
        characterIds: data.characters.map((n) => n.id),
        investigation: plan,
      },
      buildInvestigationDiagram(plan, data.characters),
    );
    expect(board.layout!.watch.parentId).toBe('place');
    expect(board.layout!.witness.parentId).toBe('place');
    data.boards = [board];
    data.activeBoardId = board.id;
    await launch(data, 'ru');
    await page.locator('[data-node-id="__culprit__"]').click();
    const mode = page.locator('.investigation-creator-mode');
    await mode
      .locator('nav')
      .getByRole('button', { name: t('reachability'), exact: true })
      .click();
    const access = mode.locator('.ic-section').filter({
      has: page.getByRole('heading', { name: new RegExp(`^${t('access')}`) }),
    });
    await access.getByRole('button', { name: t('add'), exact: true }).click();
    const row = access.locator('details[open]');
    await row.getByRole('combobox', { name: t('targetId'), exact: true }).selectOption('watch');
    await row
      .getByRole('group', { name: t('requires'), exact: true })
      .getByRole('checkbox', { name: 'Fabrice', exact: true })
      .check();
    if (includeLocation)
      await row
        .getByRole('group', { name: t('requires'), exact: true })
        .getByRole('checkbox', { name: 'Workshop', exact: true })
        .check();
    await row
      .getByRole('textbox', { name: t('method'), exact: true })
      .fill('Examine after finding Fabrice');
    await mode
      .locator('footer')
      .getByRole('button', { name: t('assemble'), exact: true })
      .click();
    await expect(mode).toHaveCount(0);
    const saved = await persisted();
    expect(saved.boards[0].layout!.watch.parentId).toBe('witness');
    expect(saved.boards[0].layout!.witness.parentId).toBe('place');
    const edge = () =>
      page.locator('.diagram-edge title').filter({ hasText: 'Fabrice → Wristwatch' });
    await expect(edge()).toHaveCount(1);
    await app.close();
    await reopen();
    expect((await persisted()).boards[0].layout).toEqual(saved.boards[0].layout);
    await expect(edge()).toHaveCount(1);
  });
}

for (const locale of ['en', 'ru'] as const) {
  test(`assembly draws the observation chain without a context shortcut in ${locale}`, async () => {
    setLocale(locale);
    const data = observationsInvestigation(),
      plan = structuredClone(data.boards[0].investigation!);
    const board = applyCreatorDiagram(
      data.boards[0],
      buildInvestigationDiagram(plan, data.characters),
    );
    // A persisted diagram produced by the old all-prerequisites mechanism.
    board.layout!.subject.parentIds = ['observations', 'witness'];
    board.layout!.subject.generated!.parentIds = ['observations', 'witness'];
    data.boards[0] = board;
    await launch(data, locale);
    const shortcut = () =>
      page.locator('.diagram-edge[data-source-id="witness"][data-target-id="subject"]');
    await expect(shortcut()).toHaveCount(1);
    await page.locator('[data-node-id="__culprit__"]').click();
    await page
      .locator('.ic-footer')
      .getByRole('button', { name: messages(locale)('assemble'), exact: true })
      .click();
    await expect(page.locator('.investigation-creator-mode')).toHaveCount(0);
    await expect(shortcut()).toHaveCount(0);
    await expect(
      page.locator('.diagram-edge[data-source-id="witness"][data-target-id="observations"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('.diagram-edge[data-source-id="observations"][data-target-id="subject"]'),
    ).toHaveCount(1);
    const saved = (await persisted()).boards[0];
    expect(saved.investigation).toEqual(plan);
    expect(parentsOf(saved, 'subject')).toEqual(['observations']);
    await page.screenshot({ path: `test-results/observation-chain-${locale}.png` });
    await app.close();
    await reopen();
    await expect(shortcut()).toHaveCount(0);
    expect((await persisted()).boards[0].investigation).toEqual(plan);
  });
}

for (const locale of ['en', 'ru'] as const) {
  test(`assembles from the footer and keeps the saved tree after restart in ${locale}`, async () => {
    setLocale(locale);
    const t = messages(locale),
      data = demoDatabase();
    data.boards[0].layout = {};
    await launch(data, locale);
    // Keep browser geometry assertions reproducible; the layout unit suite
    // exercises variation across random seeds separately.
    await page.evaluate(() => {
      Math.random = () => 0.3;
    });
    await page.locator('[data-node-id="__culprit__"]').click();
    const mode = page.locator('.investigation-creator-mode');
    // Ordinary saving keeps authoring and assembly separate.
    await mode.getByRole('button', { name: t('save'), exact: true }).click();
    expect((await persisted()).boards[0].layout).toEqual({});
    await mode
      .locator('nav')
      .getByRole('button', { name: t('crime'), exact: true })
      .click();
    const assemble = mode
      .locator('footer')
      .getByRole('button', { name: t('assemble'), exact: true });
    await expect(assemble).toBeVisible();
    await assemble.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/creator-assemble-button-${locale}.png` });
    await assemble.click();
    await expect(mode).toHaveCount(0);
    const saved = await persisted(),
      board = saved.boards[0];
    expect(Object.keys(board.layout!)).toHaveLength(board.characterIds.length);
    expect(board.layout!.door.parentId).toBe('apartment');
    expect(board.layout!.meeting.parentId).toBe('celine');
    expect(board.layout!.remi.parentId).toBe('courtyard');
    expect(saved.characters).toEqual(data.characters);
    expect(board.investigation).toEqual(data.boards[0].investigation);
    await expect(
      page.locator('.diagram-edge title').filter({
        hasText: `${data.characters.find((n) => n.id === 'apartment')!.name} → ${data.characters.find((n) => n.id === 'door')!.name}`,
      }),
    ).toHaveCount(1);
    await page.screenshot({ path: `test-results/creator-assembled-${locale}.png` });
    expect(await renderedCrossings()).toBeLessThanOrEqual(3);
    expect(longestLink(board, saved)).toBeLessThan(750);
    await app.close();
    await reopen();
    expect((await persisted()).boards[0].layout).toEqual(board.layout);
    await page.evaluate(() => {
      Math.random = () => 0.3;
    });
    await page.locator('[data-node-id="__culprit__"]').click();
    await page
      .locator('.ic-footer')
      .getByRole('button', { name: t('assemble'), exact: true })
      .click();
    await expect(page.locator('.investigation-creator-mode')).toHaveCount(0);
    const repeated = (await persisted()).boards[0];
    for (const id of board.characterIds) {
      expect(repeated.layout![id].parentId).toBe(board.layout![id].parentId);
      expect(repeated.layout![id].x).toBeCloseTo(board.layout![id].x!, 8);
      expect(repeated.layout![id].y).toBeCloseTo(board.layout![id].y!, 8);
    }
  });
}

test('assembly failure leaves the saved board intact and allows returning to it', async () => {
  setLocale('en');
  const t = messages('en'),
    data = demoDatabase();
  data.boards[0].layout = {
    door: { x: 100, y: 100, locked: true },
    window: { x: 100, y: 100, locked: true },
  };
  await launch(data, 'en');
  await page.locator('[data-node-id="__culprit__"]').click();
  const mode = page.locator('.investigation-creator-mode');
  await mode
    .locator('footer')
    .getByRole('button', { name: t('assemble'), exact: true })
    .click();
  await expect(mode.locator('.ic-error')).toHaveText(t('diagramSpaceError'));
  expect((await persisted()).boards[0].layout).toEqual(data.boards[0].layout);
  await mode.getByRole('button', { name: t('backToBoard'), exact: true }).click();
  await expect(mode).toHaveCount(0);
});

for (const locale of ['en', 'ru'] as const) {
  test(`reads chosen library folders, preserves nodes and reads new nodes after restart in ${locale}`, async () => {
    setLocale(locale);
    const t = messages(locale),
      data = emptyDatabase();
    data.folders = [
      { id: 'people', name: 'People', parentId: null, kind: 'person' },
      { id: 'witnesses', name: 'Witnesses', parentId: 'people', kind: 'person' },
      { id: 'clues', name: 'Clues', parentId: null, kind: 'evidence' },
    ];
    data.characters = [
      {
        id: 'authored',
        name: 'Authored person',
        color: '#123456',
        notes: 'Original notes',
        folderId: 'witnesses',
        kind: 'person',
        suspect: true,
        answers: { motive: 'Original motive' },
      },
      {
        id: 'clue',
        name: 'Authored clue',
        color: '#123456',
        notes: '',
        folderId: 'clues',
        kind: 'evidence',
      },
      { id: 'unrelated', name: 'Unrelated person', color: '#123456', notes: '', folderId: null },
    ];
    data.boards = [
      { id: 'case', name: 'Case', description: '', characterIds: [], connections: [] },
    ];
    data.activeBoardId = 'case';
    await launch(data, locale);
    await page.locator('[data-node-id="__culprit__"]').click();
    let mode = page.locator('.investigation-creator-mode');
    let sources = mode.getByRole('region', { name: t('sourceFolders'), exact: true });
    await sources.getByRole('checkbox', { name: 'People (1)', exact: true }).check();
    let responsible = mode.getByRole('group', { name: t('culpritIds'), exact: true });
    await expect(
      responsible.getByRole('checkbox', { name: 'Authored person', exact: true }),
    ).toBeVisible();
    await expect(
      responsible.getByRole('checkbox', { name: 'Unrelated person', exact: true }),
    ).toHaveCount(0);
    await responsible.getByRole('checkbox', { name: 'Authored person', exact: true }).check();
    await sources.getByRole('checkbox', { name: 'People / Witnesses (1)', exact: true }).check();
    await sources.getByRole('checkbox', { name: 'Clues (1)', exact: true }).check();
    await expect
      .poll(async () => (await persisted()).boards[0].characterIds)
      .toEqual(['authored', 'clue']);
    expect((await persisted()).characters).toEqual(data.characters);
    await sources.getByRole('checkbox', { name: 'People / Witnesses (1)', exact: true }).uncheck();
    await expect
      .poll(async () => (await persisted()).boards[0].creatorFolderIds)
      .toEqual(['people', 'clues']);
    const saved = await persisted();
    await app.close();
    saved.characters.push({
      id: 'new-person',
      name: 'New library person',
      color: '#123456',
      notes: '',
      folderId: 'witnesses',
      suspect: true,
    });
    await writeFile(path.join(directory, 'library.json'), JSON.stringify(saved));
    await reopen();
    await page.locator('[data-node-id="__culprit__"]').click();
    mode = page.locator('.investigation-creator-mode');
    sources = mode.getByRole('region', { name: t('sourceFolders'), exact: true });
    responsible = mode.getByRole('group', { name: t('culpritIds'), exact: true });
    await expect(sources.getByRole('checkbox', { name: 'People (2)', exact: true })).toBeChecked();
    await expect
      .poll(async () => (await persisted()).boards[0].characterIds)
      .toEqual(['authored', 'clue', 'new-person']);
    await mode
      .locator('nav')
      .getByRole('button', { name: t('crime'), exact: true })
      .click();
    await expect(
      responsible.getByRole('checkbox', { name: 'Authored person', exact: true }),
    ).toBeChecked();
    await expect(
      responsible.getByRole('checkbox', { name: 'New library person', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: `test-results/creator-folders-${locale}.png` });
    await sources.getByRole('checkbox', { name: 'People (2)', exact: true }).uncheck();
    await expect
      .poll(async () => (await persisted()).boards[0].creatorFolderIds)
      .toEqual(['clues']);
    expect((await persisted()).boards[0].characterIds).toEqual(['authored', 'clue', 'new-person']);
    await mode.getByRole('button', { name: t('backToBoard'), exact: true }).click();
    await expect(page.locator('[data-node-id="new-person"]')).toBeVisible();
  });
}

test('rejects a folder that exceeds the board limit without partially adding its nodes', async () => {
  setLocale('en');
  const t = messages('en'),
    data = emptyDatabase();
  data.folders = [{ id: 'large', name: 'Large folder', parentId: null, kind: 'evidence' }];
  data.characters = Array.from({ length: 501 }, (_, index) => ({
    id: `node-${index}`,
    name: `Node ${index}`,
    color: '#123456',
    notes: '',
    folderId: index ? 'large' : null,
    kind: 'evidence',
  }));
  data.boards = [
    { id: 'case', name: 'Case', description: '', characterIds: ['node-0'], connections: [] },
  ];
  data.activeBoardId = 'case';
  await launch(data, 'en');
  await page.locator('[data-node-id="__culprit__"]').click();
  const mode = page.locator('.investigation-creator-mode');
  const folder = mode.getByRole('checkbox', { name: 'Large folder (500)', exact: true });
  await folder.check();
  await expect(mode.locator('.ic-error')).toHaveText(t('sourceLimit'));
  expect((await persisted()).boards[0].characterIds).toEqual(['node-0']);
  await folder.uncheck();
  await expect(mode.locator('.ic-error')).toHaveCount(0);
});

for (const locale of ['en', 'ru'] as const) {
  test(`filters victim and responsible lists by character roles and persists role edits in ${locale}`, async () => {
    setLocale(locale);
    const t = messages(locale),
      data = demoDatabase();
    const witness = data.characters.find((n) => n.id === 'elisa')!;
    const suspect = data.characters.find((n) => n.id === 'domye')!;
    const victim = data.characters.find((n) => n.id === 'valk')!;
    const victimWitness = data.characters.find((n) => n.id === 'mathias')!;
    // Old selections must not return as unfiltered fallback options.
    data.boards[0].investigation!.crime.victimId = witness.id;
    data.boards[0].investigation!.crime.culpritIds = [victim.id, witness.id, suspect.id];
    await launch(data, locale);
    await page.locator('[data-node-id="__culprit__"]').click();
    const mode = page.locator('.investigation-creator-mode');
    await mode
      .locator('nav')
      .getByRole('button', { name: t('crime'), exact: true })
      .click();
    const victims = mode.getByRole('combobox', { name: t('victimId'), exact: true });
    const responsible = mode.getByRole('group', { name: t('culpritIds'), exact: true });
    await expect(victims.locator('option')).toHaveText([
      t('none'),
      ...data.characters.filter((n) => n.kind === 'person' && n.victim).map((n) => n.name),
    ]);
    await expect(
      responsible.getByRole('checkbox', { name: witness.name, exact: true }),
    ).toBeChecked();
    await expect(
      responsible.getByRole('checkbox', { name: victim.name, exact: true }),
    ).toBeChecked();
    await responsible.getByRole('checkbox', { name: victimWitness.name, exact: true }).check();
    await expect(
      responsible.getByRole('checkbox', { name: suspect.name, exact: true }),
    ).toBeChecked();
    await victims.selectOption(victim.id);
    await expect
      .poll(async () => (await persisted()).boards[0].investigation!.crime)
      .toMatchObject({
        victimId: victim.id,
        culpritIds: [victim.id, witness.id, suspect.id, victimWitness.id],
      });

    const nodes = mode
      .locator('details')
      .filter({ has: page.locator('summary', { hasText: `${t('nodes')} (` }) });
    await nodes.locator('summary').click();
    await nodes.getByRole('button', { name: suspect.name, exact: true }).click();
    await mode.getByLabel(tr('trace.victim'), { exact: true }).check();
    await mode.getByLabel(tr('trace.suspect'), { exact: true }).uncheck();
    await mode.getByLabel(tr('trace.witness'), { exact: true }).uncheck();
    await mode.locator('button[type=submit]').click();
    await expect(
      responsible.getByRole('checkbox', { name: suspect.name, exact: true }),
    ).toHaveCount(0);
    await expect(victims.locator(`option[value="${suspect.id}"]`)).toHaveText(suspect.name);
    await victims.selectOption(suspect.id);
    await expect
      .poll(async () => (await persisted()).boards[0].investigation!.crime)
      .toMatchObject({
        victimId: suspect.id,
        culpritIds: [victim.id, witness.id, victimWitness.id],
      });
    await expect
      .poll(async () => (await persisted()).characters.find((n) => n.id === suspect.id))
      .toMatchObject({ victim: true, suspect: false, witness: false });
    await app.close();
    await reopen();
    await page.locator('[data-node-id="__culprit__"]').click();
    const reopenedMode = page.locator('.investigation-creator-mode');
    await reopenedMode
      .locator('nav')
      .getByRole('button', { name: t('crime'), exact: true })
      .click();
    await expect(
      reopenedMode.getByRole('combobox', { name: t('victimId'), exact: true }),
    ).toHaveValue(suspect.id);
    await expect(
      reopenedMode
        .getByRole('group', { name: t('culpritIds'), exact: true })
        .getByRole('checkbox', { name: suspect.name, exact: true }),
    ).toHaveCount(0);
    const reopenedResponsible = reopenedMode.getByRole('group', {
      name: t('culpritIds'),
      exact: true,
    });
    await expect(
      reopenedResponsible.getByRole('checkbox', { name: witness.name, exact: true }),
    ).toBeChecked();
    await expect(
      reopenedResponsible.getByRole('checkbox', { name: victim.name, exact: true }),
    ).toBeChecked();
    await expect(
      reopenedResponsible.getByRole('checkbox', { name: victimWitness.name, exact: true }),
    ).toBeChecked();
    await reopenedMode.getByRole('button', { name: t('backToBoard'), exact: true }).click();
    await page.locator(`[data-node-id="${suspect.id}"]`).click();
    await expect(page.locator('.role-badges')).toHaveText(tr('trace.victim'));
    await page
      .getByRole('navigation', { name: tr('navigation.mainLabel') })
      .getByRole('button', { name: tr('navigation.characters'), exact: true })
      .click();
    await page.getByRole('button', { name: tr('trace.filterVictim'), exact: true }).click();
    await expect(page.locator('.character-card')).toHaveCount(3);
    await expect(page.locator('.character-card').filter({ hasText: suspect.name })).toHaveCount(1);
  });
}

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
    await expect.poll(async () => (await persisted()).characters[0]?.name).toBe('Witness');
    await mode.getByLabel(t('motive'), { exact: true }).pressSequentially('An authored motive');
    await expect
      .poll(async () => (await persisted()).boards[0].investigation?.crime.motive)
      .toBe('An authored motive');
    await expect(mode.locator('nav button[aria-current]')).toContainText(t('crime'));
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
    await expect
      .poll(async () => (await persisted()).boards[0].investigation!.evidence[0].explanation)
      .toBe('Edited clue interpretation');
    // Close on the edited step without saving or navigating away.
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
