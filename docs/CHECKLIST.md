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
- [ ] Confirm GitHub repository visibility is private and verify the push.

## Phase 1 — Text entry and monthly dashboard

### Milestone 1A: Foundation

- [ ] Scaffold Next.js/TypeScript/Tailwind/shadcn project with compatible pinned dependencies.
- [x] Config verifier, server-only database clients, lint/type/build checks, and CI workflow.
- [x] Ledger migrations, baseline categories, owner configuration, RLS and transactional mutations.
- [x] Implement paise parsing, dates, derived balanced postings, revisions, voiding, and batch idempotency.
- [x] Test atomic batches, replay, RLS isolation, stale edits, reversals, draft confirmation, and the AI quota in local PostgreSQL.
- [ ] Tests: invalid amounts/precision, overflow bounds, timezone/month boundaries, rollback, duplicate concurrent delivery, reversals, cross-owner access.

Gate: local checks and database integration tests pass before Telegram feature work.

- [x] Hosted migrations 001 and 002 verified. Anonymous reads and expense mutation denied. Synthetic create, replay, edit, void and reversal checks passed.

### Milestone 1B: Telegram text

- [ ] Safe token/owner-ID discovery scripts; no credentials printed.
- [x] grammY private-chat owner checks and webhook-secret verification.
- [x] Structured parser for single/multiple personal expenses, explicit dates, today and yesterday.
- [x] Coverage metadata, persisted Gemini confirmation drafts, and dashboard edit/void history.
- [ ] Clarifications currently request a complete revised message. Telegram edit, cancel and undo commands remain pending.
- [x] Implement durable inbox and reply delivery with expiring leases, retries and deduplication. Local database tests exercise recovery, stale leases, reply retries and the scheduler SQL with test stubs.
- [x] Hosted recovery migration 003 verified. Synthetic recovery exercised inbox deduplication, exclusive lease, stale lease rejection, outbox delivery stage and terminal scrubbing.
- [ ] Activate and verify the recovery scheduler after Vercel deployment.
- [x] Pin gemini-3.5-flash-lite. The example defaults to paused and the verified local environment is capped at 10 requests/day.
- [x] Verified owner-reported Free quota and local quota exhaustion and provider 429 handling. Live synthetic Gemini parsing, hosted confirmation and duplicate confirmation, and manual fallback passed. The synthetic expense was voided.
- [ ] Minimize/pseudonymize permitted AI input; sensitive entries use the non-AI path; initial API tests use synthetic data.
- [x] Add a structured non-AI entry command and reject recognizable loan and split messages on the plain text path.
- [x] Add opt-in Gemini parsing, an expiring confirmation draft, and one save per draft.
- [x] Test 3.5 response parsing, including thought parts and truncation, local draft confirmation, duplicate confirmation, and provider 429 handling.
- [ ] Tests: malformed/refused AI response, injection-like input, unauthorized updates, missing payer/amount/date, multi-entry atomicity, retry after commit, concurrent edits.

Gate: authorized Telegram messages save once; unauthorized messages cannot read/write or invoke AI; ambiguous messages write nothing until resolved.

### Milestone 1C: Dashboard and release

- [x] Owner-only dashboard verified with a temporary hosted Supabase session, then revoked. Anonymous access redirects and public signup is disabled.
- [ ] Owner password form, browser logout and session expiry still need a browser check.
- [x] Implement mobile dashboard, transaction list/edit, search, month/category filters and pagination.
- [x] Implement monthly personal totals, gross payments, category breakdown, and previous full-month comparison.
- [x] Four-section dashboard navigation, including a Phase 2 placeholder for people and groups.
- [ ] Installable PWA metadata/icons/offline shell; no sensitive caching.
- [ ] Accessible labels, keyboard navigation, responsive layout, empty/error/loading states.
- [ ] Playwright flow: login -> Telegram entry -> month total -> edit -> void -> logout.
- [x] Six automated tests, lint, type checking and the production build passed. Local HTTP tests verified the authenticated dashboard, filters, revision history, private caching and rejected webhook requests.
- [ ] Browser-based visual and production end-to-end checks remain pending.
- [ ] Owner will import and deploy on Vercel. Production owner sign-in, Telegram webhook round trip and scheduler HTTP delivery remain pending.
- [ ] Phase 2 is gated on the production Phase 1 checks.
- [ ] Verify backups/restoration, monitoring and recovery runbook.

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
