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

### Item 4: Native alert()/confirm() migration incomplete
- **Problem**: Several renderer paths still used native `alert()`/`confirm()`, leaving them outside the app's Radix dialog/focus management.
- **Fix**: Migrated destructive confirmations and notices to `useAppDialog()` in Goals, Income, Savings, Wealth, Recurring/Subscriptions, Budget category drawer, Plugin Registry, and the OFX import notice in Transactions. Plugin load/reload failures now use app dialogs, and the dead Plugin Development Guide `href="#"` was removed in favor of text pointing to `PLUGINS.md`.
- **Files touched**: `src/renderer/src/pages/goals.tsx`, `src/renderer/src/pages/income.tsx`, `src/renderer/src/pages/savings.tsx`, `src/renderer/src/pages/wealth.tsx`, `src/renderer/src/pages/subscriptions.tsx`, `src/renderer/src/pages/transactions.tsx`, `src/renderer/src/components/budget/category-drawer.tsx`, `src/renderer/src/components/plugins/plugin-registry.tsx`.
- **Verification**: Re-read all touched files after editing. Ran `rg -n "\\balert\\(|\\bconfirm\\(" src\\renderer\\src\\pages src\\renderer\\src\\components`; remaining matches are `dialog.alert`/`dialog.confirm` app-dialog calls, not native browser dialogs. Ran `npm run typecheck` successfully and `npm run build` successfully. Per-dialog live click/focus verification is blocked by the encrypted real profile/app-data isolation issue noted in Item 1; I did not unlock or mutate the real profile.

### Item 5: Key manager tests fail outside Electron
- **Problem**: `keyManager.test.ts` called `encryptWithMachineKey()`, which uses `app.getPath('appData')`; in Vitest there was no Electron `app` mock, so 4 of 8 tests failed.
- **Fix**: Added a Vitest `electron` mock in `keyManager.test.ts` that returns a temporary app-data directory for `app.getPath()`, and removes that temp directory after the suite.
- **Files touched**: `src/main/crypto/__tests__/keyManager.test.ts`.
- **Verification**: Re-read the test file after editing and confirmed `src/main/crypto/keyManager.ts` was not modified. Ran `npm test -- src/main/crypto/__tests__/keyManager.test.ts` successfully: 8/8 key-manager tests passed. Ran full `npm test` successfully: 1 test file, 8 tests passed. Ran `npm run typecheck` successfully.

### Item 6: Command palette unreachable from keyboard
- **Problem**: Ctrl+K could be swallowed before the renderer `keydown` handler saw it, and there was no visible command palette launcher.
- **Fix**: Added an Electron `before-input-event` bridge for Ctrl+K that sends `command-palette:open` to the renderer. Exposed a preload listener and wired it through `useKeyboardShortcuts()` with the same input/dialog guards used by renderer shortcuts. Normalized renderer shortcut keys with `toLowerCase()`. Added a visible sidebar "Command" button that opens the palette through the existing Zustand state.
- **Files touched**: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/hooks/use-keyboard.ts`, `src/renderer/src/components/layout/sidebar.tsx`.
- **Verification**: Re-read all touched files after editing and confirmed both keyboard paths and the sidebar fallback call `setCommandOpen(true)`. Ran `npm run typecheck` successfully and `npm run build` successfully. Live Ctrl+K and sidebar-click verification is blocked by the encrypted real profile/app-data isolation issue noted in Item 1; I did not unlock or mutate the real profile.

### Item 7: Plugin registry dead/placeholder UX
- **Problem**: The plugin registry had a dead Plugin Development Guide `href="#"`, and plugin load/reload failures used native alerts.
- **Fix**: The native alerts were migrated in Item 4. The dead guide link was removed in favor of text pointing to the existing root `PLUGINS.md`. The plugin homepage anchor now uses the manifest homepage URL as its `href` while still opening through Electron's external-link API.
- **Files touched**: `src/renderer/src/components/plugins/plugin-registry.tsx`.
- **Verification**: Re-read `plugin-registry.tsx` after editing. Confirmed `PLUGINS.md` exists. Ran `rg` checks confirming the plugin registry no longer contains `Plugin Development Guide`, native `alert()`/`confirm()`, or placeholder `href="#"` anchors. Ran `npm run typecheck` successfully. Live plugin failure dialog verification is blocked by the encrypted real profile/app-data isolation issue noted in Item 1.

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

## Session: 2026-07-07 - Fix Pass Part 1 Item 8

### Item 8: Profile defaults drift
- **Problem**: The encrypted and legacy database profile seeds did not include the same fields as the renderer store defaults, and the data wipe reset profile omitted `baseCurrency` and `locale`.
- **Fix**: Added the missing persisted profile fields in both database seed paths, added a startup backfill that only fills missing profile keys without overwriting existing values, and updated the data wipe reset profile to include `baseCurrency` and `locale`.
- **Verification**: `npm run typecheck`, `npm run build`, and `npm test` all pass. Static verification confirms the database defaults and wipe reset now include `baseCurrency`, `savingsRateTarget`, `colorBlindMode`, and `locale`.
- **Remaining note**: Live data-wipe verification was not run against the real encrypted profile because Electron ignores the attempted disposable `APPDATA` override on this Windows host and resolves to the real app-data directory.

## Session: 2026-07-07 - Planned Batch Item 1

### Item 1: Account/wallet model
- **Problem**: Transactions and recurring/import flows used one implicit global money pool, so balances could not be reconciled per wallet/account.
- **Migration approach**: Added an `accounts` table and additive nullable `account_id` columns on `transactions`, `subscriptions`, `savings_sources`, and `income_sources`. Migration creates a default active `Main` checking account when none exists, assigns every existing money-flow row with a missing account to `Main`, and adds account indexes. Existing transaction HMACs are nulled when the transaction account column is first added so the normal HMAC backfill regenerates signatures with `account_id` included.
- **Balance approach**: Account balances are computed from transaction history, not stored as mutable account state. Income adds to balance; expense, savings, and transfer rows subtract. This keeps the event-sourced transaction projection as the source of truth and avoids a second balance value that could drift.
- **Implementation**: Added account-aware schema/migrations, transaction event payloads, transaction HMAC signing, projection rebuild/undo, transaction queries, account IPC/preload APIs, JSON backup/import support, scheduler billing account assignment, and renderer account selectors for manual transactions, edit drawer, CSV/OFX import, savings, income sources, and subscriptions. Added a sidebar Accounts page for list/create/edit/archive and computed balances.
- **Files touched**: `src/main/database-encrypted.ts`, `src/main/database.ts`, `src/main/crypto/integrity.ts`, `src/main/events/event-store.ts`, `src/main/commands/transaction-commands.ts`, `src/main/queries/transaction-queries.ts`, `src/main/ipc/handlers.ts`, `src/main/services/scheduler.ts`, `src/preload/index.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/components/layout/sidebar.tsx`, transaction components, `income.tsx`, `savings.tsx`, `subscriptions.tsx`, `transactions.tsx`, and new `src/renderer/src/pages/accounts.tsx`.
- **Verification**: `npm run typecheck`, `npm test`, and `npm run build` pass. Ran a populated temporary SQLite migration exercise with 96 transactions plus subscription/savings/income source rows: transaction count stayed 96, all existing transactions assigned to `Main`, zero unassigned money-flow rows remained, `Main` balance matched the pre-migration net, a new `Revolut` account with one expense and one income computed to `-50`, aggregate totals changed only by that `-50`, and an undo-style restore preserved the `Revolut` `account_id`. Ran a second aggregate check confirming dashboard, analytics, and budget-style SQL totals still sum across all accounts by default. Ran a targeted creation-path check confirming account assignment is present for manual modal/quick-add, CSV import, OFX import, subscription linking, recurring subscription billing, savings billing, income billing, scheduler billing, and inline/bulk edit preservation.
- **Remaining note**: Full live UI verification against a disposable Electron profile remains blocked by Electron resolving app data to the real encrypted profile on this Windows host. I did not unlock or mutate the real profile.

### Item 2: Command palette fallback launcher
- **Problem**: Ctrl+K had previously been unreliable in Electron because renderer-level shortcuts could be swallowed before React received them.
- **Implementation**: Confirmed the existing fix is already in place: the main process intercepts Ctrl/Cmd+K with `before-input-event`, prevents the default Electron behavior, sends `command-palette:open` through preload, and the renderer opens the command palette from that IPC event. The renderer still keeps its own keydown fallback, and the sidebar has a visible Command button that calls `setCommandOpen(true)`.
- **Files touched**: No source behavior changed for this item; only this log entry was added because the implementation already matched the item requirements.
- **Verification**: Ran a targeted executable source check confirming all required paths exist: main Ctrl+K intercept, preload listener cleanup, renderer IPC open handler, renderer keydown fallback, and visible sidebar Command button. Ran `npm run typecheck` and `npm test` successfully.
- **Remaining note**: I did not perform live twice-per-path UI clicks against the real encrypted profile for the same app-data isolation reason noted above. The code paths are present and covered by static execution checks, but a disposable unlocked Electron UI session is still blocked on this host.

### Item 3: Large dataset performance pass
- **Problem**: The Transactions page loaded every filtered transaction for the selected month and then sorted/rendered the full result in React. The IPC query also filtered year/month with `strftime()`, which prevents SQLite from using plain date indexes efficiently on larger datasets.
- **Implementation**: Added shared transaction filter construction in IPC using index-friendly `date >= start AND date < end` ranges, whitelisted server-side sort orders, an opt-in `LIMIT/OFFSET` path for `transactions:list`, and a new `transactions:count` IPC/preload method. The Transactions page now requests 100 rows per page, displays total/range controls, clears bulk selection on page/filter changes, and lets SQLite handle sorting. Existing aggregate callers are unchanged unless they explicitly request pagination, so budget, analytics, income, savings, and wealth calculations still receive complete datasets for their requested ranges.
- **Indexes added**: Added transaction composite indexes in encrypted and legacy database setup/migration paths for `date/id`, `account/date`, `category/date`, `type/date`, flagged/date, recurring/date, plus a case-insensitive description index for search-adjacent lookups. The contains search pattern still cannot fully use a simple B-tree index, but the date/category/type portions of filtered searches now stay indexed.
- **Verification**: `npm run typecheck`, `npm test`, and `npm run build` pass. Ran a temporary SQLite stress test with 25,000 synthetic transactions across 24 months and the new index set: paged transactions list returned 61 rows in 0.409 ms, count in 0.180 ms, budget-style month aggregate in 0.358 ms, analytics-style daily aggregate in 0.265 ms, and normal demo-size page query in 0.081 ms. `EXPLAIN QUERY PLAN` confirmed the hot paged query used `idx_transactions_category_date`. No live unlocked Electron UI verification was run because disposable Electron profile isolation remains blocked on this host.

### Item 4: Import/service unit tests
- **Problem**: Core import and service behavior had almost no automated coverage beyond the existing key manager tests, leaving CSV/OFX parsing, recurring billing guards, profile default backfill, event undo, and account assignment vulnerable to regressions.
- **Implementation**: Added focused Vitest coverage for CSV delimiter/quote parsing, preview/column guessing, Swedish amount/date normalization, CSV export quoting, OFX income/expense parsing, scheduler duplicate subscription guards, recurring source account fallback, profile default backfill preservation, transaction default account assignment, automatic Main account creation, account-aware CSV event imports, account updates, and undo restore preserving `account_id`. Added a test-only `__databaseTesting` export for the legacy profile defaults/backfill helper.
- **Test harness note**: The installed `better-sqlite3` native binary is built for Electron's Node ABI and cannot be loaded by Vitest's Node process on this host, so the new tests use small fake database objects for the specific SQL surfaces under test instead of opening native SQLite. Nothing was skipped or disabled to force a pass.
- **Verification**: `npm test` passes with 5 files and 23 tests. `npm run typecheck` and `npm run build` pass.

### Item 5: Finish app-wide native dialog migration
- **Problem**: The batch called for replacing any remaining native `alert()`/`confirm()` calls in goals, income, savings, wealth, subscriptions, category drawer, and plugin registry, plus fixing/removing the dead plugin guide `href="#"` link.
- **Implementation**: Confirmed this item was already implemented in the current source. The actual repo paths are `src/renderer/src/components/budget/category-drawer.tsx` and `src/renderer/src/components/plugins/plugin-registry.tsx`; both already use `useAppDialog`. The plugin registry no longer has a dead `href="#"` guide link and instead points users to `PLUGINS.md` in static copy. No source behavior changes were needed for this item.
- **Verification**: Ran a targeted executable source check across the seven requested surfaces confirming `native_alert=False`, `native_confirm=False`, and `useAppDialog=True` for each, plus `plugin_href_hash=False` and `plugin_guide_copy=True`. `npm test`, `npm run typecheck`, and `npm run build` pass. Live twice-per-dialog UI triggering was not run because disposable unlocked Electron profile isolation remains blocked on this host; I did not unlock or mutate the real encrypted profile.

### Item 6: Cash-flow forecast with runway warnings
- **Problem**: The dashboard showed current and historical health, but did not project whether upcoming recurring income, subscriptions, savings, budgets, and recent variable spending would leave enough monthly cash flow.
- **Implementation**: Added `dashboard:cashFlowForecast` IPC and preload bridge. It projects the next three months after the selected month using recurring net income sources, existing future income entries where present, active subscriptions, recurring savings sources, planned budget entries, and the trailing three-month average of non-recurring variable expense transactions. Planned budget and recent variable spending are combined with `max(planned budget, recent variable average)` so the forecast can warn on recent behavior without double-counting the same category spend. Added a compact secondary Dashboard card showing next-month projected balance plus three monthly forecast rows.
- **Warning tier logic**: Reused the existing Dashboard budget-health display thresholds exactly: projected balance as a percent of projected income is success at `>=70`, warning at `>=40`, and destructive below `40`. Any negative projected balance is always destructive regardless of percentage.
- **Verification**: `npm run typecheck`, `npm test`, and `npm run build` pass. Ran a constructed executable math scenario with 5,000 projected income, 3,500 planned/variable outflow, 900 subscriptions, and 800 savings sources: projected outflow was 5,200, balance was `-200`, balance percent was `-4`, and tier was `destructive`. Ran threshold checks confirming `70 => success`, `69 => warning`, `40 => warning`, and `39 => destructive`, matching the existing Dashboard budget-health thresholds. Live unlocked Electron UI verification was not run because disposable profile isolation remains blocked on this host.

### Item 7: Budget variance explanations
- **Problem**: Budget category cards showed month-over-month spending movement visually, but did not explain what changed in factual terms.
- **Implementation**: Added deterministic `transactions:categoryVariance` IPC and preload bridge. For each category, it compares the selected month with the prior month and reports factual drivers: new merchant, unusually large transaction, transaction count change, and recurring charge start/stop. Added a compact `Why?` control to each Budget category card; the explanation is hidden by default and expands inline only when clicked. The category card still opens the detail drawer on card click/keyboard, while the nested `Why?` control stops propagation.
- **Verification**: `npm run typecheck`, `npm test`, and `npm run build` pass. Ran a constructed variance scenario with previous spend `230` and current spend `1295`: the executable check computed `+1065` / `+463%` and identified `Electronics Store` as both a new merchant and the largest transaction, plus the frequency change from 2 to 4 transactions. Ran a source check confirming `categoryVariance` is wired through main/preload/Budget and that the explanation is gated by `expandedVariance.has(...)` behind the `Why?` control. Live unlocked Electron UI verification was not run because disposable profile isolation remains blocked on this host.

### Item 8: Recurring merchant detection for non-subscription spending
- **Problem**: Repeated non-subscription expenses could look like ordinary one-off spending even when they were recurring enough to deserve user attention.
- **Implementation**: Added deterministic `transactions:recurringMerchantPatterns` and `transactions:dismissRecurringMerchantPattern` IPC/preload APIs. Detection uses the selected month's rolling six-month window, groups expenses by same category plus normalized merchant name (lowercase, trimmed, repeated whitespace collapsed), flags 4+ occurrences, excludes transactions already linked to subscriptions via `subscriptions.transaction_id`, excludes subscription note markers, and persists dismissed pattern keys in settings under `recurringMerchantIgnores`. Added compact Dashboard notices with a per-pattern Dismiss button.
- **Verification**: `npm run typecheck`, `npm test`, and `npm run build` pass. Ran an executable detection scenario where `Rekas`, `REKAS `, ` rekas `, and `rEkas` appeared 4 times in the same category and correctly merged into one `rekas|7` pattern. Confirmed a merchant appearing only 3 times did not flag, subscription-linked rows did not flag, and setting the ignore key suppressed the detected pattern. Live unlocked Electron UI verification was not run because disposable profile isolation remains blocked on this host.

### Item 9: Goal feasibility planner
- **Problem**: Goals showed saved/current progress, but did not tell the user whether the remaining goal amount was realistic given the app's actual projected monthly surplus.
- **Implementation**: Added target-date editing to the Goals modal and an inline feasibility panel on each goal card. The planner computes months remaining, required monthly contribution, and pace versus the current projected monthly surplus from `dashboard.cashFlowForecast`; fully funded goals show complete, goals without a deadline prompt for a target date, and dated goals show ahead/on-track/behind messaging with the monthly gap where applicable. This reuses the existing cash-flow forecast IPC/preload path and does not add a new persistence shape or service dependency.
- **Verification**: `npm run typecheck`, `npm test`, and `npm run build` pass. Ran executable feasibility math checks confirming a 6,000 remaining goal over 6 months reports `On track` at 1,000 surplus, `Behind - need 300/month more` at 700 surplus, and `Ahead of schedule` at 1,500 surplus. Ran a source check confirming `targetDate`, `cashFlowForecast`, `monthlySurplus`, and `feasibility` are wired through the Goals page. Live unlocked Electron UI verification was not run because disposable profile isolation remains blocked on this host.

### Item 10: Category normal range bands
- **Problem**: Budget cards showed current spend, budget progress, and recent trend, but did not distinguish normal month-to-month variation from unusually high or low category spending.
- **Implementation**: Extended the existing category trend lookup to include `savings` rows as well as `expense` rows so it matches Budget card outflows. The Budget page now requests seven months of trend data, uses the prior six months as the trailing average, and adds an inline normal-range band with current-month marker, trailing average, and below/in-range/above-usual status. The normal range is the spec's simple percentage threshold: 35% below to 35% above the trailing average.
- **Verification**: `npm run typecheck`, `npm test`, and `npm run build` pass. Ran executable baseline math checks against six months of history `[900, 1000, 1100, 1000, 950, 1050]`: the trailing average is `1000`, the normal range is `650` to `1350`, 1,020 classified as normal, 1,600 as above, and 500 as below. Ran a source check confirming the Budget page uses seven-month `categoryTrend` data and the trend IPC includes both expense and savings outflows. Live unlocked Electron UI verification was not run because disposable profile isolation remains blocked on this host.

### Item 11: Export for tax/accountant review
- **Problem**: The app had full-data backup/export and transaction CSV export, but no focused yearly export for accountant review that separated tax-relevant subscriptions, income, savings, and user-selected expense categories.
- **Implementation**: Added `reports:taxReviewExport` IPC and preload bridge. The export writes a CSV via the native save dialog with tagged rows for tax-deductible subscriptions, yearly income transactions, yearly savings transactions, and yearly expense transactions from categories selected in Settings. Added a Settings card with category checkboxes, select-all/clear controls, and an export button. Updated demo data generation so the first generated subscription is always tax deductible, making this export verifiable from demo data instead of depending on randomness.
- **Verification**: `npm run typecheck`, `npm test`, and `npm run build` pass. Ran a constructed SQLite export scenario with one deductible subscription, one non-deductible subscription, income, savings, one selected-category expense, one unselected expense, and an out-of-year income row. The generated row set contained exactly 4 rows: deductible subscription annualized to `1200`, the in-year income, the in-year savings transaction, and the selected category expense; it excluded the non-deductible subscription, unselected expense, and out-of-year income. Ran source checks confirming `reports:taxReviewExport` is wired through main/preload/Settings. Live native save-dialog export against an unlocked Electron profile was not run because disposable profile isolation remains blocked on this host.

### Account migration hotfix after Item 11
- **Problem**: An existing encrypted profile could fail on unlock with `SqliteError: no such column: account_id` because the first schema block attempted to create account-dependent transaction indexes before the additive account migration had added `account_id` to older tables.
- **Fix**: Moved the `idx_transactions_account` and `idx_transactions_account_date` creation responsibility fully behind `runAccountMigration`, where the `transactions.account_id` column is guaranteed to exist. Left account assignment additive: existing transactions, subscriptions, savings sources, and income sources still backfill to `Main`. Also connected Wealth snapshot auto-fill to computed checking/savings/cash account balances so account balances feed the snapshot workflow.
- **Verification**: `npm run typecheck`, `npm test`, and `npm run build` pass. Ran an old-schema SQLite migration simulation with transactions/subscriptions/income/savings tables missing `account_id`; the account-independent indexes succeeded, `Main` was created, all four money-flow tables received `account_id`, account-dependent indexes were created after the columns existed, and the computed `Main` balance matched expected net history. Ran a separate account balance scenario confirming `Main` computed to `3500` and `Cash` to `280` from account-assigned transactions.

### Item 12: Custom tax over/underpayment estimator
- **Problem**: The app did not have the requested manual tax over/underpayment worksheet for comparing gross income, actual net income, and supposed net income month by month.
- **Implementation**: Added a persistent `tax_estimates` table in encrypted and legacy schema paths, `tax:list`, `tax:setEntry`, and `tax:deleteEntry` IPC/preload APIs, and a dedicated sidebar Tax page. The page uses the same month selector pattern and currency formatting as the rest of the app, stores one manual entry per year/month, shows both the current month result and year-to-date total, and keeps the calculation exactly manual: `supposed net income - actual net income`.
- **Verification**: `npm run typecheck`, `npm test`, and `npm run build` pass. Ran an executable persistence/calculation scenario with three months: `5500 - 5000 = +500` expected refund, `4000 - 4200 = -200` amount owed, and `3500 - 3500 = 0` on target; the running yearly total was `+300` expected refund. Source checks confirm the Tax page is routed in `App.tsx`, present in the sidebar, and wired through preload/main IPC. Live restart verification against an unlocked Electron profile was not run because disposable profile isolation remains blocked on this host.

### Item 13: Categorization rules engine upgrade
- **Problem**: Categorization rules only supported a single description substring and had no priority, amount/type/category conditions, nested AND/OR logic, or future-import-only behavior.
- **Implementation**: Added additive `priority`, `apply_future_only`, and `conditions_json` columns to `categorization_rules` while preserving legacy `pattern` rules. Added a recursive deterministic matcher supporting description contains, amount minimum, amount maximum, existing category, and transaction type conditions joined by nested `AND`/`OR` groups. `rules:apply` now evaluates non-future-only rules by priority against existing transactions, while CSV and OFX imports evaluate all rules, including future-import-only rules, before event-sourced transaction creation. Replaced the Settings rule editor with a grouped condition builder for target category, priority, future-import-only, group connectors, and condition rows.
- **Verification**: `npm run typecheck`, `npm test`, and `npm run build` pass. Ran an executable rule scenario proving `(description contains client AND amount >= 250) OR category = 5` matches correctly, a smaller client transaction does not match, a higher-priority overlapping `client lunch` rule wins, and a future-import-only rule is skipped for existing apply but matches when import mode is enabled. Ran a migration scenario confirming legacy rule rows receive the new columns with defaults and remain valid. Live UI rule-builder clicks were not run because disposable profile isolation remains blocked on this host.

### Item 14: Local privacy/audit dashboard
- **Problem**: Local privacy and security state was split across encryption, settings, backups, and integrity tools, so users had no single place to see where sensitive data lives and whether the local profile looked healthy.
- **Implementation**: Added a dedicated sidebar Privacy page and a `privacy:auditState` IPC/preload bridge. The page shows the app data folder, encrypted database path, database initialization state, current lock/unlock state, Claude API key presence without exposing the key, last backup date, and current integrity warning count. It also provides direct actions to refresh state, create a database backup, update the `lastDbBackup` setting after a successful backup, and run the existing integrity scan with a compact result summary.
- **Architecture fit**: The page is read-mostly and reuses existing local services/APIs: keychain presence checks, database path/init state, settings-backed backup metadata, native database export, and the integrity scanner. It does not add a new persistence model, external service, or AI dependency.
- **Verification**: `npm run typecheck`, `npm test`, and `npm run build` pass. Ran a focused SQLite audit-state scenario confirming `lastDbBackup` JSON parsing and `integrity_warnings` counts produce the displayed state shape. Source checks confirm the Privacy route is registered, the sidebar entry exists, and IPC/preload wiring is present. Live lock/unlock, backup-dialog, and integrity-button clicks against an unlocked disposable Electron profile were not run because disposable profile isolation remains blocked on this host; the dashboard actions call the same APIs already used by Settings, encryption, and the Integrity flow.
