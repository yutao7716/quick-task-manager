# 🐬 お手軽タスク管理アプリ v1

デスクトップ常駐型のシンプルなタスク管理アプリです。

## 起動方法

### 初回セットアップ

ターミナルでこのフォルダを開き、以下を実行してください。

```bash
cd /Users/yutaka/Documents/TaskApp/タスク管理アプリ
npm install
npm start
```

### 2回目以降

```bash
cd /Users/yutaka/Documents/TaskApp/タスク管理アプリ
npm start
```

## 使い方

| 操作 | 方法 |
|------|------|
| アプリを開く | システムトレイのアイコンをクリック |
| タスクを追加 | 入力欄にタイトルを入力して Enter |
| タスクを完了 | チェックボックスをクリック → 作業時間を入力 |
| 並び替え | 未完了タスクをドラッグ＆ドロップ |
| タスクを削除 | タスクにマウスを合わせて ✕ をクリック |
| アプリを隠す | ✕ ボタン または アイコンをクリック（常駐継続） |
| 終了 | トレイアイコンを右クリック → 終了 |

## データ保存場所

SQLite データベースは以下に自動保存されます。

- macOS: `~/Library/Application Support/quick-task-manager/tasks.db`
- Windows: `%APPDATA%\quick-task-manager\tasks.db`

## 技術構成

- Electron（デスクトップアプリ基盤）
- sql.js（SQLite、ネイティブコンパイル不要）
- Vanilla JS + HTML/CSS（UI）

## 必要環境

- Node.js 18以上
- npm 9以上
