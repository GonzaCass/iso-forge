const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('forge', {
  initialize: () => ipcRenderer.invoke('forge:initialize'),
  builds: product => ipcRenderer.invoke('forge:builds', product),
  languages: id => ipcRenderer.invoke('forge:languages', id),
  editions: (id, lang) => ipcRenderer.invoke('forge:editions', id, lang),
  chooseDirectory: () => ipcRenderer.invoke('forge:directory'),
  start: selection => ipcRenderer.invoke('forge:start', selection),
  pause: () => ipcRenderer.invoke('forge:pause'),
  openFolder: folder => ipcRenderer.invoke('forge:open-folder', folder),
  copy: value => ipcRenderer.invoke('forge:copy', value),
  openLink: name => ipcRenderer.invoke('forge:link', name),
  onState: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('forge:state', listener);
    return () => ipcRenderer.removeListener('forge:state', listener);
  },
});
