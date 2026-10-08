import { russianText } from './russian-fixtures';
import { describe, expect, it } from 'vitest';
import { type Database, databaseSchema, emptyDatabase } from '../shared/model';
import {
  createCharactersTransfer,
  createStoriesTransfer,
  mergeTransfer,
  transferSchema,
} from '../shared/transfer';

function fixture(): Database {
  return {
    ...emptyDatabase(),
    folders: [
      { id: 'family', name: russianText('demo.relationships.family'), parentId: null },
      { id: 'unused-folder', name: russianText('samples.others'), parentId: null },
    ],
    characters: [
      {
        id: 'alice',
        name: russianText('samples.alice'),
        color: '#abcdef',
        notes: russianText('samples.note'),
        folderId: 'family',
        image: 'data:image/webp;base64,YWJj',
      },
      {
        id: 'bob',
        name: russianText('samples.boris'),
        color: '#123456',
        notes: '',
        folderId: null,
      },
      {
        id: 'unused',
        name: russianText('samples.anotherCharacter'),
        color: '#987654',
        notes: '',
        folderId: 'unused-folder',
      },
    ],
    relationTypes: [
      { id: 'fear', name: russianText('demo.relationships.fear'), color: '#112233' },
      { id: 'unused-type', name: russianText('demo.relationships.love'), color: '#aabbcc' },
    ],
    clubs: [
      {
        id: 'story',
        name: russianText('samples.story'),
        description: russianText('forms.descriptionLabel'),
        characterIds: ['bob', 'alice'],
        connections: [
          {
            id: 'edge',
            sourceId: 'bob',
            targetId: 'alice',
            typeId: 'fear',
            directed: true,
            notes: russianText('connections.notesLabel'),
          },
        ],
      },
      {
        id: 'empty-story',
        name: russianText('samples.emptyStory'),
        description: '',
        characterIds: [],
        connections: [],
      },
    ],
    activeClubId: 'empty-story',
  };
}

describe('portable JSON exports', () => {
  it('imports previous story packages and emits only the current club fields', () => {
    const file = createStoriesTransfer(fixture());
    const { clubs, activeClubId, ...rest } = file.data;
    const previous = {
      ...file,
      data: { ...rest, version: 3, circles: clubs, activeCircleId: activeClubId },
    };
    expect(transferSchema.parse(previous)).toEqual(file);
    const merged = mergeTransfer(emptyDatabase(), previous);
    expect(merged.data).toEqual(file.data);
    expect(merged.summary.clubs).toBe(2);
    expect(JSON.stringify(merged.data)).not.toMatch(/"(?:circles|activeCircleId)"/);
  });
  it('exports a complete story with portraits, folders and used relations, omitting unrelated library entries', () => {
    const data = fixture();
    const file = createStoriesTransfer(data, ['story']);
    expect(file.kind).toBe('stories');
    expect(file.data.clubs).toEqual([data.clubs[0]]);
    expect(file.data.characters).toEqual(data.characters.slice(0, 2));
    expect(file.data.folders).toEqual([data.folders[0]]);
    expect(file.data.relationTypes).toEqual([data.relationTypes[0]]);
    expect(file.data.activeClubId).toBe('story');
    expect(transferSchema.parse(JSON.parse(JSON.stringify(file)))).toEqual(file);
    file.data.characters[0].name = russianText('samples.modified');
    expect(data.characters[0].name).toBe(russianText('samples.alice'));
  });
  it('exports all stories including empty ones and keeps each participant only once', () => {
    const data = fixture();
    data.clubs.push({ ...structuredClone(data.clubs[0]), id: 'second' });
    const file = createStoriesTransfer(data);
    expect(file.data.clubs).toEqual(data.clubs);
    expect(file.data.characters).toHaveLength(2);
    expect(file.data.activeClubId).toBe('empty-story');
    expect(createStoriesTransfer(emptyDatabase()).data).toEqual(emptyDatabase());
  });
  it('exports all characters, a folder, an empty folder, unfiled characters or one portrait without stories or relationships', () => {
    const data = fixture();
    data.folders.push({ id: 'empty', name: russianText('samples.emptyFolder'), parentId: null });
    const all = createCharactersTransfer(data);
    expect(all.data.characters).toEqual(data.characters);
    expect(all.data.folders).toEqual(data.folders);
    expect(all.data.clubs).toEqual([]);
    expect(all.data.relationTypes).toEqual([]);
    expect(all.data.activeClubId).toBeNull();
    const folder = createCharactersTransfer(data, { folderId: 'family' });
    expect(folder.data.characters).toEqual([data.characters[0]]);
    expect(folder.data.folders).toEqual([data.folders[0]]);
    expect(createCharactersTransfer(data, { folderId: 'empty' }).data.folders).toEqual([
      data.folders[2],
    ]);
    expect(createCharactersTransfer(data, { folderId: null }).data.characters).toEqual([
      data.characters[1],
    ]);
    expect(createCharactersTransfer(data, { characterIds: ['alice'] })).toEqual(folder);
    expect(() => createStoriesTransfer(data, ['missing'])).toThrow();
    expect(() => createCharactersTransfer(data, { folderId: 'missing' })).toThrow();
  });
  it('rejects malformed packages, unsupported versions, mismatched content and broken references', () => {
    const file = createStoriesTransfer(fixture());
    expect(transferSchema.safeParse({ ...file, version: 99 }).success).toBe(false);
    expect(transferSchema.safeParse({ ...file, kind: 'characters' }).success).toBe(false);
    expect(transferSchema.safeParse({ ...file, kind: 'relations' }).success).toBe(false);
    file.data.characters.pop();
    expect(transferSchema.safeParse(file).success).toBe(false);
    expect(() => mergeTransfer(emptyDatabase(), fixture())).toThrow();
  });
});

describe('import adds to the existing library', () => {
  it('adds stories and their dependencies and avoids duplicates on repeated import', () => {
    const file = createStoriesTransfer(fixture());
    const merged = mergeTransfer(emptyDatabase(), file);
    expect(merged.data).toEqual(file.data);
    expect(merged.summary).toEqual({
      characters: 2,
      folders: 1,
      relationTypes: 1,
      clubs: 2,
      reused: 0,
    });
    const repeated = mergeTransfer(merged.data, file);
    expect(repeated.data).toEqual(merged.data);
    expect(repeated.summary).toEqual({
      characters: 0,
      folders: 0,
      relationTypes: 0,
      clubs: 0,
      reused: 6,
    });
  });
  it('preserves existing data and active story, remaps collisions and reuses content on the next import', () => {
    const local = fixture();
    const file = createStoriesTransfer(fixture());
    local.folders[0].name = russianText('samples.localFamily');
    local.characters[0].name = russianText('samples.localAlice');
    local.relationTypes[0].color = '#654321';
    local.clubs[0].name = russianText('samples.localStory');
    const before = structuredClone(local);
    const packageBefore = structuredClone(file);
    const merged = mergeTransfer(local, file);
    expect(local).toEqual(before);
    expect(file).toEqual(packageBefore);
    expect(merged.data.characters.slice(0, 3)).toEqual(local.characters);
    expect(merged.data.clubs.slice(0, 2)).toEqual(local.clubs);
    expect(merged.data.folders.slice(0, 2)).toEqual(local.folders);
    expect(merged.data.relationTypes.slice(0, 2)).toEqual(local.relationTypes);
    expect(merged.data.activeClubId).toBe(local.activeClubId);
    const imported = merged.data.clubs.find((club) => club.name === russianText('samples.story'))!;
    const alice = merged.data.characters.find(
      (character) => character.name === russianText('samples.alice'),
    )!;
    const fear = merged.data.relationTypes.find((type) => type.color === '#112233')!;
    expect(alice.id).not.toBe('alice');
    expect(imported.id).not.toBe('story');
    expect(imported.characterIds).toEqual(['bob', alice.id]);
    expect(imported.connections[0]).toEqual({
      ...file.data.clubs[0].connections[0],
      targetId: alice.id,
      typeId: fear.id,
    });
    expect(alice.folderId).toBe(
      merged.data.folders.find(
        (folder) => folder.name === russianText('demo.relationships.family'),
      )!.id,
    );
    expect(databaseSchema.safeParse(merged.data).success).toBe(true);
    expect(mergeTransfer(merged.data, file).data).toEqual(merged.data);
  });
  it('reuses folders by name and characters and relationships by content even when IDs differ', () => {
    const local = fixture();
    const file = createStoriesTransfer(fixture());
    file.data.folders[0].id = 'new-folder';
    file.data.folders[0].name = russianText('samples.familyLowercase');
    file.data.characters[0].folderId = 'new-folder';
    file.data.characters[0].id = 'new-alice';
    file.data.clubs[0].characterIds[1] = 'new-alice';
    file.data.clubs[0].connections[0].targetId = 'new-alice';
    file.data.relationTypes[0].id = 'new-fear';
    file.data.clubs[0].connections[0].typeId = 'new-fear';
    expect(mergeTransfer(local, file).data).toEqual(local);
  });
  it('keeps distinct identical characters and relation types distinct, including after repeated import', () => {
    const data = fixture();
    data.characters[1] = { ...data.characters[0], id: 'bob' };
    data.relationTypes[1] = { ...data.relationTypes[0], id: 'unused-type' };
    data.clubs[0].connections.push({
      ...data.clubs[0].connections[0],
      id: 'second-edge',
      typeId: 'unused-type',
    });
    const file = createStoriesTransfer(data);
    const local = emptyDatabase();
    local.characters.push({ ...data.characters[0], id: 'local-alice' });
    local.folders = data.folders.slice(0, 1);
    const merged = mergeTransfer(local, file);
    expect(merged.data.characters).toHaveLength(2);
    expect(new Set(merged.data.clubs[0].characterIds).size).toBe(2);
    expect(merged.data.relationTypes).toHaveLength(2);
    expect(mergeTransfer(merged.data, file).data).toEqual(merged.data);
  });
  it('imports only characters or relation types without creating histories and enforces merged library limits', () => {
    const data = fixture();
    const characters = mergeTransfer(emptyDatabase(), createCharactersTransfer(data)).data;
    expect(characters.characters).toEqual(data.characters);
    expect(characters.clubs).toEqual([]);
    expect(characters.relationTypes).toEqual([]);
    const relations = {
      format: 'trace-transfer',
      version: 1,
      kind: 'relations',
      data: { ...emptyDatabase(), relationTypes: data.relationTypes },
    };
    const types = mergeTransfer(emptyDatabase(), relations).data;
    expect(types.relationTypes).toEqual(data.relationTypes);
    expect(types.characters).toEqual([]);
    const full = emptyDatabase();
    full.relationTypes = Array.from({ length: 200 }, (_, i) => ({
      id: `type-${i}`,
      name: russianText('samples.numberedRelationship', i),
      color: '#abcdef',
    }));
    expect(() => mergeTransfer(full, relations)).toThrow();
    expect(full.relationTypes).toHaveLength(200);
  });
});
