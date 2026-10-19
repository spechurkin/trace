import {
  type DiagramEdge,
  type DiagramFootprint,
  edgeHitsFootprint,
  edgesCross,
  footprintsOverlap,
  type Point,
  segmentsIntersect,
} from './diagram-geometry';

export const COMPACT_LAYOUT_VERSION = 'compact-v4' as const;

export class DiagramPlacementError extends Error {
}

// Soft costs trade fewer crossings against squared link lengths and extent.
// Card overlap remains a hard constraint; a crossing never invalidates a layout.
const LOCAL_CONFLICT_COST = 100_000;
const LAYOUT_CONFLICT_COST = 75_000;

interface LayoutNode {
  id: string | null;
  sources: (string | null)[];
  footprint: DiagramFootprint;
  fixed?: Point;
  previous?: Point;
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// Adapt Clubs' circular placement candidates (src/geometry.ts) into short rings
// around neighbouring cards. Every incoming and outgoing edge affects the score.
function placeCompact(nodes: LayoutNode[], bounds: Bounds, random: () => number) {
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const neighbours = nodes.map(() => new Set<number>());
  const links: { a: number; b: number }[] = [];
  for (let b = 0; b < nodes.length; b++)
    for (const source of nodes[b].sources) {
      const a = index.get(source);
      if (a !== undefined && a !== b) {
        links.push({ a, b });
        neighbours[a].add(b);
        neighbours[b].add(a);
      }
    }
  const boxes = nodes.map(({ footprint: f }) => ({
    halfWidth: Math.max(f.radius, f.labelWidth / 2),
    top: Math.min(-f.radius, f.labelTop),
    bottom: Math.max(f.radius, f.labelBottom),
  }));
  const cellSize = Math.max(
    128,
    ...boxes.map((b) => Math.max(b.halfWidth * 2, b.bottom - b.top) + 12),
  );
  const points = new Map<number, Point>();
  const buckets = new Map<string, Set<number>>();
  const cell = (p: Point) => `${Math.floor(p.x / cellSize)},${Math.floor(p.y / cellSize)}`;
  const inside = (p: Point) =>
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    p.x >= bounds.minX &&
    p.x <= bounds.maxX &&
    p.y >= bounds.minY &&
    p.y <= bounds.maxY;
  const put = (i: number, p: Point) => {
    const old = points.get(i);
    if (old) buckets.get(cell(old))?.delete(i);
    points.set(i, p);
    const key = cell(p);
    if (!buckets.has(key)) buckets.set(key, new Set());
    buckets.get(key)!.add(i);
  };
  const free = (i: number, p: Point, ignore?: number) => {
    if (!inside(p)) return false;
    const cx = Math.floor(p.x / cellSize),
      cy = Math.floor(p.y / cellSize),
      a = boxes[i];
    for (let x = cx - 1; x <= cx + 1; x++)
      for (let y = cy - 1; y <= cy + 1; y++)
        for (const j of buckets.get(`${x},${y}`) || []) {
          if (j === i || j === ignore) continue;
          const other = points.get(j)!,
            b = boxes[j];
          if (
            Math.abs(p.x - other.x) < a.halfWidth + b.halfWidth + 10 &&
            p.y + a.top < other.y + b.bottom + 10 &&
            p.y + a.bottom + 10 > other.y + b.top
          )
            return false;
        }
    return true;
  };
  for (let i = 0; i < nodes.length; i++)
    if (nodes[i].fixed) {
      const p = nodes[i].fixed!;
      if (!inside(p)) throw new DiagramPlacementError('A fixed card is outside the board bounds');
      for (const [j, other] of points)
        if (footprintsOverlap(p, nodes[i].footprint, other, nodes[j].footprint))
          throw new DiagramPlacementError('Fixed cards overlap');
      put(i, { ...p });
    }
  const angle = random() * Math.PI * 2;
  const nodeScoring = (i: number) => {
    const adjacentIndices = [...neighbours[i]].filter((j) => points.has(j));
    const adjacent = adjacentIndices.map((j) => points.get(j)!);
    const otherEdges = links
      .filter(({ a, b }) => a !== i && b !== i && points.has(a) && points.has(b))
      .map(({ a, b }) => ({ a, b, start: points.get(a)!, end: points.get(b)! }));
    const obstacles = [...points].filter(([j]) => j !== i);
    const boxesMeet = (a: Point, b: Point, c: Point, d: Point) =>
      Math.max(a.x, b.x) >= Math.min(c.x, d.x) &&
      Math.min(a.x, b.x) <= Math.max(c.x, d.x) &&
      Math.max(a.y, b.y) >= Math.min(c.y, d.y) &&
      Math.min(a.y, b.y) <= Math.max(c.y, d.y);
    const hitsCard = (a: Point, b: Point, j: number, p: Point) => {
      const box = boxes[j];
      if (
        !boxesMeet(
          a,
          b,
          { x: p.x - box.halfWidth, y: p.y + box.top },
          { x: p.x + box.halfWidth, y: p.y + box.bottom },
        )
      )
        return false;
      return edgeHitsFootprint({ id: 'target', parentId: 'source', a, b }, p, nodes[j].footprint);
    };
    const conflicts = (p: Point) => {
      let count = 0;
      for (const j of adjacentIndices) {
        const end = points.get(j)!;
        for (const edge of otherEdges) {
          if (
            edge.a !== j &&
            edge.b !== j &&
            boxesMeet(p, end, edge.start, edge.end) &&
            segmentsIntersect(p, end, edge.start, edge.end)
          )
            count += 8;
        }
        for (const [other, point] of obstacles)
          if (other !== j && hitsCard(p, end, other, point)) count++;
      }
      for (const edge of otherEdges) if (hitsCard(edge.start, edge.end, i, p)) count++;
      return count;
    };
    const weight = Math.max(1, adjacent.length);
    const target = adjacent.reduce((p, other) => ({ x: p.x + other.x, y: p.y + other.y }), {
      x: 0,
      y: 0,
    });
    // A weak preference for the centre folds chains and prevents entire branches
    // drifting outward while still keeping directly connected cards together.
    target.x = Math.max(bounds.minX, Math.min(bounds.maxX, target.x / (weight * 1.18)));
    target.y = Math.max(bounds.minY, Math.min(bounds.maxY, target.y / (weight * 1.18)));
    const distanceScore = (p: Point) => {
      const distances = adjacent.map((other) => (p.x - other.x) ** 2 + (p.y - other.y) ** 2);
      return (
        distances.reduce((sum, value) => sum + value, 0) / weight +
        Math.max(0, ...distances) * 0.7 +
        0.18 * (p.x ** 2 + p.y ** 2)
      );
    };
    return { conflicts, distanceScore, target };
  };
  const findPosition = (i: number) => {
    const { conflicts, distanceScore, target } = nodeScoring(i);
    let best = points.get(i),
      bestConflicts = best ? conflicts(best) : Infinity,
      bestScore = best ? distanceScore(best) + bestConflicts * LOCAL_CONFLICT_COST : Infinity;
    if (best && !free(i, best)) {
      best = undefined;
      bestScore = Infinity;
      bestConflicts = Infinity;
    }
    const consider = (candidate: Point) => {
      const distance = distanceScore(candidate);
      if (distance >= bestScore || !free(i, candidate)) return;
      const count = conflicts(candidate),
        value = distance + count * LOCAL_CONFLICT_COST;
      if (value < bestScore - 1e-6) {
        best = candidate;
        bestScore = value;
        bestConflicts = count;
      }
    };
    if (nodes[i].previous) consider(nodes[i].previous!);
    consider(target);
    const step = Math.max(28, Math.min(48, cellSize / 3));
    const limit = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) + cellSize;
    let firstFree: number | undefined = free(i, target) ? 0 : undefined;
    for (let ring = 1; ring * step <= limit; ring++) {
      const radius = ring * step,
        samples = Math.max(12, Math.ceil((2 * Math.PI * radius) / 55));
      for (let k = 0; k < samples; k++) {
        const direction = angle + (k / samples) * Math.PI * 2;
        consider({
          x: target.x + radius * Math.cos(direction),
          y: target.y + radius * Math.sin(direction),
        });
      }
      if (firstFree === undefined && best) firstFree = ring;
      if (firstFree !== undefined && ring >= firstFree + (bestConflicts ? 12 : 2)) break;
    }
    if (!best)
      throw new DiagramPlacementError('Could not fit cards and captions inside the board bounds');
    return best;
  };
  const pending = new Set(nodes.map((_, i) => i).filter((i) => !points.has(i)));
  while (pending.size) {
    // Start at placed neighbours and hubs so shared nodes can gather their paths.
    const ranked = [...pending].sort((a, b) => {
      const placed = (i: number) => [...neighbours[i]].filter((j) => points.has(j)).length;
      return placed(b) - placed(a) || neighbours[b].size - neighbours[a].size || a - b;
    });
    const i = ranked[0];
    put(i, findPosition(i));
    pending.delete(i);
  }
  const order = nodes
    .map((_, i) => i)
    .filter((i) => !nodes[i].fixed)
    .sort((a, b) => neighbours[b].size - neighbours[a].size || a - b);
  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (const i of order) {
      const old = points.get(i)!,
        next = findPosition(i);
      if (Math.hypot(next.x - old.x, next.y - old.y) > 0.01) moved = true;
      put(i, next);
    }
    if (!moved) break;
  }
  const result = () => new Map(nodes.map((node, i) => [node.id, { ...points.get(i)! }]));
  let best = result(),
    bestQuality = layoutQuality(nodes, best);
  if (bestQuality.conflicts && order.length) {
    // Local ring searches can become trapped by an interlocked group. Permit
    // temporary worse moves and swaps, while retaining only the best full graph.
    let state = ((angle / (Math.PI * 2)) * 4294967296) >>> 0;
    const draw = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
    const budget = Math.min(4200, Math.floor(120000 / nodes.length));
    for (let step = 0; step < budget; step++) {
      const i = order[Math.floor(draw() * order.length)],
        old = points.get(i)!;
      const before = nodeScoring(i);
      const oldEnergy = before.conflicts(old) / 8 + before.distanceScore(old) / 2_000_000;
      let j: number | undefined, other: Point | undefined, next: Point;
      if (draw() < 0.4) {
        j = order[Math.floor(draw() * order.length)];
        if (j === i) continue;
        other = points.get(j)!;
        if (!free(i, other, j) || !free(j, old, i)) continue;
        next = other;
      } else {
        const radius = 70 + draw() * Math.max(200, cellSize * 2),
          direction = draw() * Math.PI * 2;
        next = {
          x: before.target.x + Math.cos(direction) * radius,
          y: before.target.y + Math.sin(direction) * radius,
        };
        if (!free(i, next)) continue;
      }
      const oldOther = j === undefined ? 0 : nodeScoring(j).conflicts(other!) / 8;
      put(i, next);
      if (j !== undefined) put(j, old);
      const after = nodeScoring(i);
      const delta =
        after.conflicts(next) / 8 +
        after.distanceScore(next) / 2_000_000 +
        (j === undefined ? 0 : nodeScoring(j).conflicts(old) / 8) -
        oldEnergy -
        oldOther;
      const temperature = 0.7 * (1 - step / budget) ** 2 + 0.015;
      if (delta > 0 && draw() >= Math.exp(-delta / temperature)) {
        put(i, old);
        if (j !== undefined) put(j, other!);
      }
      if (step % 32 === 0 || step === budget - 1) {
        const candidate = result(),
          quality = layoutQuality(nodes, candidate);
        if (
          quality.conflicts * LAYOUT_CONFLICT_COST + quality.distance <
          bestQuality.conflicts * LAYOUT_CONFLICT_COST + bestQuality.distance
        ) {
          best = candidate;
          bestQuality = quality;
        }
        if (!bestQuality.conflicts) break;
      }
    }
  }
  return best;
}

function layoutQuality(nodes: LayoutNode[], points: Map<string | null, Point>) {
  const edges: DiagramEdge[] = nodes.flatMap((node) =>
    node.sources.map((source) => ({
      id: node.id!,
      parentId: source,
      a: points.get(source)!,
      b: points.get(node.id)!,
    })),
  );
  let conflicts = 0,
    distance = 0,
    longest = 0;
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i],
      length = (edge.a.x - edge.b.x) ** 2 + (edge.a.y - edge.b.y) ** 2;
    distance += length;
    longest = Math.max(longest, length);
    for (let j = 0; j < i; j++) {
      const other = edges[j];
      if (edge.id === other.parentId && edge.parentId === other.id) continue;
      if (edgesCross(edge, other)) conflicts += 8;
    }
    for (const node of nodes)
      if (
        node.id !== edge.id &&
        node.id !== edge.parentId &&
        edgeHitsFootprint(edge, points.get(node.id)!, node.footprint)
      )
        conflicts++;
  }
  const extent = Math.max(
    0,
    ...[...points.values()].map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))),
  );
  return {
    conflicts,
    distance: distance / Math.max(1, edges.length) + longest * 2 + extent ** 2 * 0.15,
  };
}

export function compactLayout(nodes: LayoutNode[], bounds: Bounds, random: () => number) {
  let best: Map<string | null, Point> | undefined;
  let failure: DiagramPlacementError | undefined;
  let bestConflicts = Infinity,
    bestDistance = Infinity;
  const attempts = Math.max(1, Math.min(24, Math.floor(800 / nodes.length)));
  for (let attempt = 0; attempt < attempts; attempt++) {
    let points: Map<string | null, Point>;
    try {
      points = placeCompact(nodes, bounds, () => (random() + attempt * 0.38196601125) % 1);
    } catch (error) {
      if (!(error instanceof DiagramPlacementError)) throw error;
      failure = error;
      continue;
    }
    const { conflicts, distance } = layoutQuality(nodes, points);
    if (
      conflicts * LAYOUT_CONFLICT_COST + distance <
      bestConflicts * LAYOUT_CONFLICT_COST + bestDistance
    ) {
      best = points;
      bestConflicts = conflicts;
      bestDistance = distance;
    }
    if (!bestConflicts && attempt >= Math.min(11, attempts - 1)) break;
  }
  if (!best) throw failure ?? new DiagramPlacementError('Could not arrange the board');
  return best;
}
