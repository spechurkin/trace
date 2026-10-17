import type { AppUpdater } from 'electron-updater';
import type { UpdateInterval, UpdateState } from '../shared/updates';

// Keep updater state in the main process so reopening Settings never loses progress.
export class UpdateController {
  state: UpdateState;
  private operation = false;

  constructor(
    private updater: AppUpdater | undefined,
    currentVersion: string,
    private publish: (state: UpdateState) => void,
    packaged: boolean,
    intervalDays: UpdateInterval = 1,
  ) {
    this.state = {
      status: updater ? 'idle' : packaged ? 'manual' : 'disabled',
      currentVersion,
      intervalDays,
    };
    if (!updater) return;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    updater.channel = 'latest';
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.on('checking-for-update', () => this.set({ status: 'checking' }));
    updater.on('update-not-available', () =>
      this.set({ status: 'current', version: undefined, percent: undefined }),
    );
    updater.on('update-available', (info) =>
      this.set({ status: 'downloading', version: info.version, percent: 0 }),
    );
    updater.on('download-progress', (info) =>
      this.set({ status: 'downloading', percent: Math.round(info.percent) }),
    );
    updater.on('update-downloaded', (info) =>
      this.set({ status: 'ready', version: info.version, percent: 100 }),
    );
    updater.on('error', () => this.set({ status: 'error' }));
  }

  setInterval(intervalDays: UpdateInterval) {
    this.set({ intervalDays });
  }

  async check() {
    if (
      !this.updater ||
      this.operation ||
      ['checking', 'downloading', 'ready', 'installing'].includes(this.state.status)
    )
      return this.state;
    this.operation = true;
    try {
      const result = await this.updater.checkForUpdates();
      // Await the download too: retrying after a failed download must not race a check.
      await result?.downloadPromise;
    } catch {
      this.set({ status: 'error' });
    } finally {
      this.operation = false;
    }
    return this.state;
  }

  async install(flush: () => Promise<void>) {
    if (!this.updater || this.state.status !== 'ready') return;
    this.set({ status: 'installing' });
    try {
      await flush();
      this.updater.quitAndInstall(false, true);
    } catch (error) {
      this.set({ status: 'ready' });
      throw error;
    }
  }

  private set(update: Partial<UpdateState>) {
    this.state = { ...this.state, ...update };
    this.publish(this.state);
  }
}
