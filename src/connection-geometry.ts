// Adapted from Clubs: src/geometry.ts (directed graph curves and parallel lanes).
import type { Connection } from '../shared/model';
import type { Point } from './geometry';
import { CULPRIT } from '../shared/investigation';
import { type EdgePath, obstacleHits, routeEdges, straightGeometry } from './edge-routing';

const NODE_RADIUS = 34;

function baseGeometry(
  edge: Connection,
  edges: Connection[],
  positions: Map<string, Point>,
  captionWidths: Map<string, number>,
): EdgePath {
  const start = positions.get(edge.sourceId)!;
  const end = positions.get(edge.targetId)!;
  const pair = [edge.sourceId, edge.targetId].sort();
  const parallel = edges.filter(
    (e) => [e.sourceId, e.targetId].sort().join('|') === pair.join('|'),
  );
  const lane =
    Math.max(
      0,
      parallel.findIndex((e) => e.id === edge.id),
    ) -
    (Math.max(1, parallel.length) - 1) / 2;
  // Use a canonical orientation so reversed arrows occupy distinct lanes.
  const orientation = edge.sourceId === pair[0] ? 1 : -1;
  const dx = end.x - start.x,
    dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length,
    ny = dx / length;
  const bend = lane * 48 * orientation;
  const direct = straightGeometry(edge, positions);
  if (parallel.length === 1 && !obstacleHits(edge, direct, positions, captionWidths)) return direct;
  const points = [...positions.values()];
  const minX = Math.min(...points.map((p) => p.x)) - 90,
    maxX = Math.max(...points.map((p) => p.x)) + 90;
  const minY = Math.min(...points.map((p) => p.y)) - 90,
    maxY = Math.max(...points.map((p) => p.y)) + 90;
  const controlAt = (bend: number) => ({
    x: Math.max(minX, Math.min(maxX, (start.x + end.x) / 2 + nx * bend)),
    y: Math.max(minY, Math.min(maxY, (start.y + end.y) / 2 + ny * bend)),
  });
  let control = controlAt(bend);
  // Unlike Clubs' circular layout, a shared investigation node may lie behind
  // other cards. Bend the copied quadratic path around cards and captions.
  const obstacles = [...positions].filter(([id]) => id !== edge.sourceId && id !== edge.targetId);
  const hits = (control: Point) => {
    let hits = 0;
    for (let i = 1; i < 40; i++) {
      const t = i / 40;
      const p = {
        x: start.x * (1 - t) ** 2 + 2 * (1 - t) * t * control.x + end.x * t * t,
        y: start.y * (1 - t) ** 2 + 2 * (1 - t) * t * control.y + end.y * t * t,
      };
      for (const [id, point] of obstacles) {
        if (
          Math.hypot(p.x - point.x, p.y - point.y) < (id === CULPRIT ? 63 : 48) ||
          (Math.abs(p.x - point.x) < (captionWidths.get(id) ?? 80) + 10 &&
            p.y - point.y > 38 &&
            p.y - point.y < 74)
        )
          hits++;
      }
    }
    return hits;
  };
  let best = hits(control);
  if (best) {
    for (const offset of [90, -90, 180, -180, 360, -360, 720, -720, 1440, -1440]) {
      const candidate = controlAt(bend + offset),
        score = hits(candidate);
      if (score < best) {
        control = candidate;
        best = score;
      }
      if (!best) break;
    }
  }
  const trimmed = (point: Point, toward: Point, radius: number) => {
    const length = Math.hypot(toward.x - point.x, toward.y - point.y) || 1;
    return {
      x: point.x + ((toward.x - point.x) / length) * radius,
      y: point.y + ((toward.y - point.y) / length) * radius,
    };
  };
  const a = trimmed(start, control, edge.sourceId === CULPRIT ? 63 : NODE_RADIUS + 5);
  const b = trimmed(end, control, NODE_RADIUS + (edge.directed ? 14 : 5));
  return {
    path: `M ${a.x} ${a.y} Q ${control.x} ${control.y} ${b.x} ${b.y}`,
    label: {
      x: a.x * 0.25 + control.x * 0.5 + b.x * 0.25,
      y: a.y * 0.25 + control.y * 0.5 + b.y * 0.25,
    },
    samples: Array.from({ length: 33 }, (_, i) => {
      const t = i / 32;
      return {
        x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * control.x + t * t * b.x,
        y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * control.y + t * t * b.y,
      };
    }),
  };
}

let cacheKey = '',
  cache = new Map<string, EdgePath>();

export function edgeGeometry(
  edge: Connection,
  edges: Connection[],
  positions: Map<string, Point>,
  captionWidths: Map<string, number> = new Map(),
): EdgePath {
  const list = edges.some((e) => e.id === edge.id) ? edges : [edge];
  const key = JSON.stringify([
    list.map((e) => [e.id, e.sourceId, e.targetId, e.directed]),
    [...positions],
    [...captionWidths],
  ]);
  if (key !== cacheKey) {
    cache = routeEdges(
      list,
      positions,
      new Map(list.map((e) => [e.id, baseGeometry(e, list, positions, captionWidths)])),
      captionWidths,
    );
    cacheKey = key;
  }
  return cache.get(edge.id)!;
}
