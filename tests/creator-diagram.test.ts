import { expect, it } from 'vitest';
import { buildInvestigationDiagram } from '../modules/investigation-creator/diagram';
import { auditInvestigation } from '../modules/investigation-creator/engine';
import { applyCreatorDiagram, creatorPlacements } from '../src/creator-diagram';
import { demoDatabase } from '../src/demo';
import { databaseSchema, emptyDatabase, removeFromBoard } from '../shared/model';
import { createStoriesTransfer, mergeTransfer } from '../shared/transfer';
import { CULPRIT, retainMembers } from '../shared/investigation';
import { boardPositions, CENTER } from '../src/geometry';

// Full demo layout searches exceed the default five-second budget on CI runners.
it(
  'assembles a host board without altering the logical audit or central culprit',
  { timeout: 30_000 },
  () => {
    const data = demoDatabase(),
      old = { ...data.boards[0], layout: {} };
    const before = auditInvestigation(old, data.characters);
    const diagram = buildInvestigationDiagram(old.investigation!, data.characters);
    const board = applyCreatorDiagram(old, diagram);
    expect(databaseSchema.safeParse({ ...data, boards: [board] }).success).toBe(true);
    expect(auditInvestigation(board, data.characters).issues).toEqual(before.issues);
    expect(boardPositions(board).get(CULPRIT)).toEqual(CENTER);
    expect(Object.keys(board.layout!)).toHaveLength(board.characterIds.length);
    const repeated = applyCreatorDiagram(
      board,
      buildInvestigationDiagram(board.investigation!, data.characters, creatorPlacements(board)),
    );
    for (const id of board.characterIds) {
      expect(repeated.layout?.[id].parentId).toBe(board.layout?.[id].parentId);
      expect(repeated.layout?.[id].x).toBeCloseTo(board.layout![id].x!, 9);
      expect(repeated.layout?.[id].y).toBeCloseTo(board.layout![id].y!, 9);
    }
  },
);
it(
  'transfers generation markers with remapped IDs and cleans them when removing a parent',
  { timeout: 30_000 },
  () => {
    const data = demoDatabase();
    data.boards[0] = applyCreatorDiagram(
      { ...data.boards[0], layout: {} },
      buildInvestigationDiagram(data.boards[0].investigation!, data.characters),
    );
    const file = createStoriesTransfer(data),
      existing = demoDatabase();
    existing.characters.forEach((n) => {
      n.name = 'Different ' + n.name;
    });
    existing.boards[0].name = 'Different board';
    const imported = mergeTransfer(existing, file).data;
    const board = imported.boards[1];
    expect(board).toBeDefined();
    expect(databaseSchema.safeParse(imported).success).toBe(true);
    const members = new Set(board.characterIds);
    for (const entry of Object.values(board.layout!)) {
      expect(entry.generated).toBeDefined();
      expect(entry.generated!.parentId === CULPRIT || members.has(entry.generated!.parentId)).toBe(
        true,
      );
    }
    const parent = Object.values(board.layout!).find((p) => p.parentId !== CULPRIT)!.parentId!;
    for (const changed of [
      removeFromBoard(board, parent),
      retainMembers(
        board,
        board.characterIds.filter((id) => id !== parent),
      ),
    ]) {
      expect(Object.values(changed.layout!).some((p) => p.generated?.parentId === parent)).toBe(
        false,
      );
      expect(
        databaseSchema.safeParse({ ...imported, boards: [changed], activeBoardId: changed.id })
          .success,
      ).toBe(true);
    }
    expect(mergeTransfer(emptyDatabase(), file).data.boards).toEqual(data.boards);
  },
);
it(
  'keeps a locked card at its actual default position even without explicit coordinates',
  { timeout: 30_000 },
  () => {
    const data = demoDatabase(),
      board = { ...data.boards[0], layout: { domye: { locked: true } } };
    const position = boardPositions(board).get('domye')!;
    const built = applyCreatorDiagram(
      board,
      buildInvestigationDiagram(board.investigation!, data.characters, creatorPlacements(board), {
        replaceManual: true,
      }),
    );
    expect(built.layout?.domye).toMatchObject({
      x: position.x,
      y: position.y,
      locked: true,
      parentId: CULPRIT,
    });
  },
);
