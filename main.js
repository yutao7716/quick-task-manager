'use strict';

const {
  app, BrowserWindow, Tray, Menu,
  ipcMain, nativeImage, screen,
  globalShortcut, clipboard,
} = require('electron');
const path = require('path');
const fs   = require('fs');

// ──────────────────────────────────────────────
// JSON ファイルストレージ（依存ライブラリ不要・確実動作）
// ──────────────────────────────────────────────
let tasksCache = [];
let dbFilePath = null;

function initDatabase() {
  dbFilePath = path.join(app.getPath('userData'), 'tasks.json');
  try {
    if (fs.existsSync(dbFilePath)) {
      const raw = fs.readFileSync(dbFilePath, 'utf8');
      tasksCache = JSON.parse(raw);
    }
  } catch (e) {
    console.error('タスクデータ読み込みエラー:', e);
    tasksCache = [];
  }
}

function saveDb() {
  if (!dbFilePath) return;
  try {
    fs.writeFileSync(dbFilePath, JSON.stringify(tasksCache, null, 2), 'utf8');
  } catch (e) {
    console.error('タスクデータ保存エラー:', e);
  }
}

// ──────────────────────────────────────────────
// ウィンドウ管理
// ──────────────────────────────────────────────
let mainWindow    = null;
let dolphinWindow = null;
let tray          = null;

/** イルカの位置を画面右下にリセット */
function resetDolphinPosition() {
  if (!dolphinWindow) return;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  dolphinWindow.setPosition(width - 84, height - 84);
}

/** フローティング・イルカウィンドウ */
function createDolphinWindow() {
  dolphinWindow = new BrowserWindow({
    width: 68,
    height: 68,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-dolphin.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  dolphinWindow.loadFile('dolphin.html');

  dolphinWindow.once('ready-to-show', () => {
    resetDolphinPosition();
    dolphinWindow.setAlwaysOnTop(true, 'floating', 1);
    dolphinWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    dolphinWindow.show();
  });

  // ready-to-show が発火しない場合のフォールバック
  setTimeout(() => {
    if (dolphinWindow && !dolphinWindow.isVisible()) {
      resetDolphinPosition();
      dolphinWindow.setAlwaysOnTop(true, 'floating', 1);
      dolphinWindow.show();
    }
  }, 3000);
}

/** タスクリスト・ウィンドウ */
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 360,
    height: 600,
    minWidth: 300,
    minHeight: 420,
    frame: false,
    resizable: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('renderer.html');

  mainWindow.on('blur', () => {
    if (!mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

/** タスクウィンドウをイルカの近くに表示 */
function showMainWindowNearDolphin() {
  if (!mainWindow) return;

  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const [mw, mh] = mainWindow.getSize();

  let mx, my;
  if (dolphinWindow) {
    const [dx, dy] = dolphinWindow.getPosition();
    const [dw]     = dolphinWindow.getSize();
    mx = dx + dw - mw;
    my = dy - mh - 8;
  } else {
    mx = sw - mw - 16;
    my = sh - mh - 16;
  }

  mx = Math.max(8, Math.min(mx, sw - mw - 8));
  my = Math.max(8, Math.min(my, sh - mh - 8));

  mainWindow.setPosition(mx, my);
  mainWindow.show();
  mainWindow.focus();
}

function toggleMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    showMainWindowNearDolphin();
  }
}

/** システムトレイ */
function createTray() {
  const iconPath = path.join(__dirname, 'icon.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('お手軽タスク管理');

  const buildMenu = () => Menu.buildFromTemplate([
    { label: 'タスクを開く',          click: () => showMainWindowNearDolphin() },
    { label: '🐬 イルカを右下に戻す', click: () => { resetDolphinPosition(); dolphinWindow?.show(); } },
    { type: 'separator' },
    { label: '終了',                   click: () => app.quit() },
  ]);

  tray.on('click',       toggleMainWindow);
  tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
}

// ──────────────────────────────────────────────
// IPC — データベース操作
// ──────────────────────────────────────────────

/** アクティブなタスクを並び順で返す */
ipcMain.handle('db:getTasks', () => {
  return tasksCache
    .filter(t => !t.deleted)
    .sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (a.task_order !== b.task_order) return (a.task_order ?? 0) - (b.task_order ?? 0);
      return new Date(a.created_at) - new Date(b.created_at);
    });
});

/** タスク追加 */
ipcMain.handle('db:addTask', (_, task) => {
  const now = task.created_at;
  const newTask = {
    id: task.id,
    title: task.title,
    completed: false,
    task_order: 0,
    spent_minutes: null,
    created_at: now,
    completed_at: null,
    updated_at: now,
    deleted: false,
  };
  tasksCache.push(newTask);
  saveDb();
  return newTask;
});

/** タスク完了 */
ipcMain.handle('db:completeTask', (_, { id, spent_minutes }) => {
  const now  = new Date().toISOString();
  const task = tasksCache.find(t => t.id === id);
  if (task) {
    task.completed     = true;
    task.spent_minutes = spent_minutes ?? null;
    task.completed_at  = now;
    task.updated_at    = now;
    saveDb();
  }
  return { id, completed: true, completed_at: now, spent_minutes };
});

/** 完了取り消し */
ipcMain.handle('db:uncompleteTask', (_, { id }) => {
  const now  = new Date().toISOString();
  const task = tasksCache.find(t => t.id === id);
  if (task) {
    task.completed    = false;
    task.completed_at = null;
    task.updated_at   = now;
    saveDb();
  }
  return { id };
});

/** 作業時間のみ更新 */
ipcMain.handle('db:updateSpentMinutes', (_, { id, spent_minutes }) => {
  const task = tasksCache.find(t => t.id === id);
  if (task) {
    task.spent_minutes = spent_minutes ?? null;
    task.updated_at    = new Date().toISOString();
    saveDb();
  }
});

/** タスク削除（論理削除） */
ipcMain.handle('db:deleteTask', (_, { id }) => {
  const task = tasksCache.find(t => t.id === id);
  if (task) {
    task.deleted    = true;
    task.updated_at = new Date().toISOString();
    saveDb();
  }
  return { id };
});

/** 並び順更新 */
ipcMain.handle('db:updateOrder', (_, { tasks }) => {
  const now = new Date().toISOString();
  for (const { id, order } of tasks) {
    const task = tasksCache.find(t => t.id === id);
    if (task) {
      task.task_order = order;
      task.updated_at = now;
    }
  }
  saveDb();
});

// ──────────────────────────────────────────────
// IPC — ウィンドウ制御
// ──────────────────────────────────────────────
ipcMain.on('window:hide',  () => mainWindow?.hide());

// ──────────────────────────────────────────────
// IPC — イルカ制御
// ──────────────────────────────────────────────
ipcMain.on('dolphin:toggle', () => toggleMainWindow());

ipcMain.on('dolphin:setPosition', (_, { x, y }) => {
  dolphinWindow?.setPosition(Math.round(x), Math.round(y));
});

ipcMain.handle('dolphin:getPosition', () =>
  dolphinWindow?.getPosition() ?? [0, 0]
);

ipcMain.on('dolphin:contextMenu', () => {
  const menu = Menu.buildFromTemplate([
    { label: 'タスクを開く / 閉じる', click: () => toggleMainWindow() },
    { type: 'separator' },
    { label: '終了', click: () => app.quit() },
  ]);
  menu.popup({ window: dolphinWindow });
});

// ──────────────────────────────────────────────
// アプリ起動
// ──────────────────────────────────────────────
app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.hide();

  initDatabase();   // 同期・シンプル
  createMainWindow();
  createDolphinWindow();
  createTray();

  // グローバルショートカット: テキストをコピー後 Ctrl/Cmd+Shift+T でクイック追加
  const ok = globalShortcut.register('CommandOrControl+Shift+T', () => {
    const text = clipboard.readText().trim().slice(0, 200);
    showMainWindowNearDolphin();
    if (text) mainWindow?.webContents.send('quick-add', text);
  });
  if (!ok) console.warn('グローバルショートカット登録失敗');
});

app.on('window-all-closed', (e) => e.preventDefault());

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  saveDb();
});
