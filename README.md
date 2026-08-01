# Budget

Budget is a local-first Windows desktop personal finance app built with Electron, React, TypeScript, Zustand, Tailwind CSS, shadcn/ui, better-sqlite3/SQLCipher, and an event-sourced transaction architecture.

It is designed for private day-to-day budgeting: transactions, accounts, budgets, goals, subscriptions, savings, income, tax review, wealth tracking, imports/exports, and optional Claude-powered assistance. The app stores financial data locally in an encrypted database at `%APPDATA%\BudgetApp\data_encrypted.db`.

## Current Status

- Windows desktop app with NSIS installer output.
- Local encrypted storage with master-password unlock.
- Event-sourced/CQRS transaction write path with undo and projection repair.
- Account-aware transactions, imports, subscriptions, savings sources, and income sources.
- Verified with `npm test`, `npm run typecheck`, `npm run build`, and `npm run dist`.
- Latest installer output: `release\Budget Setup 1.1.0.exe`.

## Features

### Core Finance

- Dashboard with monthly stats, net worth, cash-flow forecast, runway warnings, spending streak, AI insight card, and recurring merchant notices.
- Accounts page for checking, savings, cash, and other accounts.
- Account starting balances plus computed account activity.
- Savings transactions subtract from everyday accounts and add to savings accounts when assigned there.
- Account-aware manual transactions, quick entry, editing, CSV import, OFX import, subscriptions, savings sources, and income sources.
- Paginated transaction list with filters, search, bulk actions, calendar view, history, undo, CSV export, CSV import, and OFX import.
- Budget categories with monthly entries, category detail drawer, normal-range bands, and factual variance explanations.
- Goals with target dates and feasibility planning against projected monthly surplus.
- Debt payoff tracking per person or company with original amount, paid amount, remaining balance, dated payment history, minimum payments, interest, and snowball/avalanche forecasts.
- Savings and recurring savings-source workflows.
- Income sources, recurring income checks, and manual income entries.
- Subscriptions with recurring billing, account assignment, hold state, tax-deductible marking, and transaction linking.
- Wealth tracking with snapshots, investment entries, ETF holdings, pension projection, and account-balance snapshot auto-fill. Remaining goal debts are deducted automatically from live net worth and new snapshots.
- Tax estimator for manual monthly overpayment/underpayment tracking.
- Accountant/tax review CSV export for deductible subscriptions, income, savings, and selected expense categories.
- Analytics for summary, month-over-month movement, heatmap, year-over-year view, and break-even.
- Year-end report and printable year summary.
- Habits and monthly mood tracking.

### Planning And Review

- Smart monthly review, unusual transaction detection, recurring-cost changes, due-date warnings, and subscription price history.
- Bank reconciliation with statement balance comparison and transaction verification.
- Cash-flow calendar, month-end expense forecast, budget suggestions, and optional category-budget rollover.
- Scenario planner for income, expense, and recurring-cost changes.
- Transaction splits, tags, shared expenses, receipt/PDF attachments, refund links, and automatic transfer-pair detection.
- Merchant normalization, saved transaction filters, uncategorized-transaction cleanup, and financial alerts.
- Month locks, data-quality status, change history with restore, and backup verification.
- Monthly and yearly financial reports in CSV and PDF.

### Automation And Intelligence

- Scheduler for recurring subscription, savings, and income billing checks.
- Recurring merchant detection for repeated non-subscription spending.
- Advanced categorization rules with priority, future-import-only mode, amount/type/category/description conditions, and nested AND/OR groups.
- Optional Claude assistant using `claude-sonnet-4-20250514`.
- Optional AI category suggestions, insights, weekly tips, and anomaly detection when an Anthropic API key is saved.

### Data And Connectivity

- CSV preview/import with column mapping and account assignment.
- OFX import with account assignment.
- Transaction CSV export.
- JSON backup/import.
- Encrypted database export/import.
- Yearly tax/accountant CSV export.
- Currency display support for SEK, EUR, and USD with rates from Frankfurter.

### Privacy, Security, And Reliability

- Dedicated Privacy page showing sensitive data locations, lock/unlock state, API key presence, last backup date, and integrity warning count.
- Local database encryption through SQLCipher.
- Master-password based keystore.
- HMAC row signing for critical financial tables.
- Integrity scan, warning review, warning clear, and HMAC backfill tools.
- Data repair from transaction events.
- Electron renderer hardening with context isolation, sandboxing, no renderer Node integration, and a preload API.
- Native app dialogs instead of browser `alert()`/`confirm()`.
- Large-dataset transaction pagination and SQLite indexes for common filters.

### Plugin System

- Plugin registry and plugin manager.
- Built-in plugin support for app modules.
- User plugins under `%APPDATA%\BudgetApp\plugins`.
- See [PLUGINS.md](PLUGINS.md) for plugin authoring details.

## Requirements

- Windows 10 or Windows 11.
- Node.js 20+.
- npm.
- Visual Studio Build Tools may be needed when native modules are rebuilt.

Native dependencies include `better-sqlite3`, `better-sqlite3-multiple-ciphers`, `argon2`, and `keytar`.

## Setup

```bash
npm install
npm run dev
```

The app launches through `electron-vite` in development.

## Build

Create a production build:

```bash
npm run build
```

Create the Windows installer and unpacked app:

```bash
npm run dist
```

`npm run dist` runs `scripts/prepare-dist.js`, which:

1. Removes stale `out/` and `release/` artifacts.
2. Runs a fresh production build.
3. Verifies build output is newer than source files.
4. Writes `release\build-fingerprint.json`.
5. Runs `electron-builder --win`.

Outputs:

| Artifact | Path |
| --- | --- |
| Installer | `release\Budget Setup 1.1.0.exe` |
| Unpacked executable | `release\win-unpacked\Budget.exe` |
| Build fingerprint | `release\build-fingerprint.json` |

Build an unpacked directory only:

```bash
npm run dist:dir
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start Electron/Vite development mode |
| `npm run build` | Build main, preload, and renderer bundles |
| `npm run dist:prepare` | Clean, build, verify freshness, and write build fingerprint |
| `npm run dist` | Build and package the Windows NSIS installer |
| `npm run dist:dir` | Build unpacked Windows app output |
| `npm run typecheck` | Run TypeScript checks for main and renderer |
| `npm test` | Run Vitest test suite |
| `npm run test:watch` | Run Vitest in watch mode |

## First Launch And Encryption

On first launch, the app creates an encrypted local profile.

1. Create a master password.
2. The app derives a key-encryption key using Argon2id.
3. A random data-encryption key and signing key are generated.
4. Keys are envelope-encrypted and stored in `%APPDATA%\BudgetApp\keystore.json`.
5. The SQLCipher database is created at `%APPDATA%\BudgetApp\data_encrypted.db`.

If an older unencrypted `data.db` exists, the app can migrate it to `data_encrypted.db` and backfill HMAC signatures.

There is no master-password recovery. If the master password is lost, the encrypted database cannot be decrypted.

## Data Locations

| Item | Path |
| --- | --- |
| Encrypted database | `%APPDATA%\BudgetApp\data_encrypted.db` |
| Keystore | `%APPDATA%\BudgetApp\keystore.json` |
| Machine key fallback | `%APPDATA%\BudgetApp\.machine_key` |
| User plugins | `%APPDATA%\BudgetApp\plugins\` |
| Manual database exports | User-selected path |
| Installer output | `release\Budget Setup 1.1.0.exe` |

The Privacy page in the app also shows the active app-data path and encrypted database path.

## Accounts Model

Accounts are a first-class model for checking, savings, cash, and other balances.

- Each account has a name, type, currency, archive state, and starting balance.
- Existing profiles are migrated additively with `opening_balance` defaulting to `0`.
- Existing transactions, subscriptions, savings sources, and income sources are assigned to the default `Main` account when needed.
- Balances are computed, not manually stored as mutable totals.
- Final account balance is `opening_balance + computed transaction activity`.
- Income adds to account activity.
- Expenses, transfers, and savings subtract from checking/cash/other accounts.
- Savings transactions add to savings-type accounts when assigned there.

This keeps transaction history as the source of truth while still allowing real-world bank balances that existed before the app history began.

## AI Assistant

AI features are optional. The app works without an API key.

To enable AI:

1. Create an Anthropic API key.
2. Open Settings.
3. Save the key in the AI section.

The app uses `claude-sonnet-4-20250514` for chat, insights, tips, and category suggestions. API keys are stored through the local keychain service and are never displayed in the UI. The Privacy page only reports whether a key is present.

## Backup, Export, And Recovery

Recommended backup paths:

- Use Settings or Privacy to export the encrypted database.
- Export transactions to CSV for portable, unencrypted transaction backups.
- Export JSON for full app-level data transfer.
- Use the tax/accountant export for yearly review.

Critical encrypted profile files should be backed up together:

- `data_encrypted.db`
- `keystore.json`
- `.machine_key` if the fallback key path is in use

Manual recovery options:

- Restore a known-good encrypted database export.
- Run the integrity scanner to find tampered or unsigned rows.
- Backfill HMACs when appropriate.
- Repair transaction projection from the event log.
- Delete stale WAL/SHM files only while the app is closed.

Resilience helper:

```bash
node scripts/test-resilience.js
```

## Security Notes

Budget is local-first and does not require cloud hosting.

Security measures include:

- SQLCipher encrypted database.
- Argon2id master-password derivation.
- Envelope-encrypted data and signing keys.
- HMAC-SHA256 signing for critical financial rows.
- Integrity warnings persisted in `integrity_warnings`.
- Lock/unlock flow that clears keys from memory on lock/quit.
- Electron context isolation and sandboxed renderer.
- Preload-only IPC surface for renderer access.
- Optional auto-updater disabled unless `BUDGET_AUTO_UPDATE=true`.

See [THREAT_MODEL.md](THREAT_MODEL.md) for the full STRIDE threat model.

## Auto Updates

`electron-updater` is scaffolded in `src/main/updater.ts`, but it is disabled by default.

To enable update checks in packaged builds:

1. Configure `build.publish.url` in `package.json`.
2. Run the packaged app with `BUDGET_AUTO_UPDATE=true`.

## Code Signing

The current local build skips signing when no certificate is configured. For distribution, configure signing through electron-builder using a certificate file or `CSC_LINK` and `CSC_KEY_PASSWORD`.

## Architecture

```text
src/main/       Electron main process, database, IPC, services, crypto
src/main/crypto Key management, envelope encryption, HMAC integrity
src/main/db     SQLCipher migration helpers
src/main/events Event store for transaction history
src/main/commands CQRS transaction write operations
src/main/queries  CQRS transaction read operations
src/main/ipc    IPC handlers
src/main/plugins Plugin manager
src/preload/    contextBridge API exposed as window.api
src/renderer/   React UI
scripts/        packaging and resilience helpers
resources/      app resources and icon assets
```

Transactions use an event-sourced write path. Create, update, delete, flag, recategorize, import, and undo operations append events, and the current transaction table acts as a materialized projection for fast reads.

## Verification

Recent full verification:

```bash
npm run typecheck
npm test
npm run build
npm run dist
```

Expected current test state:

- 7 Vitest files passing.
- 33 tests passing.
- Production build succeeds.
- Windows installer is generated in `release\`.

The build may print a Vite warning about `database-encrypted.ts` being both dynamically and statically imported. This warning is currently non-fatal and packaging succeeds.

## Related Docs

- [IMPLEMENTATION_LOG.md](IMPLEMENTATION_LOG.md)
- [QA_LOG.md](QA_LOG.md)
- [THREAT_MODEL.md](THREAT_MODEL.md)
- [PLUGINS.md](PLUGINS.md)
- [CHANGELOG.md](CHANGELOG.md)

## License

MIT
