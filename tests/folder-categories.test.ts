import { describe, expect, it } from 'vitest';
import { databaseSchema, deleteCharacterFolder, emptyDatabase } from '../shared/model';
import { folderKindOf, folderPath } from '../shared/folders';
import { createCharactersTransfer, mergeTransfer } from '../shared/transfer';
import { demoDatabase } from '../src/demo';

describe('category-owned folders', () => {
  it('allows the same name across categories and rejects cross-category nodes and parents', () => {
    const data = demoDatabase();
    expect(databaseSchema.safeParse(data).success).toBe(true);
    const node = data.characters.find((node) => node.kind === 'evidence')!;
    node.folderId = 'person';
    expect(databaseSchema.safeParse(data).success).toBe(false);
    node.folderId = 'evidence';
    data.folders.find((folder) => folder.id === 'evidence')!.parentId = 'person';
    expect(databaseSchema.safeParse(data).success).toBe(false);
  });

  it('migrates mixed legacy branches, empty folders and colliding IDs without changing boards', () => {
    const original = demoDatabase();
    const legacy = {
      ...original,
      folders: [
        { id: 'leaf', name: 'Leaf', parentId: 'root' },
        { id: 'empty', name: 'Empty', parentId: 'root' },
        { id: 'root', name: 'Case', parentId: null },
        { id: 'root-evidence', name: 'Existing', parentId: null },
      ],
      characters: original.characters.map((node) => ({ ...node, folderId: 'leaf' })),
    };
    const before = structuredClone(legacy);
    const migrated = databaseSchema.parse(legacy);
    expect(legacy).toEqual(before);
    expect(migrated.clubs).toEqual(original.clubs);
    expect(new Set(migrated.folders.map((folder) => folder.id)).size).toBe(migrated.folders.length);
    for (const node of migrated.characters) {
      expect(folderKindOf(migrated.folders.find((folder) => folder.id === node.folderId)!)).toBe(
        node.kind,
      );
      expect(folderPath(migrated.folders, node.folderId!)).toBe('Case / Leaf');
      expect({ ...node, folderId: null }).toEqual({
        ...original.characters.find((item) => item.id === node.id),
        folderId: null,
      });
    }
    expect(migrated.folders.filter((folder) => folder.name === 'Empty')).toHaveLength(1);
    expect(databaseSchema.parse(migrated)).toEqual(migrated);
    const personRoot = migrated.folders.find(
      (folder) => folder.name === 'Case' && folderKindOf(folder) === 'person',
    )!;
    const deleted = deleteCharacterFolder(migrated, personRoot.id);
    expect(
      deleted.characters
        .filter((node) => node.kind === 'person')
        .every((node) => node.folderId === null),
    ).toBe(true);
    expect(deleted.characters.filter((node) => node.kind !== 'person')).toEqual(
      migrated.characters.filter((node) => node.kind !== 'person'),
    );
    expect(databaseSchema.safeParse(deleted).success).toBe(true);
  });

  it('assigns an empty old tree to people and infers non-person ownership from descendants', () => {
    const empty = { ...emptyDatabase(), folders: [{ id: 'empty', name: 'Empty' }] };
    expect(folderKindOf(databaseSchema.parse(empty).folders[0])).toBe('person');
    const old = {
      ...emptyDatabase(),
      folders: [
        { id: 'case', name: 'Case' },
        { id: 'child', name: 'Clues', parentId: 'case' },
      ],
      characters: [
        {
          ...demoDatabase().characters.find((node) => node.kind === 'evidence')!,
          folderId: 'child',
        },
      ],
    };
    expect(databaseSchema.parse(old).folders.map(folderKindOf)).toEqual(['evidence', 'evidence']);
  });

  it('keeps same-name folders from different categories separate during repeated imports', () => {
    const local = emptyDatabase();
    local.folders = [{ id: 'shared', name: 'Case', parentId: null, kind: 'person' }];
    const source = emptyDatabase();
    source.folders = [{ id: 'shared', name: 'Case', parentId: null, kind: 'evidence' }];
    source.characters = [
      {
        ...demoDatabase().characters.find((node) => node.kind === 'evidence')!,
        folderId: 'shared',
      },
    ];
    const file = createCharactersTransfer(source);
    const merged = mergeTransfer(local, file);
    expect(merged.data.folders).toHaveLength(2);
    expect(merged.data.characters[0].folderId).not.toBe('shared');
    expect(
      merged.data.folders.find((folder) => folder.id === merged.data.characters[0].folderId)?.kind,
    ).toBe('evidence');
    expect(mergeTransfer(merged.data, file).data).toEqual(merged.data);
    expect(createCharactersTransfer(merged.data, { folderId: 'shared' }).data.characters).toEqual(
      [],
    );
  });
});
