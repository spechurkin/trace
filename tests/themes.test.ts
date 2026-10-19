import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  installBundledTheme,
  readThemeResource,
  resolveThemeFile,
  scanThemes,
  themesDirectory,
} from '../electron/themes';
import { userThemeKey } from '../shared/themes';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'trace-themes-'));
  directories.push(directory);
  const root = path.join(directory, 'themes');
  const id = 'Theme [\u591c] #1';
  const folder = path.join(root, id);
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  const manifest = {
    format: 'clubs/theme',
    api_version: 1,
    name: 'Theme',
    mode: 'dark',
    stylesheet: 'style.css',
  };
  await writeFile(path.join(folder, 'theme.json'), JSON.stringify(manifest));
  await writeFile(path.join(folder, 'style.css'), ':root { --theme-accent: #123456; }');
  return { directory, root, id, folder, manifest };
}

it.each(['clubs'])(
  'installs %s as an editable folder package and never overwrites existing user files',
  async (id) => {
    const { root } = await fixture();
    const source = path.join(process.cwd(), 'resources/themes', id);
    await installBundledTheme(root, source);
    const catalog = await scanThemes(root);
    expect(catalog.themes.filter((theme) => theme.id === id).map((theme) => theme.variant)).toEqual(
      [undefined],
    );
    const file = path.join(root, id, 'style.css');
    await writeFile(file, '/* user edits */');
    await installBundledTheme(root, source);
    expect(await readFile(file, 'utf8')).toBe('/* user edits */');
    await writeFile(path.join(root, id, 'theme.json'), '{}');
    await installBundledTheme(root, source);
    expect(await readFile(path.join(root, id, 'theme.json'), 'utf8')).toBe('{}');
  },
);

it('uses application folders for development, installed, portable, AppImage and macOS builds', () => {
  const options = {
    packaged: true,
    appPath: path.resolve('resources/app.asar'),
    executable: path.resolve('Trace/Trace.exe'),
    platform: 'win32' as NodeJS.Platform,
    env: {},
  };
  expect(themesDirectory(options)).toBe(path.resolve('Trace/themes'));
  expect(themesDirectory({ ...options, packaged: false })).toBe(
    path.join(options.appPath, 'themes'),
  );
  expect(
    themesDirectory({ ...options, env: { PORTABLE_EXECUTABLE_DIR: path.resolve('portable') } }),
  ).toBe(path.resolve('portable/themes'));
  expect(
    themesDirectory({
      ...options,
      platform: 'linux',
      env: { APPIMAGE: path.resolve('images/Trace.AppImage') },
    }),
  ).toBe(path.resolve('images/themes'));
  expect(
    themesDirectory({
      ...options,
      platform: 'darwin',
      executable: path.resolve('Apps/Trace.app/Contents/MacOS/Trace'),
    }),
  ).toBe(path.resolve('Apps/themes'));
  expect(themesDirectory({ ...options, env: { TRACE_THEMES_DIR: path.resolve('isolated') } })).toBe(
    path.resolve('isolated'),
  );
});

it('creates an empty folder and catalogs Unicode paths, variants and independent errors without modifying files', async () => {
  const { root, id, folder, manifest } = await fixture();
  const empty = path.join(root, 'empty-root');
  expect((await scanThemes(empty)).themes).toEqual([]);
  await rm(empty, { recursive: true });
  const source = JSON.stringify({
    ...manifest,
    mode: undefined,
    variants: [
      { id: 'dark', name: 'Dark', mode: 'dark' },
      { id: 'light', name: 'Light', mode: 'light' },
    ],
  });
  await writeFile(path.join(folder, 'theme.json'), '\uFEFF' + source);
  await mkdir(path.join(root, 'Broken'));
  await writeFile(path.join(root, 'Broken', 'theme.json'), '{}');
  const catalog = await scanThemes(root);
  expect(catalog.themes.map((theme) => [theme.id, theme.variant, theme.mode])).toEqual([
    [id, 'dark', 'dark'],
    [id, 'light', 'light'],
  ]);
  expect(catalog.themes[0].stylesheet).toContain(encodeURIComponent(id));
  expect(userThemeKey(catalog.themes[0])).not.toBe(userThemeKey(catalog.themes[1]));
  expect(catalog.warnings).toHaveLength(1);
  expect(await readFile(path.join(folder, 'theme.json'), 'utf8')).toBe('\uFEFF' + source);
  await writeFile(
    path.join(folder, 'theme.json'),
    JSON.stringify({
      ...manifest,
      variants: [
        { id: 'same', name: 'A', mode: 'dark' },
        { id: 'same', name: 'B', mode: 'light' },
      ],
    }),
  );
  expect((await scanThemes(root)).themes).toEqual([]);
});

it('serves local CSS and images and rejects traversal, absolute paths and directory junction escapes', async () => {
  const { directory, root, id, folder } = await fixture();
  await writeFile(
    path.join(folder, 'assets', 'paper.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  );
  expect((await readThemeResource(root, id, 'assets/paper.svg')).mime).toBe('image/svg+xml');
  expect((await readThemeResource(root, id, 'style.css')).mime).toContain('text/css');
  for (const file of [
    '../secret.css',
    '/secret.css',
    'C:/secret.css',
    'assets\\paper.svg',
    'assets/../../secret.css',
  ])
    await expect(resolveThemeFile(root, id, file)).rejects.toThrow();
  const outside = path.join(directory, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'secret.css'), 'body {}');
  await symlink(outside, path.join(folder, 'escape'), 'junction');
  await expect(resolveThemeFile(root, id, 'escape/secret.css')).rejects.toThrow('escapes');
  await symlink(outside, path.join(root, 'external'), 'junction');
  await expect(resolveThemeFile(root, 'external', 'secret.css')).rejects.toThrow('escapes');
  await writeFile(path.join(folder, 'code.js'), 'throw new Error()');
  await expect(readThemeResource(root, id, 'code.js')).rejects.toThrow('Unsupported');
});

it('isolates missing stylesheets, unsupported formats and oversized resources', async () => {
  const { root, folder, id, manifest } = await fixture();
  await writeFile(path.join(folder, 'style.css'), ' '.repeat(2 * 1024 * 1024 + 1));
  expect((await scanThemes(root)).warnings.join()).toContain('too large');
  await expect(readThemeResource(root, id, 'style.css')).rejects.toThrow('too large');
  await writeFile(
    path.join(folder, 'theme.json'),
    JSON.stringify({ ...manifest, format: 'maploom/theme' }),
  );
  expect((await scanThemes(root)).themes).toEqual([]);
  await writeFile(
    path.join(folder, 'theme.json'),
    JSON.stringify({ ...manifest, stylesheet: 'missing.css' }),
  );
  expect((await scanThemes(root)).warnings).toHaveLength(1);
});
