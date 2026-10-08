import { getLocale } from '../shared/i18n';

const collators = {
  ru: new Intl.Collator('ru', { sensitivity: 'base', numeric: true }),
  en: new Intl.Collator('en', { sensitivity: 'base', numeric: true }),
};

export function sortByName<T extends { name: string }>(items: readonly T[]): T[] {
  const collator = collators[getLocale()];
  return [...items].sort((a, b) => collator.compare(a.name, b.name));
}
