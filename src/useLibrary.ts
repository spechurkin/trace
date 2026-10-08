import { tr } from '../shared/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type Database, type LoadResult } from '../shared/model';
import { storage } from './storage';

export function useLibrary() {
  const [data, setData] = useState<Database | null>(null);
  const [status, setStatus] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [path, setPath] = useState('');
  const current = useRef<Database | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const revision = useRef(0);

  const adopt = useCallback((result: LoadResult) => {
    current.current = result.data;
    setData(result.data);
    setPath(result.path);
    setWarning(result.warning || '');
    setStatus('saved');
    setError('');
  }, []);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      adopt(await storage.load());
    } catch (error) {
      setStatus('error');
      setError(error instanceof Error ? error.message : tr('errors.libraryRead'));
    }
  }, [adopt]);
  useEffect(() => {
    void load();
  }, [load]);

  const commit = useCallback((update: (data: Database) => Database) => {
    if (!current.current) return;
    const next = update(current.current);
    current.current = next;
    setData(next);
    setStatus('saving');
    setError('');
    const ownRevision = ++revision.current;
    queue.current = queue.current
      .then(() => storage.save(next))
      .then(() => {
        if (revision.current === ownRevision) setStatus('saved');
      })
      .catch((error) => {
        if (revision.current === ownRevision) {
          setStatus('error');
          setError(error instanceof Error ? error.message : tr('errors.librarySave'));
        }
      });
  }, []);

  const flush = useCallback(async () => {
    await queue.current;
    // Retrying explicitly also covers a previous failed save.
    if (current.current) await storage.save(current.current);
    setStatus('saved');
    setError('');
  }, []);
  return {
    data,
    status,
    error,
    warning,
    path,
    commit,
    load,
    adopt,
    flush,
    retry: () => commit((data) => ({ ...data })),
  };
}
