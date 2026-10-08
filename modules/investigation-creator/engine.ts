import type { InvestigationBoard, InvestigationNode } from './contracts';
import { kindOf, questionKeys } from './contracts';
import { emptyPlan, type InvestigationPlan } from './schema';

export type Severity = 'error' | 'warning' | 'info';
export type AuditGroup =
  'crime' | 'matrix' | 'timeline' | 'reachability' | 'deadEnds' | 'versions' | 'completeness';
export type AuditIssue = {
  code: string;
  severity: Severity;
  group: AuditGroup;
  ids: string[];
  args: (string | number)[];
};
export type Knowledge = {
  supports: string[];
  refutes: string[];
  state: 'true' | 'false' | 'unknown' | 'conflict';
};

// Monotone inference on a directed hypergraph: AND prerequisites inside a rule,
// OR between rules. Distinct confirmed evidence nodes count once per polarity.
// No authored truth or visual parent edge grants players knowledge.
export function explore(p: InvestigationPlan, nodes: InvestigationNode[], excluded?: string) {
  const valid = new Set(nodes.map((n) => n.id).filter((id) => id !== excluded));
  const reached = new Set<string>();
  const positive = new Set<string>(),
    negative = new Set<string>();
  const proofs = new Map<string, string>();
  const conclusions = new Map(p.conclusions.map((c) => [c.id, c]));
  const buckets = new Map<string, { supports: Set<string>; refutes: Set<string> }>();
  for (const c of p.conclusions) buckets.set(c.id, { supports: new Set(), refutes: new Set() });
  const queue: string[] = [];
  const visit = (id: string, reason: string) => {
    if (valid.has(id) && !reached.has(id)) {
      reached.add(id);
      proofs.set(id, reason);
      queue.push(`n:${id}`);
    }
  };
  const waiting = new Map<string, number[]>();
  const remaining = p.access.map(
    (r) =>
      new Set([...r.requires.map((id) => `n:${id}`), ...r.conclusions.map((id) => `c:${id}`)]).size,
  );
  p.access.forEach((r, i) => {
    if (!r.method.trim() || !valid.has(r.targetId)) return;
    const keys = new Set([
      ...r.requires.map((id) => `n:${id}`),
      ...r.conclusions.map((id) => `c:${id}`),
    ]);
    for (const key of keys) {
      const bucket = waiting.get(key) || [];
      bucket.push(i);
      waiting.set(key, bucket);
    }
    if (!keys.size) visit(r.targetId, r.id);
  });
  for (const id of p.entries) visit(id, 'entry');
  const evidence = new Map<string, InvestigationPlan['evidence']>();
  const evidenceIds = new Set(nodes.filter((n) => kindOf(n) === 'evidence').map((n) => n.id));
  for (const e of p.evidence) {
    if (e.certainty === 'confirmed' && evidenceIds.has(e.nodeId)) {
      const bucket = evidence.get(e.nodeId) || [];
      bucket.push(e);
      evidence.set(e.nodeId, bucket);
    }
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const key = queue[cursor];
    if (key.startsWith('n:'))
      for (const e of evidence.get(key.slice(2)) || []) {
        const bucket = buckets.get(e.conclusionId),
          c = conclusions.get(e.conclusionId);
        if (!bucket || !c) continue;
        bucket[e.effect].add(e.nodeId);
        const set = e.effect === 'supports' ? positive : negative;
        if (bucket[e.effect].size >= c.threshold && !set.has(c.id)) {
          set.add(c.id);
          if (e.effect === 'supports') queue.push(`c:${c.id}`);
        }
      }
    for (const i of waiting.get(key) || [])
      if (--remaining[i] === 0) visit(p.access[i].targetId, p.access[i].id);
  }
  const knowledge = new Map<string, Knowledge>();
  for (const c of p.conclusions) {
    const bucket = buckets.get(c.id)!;
    knowledge.set(c.id, {
      supports: [...bucket.supports],
      refutes: [...bucket.refutes],
      state: positive.has(c.id)
        ? negative.has(c.id)
          ? 'conflict'
          : 'true'
        : negative.has(c.id)
          ? 'false'
          : 'unknown',
    });
  }
  return { reached, positive, negative, knowledge, proofs };
}

// Iterative Kosaraju avoids stack overflow on imported graphs.
function components(vertices: string[], edges: Map<string, Set<string>>) {
  const included = new Set(vertices);
  edges = new Map(
    [...edges]
      .filter(([from]) => included.has(from))
      .map(([from, tos]) => [from, new Set([...tos].filter((to) => included.has(to)))]),
  );
  const seen = new Set<string>(),
    order: string[] = [],
    reverse = new Map<string, Set<string>>();
  for (const [from, tos] of edges)
    for (const to of tos) reverse.set(to, new Set([...(reverse.get(to) || []), from]));
  for (const v of vertices) {
    const stack: [string, boolean][] = [[v, false]];
    while (stack.length) {
      const [id, done] = stack.pop()!;
      if (done) {
        order.push(id);
        continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push([id, true]);
      for (const to of edges.get(id) || []) if (!seen.has(to)) stack.push([to, false]);
    }
  }
  seen.clear();
  const result: string[][] = [];
  for (const v of order.reverse())
    if (!seen.has(v)) {
      const component: string[] = [],
        stack = [v];
      seen.add(v);
      while (stack.length) {
        const id = stack.pop()!;
        component.push(id);
        for (const from of reverse.get(id) || [])
          if (!seen.has(from)) {
            seen.add(from);
            stack.push(from);
          }
      }
      result.push(component);
    }
  return result;
}

type TemporalEdge = { from: number; to: number; weight: number; ids: string[] };
// Simple Temporal Network: t(to)-t(from) <= weight. Bellman-Ford produces
// a concrete negative-cycle witness instead of guessing times from prose.
function temporalNetwork(
  p: InvestigationPlan,
  rows: InvestigationPlan['timeline'],
  extra: InvestigationPlan['ordering'] = [],
  tighten = true,
) {
  const indices = new Map(rows.map((r, i) => [r.id, i + 1]));
  const edges: TemporalEdge[] = rows.flatMap((r, i) => [
    { from: 0, to: i + 1, weight: r.latest, ids: [r.id] },
    { from: i + 1, to: 0, weight: -r.earliest, ids: [r.id] },
  ]);
  for (const o of [...p.ordering, ...extra]) {
    const before = indices.get(o.beforeId),
      after = indices.get(o.afterId);
    if (before === undefined || after === undefined) continue;
    const duration = rows[before - 1].duration;
    edges.push({
      from: after,
      to: before,
      weight: -duration - o.minGap,
      ids: [o.id, o.beforeId, o.afterId],
    });
    if (o.maxGap !== null)
      edges.push({
        from: before,
        to: after,
        weight: duration + o.maxGap,
        ids: [o.id, o.beforeId, o.afterId],
      });
  }
  const distance = Array<number>(rows.length + 1).fill(0),
    previous: (TemporalEdge | undefined)[] = Array(rows.length + 1);
  let changed = -1;
  for (let pass = 0; pass <= rows.length; pass++) {
    changed = -1;
    for (const e of edges)
      if (distance[e.to] > distance[e.from] + e.weight) {
        distance[e.to] = distance[e.from] + e.weight;
        previous[e.to] = e;
        changed = e.to;
      }
    if (changed === -1) break;
  }
  if (changed !== -1) {
    let at = changed;
    for (let i = 0; i <= rows.length; i++) at = previous[at]!.from;
    const cycle = new Set<string>(),
      start = at;
    do {
      const e = previous[at]!;
      e.ids.forEach((id) => cycle.add(id));
      at = e.from;
    } while (at !== start);
    return { conflict: [...cycle], bounds: new Map<string, [number, number]>() };
  }
  if (!tighten) return { conflict: [], bounds: new Map<string, [number, number]>() };
  // Tighten intervals using shortest paths from/to the origin, O(VE).
  const shortest = (backward: boolean) => {
    const d = Array<number>(rows.length + 1).fill(Infinity);
    d[0] = 0;
    for (let pass = 0; pass < rows.length; pass++) {
      let update = false;
      for (const e of edges) {
        const a = backward ? e.to : e.from,
          b = backward ? e.from : e.to;
        if (d[b] > d[a] + e.weight) {
          d[b] = d[a] + e.weight;
          update = true;
        }
      }
      if (!update) break;
    }
    return d;
  };
  const upper = shortest(false),
    lower = shortest(true);
  return {
    conflict: [],
    bounds: new Map(rows.map((r, i) => [r.id, [-lower[i + 1], upper[i + 1]] as [number, number]])),
  };
}

export function auditInvestigation(board: InvestigationBoard, allNodes: InvestigationNode[]) {
  const p = board.investigation || emptyPlan();
  const nodes = allNodes.filter((n) => board.characterIds.includes(n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const conclusions = new Map(p.conclusions.map((c) => [c.id, c]));
  const issues: AuditIssue[] = [];
  const label = (id: string) =>
    byId.get(id)?.name ||
    conclusions.get(id)?.text ||
    p.timeline.find((t) => t.id === id)?.nodeId ||
    id;
  const add = (
    code: string,
    severity: Severity,
    group: AuditGroup,
    ids: string[] = [],
    ...args: (string | number)[]
  ) =>
    issues.push({
      code,
      severity,
      group,
      ids,
      args: args.length ? args : [ids.map(label).join(', ')],
    });
  const reference = (id: string | null, group: AuditGroup, kind?: string) => {
    if (id === null) return;
    if (!byId.has(id) || (kind && kindOf(byId.get(id)!) !== kind))
      add('reference', 'error', group, [id]);
  };
  if (!board.investigation) add('unstructured', 'info', 'completeness');
  for (const list of [
    p.conclusions,
    p.evidence,
    p.access,
    p.timeline,
    p.ordering,
    p.travel,
    p.versions,
  ]) {
    const seen = new Set<string>();
    for (const row of list) {
      if (seen.has(row.id)) add('duplicate', 'error', 'completeness', [row.id]);
      seen.add(row.id);
    }
  }
  reference(p.crime.eventId, 'crime', 'event');
  reference(p.crime.victimId, 'crime', 'person');
  p.crime.culpritIds.forEach((id) => reference(id, 'crime', 'person'));
  if (
    !p.crime.eventId ||
    !p.crime.victimId ||
    !p.crime.motive.trim() ||
    !p.crime.method.trim() ||
    !p.crime.circumstances.trim()
  )
    add('crimeMissing', 'warning', 'crime');
  if (!p.conclusions.some((c) => c.required)) add('requiredMissing', 'error', 'matrix');
  for (const c of p.conclusions) {
    c.subjectIds.forEach((id) => reference(id, 'matrix'));
    if (!c.text.trim() || (c.required && c.truth === 'unknown'))
      add('conclusionIncomplete', 'warning', 'matrix', [c.id]);
  }
  for (const e of p.evidence) {
    reference(e.nodeId, 'matrix', 'evidence');
    reference(e.locationId, 'matrix', 'location');
    if (!conclusions.has(e.conclusionId)) add('reference', 'error', 'matrix', [e.conclusionId]);
    if (!e.explanation.trim()) add('evidenceExplanation', 'warning', 'matrix', [e.nodeId]);
  }
  for (const locationId of new Set([
    ...p.clueLocations,
    ...p.evidence.flatMap((e) => (e.locationId ? [e.locationId] : [])),
  ])) {
    reference(locationId, 'completeness', 'location');
    const count = new Set(
      p.evidence
        .filter(
          (e) =>
            e.locationId === locationId &&
            byId.has(e.nodeId) &&
            kindOf(byId.get(e.nodeId)!) === 'evidence',
        )
        .map((e) => e.nodeId),
    ).size;
    if (count < 3)
      add('threeClues', 'info', 'completeness', [locationId], label(locationId), count, 3 - count);
  }
  for (const id of [...p.entries, ...p.endings]) reference(id, 'reachability');
  if (!p.entries.length) add('entriesMissing', 'error', 'reachability');
  if (!p.endings.length) add('endingsMissing', 'error', 'reachability');
  for (const r of p.access) {
    reference(r.targetId, 'reachability');
    r.requires.forEach((id) => reference(id, 'reachability'));
    r.conclusions.forEach((id) => {
      if (!conclusions.has(id)) add('reference', 'error', 'reachability', [id]);
    });
    if (!r.method.trim()) add('methodMissing', 'warning', 'reachability', [r.targetId]);
  }
  const result = explore(p, nodes);
  for (const c of p.conclusions) {
    const k = result.knowledge.get(c.id)!;
    if (k.state === 'conflict')
      add('evidenceConflict', 'error', 'matrix', [c.id, ...k.supports, ...k.refutes]);
    else if (
      (c.truth === 'true' && k.state === 'false') ||
      (c.truth === 'false' && k.state === 'true')
    )
      add('truthConflict', 'error', 'matrix', [c.id]);
    if (c.required && (k.state !== c.truth || k.state === 'unknown'))
      add('requiredUnproven', 'error', 'reachability', [c.id]);
  }
  for (const node of nodes) {
    if (!result.reached.has(node.id)) add('unreachable', 'warning', 'reachability', [node.id]);
    if (kindOf(node) === 'evidence' && !p.evidence.some((e) => e.nodeId === node.id))
      add('unusedEvidence', 'warning', 'completeness', [node.id]);
    if (kindOf(node) === 'event' && !node.answers?.consequence?.trim())
      add('consequenceMissing', 'warning', 'completeness', [node.id]);
    const missing = questionKeys[kindOf(node)].filter((key) => !node.answers?.[key]?.trim());
    if (missing.length)
      add('answersMissing', 'info', 'completeness', [node.id], node.name, missing.length);
  }
  for (const id of p.endings)
    if (!result.reached.has(id)) add('endingUnreachable', 'error', 'reachability', [id]);

  const edges = new Map<string, Set<string>>();
  const edge = (from: string, to: string) =>
    edges.set(from, new Set([...(edges.get(from) || []), to]));
  for (const r of p.access) {
    for (const id of r.requires) edge(id, r.targetId);
    for (const c of r.conclusions)
      for (const e of p.evidence.filter(
        (e) => e.conclusionId === c && e.effect === 'supports' && e.certainty === 'confirmed',
      ))
        edge(e.nodeId, r.targetId);
  }
  for (const group of components(
    nodes.map((n) => n.id),
    edges,
  ))
    if (
      (group.length > 1 || edges.get(group[0])?.has(group[0])) &&
      group.every((id) => !result.reached.has(id))
    )
      add('lockedCycle', 'warning', 'reachability', group);

  // Reverse liveness over enabled rules. A branch may terminate by establishing
  // a required fact or clearing a false version, as well as by reaching an ending.
  const productive = new Set(p.endings.filter((id) => result.reached.has(id)));
  const usefulConclusions = new Set([
    ...p.conclusions.filter((c) => c.required).map((c) => c.id),
    ...p.versions.flatMap((v) => (v.conclusionId ? [v.conclusionId] : [])),
  ]);
  for (const e of p.evidence)
    if (usefulConclusions.has(e.conclusionId) && result.reached.has(e.nodeId))
      productive.add(e.nodeId);
  const backwards = new Map<string, Set<string>>();
  for (const r of p.access)
    if (
      r.method.trim() &&
      result.reached.has(r.targetId) &&
      r.requires.every((id) => result.reached.has(id)) &&
      r.conclusions.every((id) => result.positive.has(id))
    ) {
      const prerequisites = [
        ...r.requires,
        ...r.conclusions.flatMap((id) => result.knowledge.get(id)?.supports || []),
      ];
      backwards.set(r.targetId, new Set([...(backwards.get(r.targetId) || []), ...prerequisites]));
    }
  const work = [...productive];
  for (let cursor = 0; cursor < work.length; cursor++)
    for (const id of backwards.get(work[cursor]) || [])
      if (!productive.has(id)) {
        productive.add(id);
        work.push(id);
      }
  const stranded = nodes.filter((n) => result.reached.has(n.id) && !productive.has(n.id));
  for (const n of stranded)
    if (![...(edges.get(n.id) || [])].some((id) => stranded.some((n) => n.id === id)))
      add('deadEnd', 'warning', 'deadEnds', [n.id]);
  for (const group of components(
    stranded.map((n) => n.id),
    new Map(
      [...edges].map(([from, tos]) => [
        from,
        new Set([...tos].filter((id) => stranded.some((n) => n.id === id))),
      ]),
    ),
  ))
    if (
      group.length > 1 &&
      group.every((id) => [...(edges.get(id) || [])].every((to) => group.includes(to)))
    )
      add('deadCycle', 'warning', 'deadEnds', group);
  // Counterfactual vertex removal detects AND gates and evidence thresholds that
  // ordinary articulation-point algorithms would miss.
  const baselineGoals = p.endings.filter((id) => result.reached.has(id));
  const baselineFacts = p.conclusions.filter(
    (c) => c.required && result.knowledge.get(c.id)?.state === c.truth,
  );
  const explorationCost = p.access.reduce(
    (total, r) => total + r.requires.length + r.conclusions.length + 1,
    p.evidence.length + nodes.length,
  );
  let counterfactualCost = 0;
  for (const n of nodes)
    if (
      productive.has(n.id) &&
      result.reached.has(n.id) &&
      !p.entries.includes(n.id) &&
      !p.endings.includes(n.id)
    ) {
      counterfactualCost += explorationCost;
      if (counterfactualCost > 2000000) {
        add('analysisLimit', 'warning', 'deadEnds');
        break;
      }
      const without = explore(p, nodes, n.id);
      if (
        baselineGoals.some((id) => !without.reached.has(id)) ||
        baselineFacts.some((c) => without.knowledge.get(c.id)?.state !== c.truth)
      )
        add('bottleneck', 'warning', 'deadEnds', [n.id]);
    }

  for (const t of p.timeline) {
    reference(t.nodeId, 'timeline');
    reference(t.locationId, 'timeline', 'location');
    t.personIds.forEach((id) => reference(id, 'timeline', 'person'));
    if (!t.period.trim() || !t.locationId || !t.personIds.length)
      add('timeIncomplete', 'warning', 'timeline', [t.nodeId]);
    if (t.earliest > t.latest) add('timeRange', 'error', 'timeline', [t.id]);
  }
  for (const n of nodes.filter(
    (n) => kindOf(n) === 'event' && !p.timeline.some((t) => t.nodeId === n.id),
  ))
    add('timeMissing', 'info', 'timeline', [n.id]);
  const temporalById = new Map(p.timeline.map((t) => [t.id, t]));
  for (const o of p.ordering) {
    const before = temporalById.get(o.beforeId),
      after = temporalById.get(o.afterId);
    if (!before || !after || before.period !== after.period)
      add('orderReference', 'error', 'timeline', [o.id]);
    if (o.maxGap !== null && o.maxGap < o.minGap) add('timeRange', 'error', 'timeline', [o.id]);
  }
  for (const travel of p.travel) {
    reference(travel.fromId, 'timeline', 'location');
    reference(travel.toId, 'timeline', 'location');
  }
  const periods = new Set(p.timeline.map((t) => t.period).filter(Boolean));
  for (const period of periods) {
    const rows = p.timeline.filter((t) => t.period === period && t.certainty === 'confirmed');
    const network = temporalNetwork(p, rows);
    if (network.conflict.length) {
      add('temporalCycle', 'error', 'timeline', network.conflict);
      continue;
    }
    const disjunctions: [
      InvestigationPlan['ordering'][number],
      InvestigationPlan['ordering'][number],
    ][] = [];
    let temporalCost = 0,
      limited = false;
    for (let i = 0; i < rows.length; i++)
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i],
          b = rows[j];
        if (
          !a.locationId ||
          !b.locationId ||
          a.locationId === b.locationId ||
          !a.personIds.some((id) => b.personIds.includes(id))
        )
          continue;
        const [aMin, aMax] = network.bounds.get(a.id)!,
          [bMin, bMax] = network.bounds.get(b.id)!;
        const travel = Math.max(
          0,
          ...p.travel
            .filter(
              (t) =>
                (t.fromId === a.locationId && t.toId === b.locationId) ||
                (t.toId === a.locationId && t.fromId === b.locationId),
            )
            .map((t) => t.minutes),
        );
        const ab = {
          id: `presence-${a.id}-${b.id}`,
          beforeId: a.id,
          afterId: b.id,
          minGap: travel,
          maxGap: null,
        };
        const ba = { ...ab, beforeId: b.id, afterId: a.id };
        let canAB = aMin + a.duration + travel <= bMax,
          canBA = bMin + b.duration + travel <= aMax;
        const uncertain = aMin !== aMax || bMin !== bMax;
        if (uncertain) {
          temporalCost += rows.length * (rows.length * 2 + p.ordering.length) * 2;
          if (temporalCost > 2000000) {
            limited = true;
            continue;
          }
          if (canAB) canAB = temporalNetwork(p, rows, [ab], false).conflict.length === 0;
          if (canBA) canBA = temporalNetwork(p, rows, [ba], false).conflict.length === 0;
        }
        if (!canAB && !canBA)
          add(
            a.kind === 'alibi' || b.kind === 'alibi' ? 'alibiConflict' : 'presenceConflict',
            'error',
            'timeline',
            [a.nodeId, b.nodeId, ...a.personIds.filter((id) => b.personIds.includes(id))],
          );
        else if (aMax + a.duration + travel > bMin && bMax + b.duration + travel > aMin)
          add('timeAmbiguous', 'warning', 'timeline', [a.nodeId, b.nodeId]);
        if (uncertain && (canAB || canBA)) disjunctions.push([ab, ba]);
      }
    // Disjunctive scheduling checks joint feasibility: individually feasible
    // alibis can still be impossible together. Branch-and-bound uses the STN
    // as a pruning oracle and reports a budget limit instead of claiming success.
    if (disjunctions.length) {
      let visits = 0;
      const solve = (at: number, chosen: InvestigationPlan['ordering']): boolean | null => {
        if (++visits > 1024 || temporalCost > 2000000) return null;
        temporalCost += rows.length * (rows.length * 2 + p.ordering.length + chosen.length);
        if (temporalNetwork(p, rows, chosen, false).conflict.length) return false;
        if (at === disjunctions.length) return true;
        const first = solve(at + 1, [...chosen, disjunctions[at][0]]);
        if (first === true) return true;
        const second = solve(at + 1, [...chosen, disjunctions[at][1]]);
        return second === true ? true : first === null || second === null ? null : false;
      };
      if (disjunctions.length > 30) limited = true;
      else {
        const feasible = solve(0, []);
        if (feasible === false)
          add(
            'jointPresenceConflict',
            'error',
            'timeline',
            rows.map((r) => r.nodeId),
          );
        if (feasible === null) limited = true;
      }
    }
    if (limited) add('analysisLimit', 'warning', 'timeline');
    for (const t of p.timeline.filter((t) => t.period === period && t.certainty === 'disputed'))
      add('disputedTime', 'info', 'timeline', [t.nodeId]);
  }
  for (const v of p.versions) {
    reference(v.suspectId, 'versions', 'person');
    const c = v.conclusionId ? conclusions.get(v.conclusionId) : undefined;
    if (
      !v.title.trim() ||
      !v.motive.trim() ||
      !v.explanation.trim() ||
      !v.suspectId ||
      !c ||
      c.truth !== 'false'
    )
      add('versionIncomplete', 'warning', 'versions', [v.suspectId || v.id]);
    if (c) {
      const links = p.evidence.filter((e) => e.conclusionId === c.id);
      if (!links.some((e) => e.effect === 'supports' && e.explanation.trim()))
        add('versionUnsupported', 'warning', 'versions', [c.id]);
      if (result.knowledge.get(c.id)?.state !== 'false')
        add('versionUncleared', 'warning', 'versions', [c.id]);
    }
  }
  return {
    issues,
    ...result,
    productive,
    structured: !!board.investigation,
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
  };
}

export function suggestVersions(p: InvestigationPlan, nodes: InvestigationNode[]) {
  const state = explore(p, nodes);
  return nodes
    .filter((n) => kindOf(n) === 'person' && n.suspect !== false && n.answers?.motive?.trim())
    .flatMap((n) =>
      p.conclusions
        .filter(
          (c) =>
            c.truth === 'false' &&
            c.subjectIds.includes(n.id) &&
            !p.versions.some((v) => v.suspectId === n.id && v.conclusionId === c.id),
        )
        .flatMap((c) => {
          const apparent = p.evidence.filter(
            (e) => e.conclusionId === c.id && e.effect === 'supports' && e.explanation.trim(),
          );
          if (!apparent.length) return [];
          return [
            {
              suspectId: n.id,
              conclusionId: c.id,
              title: c.text,
              motive: n.answers!.motive,
              explanation: apparent
                .map((e) => e.explanation)
                .join('\n')
                .slice(0, 2000),
              score:
                apparent.filter((e) => state.reached.has(e.nodeId)).length +
                (state.negative.has(c.id) ? 2 : 0),
            },
          ];
        }),
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.suspectId.localeCompare(b.suspectId) ||
        a.conclusionId.localeCompare(b.conclusionId),
    );
}
