import { expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prepareDataDirectory } from '../electron/data-directory';

it('uses an independent Trace profile and preserves the source application library', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'trace-profile-'));
  try {
    for (const name of ['Clubs', 'Circles', 'Krugi']) {
      await mkdir(path.join(root, name));
      await writeFile(path.join(root, name, 'library.json'), name);
    }
    expect(prepareDataDirectory(root)).toEqual({ directory: path.join(root, 'Trace') });
    expect(prepareDataDirectory(root, path.join(root, 'custom'))).toEqual({
      directory: path.join(root, 'custom'),
    });
    for (const name of ['Clubs', 'Circles', 'Krugi'])
      expect(await readFile(path.join(root, name, 'library.json'), 'utf8')).toBe(name);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
