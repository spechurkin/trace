import { expect, it } from 'vitest';
import { BOARD_CREATION_LIMIT, databaseSchema, upsertBoard } from '../shared/model';
import { createCharactersTransfer, createStoriesTransfer, mergeTransfer } from '../shared/transfer';
import { stressDatabase } from './stress-fixtures';

it('allows board 100 and refuses board 101 before changing the input', () => {
  const data = stressDatabase(1, 99);
  const next = { ...data.boards[0], id: 'new', name: 'New board' };
  const full = upsertBoard(data, next);
  expect(BOARD_CREATION_LIMIT).toBe(100);
  expect(full.boards).toHaveLength(100);
  expect(data.boards).toHaveLength(99);
  expect(() => upsertBoard(full, { ...next, id: 'overflow' })).toThrow();
  expect(full.boards).toHaveLength(100);
});

it('allows editing at the limit and in older libraries above it', () => {
  for (const count of [100, 101, 500]) {
    const data = stressDatabase(1, count);
    const updated = upsertBoard(data, { ...data.boards[0], name: 'Edited' });
    expect(updated.boards).toHaveLength(count);
    expect(updated.boards[0].name).toBe('Edited');
    expect(databaseSchema.safeParse(updated).success).toBe(true);
    expect(() => upsertBoard(updated, { ...updated.boards[0], id: 'new' })).toThrow();
  }
});

it('permits creation after one board is deleted from a full library', () => {
  const data = stressDatabase(1, 100);
  const reduced = { ...data, boards: data.boards.slice(1), activeBoardId: 'b1' };
  expect(upsertBoard(reduced, { ...data.boards[0], id: 'replacement' }).boards).toHaveLength(100);
});

it('applies the same creation limit to JSON imports without partially mutating the library', () => {
  const data = stressDatabase(1, 99);
  const incoming = stressDatabase(1, 2);
  incoming.boards.forEach((board, i) => {
    board.id = `incoming${i}`;
    board.name = `Incoming ${i}`;
  });
  incoming.activeBoardId = 'incoming0';
  const before = structuredClone(data);
  expect(() => mergeTransfer(data, createStoriesTransfer(incoming))).toThrow();
  expect(data).toEqual(before);
  const oneBoard = createStoriesTransfer(incoming, ['incoming0']);
  const full = mergeTransfer(data, oneBoard).data;
  expect(full.boards).toHaveLength(100);
  expect(mergeTransfer(full, oneBoard).summary.boards).toBe(0);
});

it('allows node imports and reused boards in an older oversized library', () => {
  const data = stressDatabase(1, 101);
  expect(mergeTransfer(data, createStoriesTransfer(data, ['b0'])).summary.boards).toBe(0);
  const incoming = stressDatabase(1);
  incoming.characters[0].name = 'Different node';
  const result = mergeTransfer(data, createCharactersTransfer(incoming));
  expect(result.data.boards).toHaveLength(101);
  expect(result.summary.characters).toBe(1);
});
