import { expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { databaseSchema, deleteCharacter, emptyDatabase, removeFromClub } from '../shared/model';
import { boardEdges, canParent, CULPRIT, setParent } from '../shared/investigation';
import { createStoriesTransfer, mergeTransfer } from '../shared/transfer';
import { boardBounds, boardPositions, edgeGeometry } from '../src/geometry';
import { Repository } from '../electron/repository';
import { stressDatabase } from './stress-fixtures';

const metrics: Record<string, number> = {};

async function timed<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  metrics[name] = +(performance.now() - start).toFixed(2);
  await mkdir('.cache/qa', { recursive: true });
  await writeFile('.cache/qa/model-metrics.json', JSON.stringify(metrics, null, 2));
  return result;
}

it('validates the supported maximum: 5000 nodes, 500 boards and 500 nested folders', async () => {
  const data = stressDatabase(5000, 500);
  data.folders = Array.from({ length: 500 }, (_, i) => ({
    id: `f${i}`,
    name: `Folder ${i}`,
    kind: 'person' as const,
    parentId: i ? `f${i - 1}` : null,
  }));
  const parsed = await timed('maximumSchemaMs', () => databaseSchema.parse(data));
  expect(parsed).toEqual(data);
}, 60000);

it('rejects each oversized collection and invalid boundary without changing source data', () => {
  for (const data of [stressDatabase(5001), stressDatabase(1, 501)])
    expect(databaseSchema.safeParse(data).success).toBe(false);
  const data = stressDatabase(501);
  data.clubs[0].characterIds.push('n500');
  expect(databaseSchema.safeParse(data).success).toBe(false);
  for (const coordinate of [10001, -10001, NaN, Infinity]) {
    const invalid = stressDatabase(1);
    invalid.clubs[0].layout!.n0.x = coordinate;
    expect(databaseSchema.safeParse(invalid).success).toBe(false);
  }
});

it('handles a 500-level branch chain, depth ordering and finite geometry', async () => {
  const data = stressDatabase(500, 1, true);
  expect(databaseSchema.safeParse(data).success).toBe(true);
  const edges = await timed('chain500EdgesMs', () => boardEdges(data.clubs[0], data.characters));
  expect(edges.map((edge) => edge.targetId)).toEqual(data.clubs[0].characterIds);
  expect(canParent(data.clubs[0], 'n0', 'n499')).toBe(false);
  const positions = boardPositions(data.clubs[0]);
  const paths = await timed('chain500GeometryMs', () =>
    edges.map((edge) => edgeGeometry(edge, edges, positions).path),
  );
  expect(paths).toHaveLength(500);
  expect(paths.join('')).not.toMatch(/NaN|Infinity/);
  expect(boardBounds(data.clubs[0]).width).toBeGreaterThan(0);
});

it('preserves tree invariants during 1000 deterministic edits and 100 deletions', () => {
  let data = stressDatabase(500, 3);
  let seed = 20261008;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let i = 0; i < 1000; i++) {
    const child = `n${random() % 500}`,
      parent = random() % 3 ? `n${random() % 500}` : CULPRIT;
    if (canParent(data.clubs[0], child, parent))
      data.clubs[0] = setParent(data.clubs[0], child, parent);
    if (i % 50 === 0) expect(databaseSchema.safeParse(data).success).toBe(true);
  }
  for (let i = 0; i < 100; i++) data = deleteCharacter(data, `n${i}`);
  expect(databaseSchema.safeParse(data).success).toBe(true);
  expect(data.characters).toHaveLength(400);
  for (const board of data.clubs) {
    expect(boardEdges(board, data.characters)).toHaveLength(400);
    expect(
      Object.values(board.layout!).every(
        (entry) => entry.parentId === CULPRIT || board.characterIds.includes(entry.parentId!),
      ),
    ).toBe(true);
  }
});

it('round trips 500 nodes and deep branches through collision-heavy imports idempotently', async () => {
  const data = stressDatabase(500, 1, true);
  const file = createStoriesTransfer(data);
  const current = structuredClone(data);
  current.characters.forEach((node) => {
    node.name += ' existing';
  });
  current.clubs[0].name += ' existing';
  const merged = await timed('collisionImport500Ms', () => mergeTransfer(current, file));
  expect(merged.summary.characters).toBe(500);
  expect(merged.data.characters).toHaveLength(1000);
  const again = mergeTransfer(merged.data, file);
  expect(again.summary.characters).toBe(0);
  expect(again.summary.clubs).toBe(0);
  expect(again.data).toEqual(merged.data);
  expect(mergeTransfer(emptyDatabase(), file).data).toEqual(data);
});

it('serializes 100 concurrent writes and retains the penultimate backup', async () => {
  await mkdir('.test-data', { recursive: true });
  const directory = await mkdtemp(path.resolve('.test-data/qa-repository-'));
  const repo = new Repository(directory);
  await repo.load();
  const data = stressDatabase(500);
  await timed('saveBurst100Ms', async () => {
    await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        repo.save({
          ...data,
          clubs: [{ ...data.clubs[0], name: `Revision ${i}` }],
        }),
      ),
    );
  });
  expect((await new Repository(directory).load()).data.clubs[0].name).toBe('Revision 99');
  expect(JSON.parse(await readFile(repo.file + '.bak', 'utf8')).clubs[0].name).toBe('Revision 98');
});

it('rejects invalid saves and oversized files while preserving valid persisted data', async () => {
  await mkdir('.test-data', { recursive: true });
  const directory = await mkdtemp(path.resolve('.test-data/qa-invalid-'));
  const repo = new Repository(directory);
  await repo.load();
  const data = stressDatabase(1);
  await repo.save(data);
  expect(() => repo.save({ ...data, activeClubId: 'missing' })).toThrow();
  expect((await repo.load()).data).toEqual(data);
  const { open } = await import('node:fs/promises');
  const file = path.join(directory, 'oversized.json');
  const handle = await open(file, 'w');
  try {
    await handle.truncate(150 * 1024 * 1024 + 1);
  } finally {
    await handle.close();
  }
  await expect(repo.readJsonFile(file)).rejects.toThrow();
  expect((await repo.load()).data).toEqual(data);
});

it('rejects malicious text as structure and leaves valid text inert', () => {
  const data = stressDatabase(1);
  data.characters[0].name = '<img alt="" src="data:image/png;base64,eA==" onerror="alert(1)">';
  data.characters[0].answers!.identity = '<script>alert(1)</script>';
  expect(databaseSchema.safeParse(data).success).toBe(true);
  data.characters[0].image = 'javascript:alert(1)';
  expect(databaseSchema.safeParse(data).success).toBe(false);
  const original = stressDatabase(1);
  expect(() =>
    mergeTransfer(original, { format: 'trace-transfer', version: 1, kind: 'stories', data }),
  ).toThrow();
  expect(original).toEqual(stressDatabase(1));
});

it('removes chain roots without orphaning surviving descendants', () => {
  const data = stressDatabase(500, 1, true);
  const board = removeFromClub(data.clubs[0], 'n0');
  expect(board.layout!.n1.parentId).toBe(CULPRIT);
  expect(board.layout!.n499.parentId).toBe('n498');
  expect(databaseSchema.safeParse({ ...data, clubs: [board] }).success).toBe(true);
});
