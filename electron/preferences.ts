import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isLocale, type Locale, tr } from '../shared/i18n';

const filename = 'preferences.json';

export function readLanguage(directory: string): Locale {
  const file = path.join(directory, filename);
  if (!existsSync(file)) return 'en';
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (value && typeof value === 'object' && 'language' in value && isLocale(value.language))
      return value.language;
  } catch {
    // A damaged preference must not prevent access to the library.
  }
  return 'en';
}

export async function saveLanguage(directory: string, language: Locale) {
  if (!isLocale(language)) throw new Error(tr('errors.unsupportedLanguage'));
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, filename);
  await writeFile(file + '.tmp', JSON.stringify({ language }) + '\n', 'utf8');
  await rename(file + '.tmp', file);
}
