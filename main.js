'use strict';

const {
  app, BrowserWindow, Tray, Menu,
  ipcMain, nativeImage, screen,
  globalShortcut, clipboard, dialog,
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
  const backupPath = dbFilePath + '.bak';

  // 本体 → バックアップの順に読み込みを試みる（破損時フォールバック）
  for (const p of [dbFilePath, backupPath]) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          tasksCache = parsed;
          if (p === backupPath) {
            console.warn('本体が読めなかったためバックアップから復元しました');
          }
          return;
        }
      }
    } catch (e) {
      console.error(`タスクデータ読み込みエラー (${path.basename(p)}):`, e);
    }
  }
  tasksCache = [];
}

function saveDb() {
  if (!dbFilePath) return;
  const tmpPath    = dbFilePath + '.tmp';
  const backupPath = dbFilePath + '.bak';
  try {
    const data = JSON.stringify(tasksCache, null, 2);
    // 1) 一時ファイルに書いて flush
    const fd = fs.openSync(tmpPath, 'w');
    try {
      fs.writeFileSync(fd, data, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    // 2) 既存の本体をバックアップへ退避
    if (fs.existsSync(dbFilePath)) {
      fs.copyFileSync(dbFilePath, backupPath);
    }
    // 3) 一時ファイルをアトミックに本体へ差し替え
    fs.renameSync(tmpPath, dbFilePath);
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
    { label: 'タスクをエクスポート…', click: () => exportFromMenu() },
    { label: 'タスクをインポート…',   click: () => importFromMenu() },
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
// IPC — エクスポート / インポート
// ──────────────────────────────────────────────

/** 1件のタスクを正規化（インポート時の防御） */
function normalizeTask(t) {
  if (!t || typeof t !== 'object') return null;
  if (typeof t.id !== 'string' || typeof t.title !== 'string') return null;
  let spent = t.spent_minutes;
  if (spent != null) {
    spent = parseInt(spent, 10);
    if (isNaN(spent)) spent = null;
    else spent = Math.min(Math.max(spent, 0), 9999);
  }
  return {
    id: t.id,
    title: String(t.title).slice(0, 500),
    completed: Boolean(t.completed),
    task_order: Number.isFinite(t.task_order) ? t.task_order : 0,
    spent_minutes: spent ?? null,
    created_at: t.created_at || new Date().toISOString(),
    completed_at: t.completed_at || null,
    updated_at: t.updated_at || new Date().toISOString(),
    deleted: Boolean(t.deleted),
  };
}

/** エクスポート本体（ダイアログ→書き出し） */
async function doExport() {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'タスクをエクスポート',
    defaultPath: `tasks-backup-${stamp}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  fs.writeFileSync(filePath, JSON.stringify(tasksCache, null, 2), 'utf8');
  return { ok: true, count: tasksCache.filter(t => !t.deleted).length };
}

/** エクスポート: 保存ダイアログでJSONを書き出す */
ipcMain.handle('data:export', async () => {
  try {
    return await doExport();
  } catch (e) {
    console.error('エクスポートエラー:', e);
    return { ok: false, error: e.message };
  }
});

/** トレイメニュー用ラッパー */
async function exportFromMenu() {
  try { await doExport(); }
  catch (e) { console.error('エクスポートエラー:', e); }
}

async function importFromMenu() {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'タスクをインポート',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths || !filePaths[0]) return;
    const parsed = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    if (!Array.isArray(parsed)) {
      dialog.showMessageBox(mainWindow, { type: 'error', message: 'ファイル形式が正しくありません。' });
      return;
    }
    const tasks = parsed.map(normalizeTask).filter(Boolean);
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['キャンセル', 'インポート'],
      defaultId: 1,
      cancelId: 0,
      message: '現在のタスクを置き換えますか？',
      detail: `読み込むタスク: ${tasks.filter(t => !t.deleted).length}件\n先に現在のデータをエクスポートしておくことを推奨します。`,
    });
    if (response !== 1) return;
    tasksCache = tasks;
    saveDb();
    mainWindow?.webContents.send('data:reloaded');
  } catch (e) {
    console.error('インポートエラー:', e);
    dialog.showMessageBox(mainWindow, { type: 'error', message: 'インポートに失敗しました。' });
  }
}

/** インポート(読込のみ): ファイルを選んで検証し、内容を返す（まだ適用しない） */
ipcMain.handle('data:importRead', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'タスクをインポート',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };
    const raw = fs.readFileSync(filePaths[0], 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { ok: false, error: 'ファイル形式が正しくありません（配列ではありません）' };
    }
    const tasks = parsed.map(normalizeTask).filter(Boolean);
    return { ok: true, tasks, count: tasks.filter(t => !t.deleted).length };
  } catch (e) {
    console.error('インポート読込エラー:', e);
    return { ok: false, error: 'ファイルを読み込めませんでした（JSONが壊れている可能性があります）' };
  }
});

/** インポート(適用): 検証済みデータで全置き換え */
ipcMain.handle('data:importApply', (_, { tasks }) => {
  if (!Array.isArray(tasks)) return { ok: false, error: '不正なデータ' };
  tasksCache = tasks.map(normalizeTask).filter(Boolean);
  saveDb();
  return { ok: true, count: tasksCache.filter(t => !t.deleted).length };
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
