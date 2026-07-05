# Implementation Log

## Session: 2026-07-05 - Dialog Focus Fix & Demo Data

### Shared untypeable-app investigation
- **Reported trigger points checked**: Categorization Rules apply, Settings > Data card buttons, and Settings > Backup card buttons.
- **Data card button map**: Export SQLite (Electron save dialog), Export JSON (Electron save dialog), Import JSON (Electron open dialog), Import SQLite (Electron open dialog), Repair from events (confirmation), Refresh rates (completion notice), Year-end PDF (route change), Lock database (locks/reloads to unlock screen), Wipe data & restart (confirmation), Run Demo (new completion notice).
- **Evidence before fix**: Automated Electron run against a temporary app-data profile captured no renderer `console` or `pageerror` entries. The only dialog events were blocking native renderer dialogs from `alert()`/`confirm()`: `Auto-categorized 1 transactions.`, `Rebuild the transactions table from event history? Data loss is possible if events are incomplete.`, `Exchange rates refreshed.`, and `Delete ALL data and start fresh? This cannot be undone.`
- **Root cause found**: The shared mechanism across the reported paths was renderer-native blocking dialogs (`window.alert`/`window.confirm`) mixed with Electron file dialogs. These dialogs are outside React/Radix focus management and can leave Electron focus in a bad state on some Windows close paths even when the app has not crashed.
- **Fix**: Added a shared React `AppDialogProvider`/`useAppDialog` and moved the reported Settings/Data and Categorization Rules paths off native `alert()`/`confirm()`. This keeps confirmation/notice focus lifecycle inside the app's Radix dialog/focus-trap system and releases focus predictably after close.
- **Verification after fix**: Rebuilt with `npm.cmd run build`, launched Electron with a disposable app-data folder, and clicked every listed Data button plus Backup buttons. After each action, a Settings input accepted typed probe text and the DOM had zero open dialogs. Lock database reloaded to the unlock screen and the password field accepted typing.
- **Remaining note**: Full `npm.cmd run typecheck` is still blocked by pre-existing unrelated TypeScript errors in `src/main/plugins/plugin-manager.ts`; renderer typecheck is also blocked by pre-existing unrelated errors in `ai-assistant.tsx` and `subscriptions.tsx`.

### Demo data generator
- **Feature**: Added a Settings > Data `Run Demo` button.
- **Implementation**: `generateDemoData()` creates 5-8 subscriptions, 30-50 transactions across the last 3-6 months, and 1-2 goals with randomized names, amounts, dates, and descriptions. It inserts through existing renderer APIs: `subscriptions.create`, `transactions.create`, and `goals.create`.
- **Verification**: In the disposable Electron profile, first click added 5 subscriptions, 31 transactions, and 2 goals; second click added 8 subscriptions, 32 transactions, and 2 goals. Counts increased from `txs=1/subs=0/goals=0` to `txs=32/subs=5/goals=2`, then `txs=64/subs=13/goals=4`. Dashboard, Transactions, Budget, and Subscriptions pages all loaded afterward.

## Session: 2026-07-05 — Bug 2 & Bug 3 Fixes

### Bug 2: Delete Toast State Fix
- **Problem**: Toast state was scoped inside `TransactionRow` component, so when a transaction was deleted, the row unmounted and the toast disappeared immediately.
- **Fix**: Moved toast state to `TransactionsPage` level, rendered in a fixed-position container, and passed `onDeleted(undo)` callback down to `TransactionRow`.
- **Status**: ✅ Fixed and committed (commit `3cbf748`)
- **Files changed**: `src/renderer/src/pages/transactions.tsx`, `src/renderer/src/components/transactions/transaction-row.tsx`

### Bug 3: Scheduler Duplicate Prevention Fix
- **Problem**: 
  1. `scheduler.ts` used raw SQL INSERT statements that bypassed event sourcing
  2. `subscriptions:checkBilling` guard checked `description/date/amount` instead of subscription-specific marker
- **Fix**: 
  1. Updated `scheduler.ts` to use `createTransaction()` command for all billing types (ensures event sourcing)
  2. Added `subscription:{id}` notes marker and updated guard to check by this marker
  3. Wrapped entire `runBillingChecks()` in a transaction for atomicity
- **Status**: ✅ Fixed and committed (commit `de861cd`)
- **Files changed**: `src/main/ipc/handlers.ts`, `src/main/services/scheduler.ts`

### Bug 4: Scheduler SQL Parameter Mismatch
- **Problem**: Previous fix in commit `de861cd` only updated `ipc/handlers.ts` but missed `scheduler.ts`. The scheduler still used `description/date/amount` guard, causing duplicate transactions on subscription rename, leading to `RangeError: Too many parameter values` crashes.
- **Fix**: Updated `scheduler.ts` to use `notes = ?` guard with `subscription:{id}` marker, matching `handlers.ts`.
- **Status**: ✅ Fixed and committed (commit `a5fc00f`)
- **Files changed**: `src/main/services/scheduler.ts`

### Bug 5: Undo doesn't restore deleted transaction
- **Problem**: 
  1. `scheduler.ts` `subscriptions:checkBilling` guard still used `description/date/amount` instead of `notes` marker, causing duplicate transactions on subscription rename → `RangeError: Too many parameter values`
  2. `handlers.ts` `subscriptions:checkBilling` passed 3 SQL parameters but query only had 2 placeholders (notes/date)
  3. `transaction-commands.ts` `undoLastChange()` only ran UPDATE even when undoing a delete — but the row was already deleted, so UPDATE silently did nothing
- **Fix**:
  1. `scheduler.ts`: changed guard to `WHERE notes = ? AND date = ?` with `subscription:{id}`
  2. `handlers.ts`: removed extra `'expense'` parameter from `.get()`
  3. `transaction-commands.ts`: `undoLastChange()` now checks if row exists — if missing, INSERTs to restore deleted transaction
- **Verification**: `npm run build` succeeds. No automated tests exist in this repo, so runtime behavior was not executed end-to-end.
- **Status**: ✅ Fixed and committed (commit `688ce76`)
- **Files changed**: `src/main/services/scheduler.ts`, `src/main/ipc/handlers.ts`, `src/main/commands/transaction-commands.ts`

### Bug 6: Undo works once, fails on second delete+undo cycle
- **Problem**: After first undo, the `DELETED` event remains in `transaction_events`. On second delete+undo, there are two `DELETED` events. `undoLastEvents()` stripped only one, leaving the earlier `DELETED` at the end of replay, which set `state=null`, so undo returned `null` and did nothing.
- **Root cause**: `undoLastEvents()` only skipped the last event. Repeated delete→undo cycles accumulated trailing `DELETED` events that broke subsequent undos.
- **Fix**: In `event-store.ts`, `undoLastEvents()` now strips ALL trailing `DELETED` events before replaying, so undo never ends on a delete. Also added `RESTORED` event type for explicitly logging undo of deletes.
- **Verification**: `npm run build` succeeds. No automated tests exist in this repo, so runtime behavior was not executed end-to-end.
- **Status**: ✅ Fixed and committed (commit `f93336f`)
- **Files changed**: `src/main/events/event-store.ts`, `src/main/commands/transaction-commands.ts`

### Guard Analysis Summary
- **subscriptions:checkBilling**: Now uses `notes = 'subscription:{id}'` for guard (good - prevents duplicates on name changes)
- **savings:checkBilling**: Uses `notes LIKE '%savings_source:{id}%'` with year/month (good)
- **income:checkBilling**: Uses `income_entries` table with source_id/year/month (good)

## Previous Session (for reference)
Base: c3a2f83 (crash-revert commit)

<summary_status>
- ✅ Phase 0: Crash fix for `selectedMonth === 0` verified in `transaction-row.tsx`
- ✅ Phase 1: Goals AI summary reverted (already in c3a2f83)
- ✅ Phase 2.1: U3 relabel — no misleading AI claims found
- ✅ Phase 2.2: Q3 — `selectedMonth` persists via `settings.set`
- ⏸️ Phase 2.3: M1 — per-transaction multi-currency deferred (high-risk)
- ✅ Phase 2.4: M2 — locale formatting already fully implemented
- ✅ Phase 3.1: P1-13 — Pension projection persistence (`pension:get`/`pension:save`)
- ✅ Phase 3.2: P1-14/D4 — CSV export (`transactions:exportCsv` + renderer button)
- ✅ Phase 3.3: Q1 — Undo toast on transaction delete (`transaction-row.tsx`)
- ✅ Phase 3.4: A1 — "Ask AI: what changed?" month-over-month button on Analytics
- ✅ Phase 3.5: A2 — Spending trend sparklines on Budget category cards (`CategorySparkline` + `categoryTrend` IPC + preload)
- ✅ Phase 3.6: A5 — Year-over-year comparison chart on Analytics page (`analytics:yearOverYear`)
- ✅ Phase 3.7: D3 — Automatic backup reminder ("Backup" card on Settings + `lastDbBackup` setting)
- ✅ Phase 3.8: D5 — "Verify my data" integrity score already implemented
</summary_status>

### Commit history produced during this session
- `688ce76` fix: undoLastChange re-inserts deleted rows
- `3d14122` fix: handlers.ts - remove extra SQL parameter for subscriptions:checkBilling
- `a5fc00f` fix: scheduler.ts - use subscription notes marker for duplicate prevention
- `de861cd` fix: scheduler duplicate prevention - use subscription notes marker and createTransaction
- `3cbf748` fix: move delete toast state to TransactionsPage to prevent unmount on row removal
- `21a251a` feat: Q1 undo toast on transaction delete (transaction-row)
- `0eaf3f8` feat: A1 analytics 'What changed?' month comparison button
- `1be4415` feat: A2 spending trend sparklines on budget category cards
- `c17c7f6` feat: A5 year-over-year comparison chart on analytics page
- TODO: D3 backup reminder (settings)
