import { EventEmitter } from 'node:events';
import type { AppUpdater } from 'electron-updater';
import { describe, expect, it, vi } from 'vitest';
import { UpdateController } from '../electron/updates';
import { supportsAutoUpdate } from '../shared/updates';

function fixture() {
  const updater = Object.assign(new EventEmitter(), {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    allowDowngrade: true,
    channel: 'beta',
    checkForUpdates: vi.fn(async () => null as { downloadPromise: Promise<string[]> } | null),
    quitAndInstall: vi.fn(),
  });
  const publish = vi.fn();
  const controller = new UpdateController(updater as unknown as AppUpdater, '1.1.1', publish, true);
  return { updater, publish, controller };
}

it('only enables automatic installation in installed Windows and AppImage releases', () => {
  expect(supportsAutoUpdate(true, 'win32', {}, true)).toBe(true);
  expect(supportsAutoUpdate(true, 'win32', {}, false)).toBe(false);
  expect(supportsAutoUpdate(true, 'win32', { PORTABLE_EXECUTABLE_FILE: 'Trace.exe' }, true)).toBe(
    false,
  );
  expect(supportsAutoUpdate(true, 'linux', { APPIMAGE: '/opt/Trace.AppImage' })).toBe(true);
  expect(supportsAutoUpdate(false, 'linux', { APPIMAGE: '/opt/Trace.AppImage' })).toBe(false);
  expect(supportsAutoUpdate(false, 'win32', {}, true)).toBe(false);
  expect(supportsAutoUpdate(true, 'linux', {})).toBe(false);
  expect(supportsAutoUpdate(true, 'darwin', {})).toBe(false);
});

it('downloads stable upgrades without downgrades or installation on normal quit', () => {
  const { updater, controller, publish } = fixture();
  expect(updater).toMatchObject({
    autoDownload: true,
    autoInstallOnAppQuit: false,
    channel: 'latest',
    allowPrerelease: false,
    allowDowngrade: false,
  });
  updater.emit('checking-for-update');
  expect(controller.state.status).toBe('checking');
  updater.emit('update-available', { version: '1.2.0' });
  updater.emit('download-progress', { percent: 42.4 });
  expect(controller.state).toMatchObject({ status: 'downloading', version: '1.2.0', percent: 42 });
  updater.emit('update-downloaded', { version: '1.2.0' });
  expect(publish).toHaveBeenLastCalledWith({
    status: 'ready',
    currentVersion: '1.1.1',
    intervalDays: 1,
    version: '1.2.0',
    percent: 100,
  });
  expect(updater.quitAndInstall).not.toHaveBeenCalled();
});

it('keeps offline and download failures retryable without overlapping requests', async () => {
  const { updater, controller } = fixture();
  let finish!: () => void;
  const downloadPromise = new Promise<string[]>((resolve) => {
    finish = () => resolve([]);
  });
  updater.checkForUpdates.mockResolvedValueOnce({ downloadPromise });
  const check = controller.check();
  await Promise.resolve();
  await controller.check();
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  finish();
  await check;
  updater.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
  await controller.check();
  expect(controller.state.status).toBe('error');
  updater.checkForUpdates.mockImplementationOnce(async () => {
    updater.emit('update-not-available');
    return null;
  });
  await controller.check();
  expect(controller.state.status).toBe('current');
  updater.checkForUpdates.mockResolvedValueOnce({
    downloadPromise: Promise.reject(new Error('download failed')),
  });
  await controller.check();
  expect(controller.state.status).toBe('error');
});

it('preserves downloaded updates across periodic checks and waits for saves before restarting', async () => {
  const { updater, controller } = fixture();
  const flush = vi.fn(async () => {
  });
  await controller.install(flush);
  expect(flush).not.toHaveBeenCalled();
  updater.emit('update-downloaded', { version: '1.2.0' });
  await controller.check();
  expect(updater.checkForUpdates).not.toHaveBeenCalled();
  let finish!: () => void;
  const saved = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const install = controller.install(() => saved);
  await controller.install(flush);
  expect(updater.quitAndInstall).not.toHaveBeenCalled();
  finish();
  await install;
  expect(updater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true);
});

it('does not quit after a save failure and allows retrying installation', async () => {
  const { updater, controller } = fixture();
  updater.emit('update-downloaded', { version: '1.2.0' });
  await expect(
    controller.install(async () => {
      throw new Error('disk full');
    }),
  ).rejects.toThrow('disk full');
  expect(controller.state.status).toBe('ready');
  expect(updater.quitAndInstall).not.toHaveBeenCalled();
  await controller.install(async () => {
  });
  expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
});

describe.each([true, false])('unsupported build (packaged: %s)', (packaged) => {
  it('keeps checks and installation inactive', async () => {
    const controller = new UpdateController(undefined, '1.1.1', vi.fn(), packaged);
    expect((await controller.check()).status).toBe(packaged ? 'manual' : 'disabled');
    const flush = vi.fn();
    await controller.install(flush);
    expect(flush).not.toHaveBeenCalled();
  });
});
