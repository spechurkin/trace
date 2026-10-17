import { afterEach, expect, it, vi } from 'vitest';
import { UpdateSchedule } from '../electron/update-schedule';

const day = 24 * 60 * 60 * 1000;
afterEach(() => {
  vi.useRealTimers();
});

function fixture(intervalDays: 1 | 7 | 30 = 1, elapsedDays = 0) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
  const check = vi.fn(async () => {
  });
  const record = vi.fn(async () => {
  });
  const schedule = new UpdateSchedule(
    { intervalDays, lastCheck: Date.now() - elapsedDays * day },
    check,
    record,
  );
  return { check, record, schedule };
}

it.each([1, 7, 30] as const)(
  'checks every %s days, including periods beyond the Node timer limit',
  async (days) => {
    const { schedule, check, record } = fixture(days);
    schedule.start();
    await vi.advanceTimersByTimeAsync(days * day - 1);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenLastCalledWith(Date.now());
    await vi.advanceTimersByTimeAsync(days * day);
    expect(check).toHaveBeenCalledTimes(2);
    schedule.stop();
  },
);

it('checks overdue releases after startup and respects the last check after restarting', async () => {
  const { schedule, check } = fixture(7, 10);
  schedule.start();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(check).toHaveBeenCalledTimes(1);
  schedule.stop();
  const restarted = new UpdateSchedule(
    { intervalDays: 7, lastCheck: Date.now() },
    check,
    async () => {
    },
  );
  restarted.start();
  await vi.advanceTimersByTimeAsync(day);
  expect(check).toHaveBeenCalledTimes(1);
  restarted.stop();
});

it('reschedules after changing the period and after waking from sleep', async () => {
  const { schedule, check } = fixture(30, 5);
  schedule.start();
  schedule.setInterval(7);
  await vi.advanceTimersByTimeAsync(2 * day);
  expect(check).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 10 * day);
  schedule.resume();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(check).toHaveBeenCalledTimes(2);
  schedule.stop();
});

it('manual checks bypass the period, reset the schedule and survive preference write failures', async () => {
  const { schedule, check, record } = fixture(30);
  record.mockRejectedValueOnce(new Error('read only'));
  schedule.start();
  await schedule.checkNow();
  expect(check).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(29 * day);
  expect(check).toHaveBeenCalledTimes(1);
  schedule.stop();
  await vi.advanceTimersByTimeAsync(2 * day);
  expect(check).toHaveBeenCalledTimes(1);
});
