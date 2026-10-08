import { type Database, emptyDatabase } from '../shared/model';
import { CULPRIT, questionKeys } from '../shared/investigation';

export function stressDatabase(nodes = 500, boards = 1, chain = false): Database {
  const data = emptyDatabase();
  const kinds = ['person', 'evidence', 'location', 'event'] as const;
  data.characters = Array.from({ length: nodes }, (_, i) => {
    const kind = kinds[i % kinds.length];
    return {
      id: `n${i}`,
      name: `Node ${String(i).padStart(4, '0')}`,
      color: '#173EA5',
      kind,
      witness: true,
      suspect: true,
      folderId: null,
      notes: `Notes ${i}`,
      answers: Object.fromEntries(questionKeys[kind].map((key) => [key, `Answer ${i} ${key}`])),
    };
  });
  data.clubs = Array.from({ length: boards }, (_, b) => {
    const members = data.characters.slice(0, 500).map((node) => node.id);
    return {
      id: `b${b}`,
      name: `Board ${b}`,
      description: 'Synthetic QA fixture',
      characterIds: members,
      connections: [],
      layout: Object.fromEntries(
        members.map((id, i) => [
          id,
          {
            x: 100 + (i % 25) * 150,
            y: 100 + Math.floor(i / 25) * 150,
            parentId: chain && i > 0 ? members[i - 1] : CULPRIT,
          },
        ]),
      ),
    };
  });
  data.activeClubId = data.clubs[0]?.id || null;
  return data;
}
