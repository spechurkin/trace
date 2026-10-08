import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI } from '../shared/model';

const api: DesktopAPI = {
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
