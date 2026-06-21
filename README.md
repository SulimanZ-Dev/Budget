# Budget — Personal Finance Desktop App

A native Windows desktop personal budget app built with **Electron**, **React**, **Tailwind CSS**, **shadcn/ui**, and **Framer Motion**. All data is encrypted locally with **SQLCipher** in `%APPDATA%\BudgetApp\data_encrypted.db`.

## Security

Budget implements zero-knowledge encryption with envelope encryption, HMAC tamper detection, and Electron security hardening. See the full [**Threat Model (STRIDE)**](THREAT_MODEL.md) for detailed security analysis.

**Quick Security Facts:**
- 🔒 AES-256-GCM encryption via SQLCipher
- 🔑 Argon2id key derivation (64MB, 3 iterations)
- ✅ HMAC-SHA256 row signing for tamper detection
- 🛡️ Sandboxed renderer with Content Security Policy
- 🚫 No cloud dependencies, 100% local encryption

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

## Security Architecture

Budget implements **zero-knowledge, envelope-encrypted local storage** with tamper detection. All encryption happens locally—no cloud KMS, no telemetry, no external dependencies.

### Encryption Model

```
Master Password (user-provided)
    ↓ Argon2id (64MB, 3 iterations, parallelism 4)
Key Encryption Key (KEK) — transient, never stored
    ↓ AES-256-GCM
Data Encryption Key (DEK) — random, encrypted at rest
    ↓ SQLCipher (AES-256-GCM)
Encrypted Database (data_encrypted.db)
```

### Key Components

1. **Master Password & Key Derivation**
   - User sets a master password on first launch (minimum 8 characters)
   - KEK derived using Argon2id with strong parameters (64MB memory, 3 iterations)
   - Password is never stored—only the Argon2 salt is persisted
   - KEK exists only in memory during the session

2. **Envelope Encryption**
   - Random 256-bit DEK generated once, encrypted with KEK
   - Encrypted DEK stored in `%APPDATA%\BudgetApp\keystore.json`
   - SQLCipher encrypts the database using the DEK
   - Separate signing key for HMAC operations, also envelope-encrypted

3. **Tamper Detection (HMAC Row Signing)**
   - HMAC-SHA256 signatures on critical financial data (transactions, budgets, goals, categories)
   - Per-table signing keys derived from master signing key via HKDF
   - Integrity scan available in Settings to verify all signatures
   - Failed verifications logged to `integrity_warnings` table

4. **Secure Memory Handling**
   - Sensitive keys stored in Node `Buffer` objects
   - Buffers zeroed with `buffer.fill(0)` immediately after use
   - KEK and DEK cleared from memory when app locks or closes
   - API keys encrypted with machine-bound AES-256-GCM (replaces base64 fallback)

5. **Electron Hardening**
   - `contextIsolation: true` — renderer isolated from Node.js
   - `sandbox: true` — renderer runs in OS-level sandbox
   - `nodeIntegration: false` — no Node.js in renderer
   - Content Security Policy restricts script/style sources to `'self'`
   - All IPC payloads validated with Zod schemas

### Data Location

| Item | Path |
|------|------|
| Encrypted database | `%APPDATA%\BudgetApp\data_encrypted.db` |
| Keystore (encrypted DEK) | `%APPDATA%\BudgetApp\keystore.json` |
| Machine key (fallback) | `%APPDATA%\BudgetApp\.machine_key` |
| Backups | User-selected via Export in Settings |

### First-Time Setup

1. User creates master password (8+ characters recommended)
2. App derives KEK from password using Argon2id
3. App generates random DEK and signing key
4. DEK and signing key encrypted with KEK, stored in keystore
5. If unencrypted `data.db` exists, it's migrated to `data_encrypted.db` and securely deleted

### Unlock Flow

1. User enters master password
2. App derives KEK from password + stored salt
3. App decrypts DEK from keystore using KEK
4. App opens SQLCipher database with DEK
5. KEK and DEK held in memory (zeroed on lock/quit)

### Migration from Unencrypted

If you have an existing unencrypted `data.db`:
1. Set up encryption (creates master password)
2. App automatically migrates data to encrypted format
3. Original database securely deleted (overwritten with random data before unlink)
4. HMAC signatures backfilled for existing records

### Changing Master Password

Available in Settings → Security. Requires current password verification. Re-encrypts DEK and signing key with new KEK derived from new password.

### Recovery

**There is no password recovery.** If you forget your master password, your data cannot be decrypted. Choose a strong password you'll remember, or use a password manager.

## Data Recovery & Resilience

Budget implements multiple layers of data protection and recovery mechanisms.

### Automatic Recovery

**WAL (Write-Ahead Logging)**
- SQLCipher uses WAL mode for atomic commits
- Uncommitted changes automatically rolled back on crash
- Database recovers to last committed state on restart

**Event Sourcing**
- Complete audit trail in `transaction_events` table
- Rebuild corrupted data from immutable event log
- Use `rebuildTransactionsProjection()` to reconstruct state

**HMAC Integrity Verification**
- All financial records signed with HMAC-SHA256
- Automatic verification on every read
- Failed verifications logged to `integrity_warnings` table
- Manual scan available in Settings → Security

### Manual Recovery Procedures

**Scenario 1: Database Corruption**
```
1. Close Budget application
2. Navigate to %APPDATA%\BudgetApp\
3. Locate your most recent backup (from Settings → Export)
4. Rename data_encrypted.db to data_encrypted.db.corrupt
5. Copy your backup to data_encrypted.db
6. Delete data_encrypted.db-wal and data_encrypted.db-shm
7. Restart Budget and enter master password
```

**Scenario 2: Lost Master Password**
- **No recovery possible** - data is encrypted with zero-knowledge encryption
- Prevention: Use a password manager or write it down securely
- Alternative: Regular exports to unencrypted CSV (Settings → Export)

**Scenario 3: Corrupted Transaction Data**
```
1. Open Budget
2. Go to Settings → Security → Scan Integrity
3. Review integrity warnings
4. If many failures, use event sourcing recovery:
   - Open DevTools (Ctrl+Shift+I)
   - Console: await window.api.transactions.rebuildFromEvents()
5. Verify data restored correctly
```

**Scenario 4: WAL File Corruption**
```
1. Close Budget
2. Navigate to %APPDATA%\BudgetApp\
3. Delete data_encrypted.db-wal
4. Delete data_encrypted.db-shm
5. Restart Budget
6. SQLCipher will recover from last checkpoint
```

### Backup Strategy

**Automated Backups** (Recommended)
- Use Windows File History or OneDrive
- Include `%APPDATA%\BudgetApp\` in backup scope
- Encrypted database is safe to backup to cloud

**Manual Backups**
1. Settings → Export → Export Database
2. Choose secure location (encrypted USB, password manager)
3. Backup includes:
   - Encrypted database file
   - Keystore (encrypted DEK)
   - Machine key (if using fallback)

**Export to CSV** (Unencrypted)
- Settings → Export → Export to CSV
- Creates unencrypted backup of transactions
- Store securely (password-protected archive)
- Useful for migration or password recovery scenario

### Testing Resilience

Run resilience tests before major updates:
```bash
node scripts/test-resilience.js
```

Tests include:
- WAL interruption recovery
- Backup/restore verification
- Concurrent access handling
- Power loss simulation
- HMAC integrity verification
- Event sourcing recovery

### Data Location

| Item | Path | Backup Priority |
|------|------|-----------------|
| Encrypted database | `%APPDATA%\BudgetApp\data_encrypted.db` | **Critical** |
| Keystore | `%APPDATA%\BudgetApp\keystore.json` | **Critical** |
| Machine key | `%APPDATA%\BudgetApp\.machine_key` | High |
| WAL file | `%APPDATA%\BudgetApp\data_encrypted.db-wal` | Low (temporary) |
| SHM file | `%APPDATA%\BudgetApp\data_encrypted.db-shm` | Low (temporary) |

**Critical files must be backed up together** - database without keystore cannot be decrypted.

### Recovery Checklist

Before seeking help, try these steps:

- [ ] Check if backup exists (Settings → Export history)
- [ ] Verify master password is correct (try on backup copy)
- [ ] Run integrity scan (Settings → Security)
- [ ] Check for WAL/SHM files and try deleting them
- [ ] Review `integrity_warnings` table for specific issues
- [ ] Try event sourcing recovery if transactions corrupted
- [ ] Check Windows Event Viewer for crash logs
- [ ] Verify disk space available (low space can cause corruption)

### Getting Help

If recovery procedures don't work:
1. **Do not delete any files** - keep corrupted database
2. Check GitHub Issues for similar problems
3. Create new issue with:
   - Error messages from app logs
   - Steps that led to corruption
   - Recovery steps already attempted
   - Windows Event Viewer logs (if crash)
4. **Never share** your database file or keystore publicly

## Architecture

```
src/main/     Electron main process (SQLCipher, IPC, AI, currency, crypto)
  crypto/     Key management, envelope encryption, HMAC integrity
  db/         Database migration and SQLCipher initialization
  ipc/        IPC handlers with Zod validation
  commands/   CQRS write operations (event sourcing)
  queries/    CQRS read operations (optimized queries)
  events/     Event store for transaction history and audit trail
  plugins/    Plugin system for modular features
src/preload/  contextBridge API exposed as window.api
src/renderer/ React UI (never touches database directly, only via IPC)
```

### Event Sourcing & CQRS

Budget uses **event sourcing** for transaction management, providing:
- **Complete audit trail** — Every change recorded as an immutable event
- **Undo functionality** — Revert to any previous state by replaying events
- **Transaction history** — View detailed timeline of all modifications
- **CQRS separation** — Commands (writes) and Queries (reads) are separated for clarity

All transaction operations (create, update, delete, flag, recategorize) append events to an append-only `transaction_events` table. The current state is maintained in a materialized `transactions` view for performance.

### Plugin System

Budget features a **modular plugin architecture** for extending functionality:
- **Sandboxed execution** with explicit permissions
- **Hot reload** support for development
- **Type-safe APIs** with full TypeScript support
- **Event-driven** inter-plugin communication
- **Settings management** with validation

See [**PLUGINS.md**](PLUGINS.md) for complete plugin development documentation.

**Plugin Locations:**
- User plugins: `%APPDATA%\BudgetApp\plugins/`
- Built-in plugins: Habits, Subscriptions (can be disabled)

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development with hot reload |
| `npm run build` | Compile main + renderer |
| `npm run dist` | Build + NSIS installer |
| `npm run typecheck` | TypeScript check |

## License

MIT
