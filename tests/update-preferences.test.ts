import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  readLanguage,
  readUpdatePreferences,
  saveLanguage,
  saveUpdateCheck,
  saveUpdateInterval,
} from '../electron/preferences';
import type { UpdateInterval } from '../shared/updates';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function directory() {
  const value = await mkdtemp(path.join(os.tmpdir(), 'trace-updates-'));
  directories.push(value);
  return value;
}

it('defaults to daily checks and persists all three supported intervals', async () => {
  const dir = await directory();
  expect(readUpdatePreferences(dir)).toEqual({ intervalDays: 1, lastCheck: 0 });
  for (const days of [1, 7, 30] as const) {
    await saveUpdateInterval(dir, days);
    expect(readUpdatePreferences(dir).intervalDays).toBe(days);
  }
  for (const days of [0, 2, 14, 31, 1.5, '7', null]) {
    expect(() => saveUpdateInterval(dir, days as UpdateInterval)).toThrow();
  }
});

it('preserves language and last-check time when preferences change concurrently', async () => {
  const dir = await directory();
  const now = Date.now();
  await Promise.all([
    saveLanguage(dir, 'ru'),
    saveUpdateInterval(dir, 7),
    saveUpdateCheck(dir, now),
  ]);
  expect(readLanguage(dir)).toBe('ru');
  expect(readUpdatePreferences(dir)).toEqual({ intervalDays: 7, lastCheck: now });
  await saveLanguage(dir, 'en');
  expect(readUpdatePreferences(dir)).toEqual({ intervalDays: 7, lastCheck: now });
  expect(JSON.parse(await readFile(path.join(dir, 'preferences.json'), 'utf8'))).toEqual({
    language: 'en',
    updateIntervalDays: 7,
    lastUpdateCheck: now,
  });
});

it('recovers safe defaults from damaged or invalid update preferences', async () => {
  const dir = await directory();
  for (const value of [
    'broken',
    'null',
    '[]',
    '{"updateIntervalDays":2,"lastUpdateCheck":-1}',
    JSON.stringify({ updateIntervalDays: '7', lastUpdateCheck: Date.now() + 100_000 }),
  ]) {
    await writeFile(path.join(dir, 'preferences.json'), value);
    expect(readUpdatePreferences(dir)).toEqual({ intervalDays: 1, lastCheck: 0 });
  }
});
