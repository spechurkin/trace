import { russianText } from './russian-fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Repository } from '../electron/repository';
import { setLocale } from '../shared/i18n';
import { demoDatabase } from './original-demo';

setLocale('ru');

const directories: string[] = [];

async function repository() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'krugi-test-'));
  directories.push(directory);
  return new Repository(directory);
}

afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe('local filesystem persistence', () => {
  it.each([1, 2, 3])(
    'migrates an on-disk version %i library and retains the original backup',
    async (version) => {
      const repo = await repository();
      const current = demoDatabase();
      const { clubs, activeClubId, folders, ...rest } = current;
      const legacy = {
        ...rest,
        version,
        circles: clubs,
        activeCircleId: activeClubId,
        ...(version === 1 ? {} : { folders }),
        characters: current.characters.map(({ folderId: _folderId, ...character }) => character),
      };
      await writeFile(repo.file, JSON.stringify(legacy));
      const loaded = await repo.load();
      expect(loaded.data).toEqual(current);
      expect(JSON.parse(await readFile(repo.file, 'utf8'))).toEqual(legacy);
      loaded.data.folders.push({
        id: 'family',
        name: russianText('demo.relationships.family'),
        parentId: null,
      });
      loaded.data.characters[0].folderId = 'family';
      await repo.save(loaded.data);
      expect(JSON.parse(await readFile(repo.file + '.bak', 'utf8'))).toEqual(legacy);
      expect((await new Repository(repo.directory).load()).data).toEqual(loaded.data);
    },
  );
  it('initializes an empty library and preserves write ordering and previous backup', async () => {
    const repo = await repository();
    expect((await repo.load()).data.characters).toEqual([]);
    const first = demoDatabase(),
      second = structuredClone(first);
    second.characters[0].name = russianText('samples.renamedCharacter');
    await Promise.all([repo.save(first), repo.save(second)]);
    expect(JSON.parse(await readFile(repo.file, 'utf8'))).toEqual(second);
    expect(JSON.parse(await readFile(repo.file + '.bak', 'utf8'))).toEqual(first);
    expect((await new Repository(repo.directory).load()).data).toEqual(second);
  });
  it('recovers from a corrupt primary without overwriting the last valid backup', async () => {
    const repo = await repository();
    await repo.load();
    await repo.save(demoDatabase());
    await repo.save(demoDatabase());
    await writeFile(repo.file, 'broken json');
    const restored = new Repository(repo.directory);
    const loaded = await restored.load();
    expect(loaded.warning).toContain(russianText('samples.backupRecoveredText'));
    await restored.save(loaded.data);
    expect(JSON.parse(await readFile(repo.file + '.bak', 'utf8'))).toEqual(demoDatabase());
  });
  it('preserves unreadable data and rejects writes until explicit recovery', async () => {
    const repo = await repository();
    await writeFile(repo.file, 'broken json');
    await expect(repo.load()).rejects.toThrow(russianText('samples.originalFilesPreservedText'));
    await expect(repo.save(demoDatabase())).rejects.toThrow(
      russianText('samples.libraryNotLoadedText'),
    );
    expect(await readFile(repo.file, 'utf8')).toBe('broken json');
    await repo.save(demoDatabase(), true);
    expect((await repo.load()).data).toEqual(demoDatabase());
  });
});
