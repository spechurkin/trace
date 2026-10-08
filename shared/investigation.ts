import type { Character, Club, Connection, RelationType } from './model';
import { type Message, tr } from './i18n';

export const CULPRIT = '__culprit__';
export type NodeKind = NonNullable<Character['kind']>;
export type BranchKind = 'suspect' | 'witness' | 'evidence' | 'location' | 'event';
export const BRANCH_COLORS: Record<BranchKind, string> = {
  suspect: '#173EA5',
  witness: '#4C9A2A',
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

export function kindOf(node: Character): NodeKind {
  return node.kind || 'person';
}

// A person can hold both roles. Suspect has priority on that person's own branch.
export function branchOf(node: Character): BranchKind {
  const kind = kindOf(node);
  return kind === 'person' ? (node.suspect !== false ? 'suspect' : 'witness') : kind;
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

export function parentOf(board: Club, id: string) {
  return board.layout?.[id]?.parentId || CULPRIT;
}

export function canParent(board: Club, child: string, parent: string): boolean {
  if (
    !board.characterIds.includes(child) ||
    (parent !== CULPRIT && !board.characterIds.includes(parent))
  )
    return false;
  const seen = new Set([child]);
  while (parent !== CULPRIT) {
    if (seen.has(parent)) return false;
    seen.add(parent);
    parent = parentOf(board, parent);
  }
  return true;
}

export function setParent(board: Club, child: string, parent: string): Club {
  if (!canParent(board, child, parent)) throw new Error(tr('trace.invalidTree'));
  return {
    ...board,
    layout: { ...board.layout, [child]: { ...board.layout?.[child], parentId: parent } },
  };
}

export function boardEdges(board: Club, nodes: Character[]): Connection[] {
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
        ? [
            {
              id: `branch-${id}`,
              sourceId: parentOf(board, id),
              targetId: id,
              typeId: branchOf(node),
              directed: false,
              notes: '',
            },
          ]
        : [];
    })
    .sort((a, b) => depth(a.targetId) - depth(b.targetId));
}

export function retainMembers(board: Club, ids: string[]): Club {
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
        .map(([id, entry]) => [
          id,
          entry.parentId && !members.has(entry.parentId) ? { ...entry, parentId: CULPRIT } : entry,
        ]),
    ),
  };
}
