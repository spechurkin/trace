import { expect, it } from 'vitest';
import { databaseSchema, deleteCharacters } from '../shared/model';
import { boardEdges, CULPRIT, parentsOf } from '../shared/investigation';
import { convergingInvestigation } from './fixtures/converging';
import { buildInvestigationDiagram } from '../modules/investigation-creator/diagram';
import { applyCreatorDiagram } from '../src/creator-diagram';

it.each([
  { removed: ['phone', 'invoices'], parents: ['navigator'] },
  { removed: ['phone', 'invoices', 'navigator'], parents: [CULPRIT] },
])(
  'deletes $removed together across boards and repairs surviving branches',
  ({ removed, parents }) => {
    const data = convergingInvestigation();
    const board = data.boards[0];
    data.boards[0] = applyCreatorDiagram(
      board,
      buildInvestigationDiagram(board.investigation!, data.characters, [], { random: () => 0.3 }),
    );
    data.relationTypes = [{ id: 'lead', name: 'Lead', color: '#4169e1' }];
    data.boards[0].connections = boardEdges(data.boards[0], data.characters)
      .filter((edge) => edge.sourceId !== CULPRIT)
      .map((edge) => ({ ...edge, typeId: 'lead' }));
    data.boards.push({ ...structuredClone(data.boards[0]), id: 'second' });
    expect(databaseSchema.safeParse(data).success).toBe(true);
    const before = structuredClone(data);

    const result = deleteCharacters(data, [...removed, removed[0], 'missing']);

    expect(result.characters).toEqual(data.characters.filter((node) => !removed.includes(node.id)));
    for (const remaining of result.boards) {
      expect(remaining.characterIds).toEqual(
        board.characterIds.filter((id) => !removed.includes(id)),
      );
      expect(remaining.connections).toEqual(
        data.boards[0].connections.filter(
          (edge) => !removed.includes(edge.sourceId) && !removed.includes(edge.targetId),
        ),
      );
      for (const id of removed) expect(remaining.layout).not.toHaveProperty(id);
      expect(parentsOf(remaining, 'station')).toEqual(parents);
      expect(remaining.layout!.station.generated!.parentIds).toEqual(parents);
      expect(remaining.layout!.records).toEqual(data.boards[0].layout!.records);
    }
    expect(result.folders).toEqual(data.folders);
    expect(result.activeBoardId).toBe(data.activeBoardId);
    expect(databaseSchema.safeParse(result).success).toBe(true);
    expect(data).toEqual(before);
  },
);

it('keeps every object when the bulk selection is empty', () => {
  const data = convergingInvestigation();
  expect(deleteCharacters(data, [])).toEqual(data);
});
