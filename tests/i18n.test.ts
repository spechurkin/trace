import { russianText } from './russian-fixtures';
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getLocale, type Message, setLocale, tr } from '../shared/i18n';
import english from '../shared/locales/en.json' with { type: 'json' };
import russian from '../shared/locales/ru.json' with { type: 'json' };
import russianDemo from '../src/demo-content/ru.json' with { type: 'json' };
import { databaseSchema, emptyDatabase } from '../shared/model';
import { demoDatabase } from '../src/demo';
import { readLanguage, saveLanguage } from '../electron/preferences';

const directories: string[] = [];
afterEach(async () => {
  setLocale('en');
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

it('starts in English and translates generated examples and interpolated messages', () => {
  expect(getLocale()).toBe('en');
  expect(tr('app.name')).toBe('Trace');
  expect(tr('characters.editLabel', russianText('samples.noraFirstName'))).toBe(
    `Edit node ${russianText('samples.noraFirstName')}`,
  );
  const example = demoDatabase();
  expect(example.characters[0].name).toBe('Henri Domye');
  expect(example.clubs[0].name).toBe('The dead witness');
  setLocale('ru');
  expect(tr('characters.editLabel', russianText('samples.noraFirstName'))).toBe(
    russianText('characters.editLabel', russianText('samples.noraFirstName')),
  );
  expect(demoDatabase().characters[0].name).toBe(russianDemo.nodes.domye.name);
  // Previously generated/user-owned records stay intact when the UI language changes.
  expect(example.characters[0].name).toBe('Henri Domye');
});

it('updates schema errors after switching languages', () => {
  const data = emptyDatabase();
  data.relationTypes = [{ id: 'type', name: '', color: '#ffffff' }];
  let result = databaseSchema.safeParse(data);
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues[0].message).toBe('Enter a name');
  setLocale('ru');
  result = databaseSchema.safeParse(data);
  expect(result.success).toBe(false);
  if (!result.success)
    expect(result.error.issues[0].message).toBe(russianText('validation.nameRequired'));
});

it('uses the same named keys and placeholders in both language dictionaries', () => {
  const placeholders = (value: string) =>
    [...value.matchAll(/\{\d+}/g)].map((match) => match[0]).sort();
  expect(Object.keys(russian).sort()).toEqual(Object.keys(english).sort());
  for (const key of Object.keys(english) as Message[]) {
    const translation = english[key];
    expect(key).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/);
    expect(translation.trim()).not.toBe('');
    expect(russian[key].trim()).not.toBe('');
    expect(translation).not.toMatch(/\p{Script=Cyrillic}/u);
    expect(placeholders(translation)).toEqual(placeholders(russian[key]));
  }
});

it('keeps Cyrillic text out of application, test and build source files', async () => {
  async function sourceFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const branches = await Promise.all(
      entries.map(async (entry) => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory()
          ? sourceFiles(file)
          : /\.(?:tsx?|[cm]?js|py)$/.test(file)
            ? [file]
            : [];
      }),
    );
    return branches.flat();
  }

  const files = (
    await Promise.all(['src', 'shared', 'electron', 'scripts', 'tests'].map(sourceFiles))
  ).flat();
  const sources = await Promise.all(
    files.map(async (file) => ({ file, source: await readFile(file, 'utf8') })),
  );
  for (const { file, source } of sources) expect(source, file).not.toMatch(/\p{Script=Cyrillic}/u);
});

it('persists language independently of library contents and handles invalid preferences', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clubs-language-'));
  directories.push(directory);
  const library = JSON.stringify(demoDatabase());
  await writeFile(path.join(directory, 'library.json'), library);
  expect(readLanguage(directory)).toBe('en');
  await saveLanguage(directory, 'ru');
  expect(readLanguage(directory)).toBe('ru');
  expect(await readFile(path.join(directory, 'library.json'), 'utf8')).toBe(library);
  await expect(saveLanguage(directory, 'fr' as 'en')).rejects.toThrow('Unsupported language');
  expect(readLanguage(directory)).toBe('ru');
  await writeFile(path.join(directory, 'preferences.json'), 'broken json');
  expect(readLanguage(directory)).toBe('en');
});
