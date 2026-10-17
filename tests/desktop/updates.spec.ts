import { _electron as electron, type ElectronApplication, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { russianText } from '../russian-fixtures';

const root = process.cwd();
let app: ElectronApplication;

async function launch(directory: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && key !== 'ELECTRON_RUN_AS_NODE',
    ),
  ) as Record<string, string>;
  env.TRACE_DATA_DIR = directory;
  app = await electron.launch({
    executablePath: process.env.TRACE_TEST_EXECUTABLE,
    args: process.env.TRACE_TEST_EXECUTABLE ? [] : [root],
    env,
  });
  const page = await app.firstWindow();
  await expect(page.locator('.save-status')).toHaveText('All changes saved');
  return page;
}

test.afterEach(async () => {
  await app?.close();
});

test('only daily, weekly and monthly periods are offered, persisted and localized', async () => {
  await mkdir(path.join(root, '.test-data'), { recursive: true });
  const directory = await mkdtemp(path.join(root, '.test-data', 'updates-'));
  let page = await launch(directory);
  await page.getByRole('button', { name: 'Explore an example', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('All changes saved');
  const library = await readFile(path.join(directory, 'library.json'), 'utf8');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const interval = page.getByLabel('Update check interval', { exact: true });
  await expect(interval).toHaveValue('1');
  expect(await interval.locator('option').allTextContents()).toEqual([
    'Every day',
    'Every week',
    'Every month',
  ]);
  await interval.selectOption('7');
  await expect(interval).toBeEnabled();
  expect(
    JSON.parse(await readFile(path.join(directory, 'preferences.json'), 'utf8')).updateIntervalDays,
  ).toBe(7);
  expect(
    await page.evaluate(async () => {
      try {
        await window.desktop!.setUpdateInterval(2 as 1);
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  await interval.selectOption('30');
  await expect(interval).toBeEnabled();
  await app.close();
  page = await launch(directory);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Update check interval', { exact: true })).toHaveValue('30');
  await page.getByLabel('Interface language', { exact: true }).selectOption('ru');
  const localized = page.getByLabel(russianText('updates.interval'), { exact: true });
  await expect(localized).toHaveValue('30');
  expect(await localized.locator('option').allTextContents()).toEqual([
    russianText('updates.daily'),
    russianText('updates.weekly'),
    russianText('updates.monthly'),
  ]);
  await expect(page.getByLabel(russianText('settings.language'), { exact: true })).toBeEnabled();
  expect(await readFile(path.join(directory, 'library.json'), 'utf8')).toBe(library);
  expect(
    JSON.parse(await readFile(path.join(directory, 'preferences.json'), 'utf8')).updateIntervalDays,
  ).toBe(30);
  await page.screenshot({ path: path.join(root, 'test-results', 'updates-settings.png') });
});

test('ready notification opens update settings and save failures prevent install requests', async () => {
  await mkdir(path.join(root, '.test-data'), { recursive: true });
  const directory = await mkdtemp(path.join(root, '.test-data', 'update-ready-'));
  const page = await launch(directory);
  // Exercise the real preload subscription and renderer against simulated update events.
  await app.evaluate(({ BrowserWindow, ipcMain }) => {
    Object.assign(globalThis, { updateInstallRequests: 0 });
    ipcMain.removeHandler('updates:install');
    ipcMain.handle('updates:install', () => {
      const state = globalThis as typeof globalThis & { updateInstallRequests: number };
      state.updateInstallRequests++;
    });
    ipcMain.removeHandler('library:save');
    ipcMain.handle('library:save', () => {
      throw new Error('disk full');
    });
    BrowserWindow.getAllWindows()[0].webContents.send('updates:changed', {
      status: 'ready',
      currentVersion: '1.1.1',
      version: '9.9.9',
      intervalDays: 1,
      percent: 100,
    });
  });
  await page.getByRole('button', { name: 'Update 9.9.9 is ready', exact: true }).click();
  await expect(page.getByTestId('updates')).toContainText('Version 9.9.9 is ready to install.');
  await page.getByRole('button', { name: 'Save and restart to update', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The action failed.');
  expect(
    await app.evaluate(
      () =>
        (globalThis as typeof globalThis & { updateInstallRequests: number }).updateInstallRequests,
    ),
  ).toBe(0);
  expect(app.process().exitCode).toBeNull();
});
