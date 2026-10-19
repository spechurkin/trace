import { tr } from '../../shared/i18n';
import { type ThemeCatalog, userThemeKey } from '../../shared/themes';

export const themes = ['original'] as const;
const preferenceKey = 'trace.appearance';
let catalog: ThemeCatalog = { directory: '', themes: [], warnings: [] };
let generation = 0;
let activeLink: HTMLLinkElement | undefined;
const listeners = new Set<() => void>();

export function readTheme(): string {
  try {
    return localStorage.getItem(preferenceKey) || 'original';
  } catch {
    return 'original';
  }
}

let state = { catalog, selected: readTheme(), busy: false, error: '', unavailable: false };
export const getThemeState = () => state;

export function subscribeThemes(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(next: Partial<typeof state>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

export function isTheme(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (themes.some((theme) => theme === value) ||
      catalog.themes.some((theme) => userThemeKey(theme) === value))
  );
}

function resetAppearance(theme = 'original') {
  activeLink?.remove();
  activeLink = undefined;
  const root = document.documentElement;
  if (theme === 'original') delete root.dataset.theme;
  else root.dataset.theme = theme;
  delete root.dataset.themeMode;
  delete root.dataset.themeId;
  delete root.dataset.themeVariant;
}

export async function applyTheme(selection: string): Promise<void> {
  const current = ++generation;
  const theme = catalog.themes.find((item) => userThemeKey(item) === selection);
  if (!theme) {
    const builtin = themes.some((id) => id === selection);
    resetAppearance(builtin ? selection : 'original');
    publish({ error: '', unavailable: !builtin });
    return;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.media = 'not all';
  // Keep the reload generation in the path so relative CSS imports, images and fonts refresh too.
  link.href = theme.stylesheet.replace('/v0/', `/v${Date.now()}-${current}/`);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Stylesheet load timed out')), 5000);
      link.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      link.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Stylesheet unavailable'));
      };
      document.head.append(link);
    });
    if (current !== generation) {
      link.remove();
      return;
    }
    resetAppearance();
    const root = document.documentElement;
    root.dataset.theme = 'custom';
    root.dataset.themeMode = theme.mode;
    root.dataset.themeId = theme.id;
    if (theme.variant) root.dataset.themeVariant = theme.variant;
    link.media = 'all';
    activeLink = link;
    publish({ error: '', unavailable: false });
  } catch {
    link.remove();
    if (current !== generation) return;
    resetAppearance();
    publish({ error: tr('theme.loadError'), unavailable: true });
  }
}

export async function saveTheme(theme: string) {
  if (!isTheme(theme)) return;
  try {
    localStorage.setItem(preferenceKey, theme);
  } catch {
    /* Session-only preference. */
  }
  publish({ selected: theme });
  await applyTheme(theme);
}

export async function reloadThemes() {
  publish({ busy: true, error: '' });
  try {
    catalog = (await window.desktop?.getThemes()) ?? { directory: '', themes: [], warnings: [] };
    publish({ catalog });
    await applyTheme(state.selected);
  } catch {
    publish({ error: tr('theme.reloadError') });
    if (state.selected.startsWith('user:')) {
      ++generation;
      resetAppearance();
      publish({ unavailable: true });
    }
  } finally {
    publish({ busy: false });
  }
}

export async function openThemesFolder() {
  try {
    await window.desktop?.showThemesFolder();
  } catch {
    publish({ error: tr('theme.folderError') });
  }
}
