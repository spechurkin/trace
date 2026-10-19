import { describe, expect, it } from 'vitest';
import { nodesFromFolders } from '../src/creator-sources';
import { type Database, databaseSchema, deleteCharacterFolder, emptyDatabase } from '../shared/model';
import { createStoriesTransfer, mergeTransfer } from '../shared/transfer';

function fixture(): Database {
  return databaseSchema.parse({
    ...emptyDatabase(),
    folders: [
      { id: 'people', name: 'People', parentId: null, kind: 'person' },
      { id: 'child', name: 'Witnesses', parentId: 'people', kind: 'person' },
      { id: 'empty', name: 'Empty', parentId: 'people', kind: 'person' },
      { id: 'clues', name: 'Clues', parentId: null, kind: 'evidence' },
      { id: 'other', name: 'Other', parentId: null, kind: 'person' },
    ],
    characters: [
      {
        id: 'witness',
        name: 'Witness',
        folderId: 'child',
        color: '#123456',
        notes: 'Original',
        witness: true,
        answers: { identity: 'Author text' },
      },
      {
        id: 'clue',
        name: 'Clue',
        folderId: 'clues',
        color: '#123456',
        notes: '',
        kind: 'evidence',
      },
      { id: 'other-person', name: 'Other', folderId: 'other', color: '#123456', notes: '' },
      { id: 'unfiled', name: 'Unfiled', folderId: null, color: '#123456', notes: '' },
    ],
    boards: [
      {
        id: 'case',
        name: 'Case',
        description: '',
        characterIds: ['witness'],
        connections: [],
        creatorFolderIds: ['people', 'clues'],
      },
    ],
    activeBoardId: 'case',
  });
}

describe('creator folder sources', () => {
  it('reads subfolders and multiple categories once, preserving original nodes and ignoring unrelated folders', () => {
    const data = fixture();
    const nodes = nodesFromFolders(data.characters, data.folders, [
      'people',
      'child',
      'clues',
      'missing',
    ]);
    expect(nodes.map((node) => node.id)).toEqual(['witness', 'clue']);
    expect(nodes[0]).toBe(data.characters[0]);
    expect(nodesFromFolders(data.characters, data.folders, [])).toEqual([]);
  });

  it('preserves selected empty folders on export and remaps source IDs on import collisions', () => {
    const data = fixture();
    const exported = createStoriesTransfer(data);
    expect(exported.data.folders.map((folder) => folder.id)).toEqual([
      'people',
      'child',
      'empty',
      'clues',
    ]);
    expect(exported.data.characters.map((node) => node.id)).toEqual(['witness']);
    const target = emptyDatabase();
    target.folders = [{ id: 'people', name: 'Unrelated', parentId: null, kind: 'person' }];
    const merged = mergeTransfer(target, exported).data;
    const selected = merged.boards[0].creatorFolderIds!;
    expect(selected).not.toContain('people');
    expect(selected.map((id) => merged.folders.find((folder) => folder.id === id)!.name)).toEqual([
      'People',
      'Clues',
    ]);
    expect(
      nodesFromFolders(merged.characters, merged.folders, selected).map((node) => node.id),
    ).toEqual(['witness']);
  });

  it('removes deleted source folders without removing board participants or their content', () => {
    const data = deleteCharacterFolder(fixture(), 'people');
    expect(data.boards[0].creatorFolderIds).toEqual(['clues']);
    expect(data.boards[0].characterIds).toEqual(['witness']);
    expect(data.characters[0]).toMatchObject({
      id: 'witness',
      folderId: null,
      notes: 'Original',
      answers: { identity: 'Author text' },
    });
    expect(databaseSchema.safeParse(data).success).toBe(true);
  });
});
