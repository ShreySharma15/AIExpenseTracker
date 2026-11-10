# Development checklist

Checked items represent work actually completed, not intended features.

## Planning and setup

- [x] Read the user's project brief.
- [x] Inspect workspace and ancestor instruction files: empty project, no Git repository.
- [x] Check installed Node.js, npm, and Git.
- [x] Document architecture, accounting invariants, schema, and folder structure.
- [x] Create credential-free .env.example and .gitignore.
- [x] Document manual setup and ownership of tasks.
- [x] User selected Gemini 3.5 Flash-Lite, strictly free tier.
- [x] Hosted owner account exists and public signup is disabled.
- [x] Telegram bot and private chat verified against the live API.
- [x] Gemini key stored locally. Owner confirmed Free tier and no linked billing.
- [x] Verify Supabase owner, Telegram bot and private chat, and Gemini model metadata.
- [x] Generate local webhook and scheduler secrets.
- [x] Gemini 2.5 Flash-Lite returned HTTP 404. Owner selected Gemini 3.5 Flash-Lite and both live synthetic probes passed.
- [x] Gemini 3.5 Flash-Lite plain text and structured JSON returned HTTP 200. Each response had one candidate, one visible text part with a thought signature, finish reason STOP, and no Google error. The app schema accepted the synthetic ₹250 expense as 25,000 paise.
- [x] Owner confirmed Gemini 3.5 Flash-Lite quota of 15 RPM, 250,000 TPM, and 500 RPD in the unbilled Free project. Configured the local cap to 10 RPD.
- [x] Configured the GitHub remote and verified the existing default branch is `main`.
- [x] Owner explicitly approved public GitHub visibility. Audited and pushed the initial commit with GitHub noreply metadata, then verified origin/main.

## Phase 1 — Text entry and monthly dashboard

**Release status: BLOCKED pending production monitoring verification.** Core production acceptance passed on November 10, 2026. The latest session, accessibility, and monitoring checks passed on a local production build.

### Milestone 1A: Foundation

- [x] Next.js, TypeScript, Tailwind, and a shadcn/ui Button integrated with pinned dependencies. Production build passed.
- [x] Config verifier, server-only database clients, lint/type/build checks, and CI workflow.
- [x] Ledger migrations, baseline categories, owner configuration, RLS and transactional mutations.
- [x] Implement paise parsing, dates, derived balanced postings, revisions, voiding, and batch idempotency.
- [x] Test atomic batches, replay, RLS isolation, stale edits, reversals, draft confirmation, and the AI quota in local PostgreSQL.
- [x] Domain and database tests cover invalid precision, overflow, India month boundaries, rollback, repeated and competing correction calls, reversals, and owner isolation. Hosted queue and ledger replay checks verified duplicate delivery.

Gate: local checks and database integration tests pass before Telegram feature work.

- [x] Hosted migrations 001 and 002 verified. Anonymous reads and expense mutation denied. Synthetic create, replay, edit, void and reversal checks passed.

### Milestone 1B: Telegram text

- [x] Added marker-based private-chat discovery. The live run refused to poll the active production webhook. Setup verification confirmed the configured owner and chat without printing credentials.
- [x] grammY private-chat owner checks and webhook-secret verification.
- [x] Structured parser for single/multiple personal expenses, explicit dates, today and yesterday.
- [x] Coverage metadata, persisted Gemini confirmation drafts, and dashboard edit/void history.
- [x] Implement owner-only Telegram `/edit` and `/undo` with explicit ID and version, an idempotent mutation record, and a Cancel button for unconfirmed drafts. Tests cover cross-owner access, stale versions and replay. Clarifications request a complete revised message.
- [x] Production migration 004 RPC responded. Real Telegram `/add`, `/edit` and `/undo` succeeded. The production dashboard showed one edited expense at version 2, then no active result with create v1, edit v2 and void v3 in history.
- [x] Real Telegram AI draft showed **Cancel** and **Save expenses**. Cancel closed the draft, and Save on that same draft was rejected. The filtered production dashboard showed no entry. A targeted database check confirmed no draft or ledger revision remained. The first Gemini request was unavailable and one retry succeeded.
- [x] Production replay of the original synthetic source returned its existing expense ID. Revision count remained three and the voided expense stayed inactive.
- [x] Implement durable inbox and reply delivery with expiring leases, retries and deduplication. Local database tests exercise recovery, stale leases, reply retries and the scheduler SQL with test stubs.
- [x] Hosted recovery migration 003 verified. Synthetic recovery exercised inbox deduplication, exclusive lease, stale lease rejection, outbox delivery stage and terminal scrubbing.
- [x] Owner enabled the recovery schedule. A directly enqueued synthetic job reached `done` automatically in 35 seconds, with the reply delivered and the payload scrubbed.
- [x] Pin gemini-3.5-flash-lite. The example defaults to paused and the verified local environment is capped at 10 requests/day.
- [x] Verified owner-reported Free quota and local quota exhaustion and provider 429 handling. Live synthetic Gemini parsing, hosted confirmation and duplicate confirmation, and manual fallback passed. The synthetic expense was voided.
- [x] Gemini request tests verified unknown labels are replaced, common sensitive identifiers are blocked, and labels are restored locally. Synthetic inputs only for tests. Sensitive entries use the manual path.
- [x] Add a structured non-AI entry command and reject recognizable loan and split messages on the plain text path.
- [x] Add opt-in Gemini parsing, an expiring confirmation draft, and one save per draft.
- [x] Test 3.5 response parsing, including thought parts and truncation, local draft confirmation, duplicate confirmation, and provider 429 handling.
- [x] Tests cover malformed and refused output, pseudonymized instruction-like input, unauthorized updates, manual routing for debts and split/payer ambiguity, invalid amount/date output, atomic batches, replay after commit, and competing edits.

Gate: authorized Telegram messages save once; unauthorized messages cannot read/write or invoke AI; ambiguous messages write nothing until resolved.

### Milestone 1C: Dashboard and release

- [x] Owner-only dashboard verified with a temporary hosted Supabase session, then revoked. Anonymous access redirects and public signup is disabled.
- [x] Owner confirmed production password sign-in and browser logout.
- [x] Playwright on the local production build verified logout clears the session cookie, protected navigation redirects, and an expired session with a revoked refresh token is denied.
- [x] Implement mobile dashboard, transaction list/edit, search, month/category filters and pagination.
- [x] Implement monthly personal totals, gross payments, category breakdown, and previous full-month comparison.
- [x] Four-section dashboard navigation, including a Phase 2 placeholder for people and groups.
- [x] Local production build passed Chromium installability checks in a disposable profile. Offline navigation to login and the dashboard showed the static shell, reconnect restored sign-in, and Cache Storage contained only the public offline shell.
- [x] Owner confirmed the deployed PWA offline smoke check.
- [x] Playwright verified accessible labels and roles, keyboard order, visible focus, skip-link focus, login error, empty results, and 320px layout. Axe returned no configured WCAG A/AA violations on login and the dashboard.
- [x] The production browser smoke covered actual Telegram entry, edits and voids. Hosted dashboard HTTP tests covered monthly totals. Playwright separately covered browser auth and logout. The flows were verified in separate runs.
- [x] Nine automated tests, lint, type checking and the production build passed. Local HTTP tests verified the authenticated dashboard, filters, revision history, private caching and rejected webhook requests.
- [x] Browser smoke test verified the production Telegram correction and draft controls plus the matching dashboard views. Database checks separately verified replay and ledger state.
- [x] Owner deployed to Vercel. Production login page, anonymous dashboard redirect, and no-store owner dashboard verified.
- [x] Production dashboard opened with a temporary hosted owner session. RLS, create/edit/void actions, movement between monthly totals, filters, revision history, and the production sign-out action passed. The synthetic expense was voided.
- [x] Registered the production Telegram webhook. Telegram reported no pending updates or recorded delivery errors. Production rejected a missing webhook secret. A signed synthetic replay delivered a bot reply and produced one expense, which was voided.
- [x] Owner confirmed real Telegram expense creation. The Telegram API independently reported the exact production webhook URL and zero queued updates.
- [x] Owner confirmed a real Gemini draft and confirmation, and verified the Vercel Production cap of 10/day. The scheduled synthetic probe produced the expected draft without a ledger write before confirmation. Replaying confirmation returned the same expense ID. The synthetic expense was voided.
- [x] Production recovery endpoint rejected unauthenticated calls and returned HTTP 200 with the existing scheduler secret.
- [x] Owner confirmed both Supabase Vault entries and the scheduled job were configured. Automatic recovery passed the synthetic queue probe.
- [x] Read-only SQL Editor check confirmed the active one-minute Cron job, the exact production recovery destination, and a scheduled HTTP 200 at 01:04 IST on November 9, 2026. The query displayed only booleans and a timestamp.
- [x] Isolated backup/restore test exported a synthetic PGlite database, restored it into a new database, and verified ledger history, terminal queue state, and denial of anonymous reads. No production data was used.
- [x] Owner confirmed production backup availability.
- [x] Implemented structured webhook, recovery, and Gemini warnings and the operations runbook. Local built-route smoke observed redacted webhook and terminal recovery warnings. Provider 429 and log redaction tests passed.
- [ ] Verify the deployment emits the new warning in Vercel Production Logs. Do not exhaust the live Gemini quota to generate a warning.

Gate: report exact tests and live verification results. Complete Phase 1 before implementing Phase 2.

## Phase 2 — People, splits and debts

- [ ] Saved people and aliases; optional reusable groups; ad hoc participants.
- [ ] Equal/unequal splits; self or another person as payer; personal-share-only mode.
- [ ] Loan/borrowing recording, obligations, partial/full repayments, explicit settlements.
- [ ] People balance cards and per-person expense/loan/repayment history.
- [ ] Reversal and deletion rules for entries with dependent settlements.
- [ ] Tests: 100 paise / 3 participants; unequal allocations; different payer; opposite debts; overpayment; concurrent repayments; settled-expense edits; balance reconstruction.
- [ ] End-to-end fixtures reproduce the accounting examples in ARCHITECTURE.md.

Gate: shares sum exactly, journal entries balance, debt balances reconcile after edits and repayments, loans never affect spending.

## Phase 3 — Media, reminders and insights

- [ ] Receipt extraction with preview/clarification and duplicate warnings.
- [ ] Resolve unpaid-service data-use constraints before enabling raw receipt/voice uploads; no paid workaround under current authorization.
- [ ] Voice download/transcription; show interpreted financial action before saving uncertain input.
- [ ] Bounded natural-language report tools and explanations grounded in SQL results.
- [ ] Trends, category comparisons, coverage-period analysis, monthly reconciliation.
- [ ] Opt-in daily review/monthly summary/loan reminders, timezone, quiet hours and cooldowns.
- [ ] Durable jobs, scheduling and unique delivery keys; only notify the owner.
- [ ] Tests: bad/oversized media, provider timeout/refusal, media expiry, malicious receipt text, query isolation, schedule boundaries, replayed jobs, quiet periods.
- [ ] Verify complete production workflow and document operational cost/limits.

Gate: all three phases tested, remaining limitations documented, live behavior verified. Never equate a passing build with production readiness.
