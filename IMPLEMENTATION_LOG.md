# Implementation Log

## Session: 2026-07-07 - Fix Pass Part 1

### Item 1: Profile settings save stale values
- **Problem**: `SettingsPage.saveProfile()` wrote the `profile` object captured by the current render. Immediate controls such as base currency, display currency, locale, colorblind mode, notifications, and auto-hide called `setProfile(...)` and then `saveProfile()`, so the persisted profile could lag behind the visible value.
- **Fix**: Updated `saveProfile()` to accept an optional profile patch and persist `{ ...useAppStore.getState().profile, ...updates }`. Immediate controls now pass the value they just set into `saveProfile(...)`; blur handlers explicitly call `saveProfile()` so React focus events are not mistaken for profile patches.
- **Files touched**: `src/renderer/src/pages/settings.tsx`.
- **Verification**: Re-read `settings.tsx` after editing and confirmed affected controls pass explicit patches. Ran `npm run typecheck` successfully. Rebuilt with `npm run build` successfully. Attempted a disposable Electron profile restart test, but Electron on this Windows host ignores `APPDATA` overrides for `app.getPath('appData')` and resolves to the real encrypted profile; I did not unlock or mutate the real profile. Verified the app-data behavior with an isolated Electron main-process check before stopping the disposable launch.

### Item 2: Budget sparklines load stale/missing data
- **Problem**: `BudgetPage.load()` fetched fresh budget rows, then requested category trends using `visible`, which was derived from the previous render's `entries`/`spending` state.
- **Fix**: Store fetched budget rows in a local `loadedEntries` variable, build a local `loadedVisible` list from `loadedEntries` and the freshly-computed spending map, and request trend data from that fresh list.
- **Files touched**: `src/renderer/src/pages/budget.tsx`.
- **Verification**: Re-read `budget.tsx` after editing and confirmed trend requests no longer depend on the render-level `visible` value inside `load()`. Ran `npm run typecheck` successfully and `npm run build` successfully. Live first-render visual verification was blocked by the same Electron app-data isolation issue noted in Item 1; I did not unlock or mutate the real encrypted profile.

### Item 3: Budget category trend endpoint ignores selected month
- **Problem**: `transactions:categoryTrend` anchored the six-month window to `new Date().getMonth() + 1`, so viewing past months could show trends ending at today's real month.
- **Fix**: Changed the preload API and Budget page call to pass the viewed `selectedMonth`. The IPC handler now builds a year-month period range from the passed year/month and supports six-month windows that cross year boundaries.
- **Files touched**: `src/preload/index.ts`, `src/renderer/src/pages/budget.tsx`, `src/main/ipc/handlers.ts`.
- **Verification**: Re-read all touched files after editing. Ran `npm run typecheck` successfully and `npm run build` successfully. Exercised the revised SQL window with Python `sqlite3`: anchoring on March 2026 returned October 2025 through March 2026 and ignored April 2026, confirming the trend window follows the viewed month rather than today's date. A direct Budget-page visual check remains blocked by the encrypted real profile/app-data isolation issue noted in Item 1.

## Session: 2026-07-05 - Full Demo Data Coverage

### Part 1 Step 1: tab/data-source checklist
- **Dashboard (`#/`)**: monthly stats, AI weekly tip/insights/anomalies, upcoming subscriptions. Data from `dashboard:stats`, `transactions:list`, `income:*`, `subscriptions:*`, `savings:*`, `ai:*`.
- **Budget (`#/budget`)**: category budget entries, category spending, income context, subscription impact, category trend drawer. Data from `budget:getMonth`, `budget:setEntry`, `budget:categoryDetail`, `categories:*`, `transactions:list`, `transactions:categoryTrend`, `income:*`, `subscriptions:list`.
- **Transactions (`#/transactions`)**: transactions, filters, CSV/OFX import/export, edit/delete/bulk/history/undo. Data from `transactions:*`, `categories:list`, `members:list`, event history via `transactions:history`.
- **Goals (`#/goals`)**: savings and custom goals, progress, emergency target, auto-created category goals. Data from `goals:*`, `goals:emergencyTarget`, `goals:autoCreateFromCategories`.
- **Wealth (`#/wealth`)**: wealth snapshots, savings transaction totals, ETF holdings, legacy investments, pension projection. Data from `wealth:*`, `transactions:list({ type: 'savings' })`, `investmentHoldings:*`, `investments:*`, `pension:*`.
- **Analytics (`#/analytics`)**: annual summary, MoM movers, heatmap, break-even, year-over-year, transaction comparisons. Data from `analytics:*`, `transactions:list`.
- **Subscriptions (`#/subscriptions`)**: subscriptions plus recurring income and savings sources, billing checks, tax/hold flags, link/unlink. Data from `subscriptions:*`, `income:sources`, `savings:sources`.
- **Income (`#/income`)**: income sources, income entries, gross/net toggle, income transactions. Data from `income:*`, `transactions:list`, `settings:setProfile`.
- **Savings (`#/savings`)**: savings transactions and recurring savings-source entries. Data from `transactions:list({ type: 'savings' })`, `transactions:create/delete`, `savings:*`.
- **Habits (`#/habits`)**: spending streak, missed tracking days, monthly mood. Data from `settings:get('spendingStreak')`, `mood:*`, `habits:missedDays`, transaction dates.
- **AI Assistant (`#/ai`)**: API-key state and chat UI. Data from `ai:hasKey`, `ai:chat`; demo data cannot seed a real API key without user credentials.
- **Settings (`#/settings`)**: profile, members, currency, tax/inflation, AI key, appearance/display, backup/data actions, scheduler, categorization rules, integrity, plugins, onboarding, encryption. Data from `settings:*`, `members:*`, `theme:*`, `ai:*`, `data:*`, `scheduler:*`, `rules:*`, `integrity:*`, `plugins:*`, `encryption:*`, `currency:*`.
- **Year-end report (`#/report`)**: yearly printable summary/PDF. Data from `reports:yearSummary`, `print:yearSummary`.

### Part 1 Step 2: demo data expansion
- **Transactions**: increased randomized transaction coverage to 60-90 transactions over up to 11 months, plus 14 recent daily expense transactions to give Habits recent tracking data.
- **Subscriptions**: kept randomized subscription creation and now varies `tax_deductible`, `on_hold`, frequency, color, and occasional URL.
- **Goals**: creates 3-5 varied goals with target/current values, monthly payments, interest-rate variation, target dates, and notes.
- **Income**: creates 2-3 income sources and fills six months of income entries through `income:createSource` and `income:setEntry`.
- **Savings sources**: creates 2-3 recurring savings transactions through `transactions:create`, which uses the existing recurring savings-source creation path.
- **Budget**: writes six months of category budget entries through `budget:setEntry`, including notes.
- **Wealth**: creates six net-worth snapshots through `wealth:create`, 2-3 ETF holdings through `investmentHoldings:create`, 1-2 legacy investments through `investments:create`, and non-default pension values through `pension:save`.
- **Categorization rules**: creates three example rules through `rules:create`.
- **Habits/mood**: fills six monthly mood rows through `mood:set`; transaction spread also produces missed-day/streak content.
- **Settings/profile support data**: adds two household members through `members:create` so Settings is not visually sparse.
- **Structurally not seeded**: AI Assistant API-key state, integrity warnings, plugin registry contents, and encryption password state are intentionally not faked by demo data.

### Part 1 verification
- **Run Demo pass 1**: clicked Settings > Run Demo in the live Electron app. Dialog reported 5 subscriptions, 77 transactions, 5 goals, 3 income sources, 2 savings sources, 48 budget entries, 6 wealth snapshots, 2 holdings, 3 rules, and 6 mood entries.
- **Run Demo pass 2**: clicked Settings > Run Demo again. Dialog reported a different randomized batch: 7 subscriptions, 87 transactions, 4 goals, 3 income sources, 3 savings sources, 48 budget entries, 6 wealth snapshots, 3 holdings, 3 rules, and 6 mood entries.
- **Coverage correction**: Wealth still showed the legacy-investments empty message after the first tab pass, so demo generation now also seeds `investments:create`.
- **Run Demo pass 3 after correction**: clicked Settings > Run Demo again. Dialog reported 6 subscriptions, 77 transactions, 4 goals, 3 income sources, 3 savings sources, 48 budget entries, 6 wealth snapshots, 3 holdings, 1 legacy investment, 3 rules, and 6 mood entries.
- **Tab click-through**: visited Dashboard, Budget, Transactions, Goals, Wealth, Analytics, Subscriptions, Income, Savings, Habits, AI Assistant, Settings, and Year-end report in the live Electron app. Data-backed pages rendered populated data. AI Assistant still correctly asks for a real API key; this is not demo-seeded.
- **Automated checks attempted**: `npm run typecheck` is blocked by pre-existing `src/main/plugins/plugin-manager.ts` errors. `npx tsc --noEmit -p tsconfig.web.json` is blocked by pre-existing `ai-assistant.tsx` and `subscriptions.tsx` errors. `npm test` is blocked by pre-existing Electron app mocking failures in `keyManager.test.ts`. There is no `npm run lint` script.

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
