import content from './converging.json' with { type: 'json' };
import { type Character, type Database, emptyDatabase } from '../../shared/model';
import { BRANCH_COLORS } from '../../shared/investigation';
import { emptyPlan } from '../../modules/investigation-creator/schema';

export const convergingNames = content.names;

// Small structural regression for independent routes to the same location.
export function convergingInvestigation(): Database {
  const nodes: Character[] = Object.entries(convergingNames).map(([id, name]) => {
    const kind = ['home', 'office', 'garage', 'station'].includes(id) ? 'location' : 'evidence';
    return { id, name, kind, color: BRANCH_COLORS[kind], notes: '', folderId: null };
  });
  const plan = emptyPlan();
  plan.entries = ['home', 'office', 'garage'];
  plan.endings = ['records'];
  plan.access = [
    ['home', 'phone'],
    ['office', 'invoices'],
    ['garage', 'navigator'],
    ['phone', 'station'],
    ['invoices', 'station'],
    ['navigator', 'station'],
    ['station', 'records'],
  ].map(([source, target], i) => ({
    id: `r${i}`,
    targetId: target,
    requires: [source],
    conclusions: [],
    method: `Follow ${source}`,
  }));
  return {
    ...emptyDatabase(),
    characters: nodes,
    activeBoardId: 'case',
    boards: [
      {
        id: 'case',
        name: content.title,
        description: '',
        characterIds: nodes.map((n) => n.id),
        connections: [],
        investigation: plan,
        layout: {},
      },
    ],
  };
}
