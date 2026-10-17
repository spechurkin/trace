import {
  _electron as electron,
  type ElectronApplication,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { userThemeKey } from '../../shared/themes';
import { russianText } from '../russian-fixtures';

const root = process.cwd();
let app: ElectronApplication;
let page: Page;
let directory: string;
const errors: string[] = [];
const variants = ['original', 'clubs'] as const;

async function launch() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && key !== 'ELECTRON_RUN_AS_NODE',
    ),
  ) as Record<string, string>;
  env.TRACE_DATA_DIR = directory;
  env.TRACE_THEMES_DIR = path.join(directory, 'themes');
  app = await electron.launch({
    executablePath: process.env.TRACE_TEST_EXECUTABLE,
    args: process.env.TRACE_TEST_EXECUTABLE ? [] : [root],
    env,
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) =>
    errors.push(`${request.url()}: ${request.failure()?.errorText}`),
  );
  await expect(page.locator('.save-status')).toHaveText('All changes saved');
  await page.evaluate(() => document.fonts.ready);
}

function selection(theme: (typeof variants)[number]) {
  return theme === 'original' ? theme : userThemeKey({ id: 'clubs' });
}

async function chooseTheme(theme: (typeof variants)[number], view = 'Boards') {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Interface theme', { exact: true }).selectOption(selection(theme));
  if (theme === 'original') await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  else {
    await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'clubs');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme-variant');
    await expect(page.locator('.rail')).toHaveCSS('background-color', 'rgb(35, 60, 51)');
    await expect(page.locator('.topbar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  }
  await page.locator('.rail-links').getByRole('button', { name: view, exact: true }).click();
  if (theme === 'clubs') {
    await expect(page.locator('.new-board')).toHaveCSS('background-color', 'rgb(240, 244, 236)');
    const activeBoard = page.locator('.board-list-item.active');
    if (await activeBoard.count())
      await expect(activeBoard).toHaveCSS('background-color', 'rgb(240, 244, 236)');
  }
}

async function layout(selectors: string) {
  return page.locator(selectors).evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        className: element.className,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    }),
  );
}

test.beforeEach(async () => {
  errors.length = 0;
  await mkdir(path.join(root, '.test-data'), { recursive: true });
  directory = await mkdtemp(path.join(root, '.test-data', 'themes-'));
  await launch();
});
test.afterEach(async () => {
  await app?.close();
});

test('bundled themes preserve welcome geometry and persist across restarts', async () => {
  const selectors =
    '.app-shell, .rail, .sidebar, .main, .topbar, .editor-layout, .canvas, .canvas-empty, .empty-orbit, .onboarding-steps, .inspector, .statusbar';
  for (const [width, height] of [
    [1480, 1000],
    [1100, 720],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]),
      [width, height],
    );
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
    await chooseTheme('original');
    const original = await layout(selectors);
    for (const theme of variants) {
      await chooseTheme(theme);
      expect(await layout(selectors)).toEqual(original);
      await expect(page.locator('.canvas-empty .button.primary')).toBeVisible();
      await page.screenshot({
        animations: 'disabled',
        path: path.join(root, 'test-results', `${theme}-welcome-${width}.png`),
      });
    }
  }
  await app.close();
  await launch();
  await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'clubs');
  await expect(page.locator('.canvas')).toHaveCSS('background-color', 'rgb(247, 248, 244)');
  await chooseTheme('original');
  await expect(page.locator('.topbar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await app.close();
  await launch();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await page.evaluate(() => localStorage.setItem('trace.appearance', 'unknown-theme'));
  await page.reload();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  expect(errors).toEqual([]);
});

test('diagram, library, dialogs and exports retain layout and user data in all bundled themes', async () => {
  await page.getByRole('button', { name: 'Explore an example', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('All changes saved');
  const library = await readFile(path.join(directory, 'library.json'), 'utf8');
  const diagramLayout = await layout(
    '.app-shell, .rail, .sidebar, .topbar, .canvas, .inspector, .diagram-node, .canvas-top, .canvas-bottom',
  );
  const relationColors = await page
    .locator('.diagram-edge > path')
    .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).stroke));
  const exports: string[] = [];
  for (const theme of variants) {
    await chooseTheme(theme);
    expect(
      await layout(
        '.app-shell, .rail, .sidebar, .topbar, .canvas, .inspector, .diagram-node, .canvas-top, .canvas-bottom',
      ),
    ).toEqual(diagramLayout);
    expect(
      await page
        .locator('.diagram-edge > path')
        .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).stroke)),
    ).toEqual(relationColors);
    await page.screenshot({
      animations: 'disabled',
      path: path.join(root, 'test-results', `${theme}-diagram.png`),
    });
    const target = path.join(directory, `${theme}.svg`);
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, target);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('button', { name: /SVG vector diagram/ }).click();
    await expect.poll(async () => readFile(target, 'utf8').catch(() => '')).toContain('<svg');
    exports.push(await readFile(target, 'utf8'));
    await page.getByRole('button', { name: 'People', exact: true }).click();
    await expect(page.locator('.character-card').first()).toBeVisible();
    await page.screenshot({
      animations: 'disabled',
      path: path.join(root, 'test-results', `${theme}-library.png`),
    });
    await page.getByRole('button', { name: 'New node', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.screenshot({
      animations: 'disabled',
      path: path.join(root, 'test-results', `${theme}-dialog.png`),
    });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Interface theme', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(root, 'test-results', `${theme}-settings.png`) });
  }
  for (const exported of exports) expect(exported).toBe(exports[0]);
  expect(await readFile(path.join(directory, 'library.json'), 'utf8')).toBe(library);
  expect(errors).toEqual([]);
});

test('user themes reload CSS and local assets, persist variants, recover missing files and expose only two actions', async () => {
  await page.getByRole('button', { name: 'Explore an example', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('All changes saved');
  const library = await readFile(path.join(directory, 'library.json'), 'utf8');
  const themesRoot = path.join(directory, 'themes');
  expect(
    (await page.evaluate(() => window.desktop!.getThemes())).themes.map((theme) => theme.id),
  ).toEqual(['clubs']);
  const id = 'Custom [\u591c] #1';
  const folder = path.join(themesRoot, id);
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  const manifest = {
    format: 'clubs/theme',
    api_version: 1,
    name: 'Custom',
    stylesheet: 'style.css',
    variants: [
      { id: 'dark', name: 'Custom Dark', mode: 'dark' },
      { id: 'light', name: 'Custom Light', mode: 'light' },
    ],
  };
  await writeFile(path.join(folder, 'theme.json'), JSON.stringify(manifest));
  const stylesheet = (color: string) => `@import url('./assets/palette.css');
:root[data-theme='custom'] { --theme-panel: ${color}; }
:root[data-theme='custom'] .settings-card { background-image: url('./assets/paper.svg'); }`;
  await writeFile(path.join(folder, 'style.css'), stylesheet('#234567'));
  await writeFile(
    path.join(folder, 'assets', 'palette.css'),
    `:root[data-theme='custom'] { --theme-text: #efefef; }`,
  );
  await writeFile(
    path.join(folder, 'assets', 'paper.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#234567"/></svg>',
  );
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const card = page
    .locator('.settings-card')
    .filter({ has: page.getByLabel('Interface theme', { exact: true }) });
  expect(await card.getByRole('button').allTextContents()).toEqual([
    'Reload themes',
    'Open themes folder',
  ]);
  await card.getByRole('button', { name: 'Reload themes', exact: true }).click();
  const select = page.getByLabel('Interface theme', { exact: true });
  await expect(select.locator('option')).toHaveCount(4);
  await select.selectOption(userThemeKey({ id, variant: 'dark' }));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'custom');
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'dark');
  await expect(page.locator('.topbar')).toHaveCSS('background-color', 'rgb(35, 69, 103)');
  await expect(card).toHaveCSS('color', 'rgb(239, 239, 239)');
  expect(
    await card.evaluate(async (element) => {
      const url = getComputedStyle(element).backgroundImage.match(/url\("?([^"\)]+)/)?.[1];
      const image = new Image();
      image.src = url!;
      await image.decode();
      return image.naturalWidth;
    }),
  ).toBe(4);
  await writeFile(path.join(folder, 'style.css'), stylesheet('#345678'));
  await writeFile(
    path.join(folder, 'assets', 'palette.css'),
    `:root[data-theme='custom'] { --theme-text: #dddddd; }`,
  );
  await writeFile(
    path.join(folder, 'assets', 'paper.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="7" height="7"/>',
  );
  await card.getByRole('button', { name: 'Reload themes', exact: true }).click();
  await expect(page.locator('.topbar')).toHaveCSS('background-color', 'rgb(52, 86, 120)');
  await expect(card).toHaveCSS('color', 'rgb(221, 221, 221)');
  expect(
    await card.evaluate(async (element) => {
      const url = getComputedStyle(element).backgroundImage.match(/url\("?([^"\)]+)/)?.[1];
      const image = new Image();
      image.src = url!;
      await image.decode();
      return image.naturalWidth;
    }),
  ).toBe(7);
  await select.selectOption(userThemeKey({ id, variant: 'light' }));
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'light');
  await page.screenshot({ path: path.join(root, 'test-results', 'user-theme-settings.png') });
  await app.close();
  await launch();
  await expect(page.locator('html')).toHaveAttribute('data-theme-id', id);
  await expect(page.locator('html')).toHaveAttribute('data-theme-variant', 'light');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await rm(path.join(folder, 'theme.json'));
  await page.getByRole('button', { name: 'Reload themes', exact: true }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await expect(page.getByText('Theme loading errors', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Interface theme', { exact: true })).toHaveValue(
    userThemeKey({ id, variant: 'light' }),
  );
  await writeFile(path.join(folder, 'theme.json'), JSON.stringify(manifest));
  await page.getByRole('button', { name: 'Reload themes', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-variant', 'light');
  await page.getByLabel('Interface theme', { exact: true }).selectOption('original');
  await expect(page.locator('.topbar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await app.evaluate(({ shell }) => {
    shell.openPath = async (folder) => {
      (globalThis as any).__openedThemeFolder = folder;
      return '';
    };
  });
  await page.getByRole('button', { name: 'Open themes folder', exact: true }).click();
  expect(await app.evaluate(() => (globalThis as any).__openedThemeFolder)).toBe(themesRoot);
  await page.getByLabel('Interface language', { exact: true }).selectOption('ru');
  await expect(
    page.getByRole('button', { name: russianText('theme.reload'), exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: russianText('theme.openFolder'), exact: true }),
  ).toBeVisible();
  expect(await readFile(path.join(directory, 'library.json'), 'utf8')).toBe(library);
  expect(errors).toEqual([]);
});
