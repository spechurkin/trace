import type { Connection } from '../shared/model';
import type { Point } from './geometry';
import { CULPRIT } from '../shared/investigation';
import { segmentsIntersect } from '../modules/investigation-creator/diagram-geometry';

export interface EdgePath {
  path: string;
  label: Point;
  samples: Point[];
}

const incident = (a: Connection, b: Connection) =>
  [a.sourceId, a.targetId].some((id) => id === b.sourceId || id === b.targetId);
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const length = (points: Point[]) =>
  points.slice(1).reduce((sum, p, i) => sum + distance(p, points[i]), 0);
const crossPaths = (a: Point[], b: Point[]) =>
  a.slice(1).some((p, i) =>
    b.slice(1).some((q, j) => {
      const x = a[i],
        y = b[j];
      if (
        Math.max(x.x, p.x) < Math.min(y.x, q.x) ||
        Math.min(x.x, p.x) > Math.max(y.x, q.x) ||
        Math.max(x.y, p.y) < Math.min(y.y, q.y) ||
        Math.min(x.y, p.y) > Math.max(y.y, q.y)
      )
        return false;
      return segmentsIntersect(x, p, y, q);
    }),
  );

function rounded(points: Point[]): EdgePath {
  const samples = [points[0]];
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const before = points[i - 1],
      p = points[i],
      after = points[i + 1];
    const radius = Math.min(9, distance(before, p) / 3, distance(p, after) / 3);
    const a = {
      x: p.x + ((before.x - p.x) * radius) / (distance(before, p) || 1),
      y: p.y + ((before.y - p.y) * radius) / (distance(before, p) || 1),
    };
    const b = {
      x: p.x + ((after.x - p.x) * radius) / (distance(after, p) || 1),
      y: p.y + ((after.y - p.y) * radius) / (distance(after, p) || 1),
    };
    path += ` L ${a.x} ${a.y} Q ${p.x} ${p.y} ${b.x} ${b.y}`;
    samples.push(a);
    for (let k = 1; k <= 6; k++) {
      const t = k / 6;
      samples.push({
        x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * p.x + t * t * b.x,
        y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * p.y + t * t * b.y,
      });
    }
  }
  const end = points.at(-1)!;
  path += ` L ${end.x} ${end.y}`;
  samples.push(end);
  return { path, samples, label: samples[Math.floor(samples.length / 2)] };
}

function route(
  edge: Connection,
  edges: Connection[],
  paths: Map<string, EdgePath>,
  positions: Map<string, Point>,
): EdgePath | undefined {
  const start = positions.get(edge.sourceId)!,
    end = positions.get(edge.targetId)!;
  const all = [...positions.values()],
    step = 16;
  const minX = Math.min(...all.map((p) => p.x)) - 104,
    minY = Math.min(...all.map((p) => p.y)) - 104;
  const width = Math.ceil((Math.max(...all.map((p) => p.x)) + 104 - minX) / step) + 1;
  const height = Math.ceil((Math.max(...all.map((p) => p.y)) + 104 - minY) / step) + 1;
  const size = width * height;
  if (size > 180000) return;
  const cell = (p: Point) =>
    Math.max(0, Math.min(width - 1, Math.round((p.x - minX) / step))) +
    width * Math.max(0, Math.min(height - 1, Math.round((p.y - minY) / step)));
  const point = (id: number) => ({
    x: minX + (id % width) * step,
    y: minY + Math.floor(id / width) * step,
  });
  const source = cell(start),
    target = cell(end),
    occupied = new Uint16Array(size),
    blocked = new Uint8Array(size);
  const obstacles = [...positions].filter(([id]) => id !== edge.sourceId && id !== edge.targetId);
  for (let i = 0; i < size; i++) {
    const p = point(i);
    if (
      obstacles.some(
        ([id, q]) =>
          distance(p, q) < (id === CULPRIT ? 64 : 43) ||
          (Math.abs(p.x - q.x) < 83 && p.y - q.y > 38 && p.y - q.y < 75),
      )
    )
      blocked[i] = 1;
  }
  blocked[source] = 0;
  blocked[target] = 0;
  for (const other of edges) {
    if (other.id === edge.id || incident(edge, other)) continue;
    const samples = paths.get(other.id)!.samples,
      seen = new Set<number>();
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1],
        b = samples[i],
        count = Math.max(1, Math.ceil(distance(a, b) / (step / 3)));
      for (let k = 0; k <= count; k++)
        seen.add(cell({ x: a.x + ((b.x - a.x) * k) / count, y: a.y + ((b.y - a.y) * k) / count }));
    }
    for (const id of seen) occupied[id]++;
  }
  const cost = new Float64Array(size).fill(Infinity),
    previous = new Int32Array(size).fill(-1),
    closed = new Uint8Array(size);
  const heap: { id: number; score: number }[] = [];
  const push = (id: number, score: number) => {
    heap.push({ id, score });
    let i = heap.length - 1;
    while (i) {
      const p = (i - 1) >> 1;
      if (heap[p].score <= score) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const result = heap[0],
      last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (; ;) {
        let c = i * 2 + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heap[c + 1].score < heap[c].score) c++;
        if (heap[i].score <= heap[c].score) break;
        [heap[i], heap[c]] = [heap[c], heap[i]];
        i = c;
      }
    }
    return result;
  };
  cost[source] = 0;
  push(source, 0);
  while (heap.length) {
    const current = pop().id;
    if (closed[current]) continue;
    closed[current] = 1;
    if (current === target) break;
    const x = current % width,
      y = Math.floor(current / width);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = nx + ny * width;
        if (blocked[next] || closed[next]) continue;
        if (dx && dy && (blocked[x + dx + y * width] || blocked[x + (y + dy) * width])) continue;
        const value = cost[current] + (dx && dy ? Math.SQRT2 : 1) + occupied[next] * 140;
        if (value >= cost[next]) continue;
        cost[next] = value;
        previous[next] = current;
        push(next, value + Math.hypot(nx - (target % width), ny - Math.floor(target / width)));
      }
  }
  if (previous[target] === -1) return;
  const raw: Point[] = [];
  for (let id = target; id !== -1; id = previous[id]) raw.push(point(id));
  raw.reverse();
  const sr = edge.sourceId === CULPRIT ? 63 : 39,
    er = edge.directed ? 48 : 39;
  while (raw.length && distance(start, raw[0]) <= sr) raw.shift();
  while (raw.length && distance(end, raw.at(-1)!) <= er) raw.pop();
  if (!raw.length) return;
  const trim = (p: Point, toward: Point, r: number) => ({
    x: p.x + ((toward.x - p.x) * r) / (distance(p, toward) || 1),
    y: p.y + ((toward.y - p.y) * r) / (distance(p, toward) || 1),
  });
  const points = [trim(start, raw[0], sr), ...raw, trim(end, raw.at(-1)!, er)];
  const simplified = points.filter(
    (p, i) =>
      !i ||
      i === points.length - 1 ||
      Math.abs(
        (p.x - points[i - 1].x) * (points[i + 1].y - p.y) -
        (p.y - points[i - 1].y) * (points[i + 1].x - p.x),
      ) > 0.01,
  );
  return rounded(simplified);
}

export function routeEdges(
  edges: Connection[],
  positions: Map<string, Point>,
  initial: Map<string, EdgePath>,
) {
  const paths = new Map(initial);
  // Bound synchronous routing work so a large board stays responsive.
  if (edges.length * edges.length * 32 * 32 > 20_000_000) return paths;
  const conflicts = (edge: Connection, path: EdgePath) =>
    edges.filter(
      (other) =>
        other.id !== edge.id &&
        !incident(edge, other) &&
        crossPaths(path.samples, paths.get(other.id)!.samples),
    ).length;
  const hits = (edge: Connection, path: EdgePath) =>
    [...positions].filter(
      ([id, p]) =>
        id !== edge.sourceId &&
        id !== edge.targetId &&
        path.samples.some(
          (q) =>
            distance(p, q) < (id === CULPRIT ? 63 : 42) ||
            (Math.abs(q.x - p.x) < 80 && q.y - p.y > 39 && q.y - p.y < 74),
        ),
    ).length;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    const counts = new Map(edges.map((edge) => [edge.id, conflicts(edge, paths.get(edge.id)!)]));
    const order = [...edges].sort((a, b) => counts.get(b.id)! - counts.get(a.id)!);
    for (const edge of order) {
      const old = paths.get(edge.id)!,
        count = conflicts(edge, old),
        cards = hits(edge, old);
      if (!count && !cards) continue;
      const next = route(edge, edges, paths, positions);
      if (!next) continue;
      const nextCount = conflicts(edge, next);
      if (
        nextCount * 1000 + hits(edge, next) * 400 + length(next.samples) / 100 <
        count * 1000 + cards * 400 + length(old.samples) / 100
      ) {
        paths.set(edge.id, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return paths;
}
