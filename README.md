# Personal AI Expense Tracker

Private, single-owner, Telegram-first expense tracker. Phase 1 is complete. Phase 2 adds shared expenses and debts behind a server-side release flag. See the [Phase 2 setup and release steps](docs/SETUP.md#phase-2-isolated-verification-and-release).

- [Architecture and database design](docs/ARCHITECTURE.md)
- [Manual setup guide](docs/SETUP.md)
- [Development checklist and acceptance gates](docs/CHECKLIST.md)
- [Environment template](.env.example)

Stack: Next.js App Router, React, TypeScript, Tailwind CSS, shadcn/ui, Supabase PostgreSQL/Auth, grammY, Gemini Developer API and Vercel. The GitHub repository is public and the expense data remains owner-only.

Defaults: INR, integer paise, Asia/Kolkata reporting, one pre-created email/password login, no public signup, private Telegram messages only. User-selected AI: Gemini 3.5 Flash-Lite (`gemini-3.5-flash-lite`), strictly on the free tier. No billing enrollment, paid fallback, or automatic model substitution. See the setup guide for unpaid-service data-use limitations.

Inspected on 2026-11-08: directory initially empty; no Git repository or applicable ancestor AGENTS.md found. Installed tools: Node.js 22.19.0, npm 10.9.3, Git 2.50.1. Dependency compatibility and supported runtime versions will be checked when scaffolding.

Run `npm ci`, `npm run verify:setup`, and `npm run dev` from this folder. Apply the migrations described in the setup guide before enabling the dashboard and Telegram webhook. Run `npm test`, `npm run lint`, and `npm run build` for local verification. Store credentials in the ignored .env.local file and hosting secret settings.
