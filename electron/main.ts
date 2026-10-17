import { getLocale, isLocale, setLocale, tr } from '../shared/i18n';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  Menu,
  net,
  powerMonitor,
  protocol,
  session,
  shell,
} from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { databaseSchema, type ExportFormat } from '../shared/model';
import { describeImport, mergeTransfer, transferSchema } from '../shared/transfer';
import { Repository } from './repository';
import { type DataDirectory, prepareDataDirectory } from './data-directory';
import {
  readLanguage,
  readUpdatePreferences,
  saveLanguage,
  saveUpdateCheck,
  saveUpdateInterval,
} from './preferences';
import { autoUpdater } from 'electron-updater';
import { isUpdateInterval, supportsAutoUpdate } from '../shared/updates';
import { UpdateController } from './updates';
import { UpdateSchedule } from './update-schedule';
import { installBundledTheme, readThemeResource, scanThemes, themesDirectory } from './themes';

app.setName(tr('app.name'));
let dataDirectory: DataDirectory = { directory: path.join(app.getPath('appData'), 'Trace') };
let directoryError: Error | undefined;
try {
  dataDirectory = prepareDataDirectory(app.getPath('appData'), process.env.TRACE_DATA_DIR);
} catch (error) {
  directoryError = error as Error;
}
if (!directoryError) {
  app.setPath('userData', dataDirectory.directory);
  setLocale(readLanguage(dataDirectory.directory));
  app.setName(tr('app.name'));
}
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'trace',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);
let mainWindow: BrowserWindow | null = null;
let repository: Repository;
let quitting = false;
let updates: UpdateController;
let updateSchedule: UpdateSchedule | undefined;
const releasesUrl = 'https://github.com/spechurkin/trace/releases/latest';
const autoUpdatesSupported = supportsAutoUpdate(
  app.isPackaged,
  process.platform,
  process.env,
  existsSync(path.join(path.dirname(app.getPath('exe')), 'Uninstall Trace.exe')),
);

const developmentUrl = !app.isPackaged ? process.env.TRACE_DEV_URL : undefined;
const themesRoot = themesDirectory({
  packaged: app.isPackaged,
  appPath: app.getAppPath(),
  executable: app.getPath('exe'),
  platform: process.platform,
  env: process.env,
});
let themeSetupWarning = '';

function authorize(event: IpcMainInvokeEvent) {
  const url = event.senderFrame?.url;
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame ||
    !url ||
    (developmentUrl
      ? new URL(url).origin !== new URL(developmentUrl).origin
      : !url.startsWith('trace://app/'))
  )
    throw new Error(tr('errors.unauthorizedRequest'));
}

function registerHandlers() {
  ipcMain.handle('themes:list', async (event) => {
    authorize(event);
    const catalog = await scanThemes(themesRoot);
    if (themeSetupWarning) catalog.warnings.unshift(themeSetupWarning);
    return catalog;
  });
  ipcMain.handle('themes:folder', async (event) => {
    authorize(event);
    await mkdir(themesRoot, { recursive: true });
    const error = await shell.openPath(themesRoot);
    if (error) throw new Error(error);
  });
  ipcMain.handle('updates:state', (event) => {
    authorize(event);
    return updates.state;
  });
  ipcMain.handle('updates:check', async (event) => {
    authorize(event);
    await updateSchedule?.checkNow();
    return updates.state;
  });
  ipcMain.handle('updates:interval', async (event, days: unknown) => {
    authorize(event);
    if (!isUpdateInterval(days)) throw new Error(tr('updates.invalidInterval'));
    await saveUpdateInterval(dataDirectory.directory, days);
    updates.setInterval(days);
    updateSchedule?.setInterval(days);
  });
  ipcMain.handle('updates:install', async (event) => {
    authorize(event);
    await updates.install(async () => {
      await repository.flush();
    });
  });
  ipcMain.handle('updates:releases', (event) => {
    authorize(event);
    return shell.openExternal(releasesUrl);
  });

  ipcMain.handle('language:get', (event) => {
    authorize(event);
    return getLocale();
  });
  ipcMain.handle('language:set', async (event, locale: unknown) => {
    authorize(event);
    if (!isLocale(locale)) throw new Error(tr('errors.unsupportedLanguage'));
    await saveLanguage(dataDirectory.directory, locale);
    setLocale(locale);
    app.setName(tr('app.name'));
    mainWindow?.setTitle(tr('app.name'));
    updateMenu();
  });
  ipcMain.handle('library:load', async (event) => {
    authorize(event);
    const loaded = await repository.load();
    return {
      ...loaded,
      warning: [loaded.warning, dataDirectory.warning].filter(Boolean).join(' ') || undefined,
    };
  });
  ipcMain.handle('library:save', (event, data) => {
    authorize(event);
    return repository.save(data);
  });
  ipcMain.handle('library:folder', async (event) => {
    authorize(event);
    const error = await shell.openPath(repository.directory);
    if (error) throw new Error(error);
  });
  ipcMain.handle('library:export', async (event, input) => {
    authorize(event);
    const data = databaseSchema.parse(input);
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: tr('backup.dialogTitle'),
      defaultPath: tr('filenames.libraryBackup'),
      filters: [{ name: tr('backup.fileFilter'), extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  });
  ipcMain.handle('library:import', async (event) => {
    authorize(event);
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: tr('backup.importDialogTitle'),
      properties: ['openFile'],
      filters: [{ name: tr('backup.fileFilter'), extensions: ['json'] }],
    });
    if (result.canceled) return null;
    const data = await repository.readFile(result.filePaths[0]);
    const confirmation = await dialog.showMessageBox(mainWindow!, {
      type: 'question',
      title: tr('backup.replaceTitle'),
      message: tr('backup.replaceMessage'),
      detail: tr(
        'backup.replaceDetail',
        data.characters.length,
        data.folders.length,
        data.boards.length,
      ),
      buttons: [tr('actions.cancel'), tr('actions.replace')],
      defaultId: 0,
      cancelId: 0,
    });
    if (confirmation.response !== 1) return null;
    await repository.save(data, true);
    return { data, path: repository.file };
  });
  ipcMain.handle('transfer:export', async (event, input, name: unknown) => {
    authorize(event);
    if (typeof name !== 'string' || name.length > 120)
      throw new Error(tr('validation.filenameInvalid'));
    const file = transferSchema.parse(input);
    const payload = JSON.stringify(file, null, 2);
    if (Buffer.byteLength(payload) > 150 * 1024 * 1024) throw new Error(tr('validation.fileSize'));
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: tr('transfer.exportDialogTitle'),
      defaultPath: `${name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.json`,
      filters: [{ name: tr('transfer.fileFilter'), extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, payload, 'utf8');
    return true;
  });
  ipcMain.handle('transfer:import', async (event) => {
    authorize(event);
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: tr('transfer.importHint'),
      properties: ['openFile'],
      filters: [{ name: tr('transfer.importFileFilter'), extensions: ['json'] }],
    });
    if (result.canceled) return null;
    const file = await repository.readJsonFile(result.filePaths[0]);
    const current = await repository.load();
    const merged = mergeTransfer(current.data, file);
    const confirmation = await dialog.showMessageBox(mainWindow!, {
      type: 'question',
      title: tr('transfer.confirmTitle'),
      message: tr('transfer.confirmMessage'),
      detail: tr('transfer.confirmDetail', describeImport(merged.summary)),
      buttons: [tr('actions.cancel'), tr('actions.add')],
      defaultId: 1,
      cancelId: 0,
    });
    if (confirmation.response !== 1) return null;
    await repository.save(merged.data);
    return { ...merged, path: repository.file, warning: current.warning };
  });
  ipcMain.handle(
    'diagram:export',
    async (event, name: unknown, format: ExportFormat, content: unknown) => {
      authorize(event);
      if (
        typeof name !== 'string' ||
        name.length > 80 ||
        !['png', 'svg'].includes(format) ||
        typeof content !== 'string' ||
        content.length > 100_000_000
      )
        throw new Error(tr('validation.exportInvalid'));
      if (format === 'png' && !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(content))
        throw new Error(tr('validation.imageInvalid'));
      if (
        format === 'svg' &&
        (!content.startsWith('<svg') ||
          /<script\b|<foreignObject\b/i.test(content) ||
          // Inspect markup attributes without mistaking escaped node text for markup.
          (content.match(/<(?:"[^"]*"|'[^']*'|[^'">])*>/g) || []).some((tag) =>
            [...tag.matchAll(/\s([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].some(
              ([, attribute, doubleQuoted, singleQuoted, unquoted]) =>
                /^on[a-z]+$/i.test(attribute) ||
                (/^(?:href|xlink:href|src)$/i.test(attribute) &&
                  /^\s*(?:https?:|javascript:)/i.test(doubleQuoted ?? singleQuoted ?? unquoted)),
            ),
          ))
      )
        throw new Error(tr('validation.diagramInvalid'));
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: tr('export.dialogTitle'),
        defaultPath: `${name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (result.canceled || !result.filePath) return false;
      await writeFile(
        result.filePath,
        format === 'png' ? Buffer.from(content.split(',')[1], 'base64') : content,
      );
      return true;
    },
  );
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    title: tr('app.name'),
    backgroundColor: '#f6f8ff',
    autoHideMenuBar: true,
    icon: path.join(app.getAppPath(), 'resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  await mainWindow.loadURL(developmentUrl || 'trace://app/index.html');
}

if (directoryError) {
  dialog.showErrorBox(tr('errors.profileMigration'), directoryError.message);
  app.exit(1);
} else if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      repository = new Repository(app.getPath('userData'));
      for (const id of ['clubs']) {
        try {
          await installBundledTheme(
            themesRoot,
            path.join(app.getAppPath(), 'resources/themes', id),
          );
        } catch (error) {
          themeSetupWarning = [themeSetupWarning, `${id}: ${(error as Error).message}`]
            .filter(Boolean)
            .join('\n');
        }
      }

      updates = new UpdateController(
        autoUpdatesSupported ? autoUpdater : undefined,
        app.getVersion(),
        (state) => mainWindow?.webContents.send('updates:changed', state),
        app.isPackaged,
        readUpdatePreferences(dataDirectory.directory).intervalDays,
      );

      const root = path.join(app.getAppPath(), 'dist');
      protocol.handle('trace', async (request) => {
        try {
          const url = new URL(request.url);
          if (url.hostname === 'themes') {
            const [version, id, ...parts] = url.pathname
              .slice(1)
              .split('/')
              .map(decodeURIComponent);
            if (!/^v[\d-]+$/.test(version)) return new Response('Forbidden', { status: 403 });
            const { bytes, mime } = await readThemeResource(themesRoot, id, parts.join('/'));
            return new Response(new Uint8Array(bytes), {
              headers: {
                'Content-Type': mime,
                'Cache-Control': 'no-store',
                'Access-Control-Allow-Origin': '*',
                'Cross-Origin-Resource-Policy': 'cross-origin',
                'X-Content-Type-Options': 'nosniff',
              },
            });
          }
          const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
          if (url.hostname !== 'app' || !file.startsWith(root + path.sep))
            return new Response('Forbidden', { status: 403 });
          return net.fetch(pathToFileURL(file).toString());
        } catch {
          return new Response('Theme resource unavailable', { status: 404 });
        }
      });
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      if (!developmentUrl)
        session.defaultSession.webRequest.onBeforeRequest(
          { urls: ['http://*/*', 'https://*/*'] },
          (_details, callback) => callback({ cancel: true }),
        );
      updateMenu();
      registerHandlers();
      await createWindow();
      if (autoUpdatesSupported) {
        updateSchedule = new UpdateSchedule(
          readUpdatePreferences(dataDirectory.directory),
          () => updates.check(),
          (time) => saveUpdateCheck(dataDirectory.directory, time),
        );
        updateSchedule.start();
        powerMonitor.on('resume', () => updateSchedule?.resume());
        app.once('will-quit', () => {
          updateSchedule?.stop();
        });
      }

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) void createWindow();
      });
    })
    .catch((error) => {
      dialog.showErrorBox(tr('errors.appOpen'), String(error));
      app.quit();
    });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', (event) => {
    // The updater has already flushed saves and owns the install/restart sequence.
    if (quitting || !repository || updates?.state.status === 'installing') return;
    event.preventDefault();
    void repository.flush().finally(() => {
      quitting = true;
      app.quit();
    });
  });
}

function updateMenu() {
  Menu.setApplicationMenu(
    process.platform === 'darwin'
      ? Menu.buildFromTemplate([
          {
            label: tr('app.name'),
            submenu: [
              { role: 'about', label: tr('menu.about') },
              { type: 'separator' },
              { role: 'quit', label: tr('menu.quit') },
            ],
          },
          {
            label: tr('menu.edit'),
            submenu: [
              { role: 'undo', label: tr('menu.undo') },
              { role: 'redo', label: tr('menu.redo') },
              { type: 'separator' },
              { role: 'cut', label: tr('menu.cut') },
              { role: 'copy', label: tr('menu.copy') },
              { role: 'paste', label: tr('menu.paste') },
              { role: 'selectAll', label: tr('menu.selectAll') },
            ],
          },
          {
            label: tr('menu.window'),
            submenu: [
              { role: 'minimize', label: tr('menu.minimize') },
              { role: 'close', label: tr('menu.closeWindow') },
            ],
          },
        ])
      : null,
  );
}
