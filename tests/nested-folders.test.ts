import { russianText } from './russian-fixtures';
import { describe, expect, it } from 'vitest';
import {
  type Database,
  databaseSchema,
  deleteCharacterFolder,
  emptyDatabase,
} from '../shared/model';
import { folderEntries, folderPath, folderSubtree, folderTrail } from '../shared/folders';
import {
  createCharactersTransfer,
  createStoriesTransfer,
  mergeTransfer,
  transferSchema,
} from '../shared/transfer';
import { demoDatabase } from './original-demo';

function nestedLibrary(): Database {
  const data = demoDatabase();
  // Children may precede their parents in a library or an imported file.
  data.folders = [
    { id: 'main', name: russianText('samples.mainCharacters'), parentId: 'family' },
    { id: 'family', name: russianText('demo.relationships.family'), parentId: 'world' },
    { id: 'world', name: russianText('samples.world'), parentId: null },
    { id: 'other-family', name: russianText('demo.relationships.family'), parentId: 'other' },
    { id: 'other', name: russianText('samples.anotherStory'), parentId: null },
    { id: 'empty', name: russianText('samples.emptyFolderName'), parentId: 'family' },
  ];
  data.characters[0].folderId = 'main';
  data.characters[2].folderId = 'family';
  data.characters[1].folderId = 'other-family';
  return data;
}

describe('nested character folders', () => {
  it('migrates flat version 2 libraries without changing characters, histories or the input file', () => {
    const data = demoDatabase();
    data.characters[0].folderId = 'family';
    const { clubs, activeClubId, ...rest } = data;
    const old = {
      ...rest,
      version: 2,
      circles: clubs,
      activeCircleId: activeClubId,
      folders: [{ id: 'family', name: russianText('demo.relationships.family') }],
    };
    const migrated = databaseSchema.parse(old);
    expect(migrated.version).toBe(4);
    expect(migrated.folders).toEqual([
      { id: 'family', name: russianText('demo.relationships.family'), parentId: null },
    ]);
    expect(migrated.characters).toEqual(data.characters);
    expect(migrated.clubs).toEqual(data.clubs);
    expect(old.version).toBe(2);
    expect(old.folders).toEqual([{ id: 'family', name: russianText('demo.relationships.family') }]);
  });
  it('allows repeated names in different parents while rejecting missing parents, self-parenting and cycles', () => {
    const data = nestedLibrary();
    expect(databaseSchema.safeParse(data).success).toBe(true);
    for (const parentId of ['missing', 'world', 'main']) {
      const invalid = structuredClone(data);
      invalid.folders.find((folder) => folder.id === 'world')!.parentId = parentId;
      expect(databaseSchema.safeParse(invalid).success).toBe(false);
    }
    data.folders.push({
      id: 'duplicate',
      name: russianText('samples.familyLowercase'),
      parentId: 'world',
    });
    expect(databaseSchema.safeParse(data).success).toBe(false);
  });
  it('builds parent-first paths and complete subtree filters from unordered folder records', () => {
    const folders = nestedLibrary().folders;
    expect(folderEntries(folders).map((entry) => [entry.folder.id, entry.depth])).toEqual([
      ['world', 0],
      ['family', 1],
      ['main', 2],
      ['empty', 2],
      ['other', 0],
      ['other-family', 1],
    ]);
    expect(folderPath(folders, 'main')).toBe(russianText('samples.worldFamilyMainPath'));
    expect(folderTrail(folders, 'main').map((folder) => folder.id)).toEqual([
      'world',
      'family',
      'main',
    ]);
    expect(folderSubtree(folders, 'family')).toEqual(new Set(['family', 'main', 'empty']));
  });
  it('deletes a complete branch but moves all its characters to the surviving parent without altering relationships', () => {
    const data = nestedLibrary();
    const deleted = deleteCharacterFolder(data, 'family');
    expect(deleted.folders.map((folder) => folder.id)).not.toContain('main');
    expect(deleted.folders.map((folder) => folder.id)).not.toContain('empty');
    expect(deleted.characters[0].folderId).toBe('world');
    expect(deleted.characters[2].folderId).toBe('world');
    expect(deleted.characters[1].folderId).toBe('other-family');
    expect(deleted.clubs).toEqual(data.clubs);
    expect(deleted.relationTypes).toEqual(data.relationTypes);
    expect(databaseSchema.parse(deleted)).toEqual(deleted);
    expect(deleteCharacterFolder(data, 'world').characters[0].folderId).toBeNull();
    expect(data.characters[0].folderId).toBe('main');
    expect(deleteCharacterFolder(data, 'missing')).toBe(data);
  });
  it('supports deeply nested folders within the existing 500-folder limit', () => {
    const data = emptyDatabase();
    data.folders = Array.from({ length: 500 }, (_, index) => ({
      id: `folder-${index}`,
      name: russianText('samples.numberedFolder', index),
      parentId: index ? `folder-${index - 1}` : null,
    }));
    expect(databaseSchema.safeParse(data).success).toBe(true);
    expect(folderEntries(data.folders).at(-1)?.depth).toBe(499);
    expect(folderSubtree(data.folders, 'folder-0').size).toBe(500);
  });
});

describe('nested folders in JSON transfer files', () => {
  it('exports all ancestors for a single character or a story and keeps folders self-contained', () => {
    const data = nestedLibrary();
    const one = createCharactersTransfer(data, { characterIds: ['nora'] });
    expect(new Set(one.data.folders.map((folder) => folder.id))).toEqual(
      new Set(['world', 'family', 'main']),
    );
    expect(one.data.characters).toEqual([data.characters[0]]);
    expect(one.data.clubs).toEqual([]);
    expect(transferSchema.parse(JSON.parse(JSON.stringify(one)))).toEqual(one);
    const story = createStoriesTransfer(data);
    expect(story.data.folders.map((folder) => folder.id)).not.toContain('empty');
    expect(mergeTransfer(emptyDatabase(), story).data.clubs).toEqual(data.clubs);
  });
  it('exports an entire selected branch including empty subfolders and the required ancestors, excluding other branches', () => {
    const file = createCharactersTransfer(nestedLibrary(), { folderId: 'family' });
    expect(file.data.characters.map((character) => character.id)).toEqual(['nora', 'mira']);
    expect(new Set(file.data.folders.map((folder) => folder.id))).toEqual(
      new Set(['main', 'family', 'world', 'empty']),
    );
    expect(file.data.relationTypes).toEqual([]);
    expect(file.data.clubs).toEqual([]);
    expect(
      folderEntries(mergeTransfer(emptyDatabase(), file).data.folders).map((entry) => entry.path),
    ).toEqual([
      russianText('samples.world'),
      russianText('samples.worldFamilyPath'),
      russianText('samples.worldFamilyMainPath'),
      russianText('samples.worldFamilyEmptyPath'),
    ]);
  });
  it('merges by full parent path, remaps colliding IDs and does not duplicate records on another import', () => {
    const source = nestedLibrary();
    const local = nestedLibrary();
    local.folders.find((folder) => folder.id === 'world')!.name = russianText('samples.localWorld');
    const before = structuredClone(local);
    const file = createCharactersTransfer(source, { folderId: 'family' });
    const merged = mergeTransfer(local, file);
    expect(local).toEqual(before);
    const paths = folderEntries(merged.data.folders).map((entry) => entry.path);
    expect(paths).toContain(russianText('samples.localWorldFamilyMainPath'));
    expect(paths).toContain(russianText('samples.worldFamilyMainPath'));
    expect(paths).toContain(russianText('samples.anotherStoryFamilyPath'));
    expect(merged.summary.folders).toBe(4);
    expect(merged.data.clubs).toEqual(before.clubs);
    expect(mergeTransfer(merged.data, file).data).toEqual(merged.data);
  });
  it('reuses an identical hierarchy with different IDs and imports old flat-folder transfer files', () => {
    const source = nestedLibrary();
    const file = createCharactersTransfer(source);
    const renamed = structuredClone(file);
    renamed.data.folders = renamed.data.folders.map((folder) => ({
      ...folder,
      id: `copy-${folder.id}`,
      parentId: folder.parentId ? `copy-${folder.parentId}` : null,
    }));
    renamed.data.characters = renamed.data.characters.map((character) => ({
      ...character,
      folderId: character.folderId ? `copy-${character.folderId}` : null,
    }));
    expect(mergeTransfer(source, renamed).data).toEqual(source);
    const old = {
      format: 'trace-transfer',
      version: 1,
      kind: 'characters',
      data: {
        ...emptyDatabase(),
        version: 2,
        folders: [{ id: 'flat', name: russianText('samples.legacyFolder') }],
      },
    };
    expect(mergeTransfer(emptyDatabase(), old).data.folders).toEqual([
      { id: 'flat', name: russianText('samples.legacyFolder'), parentId: null },
    ]);
  });
});
