import { emptyDatabase } from '../../shared/model';
import { emptyPlan } from '../../modules/investigation-creator/schema';

export function observationsInvestigation() {
  const data = emptyDatabase(),
    plan = emptyPlan();
  data.characters = [
    {
      id: 'witness',
      name: 'Witness',
      kind: 'person',
      suspect: false,
      witness: true,
      color: '#4C9A2A',
      notes: '',
      folderId: null,
    },
    {
      id: 'observations',
      name: 'Observations',
      kind: 'evidence',
      color: '#D93846',
      notes: '',
      folderId: null,
    },
    { id: 'subject', name: 'Mwepu', kind: 'person', color: '#173EA5', notes: '', folderId: null },
  ];
  plan.entries = ['witness'];
  plan.access = [
    {
      id: 'interview',
      targetId: 'observations',
      requires: ['witness'],
      conclusions: [],
      method: 'Interview',
    },
    {
      id: 'identify',
      targetId: 'subject',
      requires: ['witness', 'observations'],
      conclusions: [],
      method: 'Follow the observations',
    },
  ];
  data.boards = [
    {
      id: 'case',
      name: 'Observation chain',
      description: '',
      connections: [],
      characterIds: data.characters.map((n) => n.id),
      investigation: plan,
      layout: {},
    },
  ];
  data.activeBoardId = 'case';
  return data;
}
