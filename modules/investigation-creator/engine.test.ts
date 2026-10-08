import { afterEach, describe, expect, it } from 'vitest';
import { auditInvestigation, explore, suggestVersions } from './engine';
import { creatorSchema, emptyPlan, remapPlan } from './schema';
import { demoDatabase } from '../../src/demo';
import { setLocale } from '../../shared/i18n';
import { databaseSchema, emptyDatabase, removeFromBoard } from '../../shared/model';
import { createStoriesTransfer, mergeTransfer } from '../../shared/transfer';
import type { InvestigationNode } from './contracts';

afterEach(() => setLocale('en'));

function sample() {
  const data = demoDatabase(),
    board = data.boards[0],
    p = board.investigation!;
  return {
    data,
    board,
    p,
    nodes: data.characters,
    audit: () => auditInvestigation(board, data.characters),
  };
}

function graph() {
  const p = emptyPlan();
  const nodes: InvestigationNode[] = ['start', 'a', 'b', 'end', 'x', 'y'].map((id) => ({
    id,
    name: id,
    kind: id === 'a' || id === 'b' ? 'evidence' : 'event',
  }));
  p.entries = ['start'];
  p.endings = ['end'];
  p.conclusions = [
    { id: 'fact', text: 'Fact', subjectIds: [], truth: 'true', required: true, threshold: 2 },
  ];
  p.evidence = ['a', 'b'].map((id) => ({
    id,
    nodeId: id,
    locationId: null,
    conclusionId: 'fact',
    effect: 'supports',
    certainty: 'confirmed',
    explanation: 'Independent source',
  }));
  p.access = [
    { id: 'a', targetId: 'a', requires: ['start'], conclusions: [], method: 'Inspect' },
    { id: 'b', targetId: 'b', requires: ['start'], conclusions: [], method: 'Interview' },
    { id: 'end', targetId: 'end', requires: [], conclusions: ['fact'], method: 'Resolve' },
  ];
  const board = { characterIds: nodes.map((n) => n.id), investigation: p };
  return { p, nodes, board, audit: () => auditInvestigation(board, nodes) };
}

const codes = (report: ReturnType<typeof auditInvestigation>) => report.issues.map((i) => i.code);

describe('existing test investigation', () => {
  it.each(['ru', 'en'] as const)(
    'has reachable resolution and consistent authored truth in %s',
    (locale) => {
      setLocale(locale);
      const s = sample(),
        result = s.audit();
      expect(result.errors, JSON.stringify(result.issues)).toBe(0);
      expect(result.reached.size).toBe(32);
      expect(result.knowledge.get('suicide')!.state).toBe('true');
      expect(result.knowledge.get('officialStory')!.state).toBe('false');
      expect(result.knowledge.get('loroMurder')!.state).toBe('false');
      expect(codes(result)).not.toContain('versionUncleared');
      expect(codes(result)).not.toContain('temporalCycle');
      expect(
        result.issues.find((i) => i.code === 'threeClues' && i.ids[0] === 'archive')!.severity,
      ).toBe('info');
    },
  );
  it('diagnoses the screenshot case: no discovery path to the recording', () => {
    const s = sample();
    s.nodes.push({
      id: 'camera',
      name: 'Camera recording',
      kind: 'evidence',
      color: '#D93846',
      notes: '',
      folderId: null,
    });
    s.board.characterIds.push('camera');
    expect(s.audit().issues).toContainEqual(
      expect.objectContaining({ code: 'unreachable', ids: ['camera'] }),
    );
  });
  it('does not interpret contradictory official prose as factual chronology', () => {
    const s = sample();
    expect(codes(s.audit())).toContain('disputedTime');
    s.p.ordering.push({
      id: 'official-before-living',
      beforeId: 'time-journal',
      afterId: 'time-official',
      minGap: 0,
      maxGap: null,
    });
    expect(codes(s.audit())).not.toContain('temporalCycle');
    s.p.timeline.find((t) => t.id === 'time-official')!.certainty = 'confirmed';
    expect(codes(s.audit())).toContain('temporalCycle');
  });
  it('detects confirmed opposing evidence and changed author truth', () => {
    const s = sample();
    s.p.evidence.find(
      (e) => e.nodeId === 'report' && e.conclusionId === 'officialStory',
    )!.certainty = 'confirmed';
    s.p.conclusions.find((c) => c.id === 'officialStory')!.threshold = 1;
    expect(codes(s.audit())).toContain('evidenceConflict');
    const other = sample();
    other.p.conclusions.find((c) => c.id === 'suicide')!.truth = 'false';
    expect(codes(other.audit())).toContain('truthConflict');
  });
  it('checks completeness and removed nodes without silently dropping references', () => {
    const s = sample();
    s.nodes.find((n) => n.id === 'fall')!.answers!.consequence = '';
    s.p.evidence = s.p.evidence.filter((e) => e.nodeId !== 'calls');
    expect(codes(s.audit())).toContain('consequenceMissing');
    expect(codes(s.audit())).toContain('unusedEvidence');
    const removed = removeFromBoard(s.board, 'apartment');
    expect(codes(auditInvestigation(removed, s.nodes))).toContain('reference');
  });
});

describe('hypergraph reachability and counterfactual checks', () => {
  it('uses AND inside a route and OR between routes, with evidence thresholds', () => {
    const s = graph();
    expect(explore(s.p, s.nodes).reached.has('end')).toBe(true);
    s.p.access[1].requires = ['x'];
    expect(explore(s.p, s.nodes).reached.has('end')).toBe(false);
    s.p.access.push({
      id: 'alternate',
      targetId: 'b',
      requires: ['start'],
      conclusions: [],
      method: 'Ask another source',
    });
    expect(explore(s.p, s.nodes).reached.has('end')).toBe(true);
    s.p.access[0].requires.push('y');
    expect(explore(s.p, s.nodes).reached.has('a')).toBe(false);
  });
  it('does not double-count duplicated roles or use disputed clues as proof', () => {
    const s = graph();
    s.p.access = s.p.access.filter((r) => r.targetId !== 'b');
    s.p.evidence.push({ ...s.p.evidence[0], id: 'copy' });
    expect(explore(s.p, s.nodes).knowledge.get('fact')!.supports).toEqual(['a']);
    expect(explore(s.p, s.nodes).reached.has('end')).toBe(false);
    s.p.evidence[0].certainty = 'disputed';
    s.p.evidence[2].certainty = 'disputed';
    expect(explore(s.p, s.nodes).knowledge.get('fact')!.state).toBe('unknown');
  });
  it('finds circular node and conclusion gates', () => {
    const s = graph();
    s.p.access[0].requires = ['b'];
    s.p.access[1].requires = ['a'];
    expect(codes(s.audit())).toContain('lockedCycle');
    s.p.access[0].requires = [];
    s.p.access[0].conclusions = ['fact'];
    expect(codes(s.audit())).toContain('lockedCycle');
  });
  it('finds reachable terminal branches, loops, and threshold bottlenecks', () => {
    const s = graph();
    s.p.access.push({
      id: 'stray',
      targetId: 'x',
      requires: ['start'],
      conclusions: [],
      method: 'Optional lead',
    });
    expect(s.audit().issues).toContainEqual(
      expect.objectContaining({ code: 'deadEnd', ids: ['x'] }),
    );
    expect(s.audit().issues).toContainEqual(
      expect.objectContaining({ code: 'bottleneck', ids: ['a'] }),
    );
    s.p.access.push(
      { id: 'loop1', targetId: 'y', requires: ['x'], conclusions: [], method: 'Loop' },
      { id: 'loop2', targetId: 'x', requires: ['y'], conclusions: [], method: 'Loop' },
    );
    expect(codes(s.audit())).toContain('deadCycle');
  });
  it('does not count empty discovery actions or diagram layout as discovery', () => {
    const s = graph();
    s.p.access[0].method = '   ';
    expect(explore(s.p, s.nodes).reached.has('a')).toBe(false);
    expect(codes(s.audit())).toContain('methodMissing');
  });
});

describe('time constraints and alibis', () => {
  function timeGraph() {
    const s = graph();
    s.nodes.push(
      { id: 'person', name: 'Person', kind: 'person' },
      { id: 'here', name: 'Here', kind: 'location' },
      { id: 'there', name: 'There', kind: 'location' },
    );
    s.board.characterIds = s.nodes.map((n) => n.id);
    s.p.timeline = [
      {
        id: 't1',
        nodeId: 'start',
        locationId: 'here',
        personIds: ['person'],
        period: 'night',
        earliest: 1300,
        latest: 1300,
        duration: 60,
        kind: 'event',
        certainty: 'confirmed',
      },
      {
        id: 't2',
        nodeId: 'end',
        locationId: 'there',
        personIds: ['person'],
        period: 'night',
        earliest: 1330,
        latest: 1330,
        duration: 10,
        kind: 'alibi',
        certainty: 'confirmed',
      },
    ];
    return s;
  }

  it('reports impossible simultaneous confirmed alibis in different locations', () => {
    expect(codes(timeGraph().audit())).toContain('alibiConflict');
  });
  it('keeps uncertain time windows and historical periods distinct', () => {
    const s = timeGraph();
    s.p.timeline[1].latest = 1450;
    expect(codes(s.audit())).not.toContain('alibiConflict');
    expect(codes(s.audit())).toContain('timeAmbiguous');
    s.p.timeline[1].period = 'eight years ago';
    expect(codes(s.audit())).not.toContain('timeAmbiguous');
  });
  it('includes travel time and treats end/start touching as compatible', () => {
    const s = timeGraph();
    s.p.timeline[1].earliest = 1360;
    s.p.timeline[1].latest = 1360;
    expect(codes(s.audit())).not.toContain('alibiConflict');
    s.p.travel.push({ id: 'route', fromId: 'here', toId: 'there', minutes: 20 });
    expect(codes(s.audit())).toContain('alibiConflict');
  });
  it('produces a contradiction witness for chained temporal constraints', () => {
    const s = timeGraph();
    s.p.timeline[1].locationId = 'here';
    s.p.ordering.push({ id: 'order', beforeId: 't1', afterId: 't2', minGap: 0, maxGap: 100 });
    expect(s.audit().issues.find((i) => i.code === 'temporalCycle')!.ids).toContain('order');
  });
  it('checks joint scheduling when every pair is individually possible', () => {
    const s = timeGraph();
    s.nodes.push({ id: 'third-place', name: 'Third place', kind: 'location' });
    s.board.characterIds.push('third-place');
    s.p.timeline[0].earliest = 0;
    s.p.timeline[0].latest = 60;
    s.p.timeline[1].earliest = 0;
    s.p.timeline[1].latest = 60;
    s.p.timeline[1].duration = 60;
    s.p.timeline.push({ ...s.p.timeline[1], id: 't3', nodeId: 'a', locationId: 'third-place' });
    expect(codes(s.audit())).not.toContain('alibiConflict');
    expect(codes(s.audit())).toContain('jointPresenceConflict');
  });
  it('respects correlated windows instead of treating them as independent', () => {
    const s = timeGraph();
    for (const t of s.p.timeline) {
      t.earliest = 0;
      t.latest = 60;
      t.duration = 60;
    }
    s.p.ordering.push({
      id: 'same-start',
      beforeId: 't1',
      afterId: 't2',
      minGap: -60,
      maxGap: -60,
    });
    expect(codes(s.audit())).toContain('alibiConflict');
  });
});

describe('recommendations, suggestions and persistence', () => {
  it('recommends three distinct clues, accepts fewer, and counts roles once', () => {
    const s = graph();
    s.nodes.push({ id: 'site', kind: 'location', name: 'Site' });
    s.board.characterIds.push('site');
    s.p.clueLocations = ['site'];
    s.p.evidence[0].locationId = 'site';
    s.p.evidence.push({ ...s.p.evidence[0], id: 'extra-role', effect: 'refutes' });
    const issue = s.audit().issues.find((i) => i.code === 'threeClues')!;
    expect(issue.severity).toBe('info');
    expect(issue.args).toEqual(['Site', 1, 2]);
    expect(creatorSchema.safeParse(s.p).success).toBe(true);
  });
  it('suggests versions only from linked suspects, explicit motives and apparent evidence', () => {
    const s = sample();
    s.p.versions = [];
    const suggestions = suggestVersions(s.p, s.nodes);
    expect(suggestions.map((s) => s.suspectId).sort()).toEqual(['domye', 'loro']);
    expect(suggestions[0].explanation).toBeTruthy();
    s.nodes.find((n) => n.id === 'domye')!.answers!.motive = '';
    expect(suggestVersions(s.p, s.nodes).some((v) => v.suspectId === 'domye')).toBe(false);
  });
  it('persists plans, accepts legacy boards and remaps every node reference on import', () => {
    const s = sample();
    expect(databaseSchema.parse(s.data).boards[0].investigation).toEqual(s.p);
    const old = sample();
    delete old.board.investigation;
    expect(databaseSchema.safeParse(old.data).success).toBe(true);
    const mapped = remapPlan(s.p, (id) => `new-${id}`);
    expect(mapped.evidence[0].nodeId).toBe('new-body');
    expect(mapped.evidence[0].locationId).toBe('new-courtyard');
    expect(mapped.conclusions[0].subjectIds).toEqual(['new-valk']);
    expect(mapped.timeline[0].personIds).toEqual(['new-valk', 'new-celine']);
    const conflict = sample();
    conflict.nodes.forEach((n) => {
      n.name += ' altered';
    });
    const merged = mergeTransfer(conflict.data, createStoriesTransfer(s.data));
    const imported = merged.data.boards.find((c) => c.id !== conflict.board.id)!;
    expect(imported.investigation).toBeTruthy();
    expect(auditInvestigation(imported, merged.data.characters).errors).toBe(0);
    expect(
      mergeTransfer(emptyDatabase(), createStoriesTransfer(s.data)).data.boards[0].investigation,
    ).toEqual(s.p);
  });
});
