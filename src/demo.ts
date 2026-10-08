import { getLocale } from '../shared/i18n';
import { type Character, type Database, emptyDatabase } from '../shared/model';
import {
  BRANCH_COLORS,
  branchOf,
  CULPRIT,
  type NodeKind,
  questionKeys,
} from '../shared/investigation';
import english from './demo-content/en.json' with { type: 'json' };
import russian from './demo-content/ru.json' with { type: 'json' };

// Links describe leads, not an accusation of murder. Generated text becomes user-owned.
const nodes: {
  id: keyof typeof russian.nodes;
  kind: NodeKind;
  parent: string;
  x: number;
  y: number;
  witness?: boolean;
  suspect?: boolean;
  locked?: boolean;
}[] = [
  { id: 'domye', kind: 'person', parent: CULPRIT, x: 160, y: 210, witness: true, suspect: true },
  { id: 'valk', kind: 'person', parent: CULPRIT, x: 640, y: 130, witness: true, suspect: true },
  { id: 'loro', kind: 'person', parent: CULPRIT, x: 160, y: 610, witness: true, suspect: true },
  { id: 'fall', kind: 'event', parent: CULPRIT, x: 770, y: 540 },
  { id: 'oldCase', kind: 'event', parent: CULPRIT, x: 550, y: 740 },
  { id: 'pressure', kind: 'event', parent: 'domye', x: -60, y: 210 },
  { id: 'apartment', kind: 'location', parent: 'pressure', x: -280, y: 210, locked: true },
  { id: 'door', kind: 'evidence', parent: 'apartment', x: -500, y: 110 },
  { id: 'tracks', kind: 'evidence', parent: 'door', x: -500, y: -70 },
  { id: 'window', kind: 'evidence', parent: 'apartment', x: -500, y: 310 },
  { id: 'writing', kind: 'event', parent: 'valk', x: 570, y: -50 },
  { id: 'drafts', kind: 'evidence', parent: 'writing', x: 360, y: -220 },
  { id: 'calls', kind: 'evidence', parent: 'writing', x: 630, y: -220 },
  { id: 'elisa', kind: 'person', parent: 'calls', x: 880, y: -220, witness: true },
  { id: 'celine', kind: 'person', parent: 'valk', x: 860, y: 100, witness: true, suspect: true },
  { id: 'meeting', kind: 'event', parent: 'celine', x: 1080, y: 100 },
  { id: 'cafe', kind: 'location', parent: 'meeting', x: 1300, y: 100 },
  { id: 'intrusion', kind: 'event', parent: 'loro', x: -60, y: 610 },
  { id: 'agreement', kind: 'evidence', parent: 'intrusion', x: -280, y: 510 },
  { id: 'folder', kind: 'evidence', parent: 'intrusion', x: -280, y: 710 },
  { id: 'archive', kind: 'location', parent: 'folder', x: -500, y: 710, locked: true },
  { id: 'archiveFind', kind: 'event', parent: 'archive', x: -500, y: 910 },
  { id: 'missingFolder', kind: 'evidence', parent: 'loro', x: 160, y: 820 },
  { id: 'body', kind: 'evidence', parent: 'fall', x: 990, y: 460 },
  { id: 'courtyard', kind: 'location', parent: 'body', x: 1210, y: 460, locked: true },
  { id: 'discovery', kind: 'event', parent: 'courtyard', x: 1210, y: 650 },
  { id: 'remi', kind: 'person', parent: 'fall', x: 990, y: 740, witness: true },
  { id: 'mathias', kind: 'person', parent: 'oldCase', x: 420, y: 940, witness: true },
  { id: 'precinct', kind: 'location', parent: 'mathias', x: 180, y: 1080, locked: true },
  { id: 'journal', kind: 'evidence', parent: 'oldCase', x: 650, y: 940 },
  { id: 'report', kind: 'evidence', parent: 'journal', x: 890, y: 1080 },
  { id: 'conclusion', kind: 'event', parent: 'oldCase', x: 1150, y: 940 },
];

export function demoDatabase(): Database {
  const content = getLocale() === 'ru' ? russian : english;
  const characters: Character[] = nodes.map((spec) => {
    const text = content.nodes[spec.id];
    const node: Character = {
      id: spec.id,
      kind: spec.kind,
      name: text.name,
      notes: text.notes,
      folderId: spec.kind,
      witness: spec.witness ?? false,
      suspect: spec.suspect ?? false,
      color: BRANCH_COLORS.evidence,
      answers: Object.fromEntries(
        questionKeys[spec.kind].map((key, index) => [key, text.answers[index]]),
      ),
    };
    node.color = BRANCH_COLORS[branchOf(node)];
    return node;
  });
  return {
    ...emptyDatabase(),
    characters,
    folders: [
      ...(['person', 'evidence', 'location', 'event'] as const).flatMap((kind) => [
        { id: `dead-witness-${kind}`, name: content.name, parentId: null, kind },
        { id: kind, name: content.folders[kind], parentId: `dead-witness-${kind}`, kind },
      ]),
    ],
    clubs: [
      {
        id: 'dead-witness',
        name: content.name,
        description: content.description,
        characterIds: characters.map((node) => node.id),
        connections: [],
        layout: Object.fromEntries(
          nodes.map(({ id, x, y, parent, locked }) => [
            id,
            {
              x,
              y,
              parentId: parent,
              ...(locked ? { locked: true } : {}),
            },
          ]),
        ),
      },
    ],
    activeClubId: 'dead-witness',
  };
}
