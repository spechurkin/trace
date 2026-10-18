import { getLocale, type Locale } from '../shared/i18n';
import { type Character, type Database, emptyDatabase } from '../shared/model';
import { BRANCH_COLORS, branchOf, type NodeKind } from '../shared/investigation';
import { emptyPlan } from '../modules/investigation-creator/schema';
import { buildInvestigationDiagram } from '../modules/investigation-creator/diagram';
import { applyCreatorDiagram } from './creator-diagram';
import english from './demo-content/station-en.json' with { type: 'json' };
import russian from './demo-content/station-ru.json' with { type: 'json' };

type Id = keyof typeof russian.nodes;
const locations = new Set<Id>([
  'abandoned',
  'home',
  'office',
  'garage',
  'station',
  'operatingRoom',
]);
const people = new Set<Id>(['journalist', 'driver', 'expert']);
const foundAt: Partial<Record<Id, Id>> = {
  phone: 'home',
  receipt: 'home',
  editorLetter: 'home',
  article: 'office',
  invoices: 'office',
  truckPhoto: 'office',
  colleagueNote: 'office',
  truck: 'garage',
  navigator: 'truck',
  waybills: 'truck',
  tireTracks: 'station',
  generator: 'station',
  undergroundDoor: 'station',
  medicalCards: 'operatingRoom',
  missingPhotos: 'operatingRoom',
  records: 'operatingRoom',
  autopsy: 'discovery',
};
const routes: [Id, Id][] = [
  ['discovery', 'abandoned'],
  ['discovery', 'journalist'],
  ['discovery', 'autopsy'],
  ['journalist', 'home'],
  ['journalist', 'office'],
  ['home', 'phone'],
  ['home', 'receipt'],
  ['home', 'editorLetter'],
  ['editorLetter', 'office'],
  ['office', 'article'],
  ['office', 'invoices'],
  ['office', 'truckPhoto'],
  ['office', 'colleagueNote'],
  ['colleagueNote', 'home'],
  ['receipt', 'garage'],
  ['truckPhoto', 'garage'],
  ['garage', 'truck'],
  ['garage', 'driver'],
  ['truck', 'navigator'],
  ['truck', 'waybills'],
  ['waybills', 'home'],
  ['waybills', 'office'],
  ['phone', 'station'],
  ['invoices', 'station'],
  ['navigator', 'station'],
  ['station', 'tireTracks'],
  ['station', 'generator'],
  ['station', 'undergroundDoor'],
  ['undergroundDoor', 'operatingRoom'],
  ['operatingRoom', 'medicalCards'],
  ['operatingRoom', 'missingPhotos'],
  ['operatingRoom', 'records'],
  ['records', 'expert'],
  ['autopsy', 'expert'],
];

export function stationDatabase(locale: Locale = getLocale(), assemble = true): Database {
  const content = locale === 'ru' ? russian : english;
  const ids = Object.keys(content.nodes) as Id[];
  const characters: Character[] = ids.map((id) => {
    const [name, notes, meaning] = content.nodes[id];
    const kind: NodeKind = locations.has(id)
      ? 'location'
      : people.has(id)
        ? 'person'
        : id === 'discovery'
          ? 'event'
          : 'evidence';
    const answers: Record<string, string> =
      kind === 'evidence'
        ? {
          found: foundAt[id] ? content.nodes[foundAt[id]!][0] : content.unknown,
          owner: content.unknown,
          contents: notes,
          meaning,
          reliability: content.observed,
        }
        : kind === 'location'
          ? {
            address: notes,
            access: content.unknown,
            scene: notes,
            traces: meaning,
            timeline: content.unknown,
          }
          : kind === 'event'
            ? {
              when: content.unknown,
              happened: notes,
              involved: content.nodes.journalist[0],
              cause: content.unknown,
              consequence: meaning,
            }
            : {
              identity: notes,
              motive: content.unknown,
              alibi: content.unknown,
              testimony: id === 'driver' ? notes : content.unknown,
              contradictions: meaning,
            };
    const node: Character = {
      id,
      name,
      notes,
      kind,
      color: '#173EA5',
      answers,
      folderId: `station-${kind}`,
      ...(kind === 'person'
        ? {
          victim: id === 'journalist',
          suspect: id !== 'journalist',
          witness: id !== 'journalist',
        }
        : {}),
    };
    node.color = BRANCH_COLORS[branchOf(node)];
    return node;
  });
  const plan = emptyPlan();
  plan.crime = {
    eventId: 'discovery',
    victimId: 'journalist',
    culpritIds: [],
    motive: '',
    method: '',
    circumstances: content.nodes.discovery[1],
  };
  plan.entries = ['discovery'];
  plan.endings = ['records'];
  plan.clueLocations = ['abandoned', 'home', 'office', 'garage', 'station', 'operatingRoom'];
  plan.access = routes.map(([from, target], i) => ({
    id: `station-route-${i}`,
    targetId: target,
    requires: [from],
    conclusions: [],
    method: content.follow
      .replace('{0}', content.nodes[from][0])
      .replace('{1}', content.nodes[target][0]),
  }));
  plan.conclusions = content.conclusions.map((text, i) => ({
    id: `station-fact-${i}`,
    text,
    subjectIds: i === 0 ? ['station'] : i === 1 ? ['operatingRoom'] : ['expert'],
    truth: 'true',
    required: true,
    threshold: i === 0 ? 1 : 2,
  }));
  plan.evidence = (
    [
      'phone',
      'invoices',
      'navigator',
      'medicalCards',
      'missingPhotos',
      'records',
      'autopsy',
    ] as Id[]
  ).map((id, i) => ({
    id: `station-evidence-${id}`,
    nodeId: id,
    conclusionId: `station-fact-${i < 3 ? 0 : i < 5 ? 1 : 2}`,
    locationId:
      foundAt[id] && locations.has(foundAt[id]!)
        ? foundAt[id]!
        : id === 'navigator'
          ? 'garage'
          : null,
    effect: 'supports',
    certainty: 'confirmed',
    explanation: content.nodes[id][2],
  }));
  let board: Database['boards'][number] = {
    id: 'station-6',
    name: content.title,
    description: content.description,
    characterIds: ids,
    connections: [],
    investigation: plan,
    layout: {},
  };
  if (assemble)
    board = applyCreatorDiagram(
      board,
      buildInvestigationDiagram(plan, characters, [], { random: () => 0.3 }),
    );
  return {
    ...emptyDatabase(),
    characters,
    boards: [board],
    activeBoardId: board.id,
    folders: (['person', 'evidence', 'location', 'event'] as const).map((kind) => ({
      id: `station-${kind}`,
      name: content.folders[kind],
      parentId: null,
      kind,
    })),
  };
}
