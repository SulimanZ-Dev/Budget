# Implementation Log

## Phase 0 — Confirm the crash fix is solid

### 0. TransactionsShell crash (`sort`/`setSort`/`load()` undefined)
- **Status:** ✅ Confirmed solid
- **What changed:** `TransactionsShell` now receives `sort`, `setSort`, and `loadData` as explicit props through its React props interface. No out-of-scope variable reliance.
- **Files touched:** `src/renderer/src/pages/transactions.tsx`
- **Deviation from report:** None.

---

## Phase 1 — Revert

### 1. Goals AI summary (ai_summary / ai_summary_updated columns)
- **Status:** ✅ Already reverted in commit `c3a2f83`
- **What changed:** Removed `ai_summary`/`ai_summary_updated` UI from `goals.tsx`, removed `goals:generateSummary` IPC handler from `handlers.ts`, removed from preload bridge, replaced forward migrations with `ALTER TABLE ... DROP COLUMN` migrations in `database.ts` and `database-encrypted.ts`.
- **Files touched:** `src/renderer/src/pages/goals.tsx`, `src/main/ipc/handlers.ts`, `src/preload/index.ts`, `src/main/database.ts`, `src/main/database-encrypted.ts`
- **Deviation from report:** None.

---

## Phase 2 — Fix existing deviations

### 2. U3 relabel (heuristic keyword-matching, not AI)
- **Status:** ⏭️ No misleading AI claims found
- **What changed:** The CSV column auto-detection (`guessColumnIndexes` in `src/main/services/csv-import.ts`) uses heuristic keyword matching (English + Swedish) and does not claim AI anywhere in its UI or naming. No relabeling needed.
- **Files checked:** `src/main/services/csv-import.ts`, `src/renderer/src/components/transactions/csv-import-modal.tsx`
- **Deviation from report:** None. The only "AI categorize" button is in `transaction-modal.tsx` and genuinely uses Claude (`window.api.ai.suggestCategory`), so that stays as-is.

### 3. Q3 — persist selectedMonth
- **Status:** ✅ Completed
- **What changed:** `selectedMonth` now persists to `settings` KV store (same pattern as `selectedYear` via profile). Added `setSelectedMonth` to `app-store.ts` that writes to `window.api.settings.set('selectedMonth', month)`. Updated `use-init.ts` to load the persisted month on startup.
- **Files touched:** `src/renderer/src/store/app-store.ts`, `src/renderer/src/hooks/use-init.ts`
- **Verification:** Change month, restart app → opens on previously selected month (verified via code review).

### 4. M1 — per-transaction multi-currency support
- **Status:** ⚠️ Deferred — high-risk item
- **Why deferred:** This is the most complex item in the pass (touches every transaction path, all aggregation logic, dashboard/analytics/wealth math). The app currently uses base-currency storage with a display toggle (SEK/EUR/USD). Converting to genuine per-transaction currency requires:
  - Adding `currency` column to transactions table (migration)
  - Updating every create/edit path (manual modal, quick-add, bulk edit, CSV import, OFX import, recurring scheduler, subscription linking)
  - Converting all aggregation logic to use exchange rates at calculation time
  - Updating `formatMoney` display logic throughout
- **Not started.** Needs dedicated time for careful implementation + manual verification across all pages.

### 5. M2 — locale formatting (sv-SE / en-US / en-GB)
- **Status:** ✅ Completed
- **What changed:**
  - Created `src/renderer/src/lib/format.ts` with `AppLocale` type (`'sv-SE' | 'en-US' | 'en-GB'`), `formatNumber`, `formatMoney`, `formatDate`, `formatPercent`, `MONTH_NAMES` (backward-compatible default), `MONTH_NAMES_BY_LOCALE`, `getMonthNames`, `SUPPORTED_LOCALES`, `LOCALE_LABELS`.
  - Added `locale` field to `Profile` interface in `app-store.ts` (default `'sv-SE'`).
  - Updated `utils.ts` to re-export from `format.ts` (backward compatible).
  - Replaced hardcoded `Intl.NumberFormat('en-US', ...)` in `utils.ts` with locale-aware `formatNumber`.
  - Replaced hardcoded `toLocaleDateString('sv-SE')` in `goals.tsx` and `year-end-report.tsx` with `formatDate(..., profile.locale)`.
  - Updated `year-end-report.tsx` to use `getMonthNames(profile.locale)` for month names.
  - Added locale selector to Settings > Appearance.
  - Added `"locale":"sv-SE"` to default profile JSON in `database.ts`.
- **Files touched:** `src/renderer/src/lib/format.ts`, `src/renderer/src/lib/utils.ts`, `src/renderer/src/store/app-store.ts`, `src/renderer/src/pages/goals.tsx`, `src/renderer/src/pages/year-end-report.tsx`, `src/renderer/src/pages/settings.tsx`, `src/main/database.ts`
- **Verification:** Build succeeds. Switching locale in settings should update number/date formatting across the app. `getMonthNames()` is used in year-end-report; other pages still use backward-compatible `MONTH_NAMES` (Swedish default).

---

## Phase 3 — Build the missing items

### 6. P1-13 — Pension projection persistence
- **Status:** ✅ Completed
- **What changed:** Pension values (`current`, `monthly`, `returnRate`, `retirementAge`) now persist in the `settings` KV table under key `'pension'`. Added `pension:get` / `pension:save` IPC handlers in `handlers.ts`, exposed via preload `window.api.pension`. Updated `wealth.tsx` to load saved values on mount and save on input blur via `savePension()`.
- **Files touched:** `src/main/ipc/handlers.ts`, `src/preload/index.ts`, `src/renderer/src/pages/wealth.tsx`
- **Verification:** Edit pension inputs, blur to save, restart app → values persisted (code review verified).

### 7. P1-14 / D4 — CSV export
- **Status:** ❌ Not started
- **What needed:** New `exportTransactionsCsv()` in main process, new IPC channel, preload method, export button on transactions page. Mirror existing CSV import structure.

### 8. Q1 — Undo toast
- **Status:** ❌ Not started
- **What needed:** Toast/snackbar system. Check if shadcn/ui toast is installed. Show toast with "Undo" button on transaction delete, wired to existing `transactions:undo` handler.

### 9. A1 — "Ask AI: what changed?" comparison
- **Status:** ❌ Not started
- **What needed:** New `compareMonths()` in `ai.ts`, wired to button in `analytics.tsx`.

### 10. A2 — Spending trend sparklines on category cards
- **Status:** ❌ Not started
- **What needed:** Add inline `AreaChart` sparklines (Recharts) to budget category cards, 6-month trend.

### 11. A5 — Year-over-year comparison chart
- **Status:** ❌ Not started
- **What needed:** Wire existing dead code in `transaction-queries.ts:347-372` to IPC, build YoY chart in analytics.

### 12. D3 — Automatic backup reminder
- **Status:** ❌ Not started
- **What needed:** Track `lastBackupDate` in settings, update on CSV export/DB export, show dashboard banner if >30 days.

### 13. D5 — "Verify my data" integrity score
- **Status:** ✅ Completed
- **What changed:** Added calculated percentage/score ("X% of records verified intact") to `IntegrityPanel` in settings. Derived from existing `total`/`verified`/`failed`/`missing` counts.
- **Files touched:** `src/renderer/src/components/integrity/integrity-panel.tsx`
- **Verification:** Score = `((total - failed - missing) / total) * 100`. Badge labels: Perfect (100%), Good (≥95%), Needs Attention (≥80%), Critical (<80%).

---

## Summary

### What was reverted
- Goals AI summary feature (commit `c3a2f83`) — columns, UI, IPC handler, preload bridge all removed. Down-migration drops `ai_summary`/`ai_summary_updated` columns.

### What was fixed
- **Q3 (selectedMonth persistence):** Month filter now survives restart by persisting to settings KV.
- **M2 (locale formatting):** Centralized locale-aware formatting utility with `sv-SE`/`en-US`/`en-GB` support, locale selector in Settings, hardcoded `en-US`/`sv-SE` replaced in `utils.ts`, `goals.tsx`, `year-end-report.tsx`.
- **P1-13 (pension persistence):** Pension projection values now stored in DB and survive restart.
- **D5 (integrity score):** Added calculated percentage display to integrity panel.

### What was newly built
- Pension projection persistence via IPC + DB storage.
- Integrity score percentage calculation with tiered badges.
- Locale-aware formatting infrastructure + Settings UI + month name localization.

### What's NOT fully confident about / needs manual testing
- **M1 (per-transaction multi-currency):** Not started. This is the highest-risk item — every aggregation path needs to convert through rates. Needs careful implementation and manual verification with 2+ currencies.
- **D5 integrity score:** Formula is straightforward but should be validated against actual scan results.
- **P1-13 pension persistence:** IPC handlers added and preload bridge wired, but needs runtime verification (restart test).

### Not started (remaining pass items)
- P1-14/D4 (CSV export)
- Q1 (undo toast)
- A1 (AI compareMonths)
- A2 (sparklines)
- A5 (YoY chart)
- D3 (backup reminder)