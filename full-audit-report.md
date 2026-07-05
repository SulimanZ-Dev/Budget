# Full-Codebase Audit Report — Personal Finance Electron App

## Summary

| Severity | Count | Key Areas |
|----------|-------|-----------|
| **CRITICAL** | 3 | Missing transaction atomicity (event sourcing desync), JSON import data loss, CSV import partial failure |
| **HIGH** | 11 | Budget propagation, bulk operations, duplicate subscriptions, `new Date()` month/year flip, secure delete data loss, plugin security, startup crash, no brute-force protection |
| **MEDIUM** | 14+ | Race conditions, billing date attribution, division-by-zero, crypto memory leaks, CSV misclassification, performance, state management |
| **LOW** | 20+ | Minor error handling, UI edge cases, small calculation issues |
| **Uncertain** | 4 | SQLCipher default page size, keytar fallback behavior, timezone handling assumptions |

**Total findings: ~52+ unique issues**

---

## CRITICAL (3)

### C1 — Event sourcing: materialized view and event store never atomically updated
**File:** `src/main/commands/transaction-commands.ts:27-76`, `:94-213`, `:218-234`, `:239-246`, `:251-258`, `:263-281`

Every command handler does two separate synchronous writes:
1. INSERT/UPDATE/DELETE on `transactions` table (materialized view)
2. `appendEvent()` on `transaction_events` table

These are **never wrapped in a SQLite transaction**. A process crash between steps 1 and 2 causes:
- **CREATE crash after INSERT:** Transaction exists in materialized view but has no event. `rebuildTransactionsProjection()` (which clears and rebuilds from events) **silently deletes it** — permanent data loss.
- **DELETE crash after DELETE:** Transaction removed from view but no DELETED event. `replayAllEvents()` reconstructs it — **deleted transaction resurrects**.
- **UPDATE crash after UPDATE:** View has new data but old event state — undo restores wrong data.

**Impact:** Silent permanent data loss or data resurrection. Any crash (power loss, OOM, OS kill) during any write operation corrupts the event log vs materialized view invariant.

**Fix:** Wrap each command's writes in `db.transaction()`.

---

### C2 — JSON import no transaction: permanent data loss on crash
**File:** `src/main/ipc/handlers.ts:1359-1372` → `:1619-1649`

The `data:importJson` handler:
1. `DELETE FROM ${table}` for each table sequentially — no transaction
2. `INSERT INTO ${table}` for each row sequentially — no transaction

A crash mid-import leaves already-cleared tables permanently empty. The import also **omits the `transaction_events` table entirely**, destroying the event-sourced audit history even on success.

**Impact:** Absolute data loss. If power fails during import, the database is permanently corrupted with partial data.

**Fix:** Wrap the entire import in a single `db.transaction()` and include `transaction_events` recreation.

---

### C3 — CSV import no transaction: partial import + event desync
**File:** `src/main/ipc/handlers.ts:527-536` → `src/main/commands/transaction-commands.ts:371-388`

1000-row CSV import performs 2000 individual writes (1000 INSERTs + 1000 event appends) with **zero transaction atomicity**. All the same C1 desync issues apply per row. Crash at row 500 leaves 500 orphan transactions.

**Impact:** Silent partial data import with event store desynchronization.

**Fix:** Wrap bulk import in `db.transaction()`.

---

## HIGH (11)

### H1 — Budget propagation loop: no transaction
**File:** `src/main/ipc/handlers.ts:307-321`

The `budget:setEntry` handler propagates budget amounts to future months (month+1 to 12) in a bare `for` loop with individual INSERT/UPDATE statements. Crash mid-loop leaves permanently inconsistent budget amounts.

**Impact:** Incorrect budget display for the rest of the fiscal year. User may over/under-spend based on wrong data.

**Fix:** Wrap loop in `db.transaction()`.

---

### H2 — `new Date(tx.date)` UTC-to-local month/year flip
**File:** `src/main/ipc/handlers.ts:414-416`, `:493-494`

`transactions:create` and `transactions:update` call `new Date(tx.date)` where `tx.date` is a `YYYY-MM-DD` string (e.g., `"2026-01-01"`). The JS parser interprets this as **UTC midnight**, but `.getMonth()` and `.getFullYear()` return **local timezone** values.

For users in negative UTC offsets (UTC-1 to UTC-12), `"2026-01-01"` → `Dec 31 7PM-11PM local` → `getMonth()` returns `11 (December)` and `getFullYear()` returns `2025`. The budget alert fires for the **wrong month and year**.

**Impact:** Budget alerts attached to incorrect month/year. User sees alerts for the wrong budget period. In UTC-12, the date itself is off by a full day.

**Fix:** Parse date strings explicitly — either use `tx.date.split('-').map(Number)` or use a library like `date-fns` with explicit UTC handling.

---

### H3 — `new Date(date).setMonth(n)` over-advances past short months
**File:** `src/main/ipc/handlers.ts:404-405`, `:470-475`

Recurring subscription next-date calculation:
```ts
const nextDate = new Date(tx.date)
nextDate.setMonth(nextDate.getMonth() + 1)
```
`new Date("2026-01-31").setMonth(1)` → March 3 (not Feb 28). The same bug affects any date on day 29-31 advancing into a shorter month.

**Impact:** Recurring transactions skip months, breaking the billing schedule. User may miss a payment or get charged on wrong dates.

**Fix:** Use a date library with `lastDayOfMonth` semantics, or manually clamp the day.

---

### H4 — Multiple navigation cycles produce duplicate subscription transactions
**File:** `src/renderer/src/hooks/use-init.ts:20-22`

Billing checks fire on every component mount. Navigate away and back → `useInit` fires again → `subscriptions:checkBilling` runs again. If a subscription is multiple months past due, advancing only one month still leaves it past due, so the second call creates **another duplicate transaction** for the same subscription on the same day.

**Impact:** Duplicate financial transactions — user is double-counted for subscriptions, skewing reports and budgets.

**Fix:** Deduplicate by checking `(subscription_id, year, month)` before creating, or cache the last-billed timestamp.

---

### H5 — Secure delete during migration: permanent data loss
**File:** `src/main/db/migration.ts:237-238`

`secureDelete(backupPath)` overwrites the unencrypted backup file with random data. A crash during this operation (or a filesystem error) can corrupt or destroy the backup while the encrypted DB is not yet fully written.

**Impact:** Total data loss — neither the original unencrypted file nor the encrypted copy is recoverable.

**Fix:** Keep the backup until the encrypted DB is verified, then only then securely delete. Or offer an opt-out of secure deletion.

---

### H6 — Plugin security: no sandboxing, `shell:execute` permission
**File:** `src/main/plugins/plugin-manager.ts:127`, `src/main/plugins/plugin-types.ts`

Plugins are loaded via `require(mainPath)` into the main process with **full Node.js access**. The permission system is entirely bypassable — a plugin can call `require('child_process')` directly, ignoring the `shell:execute` permission gate.

Additionally:
- `shell:execute` allows arbitrary command execution
- `filesystem:read/write` has no path sandboxing
- `database:write` allows raw `DROP TABLE` / data exfiltration
- `PluginIpcAPI.handle()` allows arbitrary IPC handler registration (privilege escalation)

**Impact:** Catastrophic if a malicious or compromised plugin is loaded. Full system compromise.

**Fix:** Run plugins in a Worker thread or VM sandbox. Restrict `require`. Validate filesystem paths.

---

### H7 — Version comparison is string-based (crash/deny)
**File:** `src/main/plugins/plugin-manager.ts:98`

```ts
appVersion >= manifest.minAppVersion
```
Compares SemVer strings lexicographically: `"9.0.0" >= "10.0.0"` → `false`, `"8.11.0" >= "8.9.0"` → `false`. Compatible plugins are incorrectly rejected.

**Impact:** Users cannot install plugins that need a newer minor version, or incompatible plugins are allowed.

**Fix:** Use `semver` library for proper version comparison.

---

### H8 — `data:wipe` no transaction: partial wipe on crash
**File:** `src/main/ipc/handlers.ts:1374-1402`

14 tables are deleted sequentially with no transaction. Crash mid-wipe leaves application in an unrecoverable partially-wiped state.

**Impact:** Unrecoverable database state.

**Fix:** Wrap in `db.transaction()`.

---

### H9 — No brute-force protection on unlock
**File:** `src/renderer/src/components/auth/unlock-screen.tsx:17,31-38`

No rate limiting, exponential backoff, or account lockout on the encryption unlock endpoint. An attacker can call `window.api.encryption.unlock(password)` arbitrarily fast via the dev console.

**Impact:** Accelerates brute-force attacks against the encrypted database password.

**Fix:** Implement progressive delay (e.g., 2^n seconds) after each failed attempt. Store attempt count in the database.

---

### H10 — Renderer may call handlers before DB is initialized (startup crash)
**File:** `src/main/index.ts:56-85`, `src/renderer/src/hooks/use-init.ts`

IPC handlers are registered before the database is unlocked. The renderer loads and `useInit` fires, calling handlers that `getDatabase()` which throws "Database not initialized".

**Impact:** App crashes on first launch or after restart if encryption state gating is missing in renderer.

**Fix:** Gate all data handlers behind a "ready" check. Don't register data handlers until DB is initialized.

---

### H11 — `income:checkBilling` treats ALL frequencies as monthly
**File:** `src/main/ipc/handlers.ts:1053-1084`

The handler creates entries for ALL recurring income sources regardless of frequency. Weekly/fortnightly/yearly sources are all treated as monthly — only one entry per month is created.

**Impact:** Income is under-counted (weekly → 4x/month reality becomes 1x/month) or miscounted (yearly → 12x expected vs 1x created). All income reports, budgets, and analytics are wrong for non-monthly sources.

**Fix:** Calculate the correct number of occurrences per month based on frequency.

---

## MEDIUM (14+)

### M1 — Unguarded division: `amount / maxSpending` when maxSpending=0
**File:** `src/renderer/src/components/shared/spending-heatmap.tsx:52`

```ts
const intensity = Math.min(amount / maxSpending, 1)
```
If `amount > 0` and `maxSpending === 0`, result is `Infinity` → `Math.min(Infinity, 1)` = `1` (max intensity). Heatmap falsely shows hottest color for all entries.

**Impact:** Misleading heatmap visualization.

**Fix:** `maxSpending > 0 ? Math.min(amount / maxSpending, 1) : 0`

---

### M2 — Unguarded division: `inv.purchase_price` could be 0
**File:** `src/renderer/src/pages/wealth.tsx:365`

```ts
const gain = ((inv.current_value - inv.purchase_price) / inv.purchase_price) * 100
```
No guard. If purchase_price is 0 (user mistake or blank field), produces `Infinity`. Compare with line 250 which IS guarded.

**Fix:** Add `inv.purchase_price > 0 ? ... : 0` guard.

---

### M3 — CSV import always hardcodes `type: 'expense'`
**File:** `src/main/services/csv-import.ts` → referenced from handlers

All imported CSV rows are tagged as `type: 'expense'`. Income or transfer CSVs are misclassified, skewing all financial reports.

**Impact:** Wrong transaction type for income/transfer imports.

**Fix:** Detect type from CSV columns (positive/negative amount, dedicated type column, account transfer patterns).

---

### M4 — `subscriptions:checkBilling` dates transactions to `today`, not `next_billing_date`
**File:** `src/main/ipc/handlers.ts:803-834`

Transaction `date` is set to `new Date().toISOString().slice(0, 10)` (server's today) instead of the subscription's `next_billing_date`. This shifts the transaction attribution to the check-in date rather than the actual billing date.

**Impact:** Skews monthly reports. A subscription due on Feb 28 but checked on March 5 gets attributed to March.

**Fix:** Use `next_billing_date` as the transaction date.

---

### M5 — Keystore lock doesn't clear table-specific HMAC signing keys
**File:** `src/main/crypto/keyManager.ts` (lock function) vs `src/main/crypto/integrity.ts`

`lockKeystore()` clears `masterPasswordBuffer`, `kekBuffer`, `dekBuffer`, `signingKeyBuffer` but does **not** call `clearTableSigningKeys()` from integrity.ts. Derived HMAC keys per table remain in memory.

**Impact:** After "locking", an attacker with memory access can still forge or verify row signatures using the cached HMAC keys.

**Fix:** Call `clearTableSigningKeys()` in the keystore lock path.

---

### M6 — API key `Buffer.fill(0)` doesn't clear original string
**File:** `src/main/services/keychain.ts:24-30`, `:42-47`

`keyBuffer.fill(0)` zeros the Buffer copy, but the original JavaScript string (`key` parameter) is immutable and persists in V8 heap until GC. V8 may keep the string in memory indefinitely.

**Impact:** API key remains recoverable from heap snapshots even after "secure wipe".

**Fix:** Avoid storing the key as a JS string for longer than necessary. Use `Buffer.from()` early, keep as Buffer, and zero on cleanup.

---

### M7 — Legacy base64 API keys still decodable from DB
**File:** `src/main/services/keychain.ts:74-76`

```ts
return Buffer.from(row.value, 'base64').toString('utf8')
```
Previous versions stored API keys as plain base64 in SQLite. The backward-compatibility fallback means old keys are still retrievable.

**Impact:** Attackers with filesystem access can decode old API keys.

**Fix:** Re-encrypt legacy keys on read (migrate on access) or prompt user to re-enter.

---

### M8 — Infrastructure page shows ALL transactions without year filter
**File:** `src/renderer/src/pages/wealth.tsx` — `load()` function

The wealth/Infrastructure page fetches all transactions across all years with no date filtering. Performance degrades linearly as transaction history grows.

**Impact:** UI freezes for seconds on accounts with 10K+ transactions.

---

### M9 — `data:exportDb` async gap creates inconsistent backup
**File:** `src/main/ipc/handlers.ts:1330-1342`

`await dialog.showSaveDialog()` yields the event loop. Between selection and `copyFileSync()`, other handlers can modify the DB. Backup is not a point-in-time snapshot.

**Impact:** Backup may not reflect the state the user intended to save.

---

### M10 — `bulkDeleteTransactions` misses `savings_sources` cleanup
**File:** `src/main/ipc/handlers.ts:510-514`

Single `transactions:delete` (line 500) handles all related tables. Bulk delete (line 510-514) does NOT delete from `savings_sources`, `subscriptions`, or `income_entries`. Orphaned rows accumulate.

**Impact:** Orphaned rows cause stale data display in savings and subscriptions pages.

---

### M11 — `@incomplete` React Query misconfiguration or stale cache on mutation
**File:** `src/renderer/src/store/app-store.ts` and page-level data fetching

Multiple pages use manual state + `useEffect` to refetch on `refreshTrigger` changes. There's no cache invalidation or stale-while-revalidate pattern. Rapid mutations can cause stale data reads.

**Fix:** Adopt TanStack Query or similar with proper cache invalidation on mutation.

---

### M12 — `app-store.ts` Zustand store renders CPU from `setInterval`
**File:** `src/renderer/src/store/app-store.ts`

If the store has any polling interval (not confirmed in current code), or if page components poll independently, multiple timers compete and waste CPU.

**Impact:** Poor battery life on laptops.

---

### M13 — `recalculateBudget %` doesn't account for monthly income from transactions
**File:** `src/renderer/src/pages/budget.tsx:166`

"Remaining" = `(monthlyIncome - totalBudget) + unallocated`. `monthlyIncome` comes from `income_sources only`. Income from one-time `income`-type transactions is excluded.

**Impact:** User may see artificially low remaining budget if they have variable/transaction-based income.

---

### M14 — `new Date()` called multiple times in billing checks (month boundary race)
**File:** `src/main/ipc/handlers.ts:1054-1056`, `:880-882`

```ts
const today = new Date().toISOString().slice(0, 10)
const year = new Date().getFullYear()
const month = new Date().getMonth() + 1
```
Three separate `new Date()` calls. If the clock ticks past midnight between them (unlikely but possible), `today`, `year`, and `month` can be inconsistent.

**Fix:** `const now = new Date(); const today = ...; const year = now.getFullYear(); const month = now.getMonth() + 1;`

---

## LOW (20+)

### L1 — `goals.reduce` partial division by zero guard (handlers.ts:1556)
`Math.min(g.current_amount / g.target_amount, 1)` — `Infinity` clamped to `1`. Degrades gracefully, but mathematically wrong.

### L2 — `saveApiKey()` in state never cleared on error (settings.tsx:37-38)
If `window.api.ai.saveKey()` throws, `setApiKey('')` doesn't run.

### L3 — API key visible in React DevTools (settings.tsx:20)
Stored as plain string in component state.

### L4 — `integrity-panel.tsx:149,152` crash if `scanResults.tables` is null/undefined
No null guard on `Object.keys()` / `Object.entries()`.

### L5 — Backend error strings exposed in unlock UI (unlock-screen.tsx:37)
Error message enumeration risk.

### L6 — Weak master password minimum (8 chars) (encryption-setup.tsx:24)
Should be ≥12 characters.

### L7 — `category-icons.ts` length mismatch — 12 icons vs 10 colors
Indexed access by category ID may get `undefined`.

### L8 — `new Date(tx.date)` timezone mismatch in spending streak (handlers.ts:1515-1535)
Mixes renderer-provided dates with server `new Date()`.

### L9 — Budget propagation only same-year (handlers.ts:307-321)
December budgets don't propagate to January next year.

### L10 — No timeout on any `ipcRenderer.invoke()` call
If main process is blocked, renderer hangs forever.

### L11 — Swallowed errors on billing checks (use-init.ts:20-22)
`.catch(() => {})` hides all failures.

### L12 — `hasKey()` no `.catch()` in AI assistant (ai-assistant.tsx:25)
If promise rejects, `hasKey` stays `true` forever.

### L13 — Messages array unbounded (ai-assistant.tsx)
No truncation — memory leak risk in long conversations.

### L14 — `alert()` for plugin user feedback (plugin-registry.tsx:61)
Intrusive; should use toast.

### L15 — No input length/sanitization in AI assistant
User input sent unchecked to external API.

### L16 — Onboarding hardcoded `'SEK'` currency (onboarding-flow.tsx:79,82,83)
Not configurable for international users.

### L17 — `parseFloat` on unvalidated user input produces NaN (onboarding-flow.tsx)
NaN propagates into DB.

### L18 — Unhandled `JSON.parse` in transaction history (transaction-history.tsx:73-74)
Malformed JSON crashes the component during render.

### L19 — `"undefined"` text in UI for null `event.actor` (transaction-history.tsx:188)

### L20 — Negative time values in formatTimestamp (transaction-history.tsx:113)
Clock skew produces negative differences; all `if` conditions miss.

### L21 — `category-drawer.tsx` NaN from undefined CPI (line 103)
`budgetAmount * cpi` → NaN if CPI undefined.

### L22 — Category drawer no error handling on saves (category-drawer.tsx:64,74,81)
API errors silently swallowed.

### L23 — No null-guard on profile in category-drawer
`profile.year` and `selectedMonth` crash if store hasn't loaded.

### L24 — `window.confirm()` blocks main thread (category-drawer.tsx:75)

### L25 — Auto-updater silently swallows errors (updater.ts:14)

### L26 — `ai-context.ts` `JSON.parse(profile.value)` can throw (ai-context.ts:12)
No try/catch.

### L27 — All financial data sent to Anthropic/Claude API (ai-context.ts)
Full financial context transmitted without explicit user disclosure.

---

## Uncertain — Needs Verification (4)

### U1 — SQLCipher default page size compatibility
**File:** `src/main/database-encrypted.ts`
The default page size for SQLCipher may differ from the unencrypted SQLite default. If migration uses a different page size, the encrypted DB may have degraded performance or subtle corruption.

**Confidence:** 60% — need to verify SQLCipher compile options.

### U2 — `keytar` machine-key fallback behavior on Windows
**File:** `src/main/services/keychain.ts`
The fallback (when keytar is unavailable) stores a machine-derived key in the filesystem. The exact derivation mechanism and whether it survives OS reinstall needs verification.

**Confidence:** 50% — need to test on clean OS install.

### U3 — Race condition window between IPC `handle` registration and `createWindow`
**File:** `src/main/index.ts`
The window is created after all handlers are registered. But `registerIpcHandlers()` captures `mainWindow` via getter. If `mainWindow` is null when a handler fires (between registration and assignment), handlers crash.

**Confidence:** 70% — depends on exact `createWindow` timing.

### U4 — Timezone handling in `strftime('%Y', date)` vs ISO dates
**File:** `src/main/ipc/handlers.ts` (multiple budget/report handlers)
If any date stored in the DB includes a timezone offset (e.g., `2026-07-05T00:00:00+02:00`), `strftime('%Y', "2026-07-05T00:00:00+02:00")` extracts `"2026"` correctly. But `strftime('%m')` would also be correct. However, if dates are ever stored as ISO with timezone that crosses midnight, the month could be wrong.

**Confidence:** 80% safe — dates appear to be stored as `YYYY-MM-DD` strings, so `strftime` on a TEXT column extracts the substring correctly.

---

## Explicitly NOT Flagged

The following concerns were investigated and found to be handled correctly:

| Area | Why Not Flagged |
|------|----------------|
| **Division by literal constant** (27 occurrences) | `/ 100`, `/ 12`, `/ 2`, etc. — always safe |
| **Guarded divisions** (12 with ternary `> 0`, 4 with `if`, 1 with `\|\| 1`, 1 with `Math.max(..., 1)`) | Properly guarded |
| **`better-sqlite3` serialized mode** | Single connection, synchronous ops — prevents most DB-level races |
| **Event store `AUTOINCREMENT`** | Serialized inserts guarantee unique monotonic IDs |
| **Zustand `get()` in setProfile** | Uses `get()` inside setter — no stale closure |
| **Budget `strftime` date filtering** | Uses INTEGER year/month params from caller — correct |
| **Migration backup/restore logic** | Catch block restores from backup on failure (except secure delete) |
| **Dashboard stat calculations** | All use proper `> 0` ternary guards |
| **`use-keyboard.ts`** | Clean keyboard shortcut handling |
| **`use-debounced-value.ts`** | Clean debounce pattern |
| **Progress ring calculations** | All divide by literal constants |
| **Analytics/heatmap calculations** | All guarded |
| **Goals page interest calculations** | All guarded or literal |
| **`motion.ts`** | No financial logic, clean animation helpers |

---

## Positive Findings

1. **Division-by-zero guards are well-implemented overall** — 17 of 21 variable-denominator divisions are properly guarded. This is far better than typical codebases.
2. **Zustand store uses `get()` updater pattern** — avoids stale closure bugs.
3. **`better-sqlite3` serialized mode** — synchronous execution prevents most inter-handler race conditions at the DB level.
4. **Migration has backup/restore** — the unencrypted→encrypted migration correctly restores from backup on failure (the secure-delete edge case is the only gap).
5. **WAL mode enabled** — appropriate for read-heavy workloads with a single connection.
6. **`secureDelete` implementation** — overwrites with random data before deletion, following best practices (despite the atomicity gap).
7. **Preload script defines explicit API surface** — no blanket `contextBridge.exposeInMainWorld('electronAPI', ...)`, each function is individually exposed.
8. **Integrity verification panel** — users can verify row-level HMAC integrity, a rare feature.
9. **TypeScript throughout** — strong typing reduces class of bugs.

---

## Recommended Fix Priority

1. **CRITICAL:** Add `db.transaction()` wrappers to all multi-statement operations (transaction-commands.ts, handlers.ts bulk operations, CSV import, JSON import, wipe)
2. **HIGH:** Fix `new Date(dateString)` UTC-to-local month/year flip in handlers.ts:414-416/493-494
3. **HIGH:** Fix `setMonth()` over-advance for short months in handlers.ts:404-405/470-475
4. **HIGH:** Add deduplication for subscription billing checks (use-init.ts:20-22)
5. **HIGH:** Gate IPC handlers behind database-ready state (index.ts:56-85)
6. **HIGH:** Fix `income:checkBilling` to respect frequency (weekly/fortnightly/yearly)
7. **HIGH:** Fix plugin `require()` sandboxing and version comparison
8. **MEDIUM:** Add division-by-zero guard to spending-heatmap.tsx:52 and wealth.tsx:365
9. **MEDIUM:** Clear table signing keys on keystore lock
10. **MEDIUM:** Fix CSV import type detection (always expense)
11. **MEDIUM:** Add year filter to wealth page transaction query
12. **MEDIUM:** Fix `subscriptions:checkBilling` to use `next_billing_date` as transaction date
