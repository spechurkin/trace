// The host adapter supplies nodes and persists the plan. The module has no
// dependency on the application's database, tree layout, Electron or storage.
export type NodeKind = 'person' | 'evidence' | 'location' | 'event';

export interface InvestigationNode {
  id: string;
  name: string;
  kind?: NodeKind;
  suspect?: boolean;
  answers?: Record<string, string>;
}

export interface InvestigationBoard {
  characterIds: string[];
  investigation?: import('./schema').InvestigationPlan;
}

export const kindOf = (node: InvestigationNode): NodeKind => node.kind || 'person';
export const questionKeys: Record<NodeKind, string[]> = {
  person: ['identity', 'motive', 'alibi', 'testimony', 'contradictions'],
  evidence: ['found', 'owner', 'contents', 'meaning', 'reliability'],
  location: ['address', 'access', 'scene', 'traces', 'timeline'],
  event: ['when', 'happened', 'involved', 'cause', 'consequence'],
};
