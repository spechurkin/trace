import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Repository } from '../electron/repository';
import { databaseSchema, emptyDatabase } from '../shared/model';
import { emptyPlan } from '../shared/legacy-investigation';
import { createStoriesTransfer, mergeTransfer } from '../shared/transfer';
import { demoDatabase } from './original-demo';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

function populatedLibrary() {
  const data = demoDatabase();
  const plan = emptyPlan();
  plan.crime = {
    eventId: 'mira',
    victimId: 'nora',
    culpritIds: ['elias'],
    motive: 'Inheritance',
    method: 'Poison',
    circumstances: 'At night',
  };
  plan.conclusions = [
    {
      id: 'conclusion',
      text: 'The witness lied',
      truth: 'true',
      subjectIds: ['elias'],
      required: true,
      threshold: 1,
    },
  ];
  plan.evidence = [
    {
      id: 'clue',
      nodeId: 'nora',
      conclusionId: 'conclusion',
      locationId: 'mira',
      effect: 'supports',
      certainty: 'confirmed',
      explanation: 'A signed letter',
    },
  ];
  plan.entries = ['nora'];
  plan.clueLocations = ['mira'];
  plan.endings = ['elias'];
  plan.access = [
    {
      id: 'access',
      targetId: 'mira',
      requires: ['nora'],
      conclusions: ['conclusion'],
      method: 'Key',
    },
  ];
  plan.timeline = [
    {
      id: 'time',
      nodeId: 'mira',
      personIds: ['elias'],
      locationId: 'nora',
      period: 'Night',
      earliest: 0,
      latest: 60,
      duration: 10,
      kind: 'event',
      certainty: 'disputed',
    },
  ];
  plan.ordering = [{ id: 'order', beforeId: 'time', afterId: '', minGap: 1, maxGap: null }];
  plan.travel = [{ id: 'travel', fromId: 'nora', toId: 'mira', minutes: 5 }];
  plan.versions = [
    {
      id: 'version',
      title: 'First theory',
      suspectId: 'elias',
      conclusionId: 'conclusion',
      motive: 'Inheritance',
      explanation: 'The letter',
    },
  ];
  data.boards[0].investigation = plan;
  data.boards[0].layout = { nora: { x: 100, y: 200, locked: true, parentId: '__culprit__' } };
  return data;
}

it('reads existing version 5 boards and retains all investigation materials through save and export', () => {
  const current = populatedLibrary();
  expect(databaseSchema.parse(JSON.parse(JSON.stringify(current)))).toEqual(current);
  const transfer = createStoriesTransfer(current);
  expect(mergeTransfer(emptyDatabase(), transfer).data).toEqual(current);
});

it.each([1, 2, 3, 4])(
  'converts version %i to boards without mutating or discarding source data',
  (version) => {
    const current = populatedLibrary();
    const { boards, activeBoardId, folders, ...rest } = current;
    const previous = {
      ...rest,
      version,
      ...(version === 4
        ? { clubs: boards, activeClubId: activeBoardId }
        : { circles: boards, activeCircleId: activeBoardId }),
      ...(version === 1 ? {} : { folders }),
    };
    const snapshot = structuredClone(previous);
    expect(databaseSchema.parse(previous)).toEqual(current);
    expect(previous).toEqual(snapshot);
    const serialized = JSON.stringify(databaseSchema.parse(previous));
    expect(serialized).not.toMatch(/"(?:clubs|activeClubId|circles|activeCircleId)"/);
  },
);

it('keeps investigation references correct when an imported character ID collides', () => {
  const incoming = populatedLibrary();
  const current = demoDatabase();
  current.characters[0].notes = 'Different person with the same ID';
  const result = mergeTransfer(current, createStoriesTransfer(incoming));
  const imported = result.data.boards.find((board) => board.investigation)!;
  const person = result.data.characters.find(
    (node) => node.id !== 'nora' && node.name === incoming.characters[0].name,
  )!;
  const plan = imported.investigation!;
  expect(plan.crime.victimId).toBe(person.id);
  expect(plan.evidence[0].nodeId).toBe(person.id);
  expect(plan.entries).toEqual([person.id]);
  expect(plan.access[0].requires).toEqual([person.id]);
  expect(plan.timeline[0].locationId).toBe(person.id);
  expect(plan.travel[0].fromId).toBe(person.id);
  expect(plan.evidence[0].conclusionId).toBe('conclusion');
  expect(plan.ordering[0].beforeId).toBe('time');
});

it.each([false, true])(
  'writes migration once, retaining the exact original even after later saves (backup source: %s)',
  async (fromBackup) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'trace-migration-'));
    directories.push(directory);
    const repo = new Repository(directory);
    const current = populatedLibrary();
    const { boards, activeBoardId, ...rest } = current;
    const previous = { ...rest, version: 4, clubs: boards, activeClubId: activeBoardId };
    const raw = JSON.stringify(previous, null, 4);
    await writeFile(repo.file, fromBackup ? '{broken' : raw);
    if (fromBackup) await writeFile(repo.file + '.bak', raw);
    const loaded = await repo.load();
    expect(loaded.data).toEqual(current);
    expect(loaded.warning).toBeTruthy();
    expect(JSON.parse(await readFile(repo.file, 'utf8'))).toEqual(current);
    const originals = (await readdir(directory)).filter((name) => name.includes('.pre-migration-'));
    expect(originals).toHaveLength(1);
    const original = path.join(directory, originals[0]);
    expect(await readFile(original, 'utf8')).toBe(raw);
    await repo.save({ ...current, activeBoardId: null });
    await repo.save(current);
    expect(await readFile(original, 'utf8')).toBe(raw);
    expect((await new Repository(directory).load()).warning).toBeUndefined();
    expect((await readdir(directory)).filter((name) => name.includes('.pre-migration-'))).toEqual(
      originals,
    );
  },
);

it('rejects mixed formats, malformed investigation data and unknown versions', () => {
  const current = populatedLibrary();
  expect(databaseSchema.safeParse({ ...current, clubs: [] }).success).toBe(false);
  expect(databaseSchema.safeParse({ ...current, version: 6 }).success).toBe(false);
  const invalid = structuredClone(current);
  invalid.boards[0].investigation!.crime.culpritIds = ['invalid id'];
  expect(databaseSchema.safeParse(invalid).success).toBe(false);
});
