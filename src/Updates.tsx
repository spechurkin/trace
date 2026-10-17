import { useEffect, useState } from 'react';
import { tr } from '../shared/i18n';
import { isUpdateInterval, updateIntervals, type UpdateState } from '../shared/updates';

export function useUpdates() {
  const [state, setState] = useState<UpdateState>({
    status: 'disabled',
    currentVersion: '',
    intervalDays: 1,
  });
  useEffect(() => {
    const api = window.desktop;
    if (!api) return;
    let active = true;
    let receivedEvent = false;
    const unsubscribe = api.onUpdateState((next) => {
      receivedEvent = true;
      if (active) setState(next);
    });
    void api
      .getUpdateState()
      .then((next) => {
        if (active && !receivedEvent) setState(next);
      })
      .catch(() => {
        if (active) setState({ status: 'error', currentVersion: '', intervalDays: 1 });
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return state;
}

export function UpdateSettings({
                                 state,
                                 flush,
                               }: {
  state: UpdateState;
  flush: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const api = window.desktop;
  const pending = busy || ['checking', 'downloading', 'installing'].includes(state.status);
  const manual = state.status === 'manual';
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch {
      setError(tr('updates.actionError'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-card" data-testid="updates">
      <h2>{tr('updates.title')}</h2>
      <p>{tr('updates.description')}</p>
      {api && (
        <label className="field">
          <span>{tr('updates.interval')}</span>
          <select
            aria-label={tr('updates.interval')}
            value={state.intervalDays}
            disabled={busy || state.status === 'installing'}
            onChange={(event) => {
              const days = Number(event.target.value);
              if (isUpdateInterval(days)) void run(() => api.setUpdateInterval(days));
            }}
          >
            {updateIntervals.map((days) => (
              <option key={days} value={days}>
                {tr(
                  days === 1 ? 'updates.daily' : days === 7 ? 'updates.weekly' : 'updates.monthly',
                )}
              </option>
            ))}
          </select>
          <span className="field-hint">{tr('updates.intervalHint')}</span>
        </label>
      )}
      <p aria-live="polite">
        {tr(`updates.${state.status}`, state.version || state.currentVersion, state.percent || 0)}
      </p>
      {state.status === 'downloading' && (
        <progress max={100} value={state.percent || 0} aria-label={tr('updates.progress')} />
      )}
      {error && <p role="alert">{error}</p>}
      {api && state.status !== 'disabled' && (
        <div className="button-row">
          {state.status === 'ready' ? (
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  // Drain renderer saves before asking the main process to quit.
                  await flush();
                  await api.installUpdate();
                })
              }
            >
              {tr('updates.install')}
            </button>
          ) : (
            !manual && (
              <button
                className="button secondary"
                disabled={pending}
                onClick={() => void run(() => api.checkForUpdates())}
              >
                {tr('updates.check')}
              </button>
            )
          )}
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void run(() => api.openReleases())}
          >
            {tr('updates.releases')}
          </button>
        </div>
      )}
    </div>
  );
}
