import type { Board, Character, Connection, RelationType } from './model';
import { type Message, tr } from './i18n';

export const CULPRIT = '__culprit__';
export type NodeKind = NonNullable<Character['kind']>;
export type BranchKind = 'suspect' | 'witness' | 'victim' | 'evidence' | 'location' | 'event';
export const BRANCH_COLORS: Record<BranchKind, string> = {
  suspect: '#173EA5',
  witness: '#4C9A2A',
  victim: '#64748B',
  evidence: '#D93846',
  location: '#E68A22',
  event: '#983EF5',
};
export const questionKeys: Record<NodeKind, string[]> = {
  person: ['identity', 'motive', 'alibi', 'testimony', 'contradictions'],
  evidence: ['found', 'owner', 'contents', 'meaning', 'reliability'],
  location: ['address', 'access', 'scene', 'traces', 'timeline'],
  event: ['when', 'happened', 'involved', 'cause', 'consequence'],
};

export function kindOf(node: Pick<Character, 'kind'>): NodeKind {
  return node.kind || 'person';
}

// A person can hold several roles. Victim takes priority on their own branch.
export function branchOf(node: Pick<Character, 'kind' | 'suspect' | 'victim'>): BranchKind {
  const kind = kindOf(node);
  return kind === 'person'
    ? node.victim
      ? 'victim'
      : node.suspect !== false
        ? 'suspect'
        : 'witness'
    : kind;
}

export function branchLabel(kind: BranchKind) {
  return tr(`trace.${kind}` as Message);
}

export function nodeLabel(kind: NodeKind) {
  return tr(`trace.${kind}` as Message);
}

export function investigationTypes(): RelationType[] {
  return (Object.keys(BRANCH_COLORS) as BranchKind[]).map((id) => ({
    id,
    color: BRANCH_COLORS[id],
    name: branchLabel(id),
  }));
}

export function parentOf(board: Board, id: string) {
  return board.layout?.[id]?.parentId || CULPRIT;
}

// parentId is retained as the placement anchor for older libraries. parentIds
// contains every incoming branch when the board uses converging paths.
export function parentsOf(board: Board, id: string): string[] {
  return board.layout?.[id]?.parentIds ?? [parentOf(board, id)];
}

export function canParent(board: Board, child: string, parent: string): boolean {
  if (
    !board.characterIds.includes(child) ||
    (parent !== CULPRIT && !board.characterIds.includes(parent))
  )
    return false;
  return child !== parent;
}

export function setParents(board: Board, child: string, parents: string[]): Board {
  if (
    !parents.length ||
    new Set(parents).size !== parents.length ||
    !parents.every((parent) => canParent(board, child, parent))
  )
    throw new Error(tr('trace.invalidTree'));
  return {
    ...board,
    layout: {
      ...board.layout,
      [child]: {
        ...board.layout?.[child],
        parentId:
          parents.find((parent) => {
            const seen = new Set([child]);
            for (let id = parent; id !== CULPRIT; id = parentOf(board, id)) {
              if (seen.has(id)) return false;
              seen.add(id);
            }
            return true;
          }) ?? CULPRIT,
        parentIds: parents,
      },
    },
  };
}

export function setParent(board: Board, child: string, parent: string): Board {
  return setParents(board, child, [parent]);
}

export function boardEdges(board: Board, nodes: Character[]): Connection[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = (id: string) => {
    const seen = new Set<string>();
    while (id !== CULPRIT && !seen.has(id)) {
      seen.add(id);
      id = parentOf(board, id);
    }
    return seen.size;
  };
  // Draw parents first, then deeper branches so their color takes priority at crossings.
  return board.characterIds
    .flatMap((id) => {
      const node = byId.get(id);
      return node
        ? parentsOf(board, id).map((sourceId, index) => ({
          id: index === 0 ? `branch-${id}` : `branch_${sourceId.length}_${sourceId}_${id}`,
          sourceId,
          targetId: id,
          typeId: branchOf(node),
          directed: true,
          notes: '',
        }))
        : [];
    })
    .sort((a, b) => depth(a.targetId) - depth(b.targetId));
}

export function retainMembers(board: Board, ids: string[]): Board {
  const members = new Set(ids);
  return {
    ...board,
    characterIds: ids,
    connections: board.connections.filter(
      (e) => members.has(e.sourceId) && members.has(e.targetId),
    ),
    layout: Object.fromEntries(
      Object.entries(board.layout || {})
        .filter(([id]) => members.has(id))
        .map(([id, entry]) => [id, retainParents(entry, members)]),
    ),
  };
}

export function retainParents(entry: NonNullable<Board['layout']>[string], members: Set<string>) {
  const clean = <T extends { parentId?: string; parentIds?: string[] }>(value: T): T => {
    const remaining = value.parentIds?.filter((id) => id === CULPRIT || members.has(id));
    const parentIds = remaining?.length ? remaining : [CULPRIT];
    return {
      ...value,
      ...(value.parentIds ? { parentIds } : {}),
      ...(value.parentId && value.parentId !== CULPRIT && !members.has(value.parentId)
        ? // Another incoming path may point back to a descendant. Reset only
          // the internal anchor; visible surviving paths remain in parentIds.
        { parentId: CULPRIT }
        : {}),
    };
  };
  return { ...clean(entry), ...(entry.generated ? { generated: clean(entry.generated) } : {}) };
}
