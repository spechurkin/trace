import { isLocale, tr } from '../shared/i18n';
import {
  type Database,
  databaseSchema,
  type DesktopAPI,
  emptyDatabase,
  type ExportFormat,
  type LoadResult,
} from '../shared/model';
import { describeImport, mergeTransfer, transferSchema } from '../shared/transfer';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('trace-library', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('library');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(tr('errors.browserStorageUnavailable')));
  });
}

async function browserLoad(): Promise<LoadResult> {
  const db = await database();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction('library').objectStore('library').get('data');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return {
      data: value === undefined ? emptyDatabase() : databaseSchema.parse(value),
      path: tr('data.browserLocation'),
    };
  } finally {
    db.close();
  }
}

async function browserSave(data: Database) {
  const validated = databaseSchema.parse(data);
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('library', 'readwrite');
      transaction.objectStore('library').put(validated, 'data');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error(tr('errors.librarySave')));
    });
  } finally {
    db.close();
  }
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function chooseJSON(): Promise<unknown | null> {
  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = () => resolve(input.files?.[0] || null);
    input.oncancel = () => resolve(null);
    input.click();
  });
  if (!file) return null;
  if (file.size > 150 * 1024 * 1024) throw new Error(tr('validation.fileSize'));
  return JSON.parse(await file.text());
}

const browserAPI: DesktopAPI = {
  getLanguage: async () => {
    const locale = localStorage.getItem('trace-language');
    return isLocale(locale) ? locale : 'en';
  },
  setLanguage: async (locale) => {
    if (!isLocale(locale)) throw new Error(tr('errors.unsupportedLanguage'));
    localStorage.setItem('trace-language', locale);
  },
  load: browserLoad,
  save: browserSave,
  exportBackup: async (data) => {
    download(
      tr('filenames.libraryBackup'),
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    return true;
  },
  importBackup: async () => {
    const file = await chooseJSON();
    if (file === null) return null;
    const data = databaseSchema.parse(file);
    if (!window.confirm(tr('backup.browserReplaceMessage'))) return null;
    await browserSave(data);
    return { data, path: tr('data.browserLocation') };
  },
  exportTransfer: async (input, name) => {
    const payload = JSON.stringify(transferSchema.parse(input), null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    if (blob.size > 150 * 1024 * 1024) throw new Error(tr('validation.fileSize'));
    download(`${name}.json`, blob);
    return true;
  },
  importTransfer: async () => {
    const file = await chooseJSON();
    if (file === null) return null;
    const current = await browserLoad();
    const merged = mergeTransfer(current.data, file);
    if (!window.confirm(tr('transfer.browserConfirmMessage', describeImport(merged.summary))))
      return null;
    await browserSave(merged.data);
    return { ...merged, path: current.path };
  },
  exportDiagram: async (name: string, format: ExportFormat, content: string) => {
    const blob =
      format === 'png'
        ? await (await fetch(content)).blob()
        : new Blob([content], { type: 'image/svg+xml;charset=utf-8' });
    download(`${name}.${format}`, blob);
    return true;
  },
  showDataFolder: async () => {
    throw new Error(tr('errors.desktopFolderRequired'));
  },
};

export const storage = window.desktop || browserAPI;
