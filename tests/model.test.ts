import { russianText } from './russian-fixtures';
import { describe, expect, it } from 'vitest';
import {
  databaseSchema,
  deleteCharacter,
  deleteCharacterFolder,
  removeFromClub,
} from '../shared/model';
import { demoDatabase } from './original-demo';
import { boardBounds, clubPositions, edgeGeometry } from '../src/geometry';

describe('character folders', () => {
  it('opens original libraries without changing characters, portraits or clubs', () => {
    const original = demoDatabase();
    const { folders: _folders, clubs, activeClubId, ...rest } = original;
    const legacy = {
      ...rest,
      version: 1,
      circles: clubs,
      activeCircleId: activeClubId,
      characters: original.characters.map(({ folderId: _folderId, ...character }) => character),
    };
    const migrated = databaseSchema.parse(legacy);
    expect(migrated.version).toBe(4);
    expect(migrated.folders).toEqual([]);
    expect(migrated.characters).toEqual(original.characters);
    expect(migrated.clubs).toEqual(original.clubs);
    expect(legacy.version).toBe(1);
  });
  it('rejects missing folder references and duplicate folder names or IDs', () => {
    const data = demoDatabase();
    data.characters[0].folderId = 'missing';
    expect(databaseSchema.safeParse(data).success).toBe(false);
    data.folders = [
      { id: 'missing', name: russianText('demo.relationships.family'), parentId: null },
    ];
    expect(databaseSchema.safeParse(data).success).toBe(true);
    data.folders.push({
      id: 'second',
      name: russianText('samples.familyLowercase'),
      parentId: null,
    });
    expect(databaseSchema.safeParse(data).success).toBe(false);
    data.folders[1] = { id: 'missing', name: russianText('samples.friends'), parentId: null };
    expect(databaseSchema.safeParse(data).success).toBe(false);
  });
  it('deletes a folder while preserving its members and all club relationships', () => {
    const data = demoDatabase();
    data.folders = [
      { id: 'family', name: russianText('demo.relationships.family'), parentId: null },
      { id: 'friends', name: russianText('samples.friends'), parentId: null },
    ];
    data.characters[0].folderId = data.characters[2].folderId = 'family';
    data.characters[1].folderId = 'friends';
    const deleted = deleteCharacterFolder(data, 'family');
    expect(deleted.characters).toHaveLength(data.characters.length);
    expect(deleted.characters[0].folderId).toBeNull();
    expect(deleted.characters[2].folderId).toBeNull();
    expect(deleted.characters[1].folderId).toBe('friends');
    expect(deleted.clubs).toEqual(data.clubs);
    expect(deleted.relationTypes).toEqual(data.relationTypes);
    expect(databaseSchema.safeParse(deleted).success).toBe(true);
    expect(data.characters[0].folderId).toBe('family');
  });
});

describe('library integrity', () => {
  it.each([1, 2, 3])('migrates legacy version %i fields without losing club data', (version) => {
    const current = demoDatabase();
    const { clubs, activeClubId, folders, ...rest } = current;
    const previous = {
      ...rest,
      version,
      circles: clubs,
      activeCircleId: activeClubId,
      ...(version === 1 ? {} : { folders }),
    };
    const original = structuredClone(previous);
    const migrated = databaseSchema.parse(previous);
    expect(migrated).toEqual(current);
    expect(previous).toEqual(original);
    expect(JSON.stringify(migrated)).not.toMatch(/"(?:circles|activeCircleId)"/);
  });
  it('rejects mixed legacy/current fields and invalid migrated club references', () => {
    const current = demoDatabase();
    const { clubs, activeClubId, ...rest } = current;
    const previous = { ...rest, version: 3, circles: clubs, activeCircleId: activeClubId };
    expect(databaseSchema.safeParse({ ...previous, clubs }).success).toBe(false);
    expect(databaseSchema.safeParse({ ...previous, activeClubId }).success).toBe(false);
    expect(databaseSchema.safeParse({ ...previous, activeCircleId: 'missing' }).success).toBe(
      false,
    );
    expect(databaseSchema.safeParse({ ...previous, version: 4 }).success).toBe(false);
    const broken = structuredClone(previous);
    broken.circles[0].connections[0].targetId = 'missing';
    expect(databaseSchema.safeParse(broken).success).toBe(false);
  });
  it('accepts a complete library and rejects dangling references, duplicate IDs and unsafe portraits', () => {
    const data = demoDatabase();
    expect(databaseSchema.parse(data)).toEqual(data);
    const missing = structuredClone(data);
    missing.characters.pop();
    expect(databaseSchema.safeParse(missing).success).toBe(false);
    const duplicate = structuredClone(data);
    duplicate.characters.push(duplicate.characters[0]);
    expect(databaseSchema.safeParse(duplicate).success).toBe(false);
    const portrait = structuredClone(data);
    portrait.characters[0].image = 'https://example.com/portrait.jpg';
    expect(databaseSchema.safeParse(portrait).success).toBe(false);
  });
  it('removes a participant only from one club and removes their links there', () => {
    const data = demoDatabase();
    const updated = removeFromClub(data.clubs[0], 'nora');
    expect(updated.characterIds).not.toContain('nora');
    expect(updated.connections.some((e) => e.sourceId === 'nora' || e.targetId === 'nora')).toBe(
      false,
    );
    expect(data.characters.some((c) => c.id === 'nora')).toBe(true);
    expect(data.clubs[0].characterIds).toContain('nora');
  });
  it('cascades permanent character deletion across clubs', () => {
    const data = demoDatabase();
    data.clubs.push({ ...structuredClone(data.clubs[0]), id: 'second' });
    const deletedCharacter = deleteCharacter(data, 'nora');
    expect(deletedCharacter.clubs.every((c) => !c.characterIds.includes('nora'))).toBe(true);
    expect(databaseSchema.safeParse(deletedCharacter).success).toBe(true);
  });
  it('prevents duplicate mutual links while allowing different types and directions', () => {
    const data = demoDatabase();
    const club = data.clubs[0];
    const edge = club.connections[0];
    club.connections.push({
      ...edge,
      id: 'new',
      sourceId: edge.targetId,
      targetId: edge.sourceId,
    });
    expect(databaseSchema.safeParse(data).success).toBe(false);
    club.connections[club.connections.length - 1].typeId = 'fear';
    expect(databaseSchema.safeParse(data).success).toBe(true);
    club.connections[club.connections.length - 1] = { ...edge, id: 'new', directed: true };
    expect(databaseSchema.safeParse(data).success).toBe(true);
  });
});

describe('diagram geometry', () => {
  it('expands crowded clubs and retains room for the entire exported legend', () => {
    const ids = Array.from({ length: 60 }, (_, index) => String(index));
    const positions = clubPositions(ids);
    const first = positions.get('0')!,
      second = positions.get('1')!;
    expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThan(100);
    const bounds = boardBounds(
      { id: 'crowded', name: 'Crowded board', description: '', characterIds: ids, connections: [] },
      30,
    );
    expect(bounds.legendHeight).toBe(140);
    expect(
      [...positions.values()].every(
        (p) =>
          p.x > bounds.x &&
          p.x < bounds.x + bounds.width &&
          p.y > bounds.y &&
          p.y < bounds.y + bounds.height,
      ),
    ).toBe(true);
  });
  it('places nodes at equal distance around the ring', () => {
    const positions = clubPositions(['a', 'b', 'c', 'd']);
    const radii = [...positions.values()].map((p) => Math.hypot(p.x - 460, p.y - 410));
    expect(new Set(radii.map((r) => Math.round(r))).size).toBe(1);
    expect(positions.get('a')?.y).toBeLessThan(410);
  });
  it('separates reverse directed connections and parallel types', () => {
    const a = {
      id: 'a',
      sourceId: 'nora',
      targetId: 'mira',
      typeId: 'family',
      directed: true,
      notes: '',
    };
    const b = { ...a, id: 'b', sourceId: 'mira', targetId: 'nora' };
    const positions = clubPositions(['nora', 'mira']);
    const first = edgeGeometry(a, [a, b], positions),
      second = edgeGeometry(b, [a, b], positions);
    expect(first.label.x).not.toBe(second.label.x);
    expect(first.path).not.toContain('NaN');
    expect(second.path).not.toContain('NaN');
  });
});
