import { type DiagramPlacement, type InvestigationDiagram, type InvestigationNode, kindOf } from './contracts';
import type { InvestigationPlan } from './schema';
import { type DiagramFootprint, footprintsOverlap, type Point } from './diagram-geometry';

import { COMPACT_LAYOUT_VERSION, compactLayout } from './compact-layout';
import { discoveryFrontier } from './discovery-frontier';

export { DiagramPlacementError } from './compact-layout';

export interface DiagramOptions {
  replaceManual?: boolean;
  random?: () => number;
  bounds?: { minX: number; maxX: number; minY: number; maxY: number };
  footprints?: Record<string, DiagramFootprint>;
}

// The placement backbone is a tree; parentIds contains the immediate leads of
// every independent method. The full AND/OR conditions stay in the logical plan.
export function buildInvestigationDiagram(
  plan: InvestigationPlan,
  input: InvestigationNode[],
  previous: DiagramPlacement[] = [],
  options: DiagramOptions = {},
): InvestigationDiagram {
  const {
    replaceManual = false,
    random = Math.random,
    bounds = { minX: -9000, maxX: 9000, minY: -9000, maxY: 9000 },
  } = options;
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const nodes = [...new Map(input.map((n) => [n.id, n])).values()].sort((a, b) =>
    compare(a.id, b.id),
  );
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const saved = new Map(previous.map((p) => [p.id, p]));
  const candidates = new Map<string, string | null>();
  const prerequisitesById = new Map<string, string[]>();
  const methodsById = new Map<string, string[][]>();
  const sameParents = (a?: (string | null)[], b?: (string | null)[]) =>
    JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
  for (const node of nodes) {
    const methods = plan.access
      .filter((r) => r.targetId === node.id && r.method.trim())
      .map((r) => [...new Set(r.requires.filter((id) => byId.has(id) && id !== node.id))]);
    methodsById.set(node.id, methods);
    const prerequisites = new Set(methods.flat());
    prerequisitesById.set(node.id, [...prerequisites].sort(compare));
    // Discovery order takes priority over where a node is found or appears in the timeline.
    if (prerequisites.size === 1) {
      candidates.set(node.id, [...prerequisites][0]);
      continue;
    }
    const kind = kindOf(node);
    if (kind === 'location') {
      candidates.set(node.id, null);
      continue;
    }
    const locations = new Set(
      (kind === 'evidence'
          ? plan.evidence.filter((e) => e.nodeId === node.id).map((e) => e.locationId)
          : plan.timeline
            .filter(
              (t) =>
                t.certainty === 'confirmed' &&
                (t.nodeId === node.id || (kind === 'person' && t.personIds.includes(node.id))),
            )
            .map((t) => t.locationId)
      ).filter(
        (id): id is string => !!id && kindOf(byId.get(id) || { id, name: '' }) === 'location',
      ),
    );
    // Multiple roles for one clue do not create multiple parents. Conflicting places stay ungrouped.
    if (locations.size) {
      candidates.set(node.id, locations.size === 1 ? [...locations][0] : null);
      continue;
    }
    candidates.set(node.id, null);
  }
  const parents = new Map(nodes.map((n) => [n.id, null as string | null]));
  const protectedParents = new Set<string>();
  const isManual = (old: DiagramPlacement | undefined) =>
    old &&
    (old.locked ||
      (!replaceManual &&
        (!old.generated ||
          old.parentId !== old.generated.parentId ||
          !sameParents(old.parentIds, old.generated.parentIds))));
  const manualSources = (old: DiagramPlacement) =>
    // Also tolerate older adapters that only changed the placement anchor.
    old.generated &&
    old.parentId !== old.generated.parentId &&
    sameParents(old.parentIds, old.generated.parentIds)
      ? [old.parentId ?? null]
      : (old.parentIds ?? [old.parentId ?? null]);
  const assign = (id: string, parent: string | null) => {
    if (parent === null) {
      parents.set(id, null);
      return;
    }
    if (!byId.has(parent)) return;
    const seen = new Set<string>(),
      pending = [parent];
    while (pending.length) {
      const p = pending.pop()!;
      if (p === id) return;
      if (seen.has(p)) continue;
      seen.add(p);
      const sources = [parents.get(p) ?? null];
      pending.push(...sources.filter((source): source is string => source !== null));
    }
    parents.set(id, parent);
  };
  // Keep manual edges first, so generated fallbacks cannot introduce a cycle through them.
  for (const node of nodes) {
    const old = saved.get(node.id);
    if (old?.parentId !== undefined && isManual(old)) {
      protectedParents.add(node.id);
      assign(node.id, old.parentId);
    }
  }
  const immediate = discoveryFrontier(
    methodsById,
    new Map(
      nodes.map((node) => [
        node.id,
        isManual(saved.get(node.id))
          ? manualSources(saved.get(node.id)!)
          : prerequisitesById.get(node.id)!.length
            ? prerequisitesById.get(node.id)!
            : [candidates.get(node.id)!],
      ]),
    ),
  );
  for (const node of nodes) {
    const sources = immediate.get(node.id)!;
    prerequisitesById.set(node.id, sources);
    if (sources.length === 1) candidates.set(node.id, sources[0]);
  }
  const resolved = new Set<string>(),
    resolving = new Set<string>();
  const resolve = (id: string) => {
    if (resolved.has(id) || resolving.has(id)) return;
    resolving.add(id);
    const prerequisites = prerequisitesById.get(id)!;
    // Finish prerequisite branches first, including chains with several AND conditions.
    prerequisites.forEach(resolve);
    const fallback = candidates.get(id)!;
    const currentParent = protectedParents.has(id) ? parents.get(id)! : fallback;
    if (currentParent !== null) resolve(currentParent);
    if (prerequisites.length > 1) {
      const depths = prerequisites.map((required) => {
        let depth = 0;
        for (let p: string | null = required; p !== null; p = parents.get(p)!) depth++;
        return { id: required, depth };
      });
      const maxDepth = Math.max(...depths.map((p) => p.depth));
      const deepest = depths.filter((p) => p.depth === maxDepth);
      // Choose one anchor for placement; each immediate lead remains visible.
      candidates.set(id, deepest[0].id);
    }
    if (!protectedParents.has(id)) assign(id, candidates.get(id)!);
    resolving.delete(id);
    resolved.add(id);
  };
  nodes.forEach((node) => resolve(node.id));

  const incoming = new Map<string, (string | null)[]>();
  const protectedIncoming = new Set<string>();
  for (const node of nodes) {
    const old = saved.get(node.id);
    const manual = isManual(old);
    if (manual) protectedIncoming.add(node.id);
    incoming.set(node.id, [parents.get(node.id)!]);
  }
  const addPath = (id: string, source: string | null) => {
    if (source === null || !byId.has(source) || source === id) return;
    const list = incoming.get(id)!;
    if (!list.includes(source))
      incoming.set(id, [
        ...list.filter(
          (p) =>
            p !== null ||
            (protectedIncoming.has(id) && manualSources(saved.get(id)!).includes(null)),
        ),
        source,
      ]);
  };
  // Backward leads are real discovery paths, even when they form a cycle.
  for (const manual of [true, false])
    for (const node of nodes) {
      if (protectedIncoming.has(node.id) !== manual) continue;
      const old = saved.get(node.id);
      const sources = manual ? manualSources(old!) : prerequisitesById.get(node.id)!;
      for (const source of sources) addPath(node.id, source);
      // A cycle can invalidate an anchor. Otherwise use a real incoming path
      // instead of adding a spurious connection from the central culprit.
    }

  const keepPosition = (old: DiagramPlacement | undefined) =>
    old?.x !== undefined &&
    old.y !== undefined &&
    (old.locked ||
      (!replaceManual &&
        (!old.generated || old.x !== old.generated.x || old.y !== old.generated.y)));
  const sizes = new Map<string | null, DiagramFootprint>([
    [null, { radius: 63, labelWidth: 120, labelTop: 64, labelBottom: 88 }],
  ]);
  for (const node of nodes)
    sizes.set(
      node.id,
      options.footprints?.[node.id] || {
        radius: 48,
        labelWidth: Math.min([...node.name].length, nodes.length > 12 ? 14 : 24) * 8.5 + 16,
        labelTop: 40,
        labelBottom: 70,
      },
    );
  const fixed = new Map<string | null, Point>([[null, { x: 0, y: 0 }]]);
  for (const node of nodes) {
    const old = saved.get(node.id);
    if (keepPosition(old)) fixed.set(node.id, { x: old!.x!, y: old!.y! });
  }
  // Reuse is safe only while the graph, label sizes and manual anchors match.
  // Moving a fixed card must let the automatic cards untangle their lines again.
  const signature = JSON.stringify([
    bounds,
    nodes.map((node) => [node.id, incoming.get(node.id), sizes.get(node.id), fixed.get(node.id)]),
  ]);
  let hash = 2166136261;
  for (let i = 0; i < signature.length; i++)
    hash = Math.imul(hash ^ signature.charCodeAt(i), 16777619);
  const layoutKey = (hash >>> 0).toString(16);
  const canReuse =
    !replaceManual &&
    saved.size === nodes.length &&
    nodes.every((node) => {
      const old = saved.get(node.id);
      return (
        old?.generated?.layoutVersion === COMPACT_LAYOUT_VERSION &&
        old.generated.layoutKey === layoutKey &&
        old.parentId === parents.get(node.id) &&
        sameParents(old.parentIds ?? [old.parentId ?? null], incoming.get(node.id)) &&
        old.x !== undefined &&
        old.y !== undefined &&
        old.x >= bounds.minX &&
        old.x <= bounds.maxX &&
        old.y >= bounds.minY &&
        old.y <= bounds.maxY
      );
    });
  let points = new Map<string | null, Point>([
    [null, { x: 0, y: 0 }],
    ...nodes
      .filter((node) => saved.get(node.id)?.x !== undefined && saved.get(node.id)?.y !== undefined)
      .map((node): [string, Point] => [
        node.id,
        { x: saved.get(node.id)!.x!, y: saved.get(node.id)!.y! },
      ]),
  ]);
  const savedOverlap =
    canReuse &&
    [...points].some(([a, point], i, all) =>
      all
        .slice(0, i)
        .some(([b, other]) => footprintsOverlap(point, sizes.get(a)!, other, sizes.get(b)!)),
    );
  if (!canReuse || savedOverlap)
    points = compactLayout(
      [
        { id: null, sources: [], footprint: sizes.get(null)!, fixed: fixed.get(null) },
        ...nodes.map((node) => {
          const old = saved.get(node.id);
          return {
            id: node.id,
            sources: incoming.get(node.id)!,
            footprint: sizes.get(node.id)!,
            fixed: fixed.get(node.id),
            previous:
              old?.generated?.layoutVersion === COMPACT_LAYOUT_VERSION &&
              old.x !== undefined &&
              old.y !== undefined
                ? { x: old.x, y: old.y }
                : undefined,
          };
        }),
      ],
      bounds,
      random,
    );
  return {
    nodes: nodes.map((node) => {
      const point = points.get(node.id)!;
      const suggested = fixed.has(node.id)
        ? saved.get(node.id)?.generated || points.get(parents.get(node.id)!)!
        : point;
      const generated = {
        layoutVersion: COMPACT_LAYOUT_VERSION,
        layoutKey,
        parentId: protectedParents.has(node.id) ? candidates.get(node.id)! : parents.get(node.id)!,
        parentIds: protectedIncoming.has(node.id)
          ? prerequisitesById.get(node.id)!.length
            ? prerequisitesById.get(node.id)!
            : [candidates.get(node.id)!]
          : incoming.get(node.id)!,
        x: suggested.x,
        y: suggested.y,
      };
      return {
        id: node.id,
        parentId: parents.get(node.id)!,
        parentIds: incoming.get(node.id)!,
        x: point.x,
        y: point.y,
        generated,
      };
    }),
  };
}
