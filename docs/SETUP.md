# Manual setup guide

Complete steps 1–4 for local Phase 1 development, then follow the Phase 1 verification steps at the end of this guide. GitHub and Vercel are needed for remote version control and hosted testing.

Dashboard labels can vary by account and product updates. The instructions below identify both the target setting and the expected result; if a label differs, report the label/error without sharing credentials.

## Who does what

| You do manually | The implementation agent does |
| --- | --- |
| Sign into services, accept terms, choose billing and create projects | Scaffold the app, pin dependencies, create SQL migrations and tests |
| Create the bot in Telegram and send a setup message from your own account | Verify bot identity, discover IDs from your setup message, enforce the allowlist |
| Store API keys privately in .env.local / hosting settings | Validate presence/connectivity without printing keys; generate webhook/cron secrets locally |
| Create the owner login and keep its password in your password manager | Enforce owner UUID, configure RLS, implement login and secure mutations |
| Grant GitHub/Vercel account access and select repository | Configure CI/deployment, register webhook, run live checks once access exists |
| Run prepared migration SQL if no authenticated CLI is available | Prepare exact migrations and verification queries first |

No secret API keys, passwords, database connection strings, or environment-file contents belong in chat. Account/project names, bot username, and setup completion status are enough to report progress.

## 1. Prepare the local environment file

Open the ExpenseTracker folder in your editor. Copy .env.example to .env.local using the file explorer, or run this PowerShell command from E:\Projects\ExpenseTracker once:

```powershell
if (-not (Test-Path -LiteralPath '.env.local')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env.local'
}
```

Open .env.local in your local editor, not in chat. Fill values as the next steps describe. Keep .env.example blank of credentials. .gitignore already excludes environment files except .env.example; after Git initialization the agent will verify .env.local is ignored.

Verification now: the local file exists. Later: the application config validator will report missing variable names only.

## 2. Supabase project and single owner

1. Open [Supabase Dashboard](https://supabase.com/dashboard), sign in, and click **New project**.
2. Select/create your personal organization. Name the project **personal-expense-tracker**. Generate a strong database password and save it in your password manager. Select an available nearby region, preferably Mumbai, and click **Create new project**. Wait until the project is ready.
3. Open the project's **Connect** dialog for the project URL, then **Settings -> API Keys** for the publishable and secret keys. Create a server secret key if one does not exist. Set:
   - NEXT_PUBLIC_SUPABASE_URL = project URL.
   - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = publishable key.
   - SUPABASE_SECRET_KEY = server secret key.
4. Open **Authentication -> Users -> Add user -> Create new user**. Enter your own email and a unique password. Enable **Auto Confirm User**, if offered, for this manually provisioned owner. Save the password in your password manager; it is not an environment variable.
5. Open that user's record and copy its UUID into APP_OWNER_USER_ID.
6. Under **Authentication -> Sign In / Providers**, locate **Allow new users to sign up**, turn it off, and save. Keep email/password sign-in enabled. Supabase may group this setting under general authentication configuration.
7. Open **Authentication -> URL Configuration**. For local development, set Site URL to http://localhost:3000. Add http://localhost:3000/auth/callback to allowed redirects for future callback/recovery handling. At deployment, replace Site URL with the production URL and explicitly allow the production callback as well.

Verification now: project is ready; your user appears in Authentication -> Users; signup is disabled; the three API settings and owner UUID are stored locally. Verification during Phase 1: owner can sign in, other accounts cannot reach the dashboard, anonymous database access fails, and schema/RLS tests pass.

Use the modern publishable/secret key pair where available. Supabase secret keys have privileged access and bypass RLS; they must remain server-only. See [API keys](https://supabase.com/docs/guides/api/api-keys) and [signup configuration](https://supabase.com/docs/guides/auth/general-configuration).

The database password is only needed if using a direct migration/backup connection. It does not belong in browser config and is not required in the application environment. The agent will first use prepared SQL migrations through the SQL Editor or a locally authenticated CLI.

Production email password resets require working email delivery. Initial development uses the manually created password. Before release, we will either verify an appropriate recovery flow or document a tested owner-admin recovery procedure; custom SMTP setup is deferred until needed.

## 3. Create your Telegram bot

1. Open Telegram and visit the official [@BotFather](https://t.me/BotFather).
2. Press **Start**, send **/newbot**, enter a display name, then choose an available username ending in **bot**.
3. Copy the issued token directly into TELEGRAM_BOT_TOKEN in .env.local.
4. Send **/setjoingroups**, select this bot, and choose **Disable**. The app is for your private chat, not group-chat collaboration.
5. Open the bot link supplied by BotFather, press **Start**, and send **expense tracker setup** from the account that will own the tracker.

Verification now: BotFather shows the created bot and you can open its private chat. It will not respond yet because no application exists.

At the first implementation milestone, the agent will provide a local setup helper that reads the token from .env.local, checks getMe, and reads getUpdates to find your setup message. It will display only bot username and nonsecret sender/chat IDs. Verify those match your setup message, then populate TELEGRAM_ALLOWED_USER_ID and TELEGRAM_ALLOWED_CHAT_ID. The helper must never automatically authorize the first arbitrary sender. If both IDs are already configured, npm run verify:setup verifies the bot can see that private chat and checks that the chat and sender IDs match. Both IDs are required before bot processing is enabled.

Leave TELEGRAM_WEBHOOK_SECRET blank for now; the implementation helper will generate a cryptographically random hex value directly into .env.local. Do not register a webhook yet. Local development uses long polling; production uses webhooks. They cannot run simultaneously for the same bot. A separate development bot is useful after launch but not required now.

See [Telegram bot setup](https://core.telegram.org/bots/tutorial), [polling/webhook rules](https://core.telegram.org/bots/faq), and [webhook secret verification](https://core.telegram.org/bots/api#setwebhook). Avoid putting your token in a browser URL or a terminal command that will remain in shell history.

## 4. Configure Gemini 3.5 Flash-Lite — free tier only

User decision: use the Gemini Developer API with the exact model `gemini-3.5-flash-lite`. Do not enable billing, attach a billing account, activate a paid trial as a workaround, or substitute another model/provider automatically.

1. Open [Google AI Studio](https://aistudio.google.com/) and sign in with your Google account. Review the service terms. New users may receive a default project and key automatically.
2. Open **Dashboard -> Projects**. Create a dedicated project named **Expense Tracker Free**, or use the default project only after checking that no billing account is linked. If using an existing project, click **Import projects**, select it, then **Import**.
3. Open [API keys](https://aistudio.google.com/api-keys), click **Create API key**, select the dedicated project, and name the key **expense-tracker-server**. If the default project already has a key, you can use it for this dedicated app.
4. Verify the project shows **Free** in its plan/usage-tier field. Do not click **Set up billing**, **Upgrade**, or attach a payment method. In [Google Cloud Console](https://console.cloud.google.com/), select the same project and open **Billing** to verify it has no linked billing account. If project verification is required for free access, complete that verification instead of upgrading.
5. Copy the key directly into GEMINI_API_KEY in .env.local. Set these nonsecret values:

```dotenv
AI_PROVIDER=gemini
AI_FREE_TIER_ONLY=true
GEMINI_TEXT_MODEL=gemini-3.5-flash-lite
```

6. In AI Studio, open **Usage / Usage & Billing -> Rate limits**, select this project and model, and inspect its actual RPM, TPM, and RPD limits. Labels may vary. Record the nonsecret limits for integration; do not rely on old advertised numbers. A zero/unavailable quota means setup is not ready, not permission to enable billing.

Verification now: a dedicated project with no linked billing account, Free tier, the intended model's available quota, and the key stored privately. At the first implementation milestone, the agent will make a small synthetic structured-output request and report success, authorization failure, model unavailability, or quota failure without exposing credentials. Do not use real financial data for this initial check.

The application will pin the exact model, cap requests/tokens/retries, and pause AI parsing at quota exhaustion. Manual structured entry will remain available. There is no paid fallback and no model substitution without a new user decision. The flag AI_FREE_TIER_ONLY does not impose a Google-side spending cap or prove billing status; keeping the dedicated project unbilled is the external cost boundary. Do not later link billing to it.

Privacy limitation: Google's unpaid-service terms allow submitted content and responses to be used to improve products, including human review, and instruct users not to submit sensitive, confidential, or personal information. This means a login-protected tracker is not equivalent to private AI processing. Sensitive financial entries should use the non-AI path. Minimized/pseudonymized AI text needs careful handling; redaction cannot guarantee removal of all sensitive information. Raw receipt and voice uploads stay deferred until their data handling is resolved in Phase 3, within the same free-only constraint.

References: [API key/project setup](https://ai.google.dev/gemini-api/docs/api-key), [pricing](https://ai.google.dev/gemini-api/docs/pricing), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [unpaid-service terms](https://ai.google.dev/gemini-api/terms), and [model lifecycle](https://ai.google.dev/gemini-api/docs/deprecations).

## 5. GitHub

The owner approved public visibility for [ShreySharma15/AIExpenseTracker](https://github.com/ShreySharma15/AIExpenseTracker). Before pushing to `main`, check the staged files and outgoing history for credentials, direct email addresses, environment files, and financial records. Use the repository-local GitHub noreply address. Keep live secrets in the ignored local environment file, Vercel Production, and Supabase Vault.

## 6. Deploy from GitHub to Vercel

1. After the verified push, sign in at [Vercel](https://vercel.com/) using GitHub. Open **Add New → Project**. Select **Import** next to **ShreySharma15/AIExpenseTracker**. If it is missing, select **Adjust GitHub App Permissions** and grant the Vercel app access to this repository.
2. Select the **Next.js** preset and the repository root. Keep the default install, build, and output settings. In **Settings → Git**, verify the production branch is `main`. Use a Node.js version supported by Vercel that satisfies `package.json`.
3. In **Environment Variables**, add these names for **Production** only. Copy the corresponding local values through the dashboard and mark server credentials sensitive where available.

   | Purpose | Production names |
   | --- | --- |
   | Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `APP_OWNER_USER_ID` |
   | Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_ID`, `TELEGRAM_ALLOWED_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET` |
   | Gemini | `AI_PROVIDER`, `AI_FREE_TIER_ONLY`, `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL`, `GEMINI_DAILY_REQUEST_LIMIT` |
   | Scheduler | `CRON_SECRET` |
   | App origin | `NEXT_PUBLIC_APP_URL` |

   Use `gemini`, `true`, `gemini-3.5-flash-lite`, and `10` for the four nonsecret Gemini settings. The owner verified 500 RPD for this model on the unbilled Free project. Set the app origin to the production HTTPS origin. If that origin becomes available only after the first deployment, add it under **Settings → Environment Variables** and redeploy.

4. Click **Deploy**. Open the production URL and verify the owner login screen appears. In Supabase **Authentication → URL Configuration**, set **Site URL** to the production origin and add the production callback if needed. Check the browser password login and logout.
5. Register the Telegram webhook from this checkout using `node scripts/telegram-webhook.mjs register https://YOUR-PRODUCTION-ORIGIN`, then verify status. Configure the recovery scheduler in step 7 and verify both the scheduler HTTP response and a synthetic Telegram-to-dashboard round trip. Telegram and the scheduler require access to their production endpoints.

Keep live credentials scoped to Production. See [Vercel project import](https://vercel.com/docs/getting-started-with-vercel) and [environment variables](https://vercel.com/docs/environment-variables).

## 7. Scheduled recovery — configured during Phase 1 release

Apply [the recovery migration](../supabase/migrations/202611080003_telegram_recovery.sql) once, after the first two migrations. The webhook acknowledges an authorized update after saving it to the inbox. It tries processing immediately after the response, and the scheduler picks up eligible work when processing or reply delivery fails. The ledger deduplicates mutations. Telegram may receive a repeated confirmation if a worker loses its connection after Telegram accepted the reply.

1. In Supabase **Database → Extensions**, enable **pg_cron** and **pg_net** if needed.
2. In **Vault**, create two secrets named `expense_tracker_recovery_url` (the full production HTTPS URL ending in `/api/internal/recovery`) and `expense_tracker_cron_secret` (the same value as Vercel's server-only `CRON_SECRET`). Enter the values directly in Vault.
3. In **SQL Editor → New query**, run [schedule-telegram-recovery.sql](../supabase/ops/schedule-telegram-recovery.sql). It registers a one-minute job. The file refers to Vault names only.
4. In **Integrations → Cron**, inspect runs of `expense-tracker-telegram-recovery`. Also verify the HTTP result in `net._http_response`. A successful cron run confirms only that the HTTP request was queued.
5. Send a synthetic Telegram expense after registering the webhook and verify one ledger entry. To inspect failed work without revealing payloads, use `select stage, count(*) from public.telegram_jobs group by stage;` in SQL Editor. Terminal rows hold only job metadata. A failed job can represent a delivered ledger write whose Telegram confirmation failed, so check the dashboard before resending.

To verify the schedule and destination without exposing Vault values, run these read-only checks in SQL Editor:

```sql
select jobname, schedule, active
from cron.job
where jobname = 'expense-tracker-telegram-recovery';

select exists (
  select 1 from vault.decrypted_secrets
  where name = 'expense_tracker_recovery_url'
    and decrypted_secret =
      'https://expensetracker-psi-bay.vercel.app/api/internal/recovery'
) as production_url_matches;

select created, status_code, timed_out
from net._http_response
where created > now() - interval '10 minutes'
  and content ~ '^\{"processed":[0-9]+,"failed":[0-9]+\}$'
order by created desc limit 5;
```

Look for an active one-minute job, `production_url_matches = true`, and recent HTTP 200 responses. To test actual recovery, enqueue a synthetic update without calling either HTTP endpoint, wait for its job to reach `done`, then verify the synthetic ledger entry or AI draft.

See [Supabase Cron](https://supabase.com/docs/guides/cron) and [scheduled HTTP calls with Vault](https://supabase.com/docs/guides/functions/schedule-functions).

## Values needed now versus later

| Variable | When | Source |
| --- | --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Now | Supabase project Connect dialog |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Now | Supabase Settings -> API Keys |
| SUPABASE_SECRET_KEY | Now | Supabase Settings -> API Keys; server secret |
| APP_OWNER_USER_ID | Now | Authentication -> Users -> your user's UUID |
| TELEGRAM_BOT_TOKEN | Now | BotFather |
| AI_PROVIDER=gemini / GEMINI_API_KEY / AI_FREE_TIER_ONLY=true | Now | Dedicated unbilled Google AI Studio project |
| TELEGRAM_ALLOWED_USER_ID / TELEGRAM_ALLOWED_CHAT_ID | Setup helper, before enabling bot | Your verified setup message |
| GEMINI_TEXT_MODEL=gemini-3.5-flash-lite | Now; verify during integration | Exact user-selected model |
| TELEGRAM_WEBHOOK_SECRET / CRON_SECRET | Before hosted endpoints enabled | Locally generated random values |
| NEXT_PUBLIC_APP_URL | localhost now, production origin later | Local defaults / Vercel |
| AI_VISION_MODEL / AI_TRANSCRIPTION_MODEL | Phase 3 | Selected provider capabilities |

The local configuration is verified with npm run verify:setup. Report whether signup is disabled, the migrations are applied, and the Gemini project is Free with no linked billing account. Keep the environment file and its values private.

## Run and verify Phase 1

1. From the project folder run `npm ci` and `npm run verify:setup`. This helper checks provider connectivity, owner and chat IDs, and public signup configuration. It generates any missing webhook or scheduler secret. Gemini metadata access confirms the key and model, while the Free tier and billing status must be checked in AI Studio.
2. In the intended Supabase project, open **SQL Editor → New query**. Paste and run the contents of [202611080001_expenses.sql](../supabase/migrations/202611080001_expenses.sql). Run [202611080002_ai_quota.sql](../supabase/migrations/202611080002_ai_quota.sql) in a separate new query after the first succeeds. Each migration runs in a transaction. Apply each file once. Before enabling the Telegram webhook, also apply the recovery migration in step 7 above. Use `supabase db push` with a linked and authenticated CLI instead if you already manage this project through the CLI.
3. Run `npm run dev` and open **http://localhost:3000**. Sign in as the owner. Add a test expense, check the total, change its date to a different month, then void it. Confirm the old total is restored and sign-out redirects to login.
4. For Telegram delivery, deploy to your Vercel production URL with the production environment values, including the same webhook secret generated locally. Then run `node scripts/telegram-webhook.mjs register https://YOUR-PRODUCTION-ORIGIN` and `node scripts/telegram-webhook.mjs status`. The helper leaves a webhook pointing elsewhere in place. Send `/add 12.50 Test lunch | Food` in your private bot chat and verify one matching row in the dashboard.
5. Gemini starts paused. After confirming the project is Free with no billing account, set `GEMINI_DAILY_REQUEST_LIMIT` to a positive number at or below the displayed daily quota and at most 10. The app also spaces requests 15 seconds apart. Restart or redeploy for the change. Test `/ai Yesterday spent 25 on a fictional lunch` with synthetic data and tap **Save expenses**. Tap again and verify a single expense. Keep using `/add` or the dashboard for sensitive entries.

The Telegram integration uses webhooks. Text edits and voids use the dashboard. Gemini clarifications ask for a revised complete message. The local and owner-confirmed production cap is 10/day against the unbilled project's Free quota of 500/day. The owner verified real Telegram delivery. An automated production probe verified scheduled queue processing and an AI confirmation replay. See [the checklist](CHECKLIST.md) for the remaining release checks.
