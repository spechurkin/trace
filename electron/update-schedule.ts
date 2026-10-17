import type { UpdateInterval, UpdatePreferences } from '../shared/updates';

const day = 24 * 60 * 60 * 1000;
// Node timers overflow beyond roughly 24.8 days; re-evaluate longer waits in chunks.
const maxTimeout = 2 ** 31 - 1;

export class UpdateSchedule {
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private stopped = true;
  private intervalDays: UpdateInterval;
  private lastCheck: number;

  constructor(
    preferences: UpdatePreferences,
    private check: () => Promise<unknown>,
    private recordCheck: (time: number) => Promise<void>,
  ) {
    this.intervalDays = preferences.intervalDays;
    this.lastCheck = preferences.lastCheck;
  }

  start() {
    this.stopped = false;
    this.schedule();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  setInterval(intervalDays: UpdateInterval) {
    this.intervalDays = intervalDays;
    this.schedule();
  }

  resume() {
    this.schedule();
  }

  async checkNow() {
    if (this.running) return;
    clearTimeout(this.timer);
    this.running = true;
    this.lastCheck = Date.now();
    try {
      // An unwritable preference file must not prevent a manual update check.
      await this.recordCheck(this.lastCheck).catch(() => {
      });
      await this.check();
    } finally {
      this.running = false;
      this.schedule();
    }
  }

  private schedule() {
    clearTimeout(this.timer);
    if (this.stopped || this.running) return;
    const remaining = this.lastCheck ? this.lastCheck + this.intervalDays * day - Date.now() : 0;
    this.timer = setTimeout(
      () => {
        if (this.lastCheck && Date.now() < this.lastCheck + this.intervalDays * day)
          this.schedule();
        else void this.checkNow();
      },
      Math.min(maxTimeout, Math.max(15_000, remaining)),
    );
    this.timer.unref();
  }
}
