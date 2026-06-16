'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('taskAPI', {
  // データベース操作
  getTasks:           ()     => ipcRenderer.invoke('db:getTasks'),
  addTask:            (task) => ipcRenderer.invoke('db:addTask', task),
  completeTask:       (data) => ipcRenderer.invoke('db:completeTask', data),
  uncompleteTask:     (data) => ipcRenderer.invoke('db:uncompleteTask', data),
  updateSpentMinutes: (data) => ipcRenderer.invoke('db:updateSpentMinutes', data),
  deleteTask:         (data) => ipcRenderer.invoke('db:deleteTask', data),
  updateOrder:        (data) => ipcRenderer.invoke('db:updateOrder', data),

  // エクスポート / インポート
  exportData:  ()      => ipcRenderer.invoke('data:export'),
  importRead:  ()      => ipcRenderer.invoke('data:importRead'),
  importApply: (data)  => ipcRenderer.invoke('data:importApply', data),

  // ウィンドウ
  hideWindow: () => ipcRenderer.send('window:hide'),

  // グローバルショートカット経由のクイック追加
  onQuickAdd: (callback) =>
    ipcRenderer.on('quick-add', (_event, text) => callback(text)),

  // メニューからのインポート後の再読込通知
  onDataReloaded: (callback) =>
    ipcRenderer.on('data:reloaded', () => callback()),
});
