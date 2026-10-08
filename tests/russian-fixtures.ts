import russian from '../shared/locales/ru.json' with { type: 'json' };
import samples from './fixtures/russian.json' with { type: 'json' };

const messages = { ...russian, ...samples };

export function russianText(message: keyof typeof messages, ...parameters: unknown[]): string {
  return messages[message].replace(/\{(\d+)}/g, (_, index: string) =>
    String(parameters[Number(index)]),
  );
}
