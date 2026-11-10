# Architecture and database design

Status: Phase 1 complete. Phase 2 implementation is gated by `EXPENSE_PHASE_2_ENABLED`. The design table below describes the full system.

## Decisions

- Keep the requested stack. One Next.js application serves the mobile PWA, authenticated server routes, and Telegram webhook. Use the Node.js runtime for integrations.
- Supabase supplies PostgreSQL, Auth, and later private receipt storage. Use SQL migrations and generated database types; an ORM is unnecessary for this scope.
- One pre-created Supabase email/password owner, public registration disabled, no account-management UI. Check the configured owner UUID in every dashboard request. Store owner IDs in all business tables for future independent accounts.
- Telegram accepts only the configured numeric sender ID AND private chat ID. Usernames are not authorization. Verify callbacks, media, and edited updates as strictly as text.
- AI provider adapter with Zod validation. User selected Gemini Developer API, exact model `gemini-3.5-flash-lite`, strictly on the free tier. Pin that model; no automatic substitution, paid fallback, billing enrollment, or paid-tier features. Verify availability and project free-tier status before integration. The `AI_FREE_TIER_ONLY` flag represents application policy; it cannot detect or prevent an external Google Cloud billing change using an ordinary API key alone.
- Cash-basis monthly spending uses the actual expense date. Coverage such as September/October is separate metadata; it does not move the payment or silently divide the amount across months. Explicit monthly allocations can be recorded after clarification, without duplicating cash outflow.
- All exclusions in the project brief remain excluded. People and groups are private address-book records, not app accounts or collaborators.

## Data flow

Telegram -> webhook verification -> owner allowlist -> durable update claim -> AI interpretation -> schema/domain validation -> PostgreSQL transaction -> saved response -> Telegram acknowledgement.

Dashboard -> verified Supabase session + owner check -> application services -> owner-scoped database functions/views -> mobile UI.

The AI returns proposed actions, decimal amount strings, dates, and references. It cannot execute SQL, directly write data, calculate authoritative totals, choose hidden financial facts, or authorize an action. The backend computes amounts, allocations, and reports. Queries in Phase 3 map to bounded, allowlisted reporting functions; the AI only explains their results.

Unclear payer, missing amount, ambiguous person, unresolved date, edit target, or repayment direction produces a persisted clarification draft with a short question. Drafts have versions, expiry, and cancel actions. A message containing multiple entries is committed as one validated batch; a partially understood batch remains a draft. Clear new expenses save immediately and offer Undo/Edit. Destructive or ambiguous natural-language changes show the target before confirmation. During Phase 1, debt/group requests are explicitly deferred, never misclassified as ordinary expenses.

## Planned folder structure

```text
src/
  app/
    (auth)/login/
    (dashboard)/
      page.tsx                  # Home
      transactions/
      people/                   # People & Groups, Phase 2
      insights/                 # Basic Phase 1; advanced Phase 3
    api/
      telegram/webhook/
      transactions/
      reports/
      internal/recovery/
      cron/reminders/           # Phase 3
    manifest.ts
  components/
    ui/                         # shadcn/ui
    dashboard/
    transactions/
    people/
  domain/
    money.ts
    dates.ts
    accounting/
    splits/
    repayments/
  server/
    auth/
    db/
    services/
    telegram/
    ai/
    jobs/
  lib/
    validation/
    supabase/
    config/
  types/
supabase/
  migrations/
  tests/                        # RLS and transactional integrity
scripts/                        # Safe setup/verification commands
tests/
  unit/
  integration/
  e2e/
public/                         # Icons and offline shell
docs/
.github/workflows/              # CI added in Phase 1
.env.example
```

Phase 1 keeps its personal ledger and durable Telegram inbox. Phase 2 adds owner-scoped address-book tables and a separate shared/debt ledger. `phase2_events` holds immutable entries. Shared allocations retain participant names and integer shares. `phase2_obligations` and `phase2_settlements` record the debt and explicit repayment allocations. `phase2_voids` reverses postings, and a replacement links to its original entry. The home report combines personal expense amounts and the owner's share of shared entries while counting loans and repayments only in cash flow. Balances and reconciliation derive from ledger rows.

An advisory transaction lock serializes Phase 2 writes per owner. Database functions recalculate splits, validate available balances and forbid replacing or voiding sources with active settlements. Reverse linked settlements first to correct the source. Reversals preserve the effective date and the time they were recorded. Dashboard writes derive the owner from Supabase Auth. A separate service-only Telegram draft interface accepts only the verified bot owner's scope, resolves names and aliases locally, and writes only after confirmation. Unequal splits, ambiguous repayments and net settlements use the dashboard.

## Database design

UUID primary keys unless stated otherwise. Business records carry owner_id, created_at, and relevant audit timestamps. Money uses BIGINT paise, serialized as strings at JSON boundaries and handled as bigint in TypeScript. Never parse currency through floating-point multiplication. currency is constrained to INR in v1.

| Table | Principal fields and role | First phase |
| --- | --- | --- |
| profiles | id references auth.users; timezone, currency; one provisioned owner | 1 |
| categories | id, owner_id, name, archived_at | 1 |
| transactions | id, owner_id, kind, current_revision, status, source; stable identity | 1 |
| transaction_revisions | transaction_id, version, occurred_on DATE, recorded_at TIMESTAMPTZ, total_paise, description, category_id, source_item_id, reason, changed_by; immutable revisions | 1 |
| coverage_periods | revision_id, start_date, end_date, optional explicitly confirmed allocation_paise; informational coverage distinct from payment date | 1 |
| ledger_accounts | owner_id, kind (cash, expense, receivable, payable, transfer clearing), optional person_id/category_id; internal accounting buckets | 1 |
| journal_entries | transaction_id, revision_id, reversal_of, effective_date, recorded_at | 1 |
| journal_lines | entry_id, account_id, debit_paise, credit_paise; positive one-sided amounts | 1 |
| inbound_updates | bot identity + Telegram update_id unique; owner_id after authorization, chat/message IDs, status, attempt count, lease expiry, redacted error | 1 |
| source_items | inbound_update_id + item_index unique; maps each parsed item to its transaction; message/edit provenance | 1 |
| conversation_drafts | owner_id, chat_id, validated proposal, unresolved fields, version, expiry, status | 1 |
| outbound_messages | owner_id, logical message key unique, payload, delivery state, retry schedule, Telegram message_id | 1 |
| people | owner_id, display_name, archived_at; name alone is not a unique identity | 2 |
| person_aliases | owner_id, person_id, alias; ambiguity triggers clarification | 2 |
| groups / group_members | private saved participant templates; membership does not alter old expenses | 2 |
| expense_participants | revision_id, participant (self or person_id), share_paise; immutable split snapshot | 2 |
| expense_payments | revision_id, payer (self or person_id), amount_paise; one payer per expense in v1, extendable schema | 2 |
| obligations | owner_id, person_id, source revision, direction, original_paise, kind (loan or shared expense); owner-person debts only | 2 |
| settlement_allocations | repayment revision, obligation_id, amount_paise; validates partial/full repayment | 2 |
| attachments | owner_id, transaction/draft, private storage path, MIME, retention metadata | 3 |
| reminder_preferences | owner_id, timezone, enabled types, time, quiet window, cooldown | 3 |
| reminder_deliveries | owner_id + reminder type + local period unique; status/retry metadata | 3 |
```

Use composite owner-aware foreign keys to prevent cross-owner references. Every table, view, function, and Storage policy receives an explicit access decision. Browser roles cannot directly edit journal/audit tables. Business mutations use narrowly granted PostgreSQL functions that validate ownership and all cross-row invariants in one database transaction. SECURITY DEFINER functions, where necessary, have fixed search_path, revoked PUBLIC execution, and explicit caller checks. Telegram's server secret bypasses RLS, so server-side owner checks are mandatory in addition to RLS. Do not accept owner_id from an AI result or browser payload.

Useful indexes: (owner_id, occurred_on), (owner_id, category_id), (owner_id, person_id), unique (transaction_id, version), unique (bot_id, update_id), unique source item/idempotency keys. Restrict reads to valid current revisions and active postings in report views. Search is owner-scoped and paginated.

## Accounting rules

Journal lines balance per entry. Database write functions check sums, split totals, ownership, currency, and settlement availability under locks; browser code is never the authority.

| Example | Personal spending | Owner cash outflow | Debt effect |
| --- | ---: | ---: | --- |
| Own lunch, 250 | 250 | 250 | None |
| Owner pays dinner 1,200 for self, Rahul, Siddharth equally | 400 | 1,200 | Each person owes owner 400 |
| Rahul pays same dinner | 400 | 0 | Owner owes Rahul 400; other people's mutual debts are outside this app |
| Lend Siddharth 500 | 0 | 500 | Receivable +500 |
| Siddharth repays 200 | 0 | -200 | Receivable -200 |
| Borrow 1,000 from Aditya | 0 | -1,000 | Payable +1,000 |
| Repay Aditya 300 | 0 | 300 | Payable -300 |

Amounts above are rupees for readability; storage uses paise. Display gross payments, cash received, personal spending, receivables, and payables separately. Do not hide opposite-direction obligations by automatic netting. Explicit net settlement can clear both sides with an auditable allocation. Account buckets are internal bookkeeping, not bank integration.

- Equal splits divide integer paise; distribute the remaining paise in a stable participant order shown in the confirmation. Unequal splits accept exact amounts, integer weights, or fixed-precision percentages and use deterministic largest-remainder allocation. All shares must sum to the total.
- Personal-share-only entry records only that share. Do not invent a total bill, people, or receivable.
- Repayments must identify the person, direction, and eligible obligation(s). If allocation is ambiguous, ask; do not silently assign FIFO. Overpayment requires explicit classification, not a negative remaining debt.
- Concurrent settlements lock the relevant obligations. Editing an obligation below its settled amount is rejected until linked settlements are corrected/reallocated in an explicit atomic operation.
- Refunds/reimbursements specify what they reverse or settle. Shared-expense repayment does not reduce personal spending; a genuine personal purchase refund does. Transfers between owned cash buckets do not count as spending.
- Editing creates a new revision plus reversal/replacement journal entries atomically. Deletion voids the transaction through reversal; it never destroys audit records. Historical reports use effective dates, with recorded timestamps retaining when corrections occurred.
- Backdated dates use Asia/Kolkata and the original Telegram message timestamp to resolve relative words even after delivery retries. Ambiguous dates are clarified. Compare month-to-date with an equivalent previous-month window; full-month comparisons are labeled separately.
- Stable delivery IDs prevent duplicate writes. Repeated text in a new message is only a duplicate warning, since repeated purchases can be legitimate. Telegram edited messages propose revisions, never create duplicate new expenses.

## Reliability and security

Free-tier operation: use a dedicated Google project with no linked billing account. Read actual project RPM/TPM/RPD limits in AI Studio rather than hardcoding published historical quotas. Persist application counters, cap input/output tokens and retries, and respect retry delays. On quota exhaustion, retain an uncommitted draft/pending update, send one explanatory status, and resume only within the available quota; never loop through recovery retries or rotate keys/projects to bypass limits. Add a structured manual-entry path that does not require AI. If the exact model becomes unavailable or loses free-tier eligibility, disable AI processing and report the limitation. Test these failure paths before release.

Google's unpaid-service terms permit product-improvement use and human review of inputs/outputs and instruct users not to submit sensitive, confidential, or personal information. Application authentication does not make upstream processing private. Minimize and pseudonymize allowed input locally; this is not a guarantee that free-form financial text is non-sensitive. Use synthetic content for initial API tests. Sensitive entries need the non-AI path. Raw receipts and voice notes require a separate data-handling assessment before Phase 3 activation and must not be silently uploaded. These limitations may constrain the original private-AI objective under the strict free-tier requirement. See [Gemini terms](https://ai.google.dev/gemini-api/terms).

Persist updates before processing, claim them with a lease, and atomically commit journal changes plus an outbound response. Bound provider timeouts and retry budgets. A successful HTTP acknowledgement must correspond to durable recoverable work or completed processing; never rely on an unawaited serverless task. Use an authenticated recovery endpoint and a Supabase scheduled job for expired claims/outbound retries. Verify the hosted scheduler capability during Phase 1 integration. Secrets for scheduled calls belong in Supabase Vault, not SQL migration text.

Ledger writes are idempotent across retries and crashes. Telegram message delivery itself cannot promise exactly-once semantics after a send succeeds but the response is lost; reconciliation/retries must favor consistent accounting and avoid duplicate logical confirmations where possible.

Dashboard requests verify sessions server-side and enforce the single owner, including direct API access. Add origin/CSRF checks on cookie-authenticated mutations, size/rate limits, secure cookies, sanitized error responses, and redacted logs. Use a constant-time webhook-secret check and validate the Telegram sender before any AI call. Rate limits and leases must persist across serverless instances.

The PWA caches static assets and an offline shell only. Financial responses, auth state, receipts, and API routes must not enter shared/service-worker caches. Authenticated responses use private/no-store semantics. Offline financial writes are deferred beyond v1.

Receipt/voice processing in Phase 3 checks file type and size, restricts downloads to trusted Telegram APIs, uses private storage and expiring signed URLs, and defaults to deleting temporary media after extraction. Store minimal source text with configurable retention; never log entire messages or receipts. Send only necessary content to the chosen AI provider. No automated bank connections or unsolicited messages to other people.

Production acceptance includes database backup/export and restore verification, migration rollback/recovery procedures, external outage behavior, monitoring, and a verified deployed workflow. No deployment or production readiness is claimed before these checks.

## Scheduling decision

Use Supabase scheduling for durable recovery and configurable reminders, sharing the existing provider. Vercel Cron is an alternative for approximate daily reminders, but its Hobby tier currently limits each job to daily execution and offers hourly precision. Do not promise exact-time configurable reminders on that tier. See [Vercel Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Primary references

- [Supabase server-side authentication](https://supabase.com/docs/guides/auth/server-side)
- [Supabase publishable and secret keys](https://supabase.com/docs/guides/api/api-keys)
- [Telegram webhook verification](https://core.telegram.org/bots/api#setwebhook)
- [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini project rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Gemini model lifecycle](https://ai.google.dev/gemini-api/docs/deprecations)
