'use strict';

const {
  app, BrowserWindow, Tray, Menu,
  ipcMain, nativeImage, screen,
  globalShortcut, clipboard,
} = require('electron');
const path = require('path');
const fs   = require('fs');

// ──────────────────────────────────────────────
// SQLite (sql.js — ネイティブコンパイル不要)
// ──────────────────────────────────────────────
let db         = null;
let dbFilePath = null;

async function initDatabase() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({
    locateFile: (file) =>
      path.join(__dirname, 'node_modules', 'sql.js', 'dist', file),
  });

  dbFilePath = path.join(app.getPath('userData'), 'tasks.db');

  if (fs.existsSync(dbFilePath)) {
    db = new SQL.Database(fs.readFileSync(dbFilePath));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT    PRIMARY KEY,
      title         TEXT    NOT NULL,
      completed     INTEGER NOT NULL DEFAULT 0,
      task_order    INTEGER NOT NULL DEFAULT 0,
      spent_minutes INTEGER,
      created_at    TEXT    NOT NULL,
      completed_at  TEXT,
      updated_at    TEXT    NOT NULL,
      deleted       INTEGER NOT NULL DEFAULT 0
    )
  `);
  saveDb();
}

function saveDb() {
  if (!db || !dbFilePath) return;
  fs.writeFileSync(dbFilePath, Buffer.from(db.export()));
}

function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  stmt.bind(params);
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function dbRun(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

// ──────────────────────────────────────────────
// ウィンドウ管理
// ──────────────────────────────────────────────
let mainWindow   = null;
let dolphinWindow = null;
let tray         = null;

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
    backgroundColor: '#00000000',   // 透明背景を明示
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    show: false,                     // 準備完了まで非表示
    // focusable: false は macOS でクリックに問題が出るため除去
    webPreferences: {
      preload: path.join(__dirname, 'preload-dolphin.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  dolphinWindow.loadFile('dolphin.html');

  dolphinWindow.once('ready-to-show', () => {
    resetDolphinPosition();
    // macOS では 'floating' が最も安定して最前面に表示される
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

  // フォーカスを失ったら非表示（DevTools 開発中は除く）
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
    const [dw, dh] = dolphinWindow.getSize();
    // イルカの左上に表示
    mx = dx + dw - mw;
    my = dy - mh - 8;
  } else {
    mx = sw - mw - 16;
    my = sh - mh - 16;
  }

  // 画面内にクランプ
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

/** システムトレイ（サブ手段） */
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

  const menu = Menu.buildFromTemplate([
    { label: 'タスクを開く', click: () => showMainWindowNearDolphin() },
    { label: '🐬 イルカを右下に戻す', click: () => {
        resetDolphinPosition();
        dolphinWindow?.show();
      }
    },
    { type: 'separator' },
    { label: '終了', click: () => app.quit() },
  ]);
  tray.on('click', toggleMainWindow);
  tray.on('right-click', () => tray.popUpContextMenu(menu));
}

// ──────────────────────────────────────────────
// IPC — データベース操作
// ──────────────────────────────────────────────

ipcMain.handle('db:getTasks', () =>
  dbAll('SELECT * FROM tasks WHERE deleted=0 ORDER BY completed ASC, task_order ASC, created_at ASC')
);

ipcMain.handle('db:addTask', (_, task) => {
  dbRun(
    `INSERT INTO tasks
       (id, title, completed, task_order, spent_minutes, created_at, completed_at, updated_at, deleted)
     VALUES (?, ?, 0, ?, NULL, ?, NULL, ?, 0)`,
    [task.id, task.title, task.order, task.created_at, task.created_at]
  );
  return task;
});

ipcMain.handle('db:completeTask', (_, { id, spent_minutes }) => {
  const now = new Date().toISOString();
  dbRun(
    'UPDATE tasks SET completed=1, spent_minutes=?, completed_at=?, updated_at=? WHERE id=?',
    [spent_minutes ?? null, now, now, id]
  );
  return { id, completed: 1, completed_at: now, spent_minutes };
});

ipcMain.handle('db:uncompleteTask', (_, { id }) => {
  const now = new Date().toISOString();
  dbRun('UPDATE tasks SET completed=0, completed_at=NULL, updated_at=? WHERE id=?', [now, id]);
  return { id };
});

ipcMain.handle('db:updateSpentMinutes', (_, { id, spent_minutes }) => {
  const now = new Date().toISOString();
  dbRun('UPDATE tasks SET spent_minutes=?, updated_at=? WHERE id=?', [spent_minutes ?? null, now, id]);
});

ipcMain.handle('db:deleteTask', (_, { id }) => {
  dbRun('UPDATE tasks SET deleted=1, updated_at=? WHERE id=?', [new Date().toISOString(), id]);
  return { id };
});

ipcMain.handle('db:updateOrder', (_, { tasks }) => {
  const now = new Date().toISOString();
  for (const t of tasks) {
    db.run('UPDATE tasks SET task_order=?, updated_at=? WHERE id=?', [t.order, now, t.id]);
  }
  saveDb();
});

// ──────────────────────────────────────────────
// IPC — ウィンドウ制御
// ──────────────────────────────────────────────
ipcMain.on('window:hide',  () => mainWindow?.hide());
ipcMain.on('window:close', () => mainWindow?.hide());

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
app.whenReady().then(async () => {
  // macOS のドックアイコンを非表示
  if (process.platform === 'darwin') app.dock?.hide();

  await initDatabase();
  createMainWindow();
  createDolphinWindow();
  createTray();

  // ─── グローバルショートカット ───────────────────
  // Ctrl/Cmd + Shift + T → クリップボードのテキストをタスクに追加
  const shortcut = 'CommandOrControl+Shift+T';
  const registered = globalShortcut.register(shortcut, () => {
    const text = clipboard.readText().trim().slice(0, 200);
    // タスクウィンドウを開いてテキストを事前入力
    showMainWindowNearDolphin();
    if (text) {
      mainWindow?.webContents.send('quick-add', text);
    }
  });

  if (!registered) {
    console.warn('グローバルショートカット登録失敗:', shortcut);
  }
});

app.on('window-all-closed', (e) => e.preventDefault());

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (db) { saveDb(); db.close(); }
});
