import { expect, it } from 'vitest';
import { buildInvestigationDiagram } from '../modules/investigation-creator/diagram';
import { explore } from '../modules/investigation-creator/engine';
import { discoveryFrontier } from '../modules/investigation-creator/discovery-frontier';
import { applyCreatorDiagram, creatorPlacements } from '../src/creator-diagram';
import { boardEdges, parentsOf, setParents } from '../shared/investigation';
import { type Database, databaseSchema } from '../shared/model';
import { observationsInvestigation } from './fixtures/observations';

function assemble(data: Database) {
  const board = data.boards[0];
  return applyCreatorDiagram(
    board,
    buildInvestigationDiagram(board.investigation!, data.characters, creatorPlacements(board), {
      random: () => 0.3,
    }),
  );
}

it.each(['person', 'location', 'event', 'evidence'] as const)(
  'draws a direct lead from observations to a %s while retaining the witness in discovery conditions',
  (kind) => {
    const data = observationsInvestigation(),
      plan = data.boards[0].investigation!;
    data.characters[2].kind = kind;
    const before = structuredClone(plan),
      reached = explore(plan, data.characters);
    const board = assemble(data);
    expect(parentsOf(board, 'observations')).toEqual(['witness']);
    expect(parentsOf(board, 'subject')).toEqual(['observations']);
    expect(
      boardEdges(board, data.characters)
        .filter((edge) => edge.targetId === 'subject')
        .map((edge) => edge.sourceId),
    ).toEqual(['observations']);
    expect(plan).toEqual(before);
    expect(explore(plan, data.characters)).toEqual(reached);
    expect(reached.reached.has('subject')).toBe(true);
    expect(explore(plan, data.characters, 'witness').reached.has('subject')).toBe(false);
    expect(explore(plan, data.characters, 'observations').reached.has('subject')).toBe(false);
    expect(
      explore({ ...plan, entries: ['observations'] }, data.characters).reached.has('subject'),
    ).toBe(false);
    expect(databaseSchema.safeParse({ ...data, boards: [board] }).success).toBe(true);
  },
);

it('retains a separate direct discovery method even when another method continues through observations', () => {
  const data = observationsInvestigation(),
    plan = data.boards[0].investigation!;
  plan.access.push({
    id: 'direct',
    targetId: 'subject',
    requires: ['witness'],
    conclusions: [],
    method: 'Direct introduction',
  });
  const board = assemble(data);
  expect(parentsOf(board, 'subject').sort()).toEqual(['observations', 'witness']);
  expect(
    explore(
      { ...plan, access: plan.access.filter((r) => r.targetId === 'subject') },
      data.characters,
    ).reached.has('subject'),
  ).toBe(true);
  plan.access.reverse().forEach((r) => r.requires.reverse());
  data.characters.reverse();
  expect(assemble(data)).toEqual(board);
});

it('uses explicit manual leads as branch context and preserves an authored direct connection', () => {
  const data = observationsInvestigation();
  data.boards[0].investigation!.access.shift();
  data.boards[0] = setParents(data.boards[0], 'observations', ['witness']);
  const board = assemble(data);
  expect(parentsOf(board, 'subject')).toEqual(['observations']);
  data.boards[0] = setParents(board, 'subject', ['observations', 'witness']);
  expect(parentsOf(assemble(data), 'subject')).toEqual(['observations', 'witness']);
});

it('repairs the old automatically generated triangle and keeps the repaired diagram stable', () => {
  const data = observationsInvestigation();
  const old = assemble(data),
    point = old.layout!.subject;
  point.parentIds = ['observations', 'witness'];
  point.generated!.parentIds = [...point.parentIds];
  data.boards[0] = old;
  const repaired = assemble(data);
  expect(parentsOf(repaired, 'subject')).toEqual(['observations']);
  data.boards[0] = repaired;
  expect(assemble(data)).toEqual(repaired);
});

it('reduces each combined method separately and retains independent branches', () => {
  const methods = new Map([
    ['one', [['a']]],
    ['two', [['b']]],
    ['target', [['a', 'one'], ['b', 'two'], ['context']]],
  ]);
  const sources = new Map<string, (string | null)[]>([
    ['a', [null]],
    ['b', [null]],
    ['context', [null]],
    ['one', ['a']],
    ['two', ['b']],
    ['target', ['a', 'b', 'one', 'two', 'context']],
  ]);
  expect(discoveryFrontier(methods, sources).get('target')).toEqual(['context', 'one', 'two']);
});

it('does not remove an entry into a cyclic group or invent an order between mutually dependent clues', () => {
  const methods = new Map([
    ['a', [['entry', 'b']]],
    ['b', [['entry', 'a']]],
    ['target', [['a', 'b']]],
  ]);
  const sources = new Map<string, (string | null)[]>([
    ['entry', [null]],
    ['a', ['entry', 'b']],
    ['b', ['entry', 'a']],
    ['target', ['a', 'b']],
  ]);
  expect(discoveryFrontier(methods, sources)).toEqual(
    new Map([
      ['a', ['b', 'entry']],
      ['b', ['a', 'entry']],
      ['target', ['a', 'b']],
    ]),
  );
});
