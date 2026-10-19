import { expect, it } from 'vitest';
import { convergingInvestigation, convergingNames } from './fixtures/converging';
import { buildInvestigationDiagram } from '../modules/investigation-creator/diagram';
import { explore } from '../modules/investigation-creator/engine';
import { applyCreatorDiagram, creatorPlacements } from '../src/creator-diagram';
import { boardEdges, canParent, CULPRIT, parentsOf, retainMembers, setParents } from '../shared/investigation';
import { databaseSchema, deleteCharacter, emptyDatabase, removeFromBoard } from '../shared/model';
import { createStoriesTransfer, mergeTransfer } from '../shared/transfer';
import { type DiagramEdge, edgesCross, segmentsIntersect } from '../modules/investigation-creator/diagram-geometry';
import { boardPositions, edgeGeometry } from '../src/geometry';

function assembled() {
  const data = convergingInvestigation(),
    board = data.boards[0];
  data.boards[0] = applyCreatorDiagram(
    board,
    buildInvestigationDiagram(board.investigation!, data.characters),
  );
  return data;
}

it('assembles three independent paths to one station and retains every path after rebuilding', () => {
  const data = assembled(),
    board = data.boards[0];
  expect(databaseSchema.parse(data)).toEqual(data);
  expect(parentsOf(board, 'station').sort()).toEqual(['invoices', 'navigator', 'phone']);
  const edges = boardEdges(board, data.characters).filter((edge) => edge.targetId === 'station');
  expect(edges).toHaveLength(3);
  expect(edges.every((edge) => edge.typeId === 'location' && edge.directed)).toBe(true);
  expect(new Set(boardEdges(board, data.characters).map((edge) => edge.id)).size).toBe(10);
  expect(board.characterIds.filter((id) => id === 'station')).toHaveLength(1);
  const repeated = applyCreatorDiagram(
    board,
    buildInvestigationDiagram(board.investigation!, data.characters, creatorPlacements(board)),
  );
  expect(repeated).toEqual(board);
});

it('places the shared station close to every incoming clue instead of drawing long cross-board paths', () => {
  const data = convergingInvestigation(),
    board = data.boards[0];
  for (let seed = 1; seed <= 12; seed++) {
    let state = seed;
    const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
    const diagram = buildInvestigationDiagram(board.investigation!, data.characters, [], {
      random,
    });
    const station = diagram.nodes.find((n) => n.id === 'station')!;
    const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
    const edges: DiagramEdge[] = diagram.nodes.flatMap((n) =>
      (n.parentIds ?? [n.parentId]).map((parentId) => ({
        id: n.id,
        parentId,
        a: parentId ? byId.get(parentId)! : { x: 0, y: 0 },
        b: n,
      })),
    );
    for (let i = 0; i < edges.length; i++)
      for (let j = 0; j < i; j++)
        expect(
          edgesCross(edges[i], edges[j]),
          `seed ${seed}: ${edges[i].parentId}->${edges[i].id} / ${edges[j].parentId}->${edges[j].id}`,
        ).toBe(false);
    const rendered = applyCreatorDiagram(board, diagram),
      positions = boardPositions(rendered);
    const connections = boardEdges(rendered, data.characters);
    const curves = connections.map((edge) => edgeGeometry(edge, connections, positions).samples);
    for (let i = 0; i < curves.length; i++)
      for (let j = 0; j < i; j++) {
        const a = connections[i],
          b = connections[j];
        if ([a.sourceId, a.targetId].some((id) => id === b.sourceId || id === b.targetId)) continue;
        const crossing = curves[i]
          .slice(1)
          .some((point, k) =>
            curves[j]
              .slice(1)
              .some((other, l) => segmentsIntersect(curves[i][k], point, curves[j][l], other)),
          );
        expect(
          crossing,
          `rendered seed ${seed}: ${a.sourceId}->${a.targetId} / ${b.sourceId}->${b.targetId}`,
        ).toBe(false);
      }
    const distances = ['phone', 'navigator', 'invoices'].map((id) => {
      const source = diagram.nodes.find((n) => n.id === id)!;
      return Math.hypot(source.x - station.x, source.y - station.y);
    });
    expect(Math.max(...distances)).toBeLessThan(360);
    const xs = [0, ...diagram.nodes.map((n) => n.x)],
      ys = [0, ...diagram.nodes.map((n) => n.y)];
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(750);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(750);
  }
});

it('replaces old generated long branches with compact positions while preserving manual cards', () => {
  const data = convergingInvestigation(),
    board = data.boards[0];
  const random = () => 0.2;
  let diagram = buildInvestigationDiagram(board.investigation!, data.characters, [], { random });
  const previous = structuredClone(diagram.nodes);
  for (const node of previous) {
    delete node.generated.layoutVersion;
    node.x *= 5;
    node.y *= 5;
    node.generated.x = node.x;
    node.generated.y = node.y;
  }
  const manual = previous.find((n) => n.id === 'records')!;
  manual.x = 800;
  manual.y = -350;
  diagram = buildInvestigationDiagram(board.investigation!, data.characters, previous, { random });
  expect(diagram.nodes.find((n) => n.id === 'records')).toMatchObject({ x: 800, y: -350 });
  const automated = diagram.nodes.filter((n) => n.id !== 'records');
  expect(Math.max(...automated.map((n) => Math.hypot(n.x, n.y)))).toBeLessThan(650);
  expect(diagram.nodes.every((n) => n.generated.layoutVersion === 'compact-v4')).toBe(true);
  expect(buildInvestigationDiagram(board.investigation!, data.characters, diagram.nodes)).toEqual(
    diagram,
  );
});

it('keeps separate alternative discovery methods and combined prerequisites in the logical plan', () => {
  const data = assembled(),
    board = data.boards[0],
    plan = board.investigation!;
  for (const clue of ['phone', 'invoices', 'navigator']) {
    const single = {
      ...plan,
      entries: [clue],
      access: plan.access.filter((r) => r.targetId === 'station'),
    };
    // Each clue alone is enough; assembling the graph never combines the methods into AND.
    expect(explore(single, data.characters).reached.has('station')).toBe(true);
  }
  plan.access = [
    {
      id: 'and',
      targetId: 'station',
      requires: ['phone', 'invoices'],
      conclusions: [],
      method: 'Compare',
    },
  ];
  expect(explore({ ...plan, entries: ['phone'] }, data.characters).reached.has('station')).toBe(
    false,
  );
  const combined = applyCreatorDiagram(
    { ...board, layout: {} },
    buildInvestigationDiagram(plan, data.characters),
  );
  expect(parentsOf(combined, 'station').sort()).toEqual(['invoices', 'phone']);
  expect(combined.investigation).toBe(plan);
});

it('allows returning leads and rejects invalid sources or cyclic placement anchors', () => {
  const data = assembled(),
    board = data.boards[0];
  const changed = setParents(board, 'station', ['invoices', 'navigator', 'phone']);
  expect(canParent(changed, 'phone', 'records')).toBe(true);
  expect(
    databaseSchema.safeParse({ ...data, boards: [setParents(changed, 'phone', ['records'])] })
      .success,
  ).toBe(true);
  expect(() => setParents(changed, 'station', ['phone', 'phone'])).toThrow();
  expect(() => setParents(changed, 'station', ['absent'])).toThrow();
  expect(() => setParents(changed, 'station', [])).toThrow();
  const cyclic = structuredClone(changed);
  cyclic.layout!.phone = { parentId: 'station', parentIds: ['station'] };
  cyclic.layout!.station = { ...cyclic.layout!.station, parentId: 'phone', parentIds: ['phone'] };
  expect(databaseSchema.safeParse({ ...data, boards: [cyclic] }).success).toBe(false);
  const invalid = structuredClone(changed);
  invalid.layout!.station.parentIds = ['phone'];
  expect(databaseSchema.safeParse({ ...data, boards: [invalid] }).success).toBe(false);
});

it('reconsiders automatic positions when a card is moved manually and keeps the moved card fixed', () => {
  const data = convergingInvestigation(),
    board = data.boards[0],
    random = () => 0.3;
  const first = buildInvestigationDiagram(board.investigation!, data.characters, [], { random });
  const previous = structuredClone(first.nodes),
    moved = previous.find((n) => n.id === 'home')!;
  moved.x = -350;
  moved.y = -180;
  const changed = buildInvestigationDiagram(board.investigation!, data.characters, previous, {
    random,
  });
  expect(changed.nodes.find((n) => n.id === 'home')).toMatchObject({ x: -350, y: -180 });
  expect(changed.nodes[0].generated.layoutKey).not.toBe(first.nodes[0].generated.layoutKey);
  expect(
    changed.nodes.some(
      (node) =>
        node.id !== 'home' &&
        (node.x !== first.nodes.find((n) => n.id === node.id)!.x ||
          node.y !== first.nodes.find((n) => n.id === node.id)!.y),
    ),
  ).toBe(true);
  expect(
    buildInvestigationDiagram(board.investigation!, data.characters, changed.nodes, { random }),
  ).toEqual(changed);
});

it('retains surviving paths on removal and falls back to the culprit only after the last source', () => {
  const data = assembled(),
    board = data.boards[0],
    anchor = board.layout!.station.parentId!;
  for (const changed of [
    removeFromBoard(board, anchor),
    retainMembers(
      board,
      board.characterIds.filter((id) => id !== anchor),
    ),
    deleteCharacter(data, anchor).boards[0],
  ]) {
    expect(parentsOf(changed, 'station')).toHaveLength(2);
    expect(parentsOf(changed, 'station')).not.toContain(anchor);
    expect(parentsOf(changed, 'station')).not.toContain(CULPRIT);
    expect(changed.layout!.station.generated!.parentIds).not.toContain(anchor);
    expect(databaseSchema.safeParse({ ...data, boards: [changed] }).success).toBe(true);
  }
  const isolated = retainMembers(board, ['station', 'records']);
  expect(parentsOf(isolated, 'station')).toEqual([CULPRIT]);
  expect(parentsOf(isolated, 'records')).toEqual(['station']);
});

it('round trips and remaps every incoming path and generation marker on ID collisions', () => {
  const data = assembled(),
    file = createStoriesTransfer(data),
    existing = assembled();
  existing.characters.forEach((node) => {
    node.name = 'Other ' + node.name;
  });
  existing.boards[0].name = 'Other case';
  const result = mergeTransfer(existing, file).data,
    imported = result.boards[1];
  const station = result.characters.find((node) => node.name === convergingNames.station)!;
  const sources = result.characters
    .filter((node) =>
      [convergingNames.phone, convergingNames.invoices, convergingNames.navigator].includes(
        node.name,
      ),
    )
    .map((node) => node.id);
  expect(station.id).not.toBe('station');
  expect(new Set(parentsOf(imported, station.id))).toEqual(new Set(sources));
  expect(new Set(imported.layout![station.id].generated!.parentIds)).toEqual(new Set(sources));
  expect(databaseSchema.safeParse(result).success).toBe(true);
  expect(mergeTransfer(emptyDatabase(), file).data.boards).toEqual(data.boards);
  expect(mergeTransfer(result, file).summary.boards).toBe(0);
});

it('preserves manual converging paths and locks, with explicit replacement of unlocked paths', () => {
  const data = assembled(),
    board = data.boards[0];
  const changed = setParents(board, 'station', ['phone', 'navigator']);
  const build = (replaceManual: boolean) =>
    applyCreatorDiagram(
      changed,
      buildInvestigationDiagram(
        changed.investigation!,
        data.characters,
        creatorPlacements(changed),
        { replaceManual },
      ),
    );
  expect(parentsOf(build(false), 'station')).toEqual(['phone', 'navigator']);
  expect(parentsOf(build(true), 'station')).toHaveLength(3);
  changed.layout!.station.locked = true;
  expect(parentsOf(build(true), 'station')).toEqual(['phone', 'navigator']);
  expect(parentsOf(build(false), 'station')).toEqual(['phone', 'navigator']);
});
