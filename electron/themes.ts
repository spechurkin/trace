import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type ThemeCatalog, themeManifestSchema } from '../shared/themes';

const sourceLimit = 2 * 1024 * 1024;
const resourceLimit = 32 * 1024 * 1024;
const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

export async function installBundledTheme(root: string, source: string): Promise<void> {
  await mkdir(root, { recursive: true });
  const destination = path.join(root, path.basename(source));
  try {
    await mkdir(destination);
  } catch (error) {
    // Existing packages belong to the user, even if their manifest is currently invalid.
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
    throw error;
  }

  async function copyFolder(from: string, to: string): Promise<void> {
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const target = path.join(to, entry.name);
      if (entry.isDirectory()) {
        await mkdir(target);
        await copyFolder(path.join(from, entry.name), target);
      } else if (entry.isFile()) {
        await writeFile(target, await readFile(path.join(from, entry.name)), { flag: 'wx' });
      }
    }
  }

  await copyFolder(source, destination);
}

export function themesDirectory(options: {
  packaged: boolean;
  appPath: string;
  executable: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
}): string {
  if (options.env.TRACE_THEMES_DIR) return path.resolve(options.env.TRACE_THEMES_DIR);
  if (!options.packaged) return path.join(options.appPath, 'themes');
  if (options.platform === 'win32' && options.env.PORTABLE_EXECUTABLE_DIR)
    return path.join(options.env.PORTABLE_EXECUTABLE_DIR, 'themes');
  if (options.platform === 'linux' && options.env.APPIMAGE)
    return path.join(path.dirname(options.env.APPIMAGE), 'themes');
  let directory = path.dirname(options.executable);
  if (options.platform === 'darwin') {
    let current = directory;
    while (path.dirname(current) !== current) {
      if (current.endsWith('.app')) {
        directory = path.dirname(current);
        break;
      }
      current = path.dirname(current);
    }
  }
  return path.join(directory, 'themes');
}

function relativeParts(value: string): string[] {
  const parts = value.split('/');
  if (
    !value ||
    /[\\:\x00-\x1f]/.test(value) ||
    parts.some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Expected a relative path inside the theme folder');
  return parts;
}

function inside(base: string, file: string) {
  const relative = path.relative(base, file);
  return (
    relative !== '' &&
    !relative.startsWith('..' + path.sep) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}

export async function resolveThemeFile(root: string, id: string, file: string): Promise<string> {
  if (relativeParts(id).length !== 1) throw new Error('Invalid theme folder');
  const parts = relativeParts(file);
  const base = await realpath(root);
  const folder = await realpath(path.join(base, id));
  if (!inside(base, folder)) throw new Error('Theme folder escapes themes directory');
  const resolved = await realpath(path.join(folder, ...parts));
  if (!inside(folder, resolved) || !(await stat(resolved)).isFile())
    throw new Error('Theme resource escapes its folder');
  return resolved;
}

export async function readThemeResource(root: string, id: string, file: string) {
  const resolved = await resolveThemeFile(root, id, file);
  const mime = mimeTypes[path.extname(resolved).toLowerCase()];
  if (!mime) throw new Error('Unsupported theme resource type');
  const limit = file.endsWith('.css') ? sourceLimit : resourceLimit;
  if ((await stat(resolved)).size > limit) throw new Error('Theme resource is too large');
  return { bytes: await readFile(resolved), mime };
}

export async function scanThemes(root: string): Promise<ThemeCatalog> {
  const catalog: ThemeCatalog = { directory: root, themes: [], warnings: [] };
  try {
    await mkdir(root, { recursive: true });
    const entries = await readdir(root, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      try {
        const manifestFile = await resolveThemeFile(root, entry.name, 'theme.json');
        if ((await stat(manifestFile)).size > sourceLimit)
          throw new Error('Theme manifest is too large');
        const manifest = themeManifestSchema.parse(
          JSON.parse((await readFile(manifestFile, 'utf8')).replace(/^\uFEFF/, '')),
        );
        await readThemeResource(root, entry.name, manifest.stylesheet);
        const stylesheet = `trace://themes/v0/${encodeURIComponent(entry.name)}/${manifest.stylesheet.split('/').map(encodeURIComponent).join('/')}`;
        for (const variant of manifest.variants.length ? manifest.variants : [undefined]) {
          catalog.themes.push({
            id: entry.name,
            variant: variant?.id,
            name: variant?.name ?? manifest.name,
            description: manifest.description,
            mode: variant?.mode ?? manifest.mode!,
            stylesheet,
          });
        }
      } catch (error) {
        catalog.warnings.push(`${entry.name}: ${(error as Error).message}`);
      }
    }
  } catch (error) {
    catalog.warnings.push((error as Error).message);
  }
  return catalog;
}
