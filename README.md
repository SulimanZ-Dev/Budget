# Budget — Personal Finance Desktop App

A native Windows desktop personal budget app built with **Electron**, **React**, **Tailwind CSS**, **shadcn/ui**, and **Framer Motion**. All data is stored locally with **better-sqlite3** in `%APPDATA%\BudgetApp\data.db`.

## Features

- Dashboard with net worth, spending, savings rate, streak, charts, and AI insights
- Card-based budget categories with month selector and inflation adjustment
- Banking-style transaction list with filters, CSV import, calendar view, and bulk actions
- Goals (savings, debt, emergency fund, FIRE)
- Wealth tracking, investments, pension projection
- Analytics, subscriptions, income streams, habits & mood
- Built-in **Claude AI** financial assistant (`claude-sonnet-4-20250514`)
- SEK default with EUR/USD display via [Frankfurter](https://www.frankfurter.app/)
- Keyboard shortcuts: `Ctrl+N`, `Ctrl+K`, `Ctrl+,`, `Ctrl+D`, `Ctrl+F`, `Ctrl+Shift+A`

## Requirements

- Node.js 20+
- Windows 10/11 (for building the installer)
- Visual Studio Build Tools (for `better-sqlite3` and `keytar` native modules)

## Setup

```bash
cd Budget
npm install
npm run dev
```

## Build Windows installer

```bash
npm run dist
```

The NSIS `.exe` installer is output to `release/`.

### App icon

Place a **512×512 PNG** at `resources/icon.png`, then convert to ICO for Windows:

```bash
# Using ImageMagick (optional)
magick convert resources/icon.png -define icon:auto-resize=256,128,64,48,32,16 resources/icon.ico
```

`electron-builder` uses `resources/icon.ico` for the Windows target.

### Code signing

To sign the installer for distribution, add to `package.json` under `build.win`:

```json
"certificateFile": "path/to/certificate.pfx",
"certificatePassword": "your-password"
```

Or set environment variables `CSC_LINK` and `CSC_KEY_PASSWORD` before running `npm run dist`. See [electron-builder code signing](https://www.electron.build/code-signing).

### Auto-updater

`electron-updater` is scaffolded in `src/main/updater.ts` but **disabled by default**. Enable by setting `BUDGET_AUTO_UPDATE=true` and configuring `build.publish.url` in `package.json`.

## AI Assistant

1. Get an API key from [Anthropic Console](https://console.anthropic.com/)
2. Open **Settings → AI Assistant** and save your key
3. Keys are stored in the **Windows Credential Manager** via `keytar` (falls back to encoded local storage if keytar is unavailable)

## Data location

| Item | Path |
|------|------|
| SQLite database | `%APPDATA%\BudgetApp\data.db` |
| Backups | User-selected via Export in Settings |

## Architecture

```
src/main/     Electron main process (SQLite, IPC, AI, currency)
src/preload/  contextBridge API exposed as window.api
src/renderer/ React UI (never touches SQLite directly)
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development with hot reload |
| `npm run build` | Compile main + renderer |
| `npm run dist` | Build + NSIS installer |
| `npm run typecheck` | TypeScript check |

## License

MIT
