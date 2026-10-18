import { expect, it } from 'vitest';
import { stationDatabase } from '../src/station-demo';
import { databaseSchema, deleteCharacter, emptyDatabase } from '../shared/model';
import { parentsOf } from '../shared/investigation';
import { explore } from '../modules/investigation-creator/engine';
import { createStoriesTransfer, mergeTransfer } from '../shared/transfer';
import russian from '../src/demo-content/station-ru.json' with { type: 'json' };
import english from '../src/demo-content/station-en.json' with { type: 'json' };

it.each(['en', 'ru'] as const)(
  'provides the full authored pumping station case in %s',
  (locale) => {
    const data = stationDatabase(locale),
      board = data.boards[0],
      text = locale === 'ru' ? russian : english;
    expect(databaseSchema.safeParse(data).success).toBe(true);
    expect(data.characters).toHaveLength(27);
    expect(explore(board.investigation!, data.characters).reached.size).toBe(27);
    expect(board.investigation!.endings).toEqual(['records']);
    expect(explore(board.investigation!, data.characters, 'station').reached.has('records')).toBe(
      false,
    );
    for (const clue of ['phone', 'invoices', 'navigator']) {
      const remaining = explore(board.investigation!, data.characters, clue);
      expect(remaining.reached.has('records')).toBe(true);
      expect(remaining.knowledge.get('station-fact-0')?.state).toBe('true');
    }
    expect(parentsOf(board, 'station').sort()).toEqual(['invoices', 'navigator', 'phone']);
    expect(parentsOf(board, 'home')).toEqual(
      expect.arrayContaining(['journalist', 'colleagueNote', 'waybills']),
    );
    expect(parentsOf(board, 'office')).toEqual(
      expect.arrayContaining(['journalist', 'editorLetter', 'waybills']),
    );
    expect(parentsOf(board, 'expert')).toEqual(expect.arrayContaining(['autopsy', 'records']));
    expect(board.investigation!.crime.culpritIds).toEqual([]);
    for (const node of data.characters) {
      expect(node.name).toBe(text.nodes[node.id as keyof typeof text.nodes][0]);
      expect(node.notes).toBe(text.nodes[node.id as keyof typeof text.nodes][1]);
      expect(Object.keys(node.answers!)).toHaveLength(5);
    }
    expect(mergeTransfer(emptyDatabase(), createStoriesTransfer(data)).data.boards).toEqual(
      data.boards,
    );
    for (const node of data.characters)
      expect(
        databaseSchema.safeParse(deleteCharacter(data, node.id)).success,
        `removing ${node.id}`,
      ).toBe(true);
  },
);
