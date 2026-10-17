import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI } from '../shared/model';
import type { UpdateState } from '../shared/updates';

const api: DesktopAPI = {
  getThemes: () => ipcRenderer.invoke('themes:list'),
  showThemesFolder: () => ipcRenderer.invoke('themes:folder'),
  getUpdateState: () => ipcRenderer.invoke('updates:state'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  setUpdateInterval: (days) => ipcRenderer.invoke('updates:interval', days),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  openReleases: () => ipcRenderer.invoke('updates:releases'),
  onUpdateState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => listener(state);
    ipcRenderer.on('updates:changed', handler);
    return () => {
      ipcRenderer.removeListener('updates:changed', handler);
    };
  },

  getLanguage: () => ipcRenderer.invoke('language:get'),
  setLanguage: (locale) => ipcRenderer.invoke('language:set', locale),
  load: () => ipcRenderer.invoke('library:load'),
  save: (data) => ipcRenderer.invoke('library:save', data),
  exportBackup: (data) => ipcRenderer.invoke('library:export', data),
  importBackup: () => ipcRenderer.invoke('library:import'),
  exportTransfer: (file, name) => ipcRenderer.invoke('transfer:export', file, name),
  importTransfer: () => ipcRenderer.invoke('transfer:import'),
  exportDiagram: (name, format, content) =>
    ipcRenderer.invoke('diagram:export', name, format, content),
  showDataFolder: () => ipcRenderer.invoke('library:folder'),
};
contextBridge.exposeInMainWorld('desktop', api);
