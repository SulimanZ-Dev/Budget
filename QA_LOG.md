## [AI Assistant] - assistant reply state widens role type
- Type: bug fix
- Age: pre-existing (before this session)
- Repro: Pass 1: ran `npx tsc --noEmit -p tsconfig.web.json`; TypeScript failed in `src/renderer/src/pages/ai-assistant.tsx` because `setMessages((m) => [...m, { role: 'assistant', content: reply }].slice(-50))` inferred `role` as `string`. Pass 2: reran the same command after Part 1 and observed the same failure before editing.
- Expected: The AI Assistant page should typecheck with `Message.role` narrowed to `'user' | 'assistant'`.
- Actual: The appended assistant reply object widened to `{ role: string; content: any }`, breaking the `Message[]` state updater type.
- Root cause: The inline assistant message object was not contextually typed after array spreading and slicing.
- Fix: Added an explicitly typed `assistantMsg: Message` before appending the reply to message state.
- Commit: `b86cfd6`
- Verified: Pass 1: reran `npx tsc --noEmit -p tsconfig.web.json`; the AI Assistant error disappeared and only Subscriptions errors remained. Pass 2: reran the same command and again observed only the Subscriptions errors.

## [Subscriptions] - add form resets omit tax and hold fields
- Type: bug fix
- Age: added this session (tax/hold fields appear to be recent additions)
- Repro: Pass 1: ran `npx tsc --noEmit -p tsconfig.web.json`; TypeScript failed in `src/renderer/src/pages/subscriptions.tsx` at the Add button reset because `setForm({ name, amount, url, date })` omitted `taxDeductible` and `onHold`. Pass 2: after the AI Assistant fix, reran the same command and observed the same Subscriptions failure. Code inspection found the same incomplete reset in the EmptyState action.
- Expected: Every reset of the subscription form should preserve the full form state shape, including `taxDeductible` and `onHold`, so repeated Add actions start from a complete default form.
- Actual: Two reset paths provided only four of the six state fields, causing renderer typecheck failure and risking stale checkbox state on repeat use.
- Root cause: The form state shape was extended without updating all reset call sites.
- Fix: Updated both form reset paths to include `taxDeductible: false` and `onHold: false`.
- Commit: `3604180`
- Verified: Pass 1: `npx tsc --noEmit -p tsconfig.web.json` completed successfully. Pass 2: reran the same command and it completed successfully again.

## [Plugins] - version compatibility shadows Electron app
- Type: bug fix
- Age: pre-existing (before this session)
- Repro: Pass 1: ran `npm run typecheck`; TypeScript failed in `src/main/plugins/plugin-manager.ts` because `const app = parseSemver(appVersion)` shadows the imported Electron `app`, so `app.getVersion()` is treated as a use-before-declaration. Pass 2: after renderer type fixes, reran `npm run typecheck` and the same Node-side plugin-manager error remained.
- Expected: Plugin version compatibility should compare the Electron app version with the plugin minimum version and the full typecheck should not fail on shadowed names.
- Actual: The local parsed-version variable shadowed the Electron import, creating TypeScript use-before-assignment errors.
- Root cause: A local variable was named `app` inside `isVersionCompatible`, colliding with the imported Electron `app`.
- Fix: Renamed the parsed current app version variable from `app` to `current` and updated the comparisons.
- Commit: Pending.
- Verified: Pass 1: `npm run typecheck` completed successfully. Pass 2: reran `npm run typecheck` and it completed successfully again.
