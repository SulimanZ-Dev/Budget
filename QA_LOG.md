## [AI Assistant] - assistant reply state widens role type
- Type: bug fix
- Age: pre-existing (before this session)
- Repro: Pass 1: ran `npx tsc --noEmit -p tsconfig.web.json`; TypeScript failed in `src/renderer/src/pages/ai-assistant.tsx` because `setMessages((m) => [...m, { role: 'assistant', content: reply }].slice(-50))` inferred `role` as `string`. Pass 2: reran the same command after Part 1 and observed the same failure before editing.
- Expected: The AI Assistant page should typecheck with `Message.role` narrowed to `'user' | 'assistant'`.
- Actual: The appended assistant reply object widened to `{ role: string; content: any }`, breaking the `Message[]` state updater type.
- Root cause: The inline assistant message object was not contextually typed after array spreading and slicing.
- Fix: Added an explicitly typed `assistantMsg: Message` before appending the reply to message state.
- Commit: Pending.
- Verified: Pass 1: reran `npx tsc --noEmit -p tsconfig.web.json`; the AI Assistant error disappeared and only Subscriptions errors remained. Pass 2: reran the same command and again observed only the Subscriptions errors.

## [Subscriptions] - add form resets omit tax and hold fields
- Type: bug fix
- Age: added this session (tax/hold fields appear to be recent additions)
- Repro: Pass 1: ran `npx tsc --noEmit -p tsconfig.web.json`; TypeScript failed in `src/renderer/src/pages/subscriptions.tsx` at the Add button reset because `setForm({ name, amount, url, date })` omitted `taxDeductible` and `onHold`. Pass 2: after the AI Assistant fix, reran the same command and observed the same Subscriptions failure. Code inspection found the same incomplete reset in the EmptyState action.
- Expected: Every reset of the subscription form should preserve the full form state shape, including `taxDeductible` and `onHold`, so repeated Add actions start from a complete default form.
- Actual: Two reset paths provided only four of the six state fields, causing renderer typecheck failure and risking stale checkbox state on repeat use.
- Root cause: The form state shape was extended without updating all reset call sites.
- Fix: Updated both form reset paths to include `taxDeductible: false` and `onHold: false`.
- Commit: Pending.
- Verified: Pass 1: `npx tsc --noEmit -p tsconfig.web.json` completed successfully. Pass 2: reran the same command and it completed successfully again.
