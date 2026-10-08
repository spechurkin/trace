import { afterEach, expect, it } from 'vitest';
import { setLocale } from '../shared/i18n';
import {
  boardEdges,
  BRANCH_COLORS,
  branchOf,
  CULPRIT,
  kindOf,
  parentOf,
  questionKeys,
} from '../shared/investigation';
import { databaseSchema, emptyDatabase } from '../shared/model';
import { createStoriesTransfer, mergeTransfer } from '../shared/transfer';
import { demoDatabase } from '../src/demo';
import english from '../src/demo-content/en.json' with { type: 'json' };
import russian from '../src/demo-content/ru.json' with { type: 'json' };

afterEach(() => setLocale('en'));

it.each(['en', 'ru'] as const)('provides a complete, connected editable case in %s', (locale) => {
  setLocale(locale);
  const data = databaseSchema.parse(demoDatabase());
  const board = data.clubs[0];
  expect(data.activeClubId).toBe(board.id);
  expect(data.characters).toHaveLength(32);
  expect(new Set(data.characters.map(kindOf))).toEqual(
    new Set(['person', 'evidence', 'location', 'event']),
  );
  expect(new Set(data.characters.map(branchOf))).toEqual(new Set(Object.keys(BRANCH_COLORS)));
  expect(board.characterIds).toEqual(data.characters.map((node) => node.id));
  for (const node of data.characters) {
    expect(Object.keys(node.answers!).sort(), node.id).toEqual(
      [...questionKeys[kindOf(node)]].sort(),
    );
    for (const answer of Object.values(node.answers!))
      expect(answer.trim().length, node.id).toBeGreaterThan(20);
    expect(node.notes.trim().length, node.id).toBeGreaterThan(20);
    expect(
      data.folders.some((folder) => folder.id === node.folderId),
      node.id,
    ).toBe(true);
    expect(node.color).toBe(BRANCH_COLORS[branchOf(node)]);
    let current = node.id;
    const seen = new Set<string>();
    while (current !== CULPRIT) {
      expect(seen.has(current), node.id).toBe(false);
      seen.add(current);
      current = parentOf(board, current);
    }
  }
  expect(boardEdges(board, data.characters)).toHaveLength(32);
  expect(mergeTransfer(emptyDatabase(), createStoriesTransfer(data)).data.characters).toEqual(
    data.characters,
  );
  expect(mergeTransfer(emptyDatabase(), createStoriesTransfer(data)).data.clubs).toEqual(
    data.clubs,
  );
});

it('preserves the source timeline and distinguishes pressure, entry and falsification from murder', () => {
  setLocale('en');
  const data = demoDatabase();
  const node = (id: string) => data.characters.find((node) => node.id === id)!;
  expect(node('pressure').answers!.when).toContain('21:35');
  expect(node('domye').answers!.alibi).toContain('22:25');
  expect(node('fall').answers!.when).toContain('02:16');
  expect(node('fall').answers!.happened).toContain('voluntarily');
  expect(node('intrusion').answers!.when).toContain('02:35');
  expect(node('intrusion').answers!.when).toContain('02:38');
  expect(node('discovery').answers!.when).toContain('07:05');
  expect(node('journal').answers!.contents).toContain('02:40');
  expect(node('report').answers!.contents).toContain('02:31');
  expect(node('loro').notes).toContain('not a murderer');
  expect(node('valk').notes).toContain('accomplice');
  expect(node('conclusion').answers!.consequence).toContain('five outcomes');
});

it('keeps both translations complete and creates independent data on each invocation', () => {
  expect(Object.keys(english.nodes).sort()).toEqual(Object.keys(russian.nodes).sort());
  for (const text of [english, russian]) {
    for (const node of Object.values(text.nodes)) expect(node.answers).toHaveLength(5);
  }
  expect(JSON.stringify(english)).not.toMatch(/\p{Script=Cyrillic}/u);
  setLocale('ru');
  const original = demoDatabase();
  original.characters[0].answers!.alibi = 'Edited by user';
  original.clubs[0].layout!.domye.x = 999;
  expect(demoDatabase().characters[0].answers!.alibi).not.toBe('Edited by user');
  expect(demoDatabase().clubs[0].layout!.domye.x).toBe(160);
  setLocale('en');
  expect(original.characters[0].name).toBe(russian.nodes.domye.name);
  expect(demoDatabase().characters[0].name).toBe(english.nodes.domye.name);
});
