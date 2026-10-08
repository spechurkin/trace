import { tr } from '../shared/i18n';
import { copyFile, mkdir, open, readFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { type Database, databaseSchema, emptyDatabase, type LoadResult } from '../shared/model';

const MAX_BYTES = 150 * 1024 * 1024;

export class Repository {
  readonly file: string;
  private queue: Promise<void> = Promise.resolve();
  private initialized = false;
  private primaryValid = false;

  constructor(readonly directory: string) {
    this.file = path.join(directory, 'library.json');
  }

  async readJsonFile(file: string): Promise<unknown> {
    if ((await stat(file)).size > MAX_BYTES) throw new Error(tr('validation.librarySize'));
    return JSON.parse(await readFile(file, 'utf8'));
  }

  async readFile(file: string): Promise<Database> {
    return databaseSchema.parse(await this.readJsonFile(file));
  }

  async load(): Promise<LoadResult> {
    await this.queue;
    await mkdir(this.directory, { recursive: true });
    try {
      const data = await this.readFile(this.file);
      this.initialized = this.primaryValid = true;
      return { data, path: this.file };
    } catch (error) {
      try {
        const data = await this.readFile(this.file + '.bak');
        this.initialized = true;
        this.primaryValid = false;
        return {
          data,
          path: this.file,
          warning: tr('library.backupRecovered'),
        };
      } catch (backupError) {
        if (
          (error as NodeJS.ErrnoException).code === 'ENOENT' &&
          (backupError as NodeJS.ErrnoException).code === 'ENOENT'
        ) {
          this.initialized = true;
          return { data: emptyDatabase(), path: this.file };
        }
        throw new Error(tr('errors.libraryRecovery'));
      }
    }
  }

  save(input: unknown, importing = false): Promise<void> {
    const data = databaseSchema.parse(input);
    const payload = JSON.stringify(data, null, 2);
    if (Buffer.byteLength(payload) > MAX_BYTES)
      return Promise.reject(new Error(tr('validation.librarySize')));
    const operation = this.queue.then(async () => {
      if (!this.initialized && !importing) throw new Error(tr('errors.libraryNotLoaded'));
      await mkdir(this.directory, { recursive: true });
      const temp = this.file + '.tmp';
      const handle = await open(temp, 'w');
      try {
        await handle.writeFile(payload, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (this.primaryValid) await copyFile(this.file, this.file + '.bak');
      await rename(temp, this.file);
      this.initialized = this.primaryValid = true;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  async flush() {
    await this.queue;
  }
}
