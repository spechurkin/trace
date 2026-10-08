import { expect, it } from 'vitest';
import {
  boardEdges,
  BRANCH_COLORS,
  branchOf,
  canParent,
  CULPRIT,
  retainMembers,
  setParent,
} from '../shared/investigation';
import { databaseSchema, deleteCharacter, emptyDatabase, removeFromClub } from '../shared/model';
import { demoDatabase } from '../src/demo';
import { boardBounds, boardPositions, CENTER, edgeGeometry } from '../src/geometry';
import { createStoriesTransfer, mergeTransfer } from '../shared/transfer';

it('colors each branch by its child, including evidence below a suspect and a location below evidence', () => {
  const data = demoDatabase(),
    board = data.clubs[0],
    edges = boardEdges(board, data.characters);
  expect(edges.map((e) => [e.sourceId, e.targetId, e.typeId])).toContainEqual([
    'loro',
    'missingFolder',
    'evidence',
  ]);
  expect(edges.map((e) => [e.sourceId, e.targetId, e.typeId])).toContainEqual([
    'folder',
    'archive',
    'location',
  ]);
  expect(BRANCH_COLORS.evidence).toBe('#D93846');
  expect(BRANCH_COLORS.location).toBe('#E68A22');
  expect(branchOf(data.characters[0])).toBe('suspect');
  expect(branchOf({ ...data.characters[0], suspect: false })).toBe('witness');
  expect(edges).toHaveLength(board.characterIds.length);
});
it('prevents cycles, self-parenting and parents outside the board before saving or importing', () => {
  const data = demoDatabase(),
    board = data.clubs[0];
  expect(canParent(board, 'domye', 'apartment')).toBe(false);
  expect(canParent(board, 'domye', 'domye')).toBe(false);
  expect(canParent(board, 'domye', 'missing')).toBe(false);
  expect(() => setParent(board, 'domye', 'apartment')).toThrow();
  expect(setParent(board, 'pressure', 'celine').layout?.pressure.parentId).toBe('celine');
  board.layout!.domye.parentId = 'apartment';
  expect(databaseSchema.safeParse(data).success).toBe(false);
});
it('keeps every remaining branch connected to the culprit when a parent is removed', () => {
  const data = demoDatabase(),
    board = data.clubs[0];
  for (const changed of [
    removeFromClub(board, 'domye'),
    retainMembers(
      board,
      board.characterIds.filter((id) => id !== 'domye'),
    ),
    deleteCharacter(data, 'domye').clubs[0],
  ]) {
    expect(changed.layout?.pressure.parentId).toBe(CULPRIT);
    expect(databaseSchema.safeParse({ ...data, clubs: [changed] }).success).toBe(true);
  }
  expect(board.layout?.pressure.parentId).toBe('domye');
});
it('round trips questions, both roles, positions and locks and remaps all tree references on ID collisions', () => {
  const incoming = demoDatabase();
  incoming.characters[0].answers = { alibi: 'On platform 2', testimony: 'Heard a whistle' };
  incoming.clubs[0].layout!.domye.locked = true;
  const existing = demoDatabase();
  existing.characters[0].name = 'Different person';
  existing.clubs[0].name = 'Another case';
  const file = createStoriesTransfer(incoming);
  const result = mergeTransfer(existing, file);
  const imported = result.data.clubs.find((b) => b.name === incoming.clubs[0].name)!;
  const domye = result.data.characters.find((n) => n.answers?.alibi === 'On platform 2')!;
  expect(domye.id).not.toBe('domye');
  expect(domye.witness && domye.suspect).toBe(true);
  expect(imported.layout?.[domye.id]).toEqual({ ...incoming.clubs[0].layout!.domye });
  expect(imported.layout?.pressure.parentId).toBe(domye.id);
  expect(databaseSchema.safeParse(result.data).success).toBe(true);
  expect(mergeTransfer(result.data, file).summary.clubs).toBe(0);
  const roundtrip = mergeTransfer(emptyDatabase(), file).data;
  expect(roundtrip.clubs).toEqual(incoming.clubs);
  expect(roundtrip.characters).toEqual(incoming.characters);
});
it('centers the culprit with arbitrary saved layouts and handles overlapping nodes without invalid SVG', () => {
  const data = demoDatabase(),
    board = data.clubs[0];
  board.layout!.domye = { x: 1900, y: -800 };
  const bounds = boardBounds(board);
  expect(bounds.x + bounds.width / 2).toBe(CENTER.x);
  expect(bounds.y + bounds.height / 2).toBe(CENTER.y);
  const positions = boardPositions(board);
  expect(positions.get(CULPRIT)).toEqual(CENTER);
  positions.set('domye', CENTER);
  expect(edgeGeometry(boardEdges(board, data.characters)[0], [], positions).path).not.toMatch(
    /NaN|Infinity/,
  );
});
