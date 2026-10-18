import type { Board } from '../shared/model';
import { CULPRIT } from '../shared/investigation';
import { getLocale } from '../shared/i18n';

export type Point = { x: number; y: number };
export const CENTER = { x: 460, y: 410 };
export const NODE_RADIUS = 34;

export function boardRadius(count: number) {
  return Math.max(210, Math.min(278, 196 + count * 10), count * 19);
}

export function defaultBoardPositions(ids: string[]): Map<string, Point> {
  const radius = boardRadius(ids.length);
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

export function boardPositions(board: Board): Map<string, Point> {
  const positions = defaultBoardPositions(board.characterIds);
  for (const id of board.characterIds) {
    const placement = board.layout?.[id];
    if (placement?.x !== undefined && placement?.y !== undefined)
      positions.set(id, { x: placement.x, y: placement.y });
  }
  positions.set(CULPRIT, CENTER);
  return positions;
}

// Symmetric bounds keep the fixed culprit centered even with asymmetric branches.
export function boardBounds(board: Board, legendCount = 0) {
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

export { edgeGeometry } from './connection-geometry';

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
