# 配布用インストーラーのビルド手順

electron-builder を使って、Mac（.dmg）と Windows（.exe）のインストーラーを作成します。
**署名なし（無料・自分用）** の構成です。

---

## 事前準備（共通・1回だけ）

1. [Node.js](https://nodejs.org/)（LTS版）をインストール
2. プロジェクトフォルダで依存パッケージをインストール:

```bash
npm install
```

> `electron-builder` が追加されたので、初回は `npm install` が必要です。

---

## Windows 用インストーラー（.exe）

**Windows マシン上で**実行します:

```bash
npm run dist:win
```

- 生成物: `dist/QuickTaskManager Setup 1.0.0.exe`（NSIS インストーラー）
- インストール先を選べる／デスクトップ・スタートメニューにショートカットを作成する設定です。

---

## Mac 用インストーラー（.dmg）

**Mac 上で**実行します:

```bash
npm run dist:mac
```

- 生成物: `dist/QuickTaskManager-1.0.0-arm64.dmg`（Apple Silicon用）と `-x64.dmg`（Intel用）
- DMG を開いてアプリを Applications にドラッグすればインストール完了です。

### ⚠️ 署名なしの注意点（Mac）

署名・公証していないため、初回起動時に「開発元を検証できません」という警告が出ます。回避方法:

- アプリを右クリック →「開く」→ ダイアログで「開く」を選択
- または「システム設定 → プライバシーとセキュリティ」で「このまま開く」を許可

自分用・社内配布なら問題ありませんが、不特定多数へ配るなら Apple Developer Program（$99/年）での署名・公証が必要です。

---

## 両方まとめてビルド

各 OS のインストーラーは原則その OS 上でビルドします（Mac の .dmg は Mac でのみ生成可能）。
お使いのマシンで:

```bash
npm run dist
```

を実行すると、そのOS向けのターゲットがビルドされます。

---

## 補足

- アイコンは `build/icon.png`（1024×1024）を使用。electron-builder が Windows用 `.ico` / Mac用 `.icns` に自動変換します。差し替えたい場合はこのファイルを置き換えてください。
- `dist/` フォルダはビルド成果物用で、`.gitignore` に登録済みのため Git にはコミットされません。
- アプリのデータ（tasks.json）は各OSのユーザーデータ領域に保存されます:
  - Windows: `%APPDATA%\quick-task-manager\tasks.json`
  - Mac: `~/Library/Application Support/quick-task-manager/tasks.json`
