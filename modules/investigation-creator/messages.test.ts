import { expect, it } from 'vitest';
import en from './locales/en.json' with { type: 'json' };
import ru from './locales/ru.json' with { type: 'json' };
import { messages } from './messages';
import { readFile } from 'node:fs/promises';

it('has complete standalone translations with matching placeholders', () => {
  expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    expect(en[key]).not.toMatch(/\p{Script=Cyrillic}/u);
    expect(en[key].trim()).not.toBe('');
    expect(ru[key].trim()).not.toBe('');
    expect(en[key].match(/\{\d+}/g) || []).toEqual(ru[key].match(/\{\d+}/g) || []);
  }
  expect(messages('ru')('issue_threeClues', 'Site', 1, 2)).toContain('1');
});
it('provides a message for every engine diagnostic', async () => {
  const source = await readFile(new URL('./engine.ts', import.meta.url), 'utf8');
  const codes = [...source.matchAll(/add\(\s*'([^']+)'/g)].map((match) => match[1]);
  for (const code of codes) expect(en).toHaveProperty(`issue_${code}`);
});
