import type { Club, Connection } from '../shared/model';
import { CULPRIT } from '../shared/investigation';
import { getLocale } from '../shared/i18n';

export type Point = { x: number; y: number };
export const CENTER = { x: 460, y: 410 };
export const NODE_RADIUS = 34;

export function clubRadius(count: number) {
  return Math.max(210, Math.min(278, 196 + count * 10), count * 19);
}

export function clubPositions(ids: string[]): Map<string, Point> {
  const radius = clubRadius(ids.length);
  return new Map(
    ids.map((id, index) => {
      const angle = -Math.PI / 2 + (index / ids.length) * Math.PI * 2;
      return [
        id,
        { x: CENTER.x + Math.cos(angle) * radius, y: CENTER.y + Math.sin(angle) * radius },
      ];
    }),
  );
}

export function boardPositions(board: Club): Map<string, Point> {
  const positions = clubPositions(board.characterIds);
  for (const id of board.characterIds) {
    const placement = board.layout?.[id];
    if (placement?.x !== undefined && placement?.y !== undefined)
      positions.set(id, { x: placement.x, y: placement.y });
  }
  positions.set(CULPRIT, CENTER);
  return positions;
}

// Symmetric bounds keep the fixed culprit centered even with asymmetric branches.
export function boardBounds(board: Club, legendCount = 0) {
  const positions = [...boardPositions(board).values()];
  const halfWidth = Math.max(460, ...positions.map((p) => Math.abs(p.x - CENTER.x) + 110));
  const halfHeight = Math.max(410, ...positions.map((p) => Math.abs(p.y - CENTER.y) + 110));
  const legendHeight = Math.max(0, Math.ceil(legendCount / 4) - 1) * 20;
  return {
    x: CENTER.x - halfWidth,
    y: CENTER.y - halfHeight,
    width: halfWidth * 2,
    height: halfHeight * 2,
    legendHeight,
  };
}

export function edgeGeometry(edge: Connection, edges: Connection[], positions: Map<string, Point>) {
  const start = positions.get(edge.sourceId)!;
  const end = positions.get(edge.targetId)!;
  const pair = [edge.sourceId, edge.targetId].sort();
  const parallel = edges.filter(
    (e) => [e.sourceId, e.targetId].sort().join('|') === pair.join('|'),
  );
  const lane = parallel.findIndex((e) => e.id === edge.id) - (parallel.length - 1) / 2;
  // Use a canonical orientation so reversed arrows occupy distinct lanes.
  const orientation = edge.sourceId === pair[0] ? 1 : -1;
  const dx = end.x - start.x,
    dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length,
    ny = dx / length;
  const bend = lane * 48 * orientation;
  const control = { x: (start.x + end.x) / 2 + nx * bend, y: (start.y + end.y) / 2 + ny * bend };
  const trimmed = (point: Point, toward: Point, radius: number) => {
    const length = Math.hypot(toward.x - point.x, toward.y - point.y) || 1;
    return {
      x: point.x + ((toward.x - point.x) / length) * radius,
      y: point.y + ((toward.y - point.y) / length) * radius,
    };
  };
  const a = trimmed(start, control, NODE_RADIUS + 5);
  const b = trimmed(end, control, NODE_RADIUS + (edge.directed ? 14 : 5));
  return {
    path: `M ${a.x} ${a.y} Q ${control.x} ${control.y} ${b.x} ${b.y}`,
    label: {
      x: a.x * 0.25 + control.x * 0.5 + b.x * 0.25,
      y: a.y * 0.25 + control.y * 0.5 + b.y * 0.25,
    },
  };
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => [...part][0])
    .join('')
    .toLocaleUpperCase(getLocale());
}

export function truncate(value: string, limit = 22): string {
  const chars = [...value];
  return chars.length > limit ? chars.slice(0, limit - 1).join('') + '…' : value;
}
