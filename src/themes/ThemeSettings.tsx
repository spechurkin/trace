import { useSyncExternalStore } from 'react';
import { tr } from '../../shared/i18n';
import { userThemeKey } from '../../shared/themes';
import { getThemeState, openThemesFolder, reloadThemes, saveTheme, subscribeThemes, themes } from './preferences';

export function ThemeSettings() {
  const { catalog, selected, busy, error, unavailable } = useSyncExternalStore(
    subscribeThemes,
    getThemeState,
  );
  return (
    <div className="settings-card compact">
      <h2>{tr('theme.title')}</h2>
      <label className="field">
        <select
          aria-label={tr('theme.theme')}
          value={selected}
          disabled={busy}
          onChange={(event) => {
            void saveTheme(event.target.value);
          }}
        >
          {themes.map((id) => (
            <option key={id} value={id}>
              {tr('theme.original')}
            </option>
          ))}
          {catalog.themes.map((theme) => (
            <option key={userThemeKey(theme)} value={userThemeKey(theme)}>
              {theme.name}
            </option>
          ))}
          {!themes.some((id) => id === selected) &&
            !catalog.themes.some((theme) => userThemeKey(theme) === selected) && (
              <option value={selected} disabled>
                {tr('theme.unavailable')}
              </option>
            )}
        </select>
      </label>
      <p className="field-hint">{tr('theme.hint')}</p>
      <p className="field-hint">{tr(window.desktop ? 'theme.folderHint' : 'theme.desktopHint')}</p>
      {catalog.directory && (
        <p className="data-path">
          <code>{catalog.directory}</code>
        </p>
      )}
      <div className="button-row">
        <button
          className="button secondary"
          disabled={!window.desktop || busy}
          onClick={() => {
            void reloadThemes();
          }}
        >
          {tr('theme.reload')}
        </button>
        <button
          className="button secondary"
          disabled={!window.desktop || busy}
          onClick={() => {
            void openThemesFolder();
          }}
        >
          {tr('theme.openFolder')}
        </button>
      </div>
      {busy && <p role="status">{tr('theme.loading')}</p>}
      {unavailable && <p role="status">{tr('theme.unavailableHint')}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {catalog.warnings.length > 0 && (
        <details>
          <summary>{tr('theme.warnings')}</summary>
          {catalog.warnings.map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
        </details>
      )}
    </div>
  );
}
