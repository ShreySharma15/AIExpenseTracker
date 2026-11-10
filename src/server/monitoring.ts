const actions = {
  webhook_config: "Check Production Telegram environment settings.",
  webhook_invalid_body: "Check Telegram delivery format.",
  webhook_enqueue: "Check Supabase connectivity and migration 003.",
  webhook_deferred: "Inspect the next scheduled recovery run.",
  recovery_config: "Check Production CRON_SECRET.",
  recovery_failed: "Check Supabase queue RPCs and Cron responses.",
  recovery_job_retry: "Check Telegram delivery and Supabase connectivity if retries continue.",
  recovery_job_failed: "Inspect queue stage counts and check the ledger before resending.",
  gemini_quota: "Use /add until the quota resets. Keep the Free-tier cap in place.",
  gemini_unavailable: "Check the Free project, model availability and Google service status.",
  gemini_response_invalid: "Check structured-output compatibility. Use /add until resolved.",
} as const;

type Event = keyof typeof actions;
type Context = { status?: number; source?: "app" | "provider"; stage?: "process" | "send"; attempt?: number };

export function reportEvent(event: Event, context: Context = {}) {
  const { status, source, stage, attempt } = context;
  const record = {
    component: "expense_tracker", event, action: actions[event],
    status: Number.isInteger(status) && status! >= 100 && status! <= 599 ? status : undefined,
    source: source === "app" || source === "provider" ? source : undefined,
    stage: stage === "process" || stage === "send" ? stage : undefined,
    attempt: Number.isInteger(attempt) && attempt! >= 1 && attempt! <= 4 ? attempt : undefined,
  };
  console.warn(JSON.stringify(record));
}
