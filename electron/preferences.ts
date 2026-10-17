import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isLocale, type Locale, tr } from '../shared/i18n';
import { isUpdateInterval, type UpdateInterval, type UpdatePreferences } from '../shared/updates';

const filename = 'preferences.json';
let writeQueue = Promise.resolve();

function readPreferences(directory: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(path.join(directory, filename), 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function savePreferences(directory: string, change: Record<string, unknown>) {
  const operation = writeQueue.then(async () => {
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, filename);
    await writeFile(
      file + '.tmp',
      JSON.stringify({ ...readPreferences(directory), ...change }) + '\n',
      'utf8',
    );
    await rename(file + '.tmp', file);
  });
  writeQueue = operation.catch(() => {
  });
  return operation;
}

export function readUpdatePreferences(directory: string): UpdatePreferences {
  const value = readPreferences(directory);
  return {
    intervalDays: isUpdateInterval(value.updateIntervalDays) ? value.updateIntervalDays : 1,
    lastCheck:
      typeof value.lastUpdateCheck === 'number' &&
      Number.isFinite(value.lastUpdateCheck) &&
      value.lastUpdateCheck > 0 &&
      value.lastUpdateCheck <= Date.now()
        ? value.lastUpdateCheck
        : 0,
  };
}

export function saveUpdateInterval(directory: string, intervalDays: UpdateInterval) {
  if (!isUpdateInterval(intervalDays)) throw new Error(tr('updates.invalidInterval'));
  return savePreferences(directory, { updateIntervalDays: intervalDays });
}

export function saveUpdateCheck(directory: string, time: number) {
  return savePreferences(directory, { lastUpdateCheck: time });
}

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
  await savePreferences(directory, { language });
}
