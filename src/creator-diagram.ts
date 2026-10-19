import type {
  DiagramPlacement,
  InvestigationDiagram,
  InvestigationNode,
} from '../modules/investigation-creator/contracts';
import type { Board } from '../shared/model';
import { CULPRIT } from '../shared/investigation';
import { boardPositions, CENTER, truncate } from './geometry';
import type { DiagramFootprint } from '../modules/investigation-creator/diagram-geometry';

export function creatorFootprints(nodes: InvestigationNode[]): Record<string, DiagramFootprint> {
  const context =
    typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (context) context.font = '600 12.5px sans-serif';
  return Object.fromEntries(
    nodes.map((node) => {
      const text = truncate(node.name, nodes.length > 12 ? 14 : 24);
      return [
        node.id,
        {
          radius: 48,
          labelWidth: (context?.measureText(text).width ?? [...text].length * 8.5) + 16,
          labelTop: 40,
          labelBottom: 70,
        },
      ];
    }),
  );
}

export function creatorPlacements(board: Board): DiagramPlacement[] {
  const positions = boardPositions(board);
  return Object.entries(board.layout || {}).map(([id, p]) => ({
    id,
    locked: p.locked,
    parentIds: p.parentIds?.map((id) => (id === CULPRIT ? null : id)),
    parentId:
      p.parentId === undefined
        ? p.locked
          ? null
          : undefined
        : p.parentId === CULPRIT
          ? null
          : p.parentId,
    x: p.x === undefined && !p.locked ? undefined : (p.x ?? positions.get(id)!.x) - CENTER.x,
    y: p.y === undefined && !p.locked ? undefined : (p.y ?? positions.get(id)!.y) - CENTER.y,
    generated: p.generated
      ? {
        layoutVersion: p.generated.layoutVersion,
        layoutKey: p.generated.layoutKey,
        parentId: p.generated.parentId === CULPRIT ? null : p.generated.parentId,
        parentIds: p.generated.parentIds?.map((id) => (id === CULPRIT ? null : id)),
        x: p.generated.x - CENTER.x,
        y: p.generated.y - CENTER.y,
      }
      : undefined,
  }));
}

export function applyCreatorDiagram(board: Board, diagram: InvestigationDiagram): Board {
  const members = new Set(board.characterIds);
  const layout = { ...board.layout };
  for (const p of diagram.nodes)
    if (members.has(p.id))
      layout[p.id] = {
        ...layout[p.id],
        parentId: p.parentId ?? CULPRIT,
        parentIds: (p.parentIds ?? [p.parentId]).map((id) => id ?? CULPRIT),
        x: p.x + CENTER.x,
        y: p.y + CENTER.y,
        generated: {
          layoutVersion: p.generated.layoutVersion,
          layoutKey: p.generated.layoutKey,
          parentId: p.generated.parentId ?? CULPRIT,
          parentIds: (p.generated.parentIds ?? [p.generated.parentId]).map((id) => id ?? CULPRIT),
          x: p.generated.x + CENTER.x,
          y: p.generated.y + CENTER.y,
        },
      };
  return { ...board, layout };
}
