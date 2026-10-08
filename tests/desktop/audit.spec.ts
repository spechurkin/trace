import {
  _electron as electron,
  type ElectronApplication,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { demoDatabase } from '../../src/demo';
import { type Database, databaseSchema } from '../../shared/model';
import { stressDatabase } from '../stress-fixtures';
import { setLocale, tr } from '../../shared/i18n';

let app: ElectronApplication, page: Page, directory: string;
let errors: string[] = [];
const root = process.cwd();
const evidence = path.join(root, '.cache/qa');
const metrics: Record<string, unknown> = {};

async function launch(data: Database = demoDatabase(), locale: 'en' | 'ru' = 'en') {
  setLocale(locale);
  await mkdir(path.join(root, '.test-data'), { recursive: true });
  await mkdir(evidence, { recursive: true });
  directory = await mkdtemp(path.join(root, '.test-data', 'qa-desktop-'));
  await writeFile(path.join(directory, 'preferences.json'), JSON.stringify({ language: locale }));
  await writeFile(path.join(directory, 'library.json'), JSON.stringify(data));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => value && key !== 'ELECTRON_RUN_AS_NODE'),
  ) as Record<string, string>;
  env.TRACE_DATA_DIR = directory;
  const executablePath = process.env.TRACE_TEST_EXECUTABLE;
  const start = performance.now();
  app = await electron.launch({ executablePath, args: executablePath ? [] : [root], env });
  page = await app.firstWindow();
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 1000));
  await expect(page.locator('.save-status')).toHaveText(tr('save.saved'), { timeout: 30000 });
  metrics.lastLaunchMs = +(performance.now() - start).toFixed(1);
}

async function saved() {
  await expect(page.locator('.save-status')).toHaveText(tr('save.saved'));
  return databaseSchema.parse(
    JSON.parse(await readFile(path.join(directory, 'library.json'), 'utf8')),
  );
}

async function record(name: string, value: unknown) {
  metrics[name] = value;
  let previous = {};
  try {
    previous = JSON.parse(await readFile(path.join(evidence, 'desktop-metrics.json'), 'utf8'));
  } catch {
    // First measurement.
  }
  await writeFile(
    path.join(evidence, 'desktop-metrics.json'),
    JSON.stringify({ ...previous, ...metrics }, null, 2),
  );
}

test.afterEach(async ({}, info) => {
  if (page && !page.isClosed()) {
    try {
      await page.screenshot({
        path: path.join(evidence, `${info.title.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 110)}.png`),
        timeout: 5000,
      });
    } catch (error) {
      await record(`screenshotWarning-${info.title}`, String(error));
    }
    if (info.status !== info.expectedStatus) {
      await writeFile(
        path.join(evidence, `${info.testId.replace(/[^a-zA-Z0-9]+/g, '-')}.txt`),
        (await page.locator('body').innerText()).slice(0, 30000),
      );
    }
  }
  await app?.close();
  expect(errors, 'renderer errors').toEqual([]);
});

test('minimum supported window: all main actions and modal footer stay visible in both locales', async () => {
  await launch();
  for (const locale of ['en', 'ru'] as const) {
    await page
      .locator('.rail')
      .getByRole('button', { name: tr('navigation.settings'), exact: true })
      .click();
    await page.getByLabel(tr('settings.language'), { exact: true }).selectOption(locale);
    setLocale(locale);
    await page
      .locator('.rail')
      .getByRole('button', { name: tr('navigation.clubs'), exact: true })
      .click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1080, 720));
    const clipped = await page
      .locator('.header-actions button, .canvas-bottom button, .rail-button')
      .evaluateAll((elements) =>
        elements
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return (
              r.width > 0 && (r.x < 0 || r.y < 0 || r.right > innerWidth || r.bottom > innerHeight)
            );
          })
          .map((el) => ({
            text: el.textContent,
            label: el.getAttribute('aria-label'),
            rect: el.getBoundingClientRect().toJSON(),
          })),
      );
    await record(`minimumWindow-${locale}`, clipped);
    await page.screenshot({ path: path.join(evidence, `minimum-window-${locale}.png`) });
    expect(clipped).toEqual([]);
    await page
      .locator('.inspector')
      .getByRole('button', { name: tr('trace.newNode'), exact: true })
      .click();
    await page.getByRole('dialog').locator('button[type=submit]').scrollIntoViewIfNeeded();
    await expect(page.getByRole('dialog').locator('button[type=submit]')).toBeInViewport();
    await page.keyboard.press('Escape');
  }
});

test('modal keyboard focus cycles and Escape restores opening control', async () => {
  await launch();
  const opener = page
    .locator('.inspector')
    .getByRole('button', { name: tr('trace.newNode'), exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel(tr('trace.kind'))).toBeFocused();
  const first = dialog.getByRole('button', { name: tr('actions.close'), exact: true });
  const last = dialog.locator('button[type=submit]');
  await last.focus();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('required person roles show validation and do not mutate disk', async () => {
  await launch();
  const before = await saved();
  await page
    .locator('.inspector')
    .getByRole('button', { name: tr('trace.newNode'), exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(tr('characters.nameLabel')).fill('Role validation');
  await dialog.getByLabel(tr('trace.suspect'), { exact: true }).uncheck();
  await dialog.locator('button[type=submit]').click();
  await expect(dialog.getByRole('alert')).toHaveText(tr('trace.rolesRequired'));
  expect(await saved()).toEqual(before);
  await dialog.getByLabel(tr('trace.witness'), { exact: true }).check();
  await dialog.locator('button[type=submit]').click();
  expect((await saved()).characters.at(-1)?.witness).toBe(true);
});

test('500-node board remains savable when attempting to add node 501', async () => {
  await launch(stressDatabase(500));
  await page
    .locator('.inspector')
    .getByRole('button', { name: tr('trace.newNode'), exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(tr('characters.nameLabel')).fill('Over board capacity');
  await dialog.locator('button[type=submit]').click();
  await expect(page.locator('.save-status')).toHaveText(tr('save.saved'), { timeout: 3000 });
  expect((await saved()).clubs[0].characterIds.length).toBeLessThanOrEqual(500);
});

test('5000-node library refuses node 5001 without entering unsavable state', async () => {
  await launch(stressDatabase(5000));
  await page
    .locator('.rail')
    .getByRole('button', { name: tr('trace.events'), exact: true })
    .click();
  await page
    .locator('.header-actions')
    .getByRole('button', { name: tr('trace.eventNew'), exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByLabel(tr('characters.nameLabel'))
    .fill('Over library capacity');
  await page.getByRole('dialog').locator('button[type=submit]').click();
  await expect(page.locator('.save-status')).toHaveText(tr('save.saved'), { timeout: 3000 });
  expect((await saved()).characters.length).toBeLessThanOrEqual(5000);
});

test('100-board library refuses duplicate 101 without entering unsavable state', async () => {
  await launch(stressDatabase(1, 100));
  await expect(page.locator('.new-club')).toBeDisabled();
  await page.getByRole('button', { name: tr('clubs.actionsLabel'), exact: true }).click();
  await expect(
    page.getByRole('button', { name: tr('actions.duplicate'), exact: true }),
  ).toBeDisabled();
  await expect(page.locator('.save-status')).toHaveText(tr('save.saved'), { timeout: 3000 });
  expect((await saved()).clubs).toHaveLength(100);
});

test('linking two nodes cannot create a cycle and removal reconnects children', async () => {
  const data = stressDatabase(3, 1, true);
  await launch(data);
  await page.locator('[data-node-id=n0]').press('Enter');
  await page
    .locator('.inspector')
    .getByRole('button', { name: tr('actions.connect'), exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel(tr('trace.parent')).locator('option')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.locator('[data-node-id=n0]').press('Enter');
  await page
    .locator('.inspector')
    .getByRole('button', { name: tr('members.remove'), exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: tr('actions.delete'), exact: true })
    .click();
  const persisted = await saved();
  expect(persisted.clubs[0].layout!.n1.parentId).toBe('__culprit__');
  expect(persisted.characters).toHaveLength(3);
  await expect(page.locator('.diagram-node')).toHaveCount(3);
});

test('wheel zoom stays in bounds and reset centers the board', async () => {
  await launch();
  const viewport = page.locator('.diagram-viewport');
  await viewport.dispatchEvent('wheel', { deltaY: -10000, ctrlKey: true });
  await expect(page.locator('.zoom-controls > span')).toHaveText('250%');
  await viewport.dispatchEvent('wheel', { deltaY: 10000, ctrlKey: true });
  await expect(page.locator('.zoom-controls > span')).toHaveText('50%');
  await viewport.dispatchEvent('wheel', { deltaY: 250 });
  await expect(page.locator('.diagram-transform')).toHaveAttribute(
    'style',
    /translate\(0px,\s*-250px\)/,
  );
  await page.getByRole('button', { name: tr('diagram.center'), exact: true }).click();
  await expect(page.locator('.zoom-controls > span')).toHaveText('100%');
  await expect(page.locator('.diagram-transform')).toHaveAttribute(
    'style',
    /translate\(0px,\s*0px\)/,
  );
});

test('write failure shows error and explicit retry restores persistence', async () => {
  await launch(stressDatabase(3));
  await mkdir(path.join(directory, 'library.json.tmp'));
  await page.locator('[data-node-id=n0]').press('Enter');
  await page.locator('.node-lock').click();
  await expect(page.locator('.save-status')).toHaveText(tr('save.error'));
  await expect(page.locator('.save-alert')).toBeVisible();
  expect(
    JSON.parse(await readFile(path.join(directory, 'library.json'), 'utf8')).clubs[0].layout.n0
      .locked,
  ).toBeUndefined();
  const temp = path.resolve(directory, 'library.json.tmp');
  if (!temp.startsWith(path.resolve(root, '.test-data') + path.sep))
    throw new Error('Unsafe test cleanup');
  await rm(temp, { recursive: true });
  await page.getByRole('button', { name: tr('actions.retrySave'), exact: true }).click();
  expect((await saved()).clubs[0].layout!.n0.locked).toBe(true);
});

test('malicious node text remains inert in renderer and SVG export', async () => {
  const data = stressDatabase(1);
  data.characters[0].name = '<img alt="" src="data:image/png;base64,eA==" onerror="alert(1)">';
  data.characters[0].answers!.identity = '<script>window.__qaInjected=1</script>';
  await launch(data);
  await page.locator('[data-node-id=n0]').press('Enter');
  await expect(page.locator('.character-detail h2')).toHaveText(data.characters[0].name);
  expect(
    await page.evaluate(() => (window as unknown as Record<string, unknown>).__qaInjected),
  ).toBeUndefined();
  const output = path.join(directory, 'inert.svg');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, output);
  for (const content of [
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
    '<svg><rect data-label=">" onload="alert(1)" /></svg>',
    '<svg><rect onload=alert(1) /></svg>',
    '<svg><script>alert(1)</script></svg>',
    '<svg><foreignObject /></svg>',
    '<svg><image href="https://example.com/image.png" /></svg>',
    '<svg><a href="javascript:alert(1)">link</a></svg>',
  ]) {
    await expect(
      page.evaluate((svg) => window.desktop!.exportDiagram('Unsafe', 'svg', svg), content),
    ).rejects.toThrow(tr('validation.diagramInvalid'));
  }
  await expect(readFile(output, 'utf8')).rejects.toThrow();
  await page.getByRole('button', { name: tr('actions.export'), exact: true }).click();
  await page.getByRole('button', { name: /^SVG/ }).click();
  await expect
    .poll(async () => {
      try {
        return await readFile(output, 'utf8');
      } catch {
        return '';
      }
    })
    .toContain('&lt;img');
  expect(await readFile(output, 'utf8')).not.toMatch(/<script|<img/);
});

test('rapid 51 lock toggles save the final revision', async () => {
  await launch(stressDatabase(100));
  await page.locator('[data-node-id=n0]').press('Enter');
  const start = performance.now();
  for (let i = 0; i < 51; i++) await page.locator('.node-lock').click();
  expect((await saved()).clubs[0].layout!.n0.locked).toBe(true);
  await record('lock51SaveMs', +(performance.now() - start).toFixed(1));
});

test('closing immediately after a burst preserves the final revision', async () => {
  await launch(stressDatabase(500));
  await page.locator('[data-node-id=n0]').press('Enter');
  await page.evaluate(async () => {
    for (let i = 0; i < 51; i++) {
      (document.querySelector('.node-lock') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
  await page.close();
  await app.close();
  const persisted = databaseSchema.parse(
    JSON.parse(await readFile(path.join(directory, 'library.json'), 'utf8')),
  );
  expect(persisted.clubs[0].layout!.n0.locked).toBe(true);
});

test('maximum board renders and exports 500 branches; selection stays interactive', async () => {
  await launch(stressDatabase(500, 1, true));
  await expect(page.locator('.diagram-node')).toHaveCount(501);
  await expect(page.locator('.diagram-edge')).toHaveCount(500);
  await record('board500LaunchMs', metrics.lastLaunchMs);
  const latencies = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    await page.locator(`[data-node-id=n${i}]`).press('Enter');
    await expect(page.locator('.character-detail h2')).toHaveText(
      `Node ${String(i).padStart(4, '0')}`,
    );
    latencies.push(performance.now() - start);
  }
  latencies.sort((a, b) => a - b);
  await record('board500Selection', {
    medianMs: +latencies[10].toFixed(1),
    p95Ms: +latencies[18].toFixed(1),
    maxMs: +latencies[19].toFixed(1),
  });
  const output = path.join(directory, 'stress.svg');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, output);
  const start = performance.now();
  await page.getByRole('button', { name: tr('actions.export'), exact: true }).click();
  await page.getByRole('button', { name: /^SVG/ }).click();
  await expect
    .poll(async () => {
      try {
        return (await readFile(output, 'utf8')).length;
      } catch {
        return 0;
      }
    })
    .toBeGreaterThan(10000);
  await record('board500SVGExportMs', +(performance.now() - start).toFixed(1));
  const svg = await readFile(output, 'utf8');
  expect(svg.match(/class="diagram-edge"/g)).toHaveLength(500);
  expect(svg).not.toMatch(/NaN|Infinity/);
});

test('5000-node library search returns the exact match under load', async () => {
  await launch(stressDatabase(5000, 1));
  await page
    .locator('.rail')
    .getByRole('button', { name: tr('navigation.characters'), exact: true })
    .click();
  await expect(page.locator('.character-card')).toHaveCount(1250);
  const latencies = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    await page
      .getByRole('textbox', { name: tr('characters.searchLabel'), exact: true })
      .fill(`Node ${String(i * 4).padStart(4, '0')}`);
    await expect(page.locator('.character-card h2')).toHaveText([
      `Node ${String(i * 4).padStart(4, '0')}`,
    ]);
    latencies.push(performance.now() - start);
  }
  await record(
    'library5000SearchMs',
    latencies.map((value) => +value.toFixed(1)),
  );
});

test('corrupt primary recovers backup and preserves warning in the live interface', async () => {
  await launch(stressDatabase(3));
  await app.close();
  const data = stressDatabase(3);
  await writeFile(path.join(directory, 'library.json.bak'), JSON.stringify(data));
  await writeFile(path.join(directory, 'library.json'), '{broken');
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => value && key !== 'ELECTRON_RUN_AS_NODE'),
  ) as Record<string, string>;
  env.TRACE_DATA_DIR = directory;
  const executablePath = process.env.TRACE_TEST_EXECUTABLE;
  app = await electron.launch({ executablePath, args: executablePath ? [] : [root], env });
  page = await app.firstWindow();
  await expect(page.locator('.save-alert')).toContainText(tr('library.backupRecovered'));
  await expect(page.locator('.diagram-node')).toHaveCount(4);
});

test('invalid backup import shows error and preserves the existing library', async () => {
  await launch(stressDatabase(3));
  const before = await saved();
  const filePath = path.join(directory, 'invalid.json');
  await writeFile(filePath, '{invalid');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, filePath);
  await page
    .locator('.rail')
    .getByRole('button', { name: tr('navigation.settings'), exact: true })
    .click();
  await page
    .locator('.settings-card')
    .filter({ has: page.getByRole('button', { name: tr('backup.save'), exact: true }) })
    .getByRole('button', { name: tr('actions.import'), exact: true })
    .click();
  await expect(page.locator('.toast')).toBeVisible();
  expect(await saved()).toEqual(before);
});

test('500-node automatic layout remains readable at maximum zoom', async () => {
  const data = stressDatabase(500);
  delete data.clubs[0].layout;
  await launch(data);
  await page.locator('.diagram-viewport').dispatchEvent('wheel', { deltaY: -10000, ctrlKey: true });
  await expect(page.locator('.zoom-controls > span')).toHaveText('250%');
  await page.waitForTimeout(200);
  const textSize = await page
    .locator('[data-node-id=n0] > text')
    .last()
    .evaluate((el) => {
      const text = el as SVGTextElement;
      const matrix = text.getScreenCTM()!;
      return {
        effectiveFontPx:
          parseFloat(getComputedStyle(text).fontSize) * Math.hypot(matrix.a, matrix.b),
        box: text.getBoundingClientRect().toJSON(),
      };
    });
  await record('automatic500NodeLabelAt250Percent', textSize);
  expect(textSize.effectiveFontPx).toBeGreaterThanOrEqual(10);
});

test('5000 nodes and 500 deep boards remain interactive together', async () => {
  test.setTimeout(180000);
  await launch(stressDatabase(5000, 500, true));
  await record('maximumCombinedLaunchMs', metrics.lastLaunchMs);
  const start = performance.now();
  await page.locator('[data-node-id=n0]').press('Enter');
  await expect(page.locator('.character-detail h2')).toHaveText('Node 0000');
  const selectionMs = +(performance.now() - start).toFixed(1);
  await record('maximumCombinedSelectionMs', selectionMs);
  expect(selectionMs, 'A node selection should finish within one second').toBeLessThan(1000);
  await page.locator('.node-lock').click();
  expect((await saved()).clubs[0].layout!.n0.locked).toBe(true);
});

test('invalid portrait bytes show validation and cancel preserves the library', async () => {
  await launch(stressDatabase(1));
  const before = await saved();
  await page.locator('[data-node-id=n0]').press('Enter');
  await page
    .locator('.inspector')
    .getByRole('button', { name: tr('actions.edit'), exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'invalid.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not a PNG'),
  });
  await expect(dialog.getByRole('alert')).toHaveText(tr('errors.imageRead'));
  await dialog.getByRole('button', { name: tr('actions.cancel'), exact: true }).click();
  expect(await saved()).toEqual(before);
});

test('offline Electron blocks navigation, external requests and Node access', async () => {
  await launch(stressDatabase(1));
  expect(
    await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require),
  ).toBe('undefined');
  expect(
    await page.evaluate(async () => {
      try {
        await fetch('https://example.com/');
        return true;
      } catch {
        return false;
      }
    }),
  ).toBe(false);
  const before = page.url();
  await page.evaluate(() => {
    location.href = 'https://example.com/';
  });
  await page.waitForTimeout(200);
  expect(page.url()).toBe(before);
});

test('closing while slow saves are queued retains the final board selection', async () => {
  await launch(stressDatabase(5000, 100, true));
  await page.locator('[data-node-id=n0]').press('Enter');
  await page.evaluate(async () => {
    for (let i = 0; i < 5; i++) {
      (document.querySelector('.node-lock') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    (document.querySelectorAll('.club-list-item')[1] as HTMLButtonElement).click();
  });
  await page.close();
  await app.close();
  const persisted = databaseSchema.parse(
    JSON.parse(await readFile(path.join(directory, 'library.json'), 'utf8')),
  );
  expect(persisted.activeClubId).toBe('b1');
});
