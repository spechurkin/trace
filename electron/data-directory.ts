import path from 'node:path';

export type DataDirectory = { directory: string; warning?: string };

export function prepareDataDirectory(appData: string, override?: string): DataDirectory {
  return {
    directory: override ? path.resolve(override) : path.join(path.resolve(appData), 'Trace'),
  };
}
