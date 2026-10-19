import en from './locales/en.json' with { type: 'json' };
import ru from './locales/ru.json' with { type: 'json' };

type Key = keyof typeof en;
const translations: Record<'en' | 'ru', Record<Key, string>> = { en, ru };
export type CreatorLocale = 'en' | 'ru';

export function messages(locale: CreatorLocale) {
  return (key: Key, ...args: (string | number)[]) =>
    translations[locale][key].replace(/\{(\d+)}/g, (_, i: string) => String(args[Number(i)] ?? ''));
}

export type CreatorMessage = Key;
