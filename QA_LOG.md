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
