import type { Board, Character } from '../shared/model';
import { boardEdges } from '../shared/investigation';
import { boardPositions, edgeGeometry } from '../src/geometry';
import { segmentsIntersect } from '../modules/investigation-creator/diagram-geometry';

export function pathCrossings(
  paths: { sourceId: string; targetId: string; samples: { x: number; y: number }[] }[],
) {
  let count = 0;
  for (let i = 0; i < paths.length; i++)
    for (let j = 0; j < i; j++) {
      const a = paths[i],
        b = paths[j];
      if ([a.sourceId, a.targetId].some((id) => id === b.sourceId || id === b.targetId)) continue;
      if (
        a.samples.slice(1).some((p, k) =>
          b.samples.slice(1).some((q, l) => {
            const x = a.samples[k],
              y = b.samples[l];
            if (
              Math.max(x.x, p.x) < Math.min(y.x, q.x) ||
              Math.min(x.x, p.x) > Math.max(y.x, q.x) ||
              Math.max(x.y, p.y) < Math.min(y.y, q.y) ||
              Math.min(x.y, p.y) > Math.max(y.y, q.y)
            )
              return false;
            return segmentsIntersect(x, p, y, q);
          }),
        )
      )
        count++;
    }
  return count;
}

export function diagramMetrics(board: Board, nodes: Character[]) {
  const edges = boardEdges(board, nodes),
    positions = boardPositions(board);
  const curves = edges.map((edge) => {
    return edgeGeometry(edge, edges, positions).samples;
  });
  const straight: string[][] = [],
    curved: string[][] = [];
  for (let i = 0; i < edges.length; i++)
    for (let j = 0; j < i; j++) {
      const a = edges[i],
        b = edges[j];
      if ([a.sourceId, a.targetId].some((id) => id === b.sourceId || id === b.targetId)) continue;
      const pair = [`${a.sourceId}->${a.targetId}`, `${b.sourceId}->${b.targetId}`];
      if (
        segmentsIntersect(
          positions.get(a.sourceId)!,
          positions.get(a.targetId)!,
          positions.get(b.sourceId)!,
          positions.get(b.targetId)!,
        )
      )
        straight.push(pair);
      if (
        curves[i]
          .slice(1)
          .some((p, k) =>
            curves[j].slice(1).some((q, l) => segmentsIntersect(curves[i][k], p, curves[j][l], q)),
          )
      )
        curved.push(pair);
    }
  const lengths = edges.map((edge) =>
    Math.hypot(
      positions.get(edge.sourceId)!.x - positions.get(edge.targetId)!.x,
      positions.get(edge.sourceId)!.y - positions.get(edge.targetId)!.y,
    ),
  );
  return {
    nodes: board.characterIds.length,
    edges: edges.length,
    longest: Math.max(0, ...lengths),
    straight,
    curved,
  };
}
