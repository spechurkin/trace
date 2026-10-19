import { emptyPlan, type InvestigationPlan } from '../modules/investigation-creator/schema';
import type { Character } from '../shared/model';
import { getLocale } from '../shared/i18n';
import english from './demo-content/creator-en.json' with { type: 'json' };
import russian from './demo-content/creator-ru.json' with { type: 'json' };

// Explicit author annotations of the existing case; no extraction from prose,
// invented alibis, precise medical times or unnamed perpetrators.
export function demoCreatorPlan(nodes: Character[]): InvestigationPlan {
  const content = getLocale() === 'ru' ? russian : english;
  const text = (key: keyof typeof english, ...args: string[]) =>
    content[key].replace(/\{(\d+)}/g, (_, i: string) => args[Number(i)] || '');
  const node = (id: string) => nodes.find((n) => n.id === id)!;
  const plan = emptyPlan();
  plan.crime = {
    eventId: 'fall',
    victimId: 'valk',
    culpritIds: [],
    motive: node('valk').answers!.motive,
    method: node('fall').answers!.happened,
    circumstances: node('fall').answers!.cause,
  };
  plan.entries = ['discovery'];
  plan.endings = ['conclusion'];
  plan.clueLocations = ['apartment', 'courtyard', 'archive', 'precinct'];
  const conclusion = (
    id: keyof typeof english,
    truth: 'true' | 'false',
    required: boolean,
    threshold: number,
    subjectIds: string[],
  ) => plan.conclusions.push({ id, text: text(id), truth, required, threshold, subjectIds });
  conclusion('suicide', 'true', true, 2, ['valk']);
  conclusion('lateEntry', 'true', true, 2, ['loro', 'intrusion']);
  conclusion('officialStory', 'false', true, 2, ['mathias']);
  conclusion('domyeMurder', 'false', false, 1, ['domye']);
  conclusion('loroMurder', 'false', false, 1, ['loro']);
  const role = (
    nodeId: string,
    conclusionId: string,
    effect: 'supports' | 'refutes',
    locationId: string | null,
    certainty: 'confirmed' | 'disputed' = 'confirmed',
  ) => {
    plan.evidence.push({
      id: `${nodeId}-${conclusionId}-${effect}`,
      nodeId,
      conclusionId,
      locationId,
      effect,
      certainty,
      explanation: node(nodeId).answers!.meaning,
    });
  };
  role('body', 'suicide', 'supports', 'courtyard');
  role('window', 'suicide', 'supports', 'apartment');
  role('tracks', 'suicide', 'supports', 'apartment');
  role('door', 'lateEntry', 'supports', 'apartment');
  role('tracks', 'lateEntry', 'supports', 'apartment');
  role('agreement', 'lateEntry', 'supports', null);
  role('missingFolder', 'lateEntry', 'supports', 'apartment');
  role('folder', 'officialStory', 'refutes', 'archive');
  role('journal', 'officialStory', 'refutes', 'precinct');
  role('drafts', 'officialStory', 'refutes', 'apartment');
  role('report', 'officialStory', 'supports', 'precinct', 'disputed');
  role('calls', 'officialStory', 'refutes', 'apartment', 'disputed');
  role('door', 'domyeMurder', 'supports', 'apartment', 'disputed');
  role('window', 'domyeMurder', 'refutes', 'apartment');
  role('door', 'loroMurder', 'supports', 'apartment', 'disputed');
  role('tracks', 'loroMurder', 'refutes', 'apartment');
  const discover = (targetId: string, from: string, method?: string) =>
    plan.access.push({
      id: `${from}-${targetId}`,
      targetId,
      requires: [from],
      conclusions: [],
      method: method || text('route', node(from).name, node(targetId).name),
    });
  const routes: [string, string[]][] = [
    ['courtyard', ['discovery']],
    ['apartment', ['discovery', 'courtyard']],
    ['body', ['discovery', 'courtyard']],
    ['valk', ['body', 'apartment']],
    ['door', ['apartment']],
    ['window', ['apartment', 'body']],
    ['tracks', ['apartment', 'door']],
    ['missingFolder', ['apartment']],
    ['drafts', ['apartment']],
    ['calls', ['apartment', 'drafts']],
    ['domye', ['apartment', 'celine']],
    ['pressure', ['domye', 'apartment']],
    ['writing', ['drafts', 'calls']],
    ['celine', ['calls', 'drafts']],
    ['meeting', ['celine']],
    ['cafe', ['celine', 'meeting']],
    ['remi', ['courtyard']],
    ['fall', ['remi', 'body']],
    ['loro', ['missingFolder', 'celine']],
    ['intrusion', ['loro', 'tracks']],
    ['agreement', ['loro']],
    ['folder', ['loro', 'archive']],
    ['archive', ['loro', 'missingFolder']],
    ['archiveFind', ['archive', 'folder']],
    ['elisa', ['calls', 'drafts']],
    ['mathias', ['elisa', 'folder']],
    ['oldCase', ['folder', 'drafts']],
    ['precinct', ['folder', 'mathias']],
    ['journal', ['folder', 'precinct']],
    ['report', ['journal', 'precinct']],
  ];
  for (const [target, sources] of routes) for (const source of sources) discover(target, source);
  plan.access.push({
    id: 'resolve',
    targetId: 'conclusion',
    requires: [],
    conclusions: ['suicide', 'lateEntry'],
    method: node('conclusion').answers!.happened,
  });
  // Refuting the official report must also be established before the ending:
  // positive access gates represent facts, so use a positive falsification fact.
  conclusion('falsification', 'true', true, 2, ['valk', 'mathias']);
  for (const id of ['journal', 'drafts', 'folder'])
    role(
      id,
      'falsification',
      'supports',
      id === 'journal' ? 'precinct' : id === 'drafts' ? 'apartment' : 'archive',
    );
  plan.access.at(-1)!.conclusions.push('falsification');
  const timed = (
    id: string,
    nodeId: string,
    personIds: string[],
    locationId: string | null,
    period: string,
    earliest: number,
    latest: number,
    duration: number,
    certainty: 'confirmed' | 'disputed' = 'confirmed',
  ) =>
    plan.timeline.push({
      id,
      nodeId,
      personIds,
      locationId,
      period,
      earliest,
      latest,
      duration,
      kind: 'event',
      certainty,
    });
  const night = text('night'),
    old = text('old');
  timed('time-meeting', 'meeting', ['valk', 'celine'], 'cafe', night, 1210, 1210, 0);
  timed('time-pressure', 'pressure', ['valk', 'domye'], 'apartment', night, 1295, 1295, 50);
  timed('time-writing', 'writing', ['valk'], 'apartment', night, 1380, 1380, 160);
  timed('time-fall', 'fall', ['valk'], 'apartment', night, 1576, 1576, 0);
  timed('time-remi', 'remi', ['remi'], 'courtyard', night, 1576, 1576, 0);
  timed('time-intrusion', 'intrusion', ['loro'], 'apartment', night, 1595, 1595, 3);
  timed('time-discovery', 'discovery', [], 'courtyard', night, 1865, 1865, 0);
  timed('time-journal', 'journal', ['mathias'], 'precinct', old, 160, 160, 0);
  timed('time-official', 'report', ['mathias'], null, old, 151, 151, 0, 'disputed');
  plan.ordering = [
    {
      id: 'fall-before-entry',
      beforeId: 'time-fall',
      afterId: 'time-intrusion',
      minGap: 0,
      maxGap: null,
    },
    {
      id: 'writing-before-fall',
      beforeId: 'time-writing',
      afterId: 'time-fall',
      minGap: 0,
      maxGap: null,
    },
  ];
  for (const [suspectId, conclusionId] of [
    ['domye', 'domyeMurder'],
    ['loro', 'loroMurder'],
  ])
    plan.versions.push({
      id: `version-${suspectId}`,
      title: plan.conclusions.find((c) => c.id === conclusionId)!.text,
      suspectId,
      conclusionId,
      motive: node(suspectId).answers!.motive,
      explanation: node(suspectId).answers!.contradictions,
    });
  return plan;
}
