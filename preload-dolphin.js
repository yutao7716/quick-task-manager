'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dolphinAPI', {
  toggle:      ()       => ipcRenderer.send('dolphin:toggle'),
  setPosition: (x, y)  => ipcRenderer.send('dolphin:setPosition', { x, y }),
  getPosition: ()       => ipcRenderer.invoke('dolphin:getPosition'),
  contextMenu: ()       => ipcRenderer.send('dolphin:contextMenu'),
});
