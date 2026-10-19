// The host adapter supplies nodes and persists the plan. The module has no
// dependency on the application's database, board layout, Electron or storage.
export type NodeKind = 'person' | 'evidence' | 'location' | 'event';

export interface InvestigationNode {
  id: string;
  name: string;
  kind?: NodeKind;
  suspect?: boolean;
  witness?: boolean;
  victim?: boolean;
  answers?: Record<string, string>;
}

export interface InvestigationBoard {
  characterIds: string[];
  investigation?: import('./schema').InvestigationPlan;
  diagram?: DiagramPlacement[];
  diagramBounds?: { minX: number; maxX: number; minY: number; maxY: number };
  diagramFootprints?: (
    nodes: InvestigationNode[],
  ) => Record<string, import('./diagram-geometry').DiagramFootprint>;
}

export interface DiagramPoint {
  layoutVersion?: 'compact-v1' | 'compact-v2' | 'compact-v3' | 'compact-v4';
  layoutKey?: string;
  parentId: string | null;
  parentIds?: (string | null)[];
  x: number;
  y: number;
}

export interface DiagramPlacement {
  id: string;
  parentId?: string | null;
  parentIds?: (string | null)[];
  x?: number;
  y?: number;
  locked?: boolean;
  generated?: DiagramPoint;
}

export interface InvestigationDiagram {
  // Kept for older hosts; compact layouts use variable edge lengths.
  edgeLength?: number;
  nodes: (DiagramPoint & { id: string; generated: DiagramPoint })[];
}

export const kindOf = (node: InvestigationNode): NodeKind => node.kind || 'person';

export type CrimeRole = 'victimId' | 'culpritIds';
export const canFillCrimeRole = (node: InvestigationNode, role: CrimeRole): boolean =>
  kindOf(node) === 'person' &&
  (role === 'victimId' ? node.victim === true : node.suspect !== false || node.witness === true);
export const questionKeys: Record<NodeKind, string[]> = {
  person: ['identity', 'motive', 'alibi', 'testimony', 'contradictions'],
  evidence: ['found', 'owner', 'contents', 'meaning', 'reliability'],
  location: ['address', 'access', 'scene', 'traces', 'timeline'],
  event: ['when', 'happened', 'involved', 'cause', 'consequence'],
};
