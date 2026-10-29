'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  init: () => ipcRenderer.invoke('app:init'),
  save: (payload) => ipcRenderer.send('data:save', payload),
  bounds: () => ipcRenderer.invoke('win:bounds'),
  setBounds: (b) => ipcRenderer.send('win:set-bounds', b),
  pin: (on) => ipcRenderer.send('win:pin', !!on),
  hide: () => ipcRenderer.send('win:hide'),
  quit: () => ipcRenderer.send('app:quit'),
  launchAtLogin: (on) => ipcRenderer.send('app:launch-at-login', !!on),
  openDataFolder: () => ipcRenderer.send('app:open-data'),
  onState: (fn) => ipcRenderer.on('state:changed', (_e, payload) => fn(payload)),
});
