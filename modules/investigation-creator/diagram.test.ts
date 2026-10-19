import { describe, expect, it } from 'vitest';
import { buildInvestigationDiagram, DiagramPlacementError } from './diagram';
import { emptyPlan } from './schema';
import type { DiagramPlacement, InvestigationDiagram, InvestigationNode } from './contracts';
import { type DiagramEdge, edgesCross, footprintsOverlap } from './diagram-geometry';

function random(seed = 1) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
}

function sample() {
  const nodes: InvestigationNode[] = [
    { id: 'a', name: 'Hall', kind: 'location' },
    { id: 'b', name: 'Lab', kind: 'location' },
    { id: 'clue', name: 'Clue', kind: 'evidence' },
    { id: 'event', name: 'Event', kind: 'event' },
    { id: 'person', name: 'Person', kind: 'person' },
    { id: 'follow', name: 'Follow-up', kind: 'event' },
  ];
  const plan = emptyPlan();
  plan.evidence = [0, 1].map((i) => ({
    id: `e${i}`,
    nodeId: 'clue',
    locationId: 'a',
    conclusionId: 'fact',
    effect: 'supports',
    certainty: 'confirmed',
    explanation: 'Source',
  }));
  plan.timeline = [
    {
      id: 't',
      nodeId: 'event',
      personIds: ['person'],
      locationId: 'b',
      period: 'Night',
      earliest: 1,
      latest: 1,
      duration: 2,
      certainty: 'confirmed',
      kind: 'event',
    },
  ];
  plan.access = [
    { id: 'r', targetId: 'follow', requires: ['clue'], conclusions: [], method: 'Follow clue' },
  ];
  return { nodes, plan };
}

function geometry(diagram: InvestigationDiagram) {
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  return diagram.nodes.map((node) => {
    const parent = node.parentId ? byId.get(node.parentId)! : { x: 0, y: 0, parentId: null };
    const grandparent = parent.parentId ? byId.get(parent.parentId)! : { x: 0, y: 0 };
    const dx = node.x - parent.x,
      dy = node.y - parent.y;
    return {
      id: node.id,
      length: Math.hypot(dx, dy),
      forward: dx * (parent.x - grandparent.x) + dy * (parent.y - grandparent.y),
      hasParent: !!node.parentId,
    };
  });
}

describe('automatic investigation graph', () => {
  // This stress case runs the full layout search for twenty independent seeds.
  it(
    'packs dense neighbouring branches without overlapping cards or captions across random seeds',
    { timeout: 120_000 },
    () => {
      const nodes: InvestigationNode[] = [],
        plan = emptyPlan();
      for (let group = 0; group < 3; group++) {
        nodes.push({ id: `place${group}`, name: `Location ${group}`, kind: 'location' });
        for (let child = 0; child < 6; child++) {
          const id = `clue${group}-${child}`;
          nodes.push({ id, name: `A long clue caption ${group}-${child}`, kind: 'evidence' });
          plan.evidence.push({
            id: `e${id}`,
            nodeId: id,
            locationId: `place${group}`,
            conclusionId: 'fact',
            effect: 'supports',
            certainty: 'confirmed',
            explanation: 'Source',
          });
        }
      }
      nodes.push(
        { id: 'person1', name: 'First witness', kind: 'person' },
        { id: 'person2', name: 'Second witness', kind: 'person' },
      );
      const size = { radius: 48, labelWidth: 135, labelTop: 40, labelBottom: 70 };
      const footprints = Object.fromEntries(nodes.map((n) => [n.id, size]));
      for (let seed = 1; seed <= 20; seed++) {
        const diagram = buildInvestigationDiagram(plan, nodes, [], {
          random: random(seed),
          footprints,
        });
        const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
        const edges: DiagramEdge[] = diagram.nodes.flatMap((n) =>
          (n.parentIds ?? [n.parentId]).map((parentId) => ({
            id: n.id,
            parentId,
            a: parentId ? byId.get(parentId)! : { x: 0, y: 0 },
            b: n,
          })),
        );
        for (let i = 0; i < diagram.nodes.length; i++) {
          for (let j = i + 1; j < diagram.nodes.length; j++) {
            expect(footprintsOverlap(diagram.nodes[i], size, diagram.nodes[j], size)).toBe(false);
          }
        }
        // These are centre-to-centre segments. The renderer routes the final paths
        // around captions; placement balances crossings with a compact footprint.
        let crossings = 0;
        for (let i = 0; i < edges.length; i++)
          for (let j = 0; j < i; j++) if (edgesCross(edges[i], edges[j])) crossings++;
        expect(crossings, `seed ${seed}`).toBeLessThanOrEqual(2);
        const extent = Math.max(
          ...diagram.nodes.map((n) => Math.max(Math.abs(n.x), Math.abs(n.y))),
        );
        expect(extent).toBeLessThan(800);
        expect(
          buildInvestigationDiagram(plan, nodes, diagram.nodes, {
            random: random(seed + 100),
            footprints,
          }),
        ).toEqual(diagram);
      }
    },
  );
  it('groups by unique locations and explicit discovery links without interpreting prose', () => {
    const { nodes, plan } = sample();
    const diagram = buildInvestigationDiagram(plan, nodes, [], { random: random() });
    expect(Object.fromEntries(diagram.nodes.map((n) => [n.id, n.parentId]))).toEqual({
      a: null,
      b: null,
      clue: 'a',
      event: 'b',
      person: 'b',
      follow: 'clue',
    });
    expect(nodes.find((n) => n.id === 'clue')!.answers).toBeUndefined();
  });
  it.each(['evidence', 'person', 'event', 'location'] as const)(
    'places a %s after its explicit discovery prerequisite before grouping by location',
    (kind) => {
      const { nodes, plan } = sample();
      const target = nodes.find((n) => n.id === 'clue')!;
      target.kind = kind;
      plan.timeline.push({ ...plan.timeline[0], id: 'target-time', nodeId: target.id });
      const first = buildInvestigationDiagram(plan, nodes, [], { random: random() });
      plan.access.push({
        id: 'find-target',
        targetId: target.id,
        requires: ['person'],
        conclusions: [],
        method: 'Search after meeting the witness',
      });
      const changed = buildInvestigationDiagram(plan, nodes, first.nodes, { random: random(99) });
      expect(changed.nodes.find((n) => n.id === target.id)!.parentId).toBe('person');
      expect(changed.nodes.find((n) => n.id === 'person')!.parentId).toBe('b');
      for (const edge of geometry(changed)) expect(edge.length).toBeLessThan(350);
      expect(
        buildInvestigationDiagram(plan, nodes, changed.nodes, { random: random(123) }),
      ).toEqual(changed);
    },
  );
  it('uses short variable distances instead of forcing every branch outward by 240 units', () => {
    const { nodes, plan } = sample();
    const diagram = buildInvestigationDiagram(plan, nodes, [], { random: random(123) });
    for (const edge of geometry(diagram)) {
      expect(edge.length).toBeLessThan(240);
    }
  });
  it.each([false, true])(
    'uses the last prerequisite in a shared branch with explicit location access: %s',
    (explicitAccess) => {
      const { nodes, plan } = sample();
      if (explicitAccess)
        plan.access.push({
          id: 'find-clue',
          targetId: 'clue',
          requires: ['a'],
          conclusions: [],
          method: 'Search',
        });
      const first = buildInvestigationDiagram(plan, nodes, [], { random: random() });
      plan.access[0].requires = ['a', 'clue'];
      const diagram = buildInvestigationDiagram(plan, nodes, first.nodes, { random: random() });
      expect(diagram.nodes.find((n) => n.id === 'follow')!.parentId).toBe('clue');
      expect(diagram.nodes.find((n) => n.id === 'follow')!.parentIds).toEqual(['clue']);
      expect(diagram.nodes.find((n) => n.id === 'clue')!.parentId).toBe('a');
      expect(buildInvestigationDiagram(plan, nodes, diagram.nodes, { random: random(99) })).toEqual(
        diagram,
      );
    },
  );
  it('resolves several levels of combined prerequisites independently of list and node order', () => {
    const { nodes, plan } = sample();
    plan.access = [
      { id: 'r1', targetId: 'clue', requires: ['a'], conclusions: [], method: 'Search' },
      {
        id: 'r2',
        targetId: 'person',
        requires: ['a', 'clue'],
        conclusions: [],
        method: 'Identify',
      },
      {
        id: 'r3',
        targetId: 'event',
        requires: ['person', 'a', 'clue'],
        conclusions: [],
        method: 'Reconstruct',
      },
      {
        id: 'r4',
        targetId: 'follow',
        requires: ['clue', 'event', 'a', 'person'],
        conclusions: [],
        method: 'Follow',
      },
    ];
    const diagram = buildInvestigationDiagram(plan, nodes, [], { random: random() });
    expect(Object.fromEntries(diagram.nodes.map((n) => [n.id, n.parentId]))).toEqual({
      a: null,
      b: null,
      clue: 'a',
      person: 'clue',
      event: 'person',
      follow: 'event',
    });
    const reordered = structuredClone(plan);
    reordered.access.reverse().forEach((r) => r.requires.reverse());
    expect(
      buildInvestigationDiagram(reordered, [...nodes].reverse(), [], { random: random() }),
    ).toEqual(diagram);
    expect(Object.fromEntries(diagram.nodes.map((n) => [n.id, n.parentIds]))).toEqual({
      a: [null],
      b: [null],
      clue: ['a'],
      person: ['clue'],
      event: ['person'],
      follow: ['event'],
    });
    for (const edge of geometry(diagram)) expect(edge.length).toBeLessThan(600);
  });
  it('keeps every prerequisite across branches and chooses one anchor when depths tie', () => {
    const { nodes, plan } = sample();
    plan.access[0].requires = ['clue', 'b'];
    let diagram = buildInvestigationDiagram(plan, nodes, [], { random: random() });
    expect(diagram.nodes.find((n) => n.id === 'follow')!.parentId).toBe('clue');
    plan.access[0].requires = ['clue', 'person'];
    diagram = buildInvestigationDiagram(plan, nodes, [], { random: random() });
    expect(diagram.nodes.find((n) => n.id === 'follow')!.parentIds).toEqual(['clue', 'person']);
    plan.access.push({
      id: 'tie',
      targetId: 'event',
      requires: ['clue', 'person'],
      conclusions: [],
      method: 'Compare',
    });
    diagram = buildInvestigationDiagram(plan, nodes, [], { random: random() });
    expect(diagram.nodes.find((n) => n.id === 'event')!.parentIds).toEqual(['clue', 'person']);
  });
  it('measures prerequisite depth through preserved manual branches', () => {
    const { nodes, plan } = sample();
    const first = buildInvestigationDiagram(plan, nodes, [], { random: random() });
    first.nodes.find((n) => n.id === 'clue')!.parentId = 'person';
    plan.access[0].requires = ['b', 'person', 'clue'];
    const diagram = buildInvestigationDiagram(plan, nodes, first.nodes, { random: random() });
    expect(diagram.nodes.find((n) => n.id === 'follow')!.parentId).toBe('clue');
    expect(diagram.nodes.find((n) => n.id === 'clue')!.parentId).toBe('person');
  });
  it('breaks cycles between combined prerequisites without depending on checkbox order', () => {
    const { nodes, plan } = sample();
    plan.access[0].requires = ['a', 'clue'];
    plan.access.push({
      id: 'back',
      targetId: 'clue',
      requires: ['a', 'follow'],
      conclusions: [],
      method: 'Back',
    });
    const diagram = buildInvestigationDiagram(plan, nodes, [], { random: random() });
    const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
    for (const node of diagram.nodes) {
      const seen = new Set([node.id]);
      for (let parent = node.parentId; parent; parent = byId.get(parent)!.parentId) {
        expect(seen.has(parent)).toBe(false);
        seen.add(parent);
      }
    }
    plan.access.reverse().forEach((r) => r.requires.reverse());
    expect(buildInvestigationDiagram(plan, [...nodes].reverse(), [], { random: random() })).toEqual(
      diagram,
    );
  });
  it('uses different angles for different random samples and is independent of input order', () => {
    const { nodes, plan } = sample();
    const a = buildInvestigationDiagram(plan, nodes, [], { random: random(1) });
    const b = buildInvestigationDiagram(plan, nodes, [], { random: random(2) });
    expect(a.nodes.map((n) => [n.x, n.y])).not.toEqual(b.nodes.map((n) => [n.x, n.y]));
    expect(
      buildInvestigationDiagram(plan, [...nodes].reverse(), [], { random: random(1) }),
    ).toEqual(a);
  });
  it('does not choose between conflicting places or convert disputed testimony into a parent', () => {
    const { nodes, plan } = sample();
    plan.evidence[1].locationId = 'b';
    plan.timeline[0].certainty = 'disputed';
    const diagram = buildInvestigationDiagram(plan, nodes, [], { random: random() });
    expect(diagram.nodes.find((n) => n.id === 'clue')!.parentId).toBeNull();
    expect(diagram.nodes.find((n) => n.id === 'person')!.parentId).toBeNull();
    expect(diagram.nodes.find((n) => n.id === 'event')!.parentId).toBeNull();
  });
  it('ignores absent references and breaks discovery cycles deterministically', () => {
    const { nodes, plan } = sample();
    plan.evidence[0].locationId = plan.evidence[1].locationId = 'absent';
    plan.access.push({
      id: 'back',
      targetId: 'clue',
      requires: ['follow'],
      conclusions: [],
      method: 'Back',
    });
    const diagram = buildInvestigationDiagram(plan, nodes, [], { random: random() });
    const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
    for (const n of diagram.nodes) {
      const seen = new Set([n.id]);
      for (let parent = n.parentId; parent; parent = byId.get(parent)!.parentId) {
        expect(seen.has(parent)).toBe(false);
        seen.add(parent);
      }
    }
    expect(buildInvestigationDiagram(plan, [...nodes].reverse(), [], { random: random() })).toEqual(
      diagram,
    );
  });
  it('keeps generated angles after an ordinary repeat and updates grouping after a plan change', () => {
    const { nodes, plan } = sample();
    const first = buildInvestigationDiagram(plan, nodes, [], { random: random() });
    expect(buildInvestigationDiagram(plan, nodes, first.nodes, { random: random(99) })).toEqual(
      first,
    );
    plan.evidence.forEach((e) => {
      e.locationId = 'b';
    });
    const changed = buildInvestigationDiagram(plan, nodes, first.nodes, { random: random(99) });
    expect(changed.nodes.find((n) => n.id === 'clue')!.parentId).toBe('b');
    for (const edge of geometry(changed)) expect(edge.length).toBeLessThan(350);
  });
  it('preserves manual changes and locks, while explicit replacement rebuilds unlocked nodes', () => {
    const { nodes, plan } = sample();
    const first = buildInvestigationDiagram(plan, nodes, [], { random: random() });
    const previous: DiagramPlacement[] = structuredClone(first.nodes);
    const clue = previous.find((n) => n.id === 'clue')!;
    Object.assign(clue, { parentId: 'b', x: 321, y: -123 });
    const locked = previous.find((n) => n.id === 'person')!;
    Object.assign(locked, { parentId: null, x: -400, y: 200, locked: true });
    const kept = buildInvestigationDiagram(plan, nodes, previous, { random: random(9) });
    expect(kept.nodes.find((n) => n.id === 'clue')).toMatchObject({
      parentId: 'b',
      x: 321,
      y: -123,
    });
    const replaced = buildInvestigationDiagram(plan, nodes, previous, {
      replaceManual: true,
      random: random(9),
    });
    expect(replaced.nodes.find((n) => n.id === 'clue')!.parentId).toBe('a');
    expect(replaced.nodes.find((n) => n.id === 'person')).toMatchObject({
      parentId: null,
      x: -400,
      y: 200,
    });
  });
  it('folds a 500-node chain into a compact board instead of requiring a long straight tree', () => {
    const plan = emptyPlan();
    const nodes: InvestigationNode[] = Array.from({ length: 500 }, (_, i) => ({
      id: `n${i}`,
      name: String(i).padStart(3, '0'),
      kind: 'event',
    }));
    plan.access = nodes.slice(1).map((n, i) => ({
      id: `r${i}`,
      targetId: n.id,
      requires: [nodes[i].id],
      conclusions: [],
      method: 'Continue',
    }));
    const diagram = buildInvestigationDiagram(plan, nodes, [], { random: random() });
    expect(diagram.nodes).toHaveLength(500);
    expect(
      Math.max(...diagram.nodes.map((n) => Math.max(Math.abs(n.x), Math.abs(n.y)))),
    ).toBeLessThan(3500);
    const size = { radius: 48, labelWidth: 42, labelTop: 40, labelBottom: 70 };
    for (let i = 0; i < diagram.nodes.length; i++)
      for (let j = 0; j < i; j++)
        expect(footprintsOverlap(diagram.nodes[i], size, diagram.nodes[j], size)).toBe(false);
  });
  it('reports insufficient space rather than overlapping cards', () => {
    const { nodes, plan } = sample();
    expect(() =>
      buildInvestigationDiagram(plan, nodes, [], {
        bounds: { minX: -40, maxX: 40, minY: -40, maxY: 40 },
        random: random(),
      }),
    ).toThrow(DiagramPlacementError);
  });
});
