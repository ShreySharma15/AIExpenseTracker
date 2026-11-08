import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const local = ".env.local";
try { process.loadEnvFile(local); } catch { console.error("Create .env.local from .env.example first."); process.exit(1); }
const env = process.env;
const required = [
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY",
  "APP_OWNER_USER_ID", "TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_USER_ID",
  "TELEGRAM_ALLOWED_CHAT_ID", "GEMINI_API_KEY",
];
const missing = required.filter((name) => !env[name]?.trim());
if (missing.length) { console.error("Missing settings:", missing.join(", ")); process.exit(1); }
if (env.AI_PROVIDER !== "gemini" || env.AI_FREE_TIER_ONLY !== "true" || env.GEMINI_TEXT_MODEL !== "gemini-3.5-flash-lite") {
  console.error("Use the Gemini free-tier settings in .env.example."); process.exit(1);
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(env.NEXT_PUBLIC_SUPABASE_URL)
    || !/^\d+:[\w-]+$/.test(env.TELEGRAM_BOT_TOKEN)
    || !/^[0-9a-f-]{36}$/i.test(env.APP_OWNER_USER_ID)
    || !/^\d+$/.test(env.TELEGRAM_ALLOWED_USER_ID) || !/^\d+$/.test(env.TELEGRAM_ALLOWED_CHAT_ID)) {
  console.error("Check the Supabase URL, owner UUID, Telegram token format and private-chat IDs."); process.exit(1);
}
for (const name of ["TELEGRAM_WEBHOOK_SECRET", "CRON_SECRET"]) {
  if (!env[name]) { appendFileSync(local, "\n" + name + "=" + randomBytes(32).toString("hex") + "\n"); console.log("Generated", name); }
}
async function check(label, url, headers, accept) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(12000), redirect: "error" });
    if (!res.ok) { console.error(label + ": HTTP " + res.status); return false; }
    if (!accept(await res.json())) { console.error(label + ": unexpected response"); return false; }
    console.log(label + ": OK"); return true;
  } catch { console.error(label + ": connection or response failed"); return false; }
}
const project = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const bot = "https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN;
const serviceHeaders = { apikey: env.SUPABASE_SECRET_KEY, ...(env.SUPABASE_SECRET_KEY.startsWith("eyJ") ? { Authorization: "Bearer " + env.SUPABASE_SECRET_KEY } : {}) };
async function verifyLedgerAccess(relation) {
  try {
    const url = project + "/rest/v1/" + relation + "?limit=0";
    const options = { signal: AbortSignal.timeout(12000), redirect: "error" };
    const [service, anon] = await Promise.all([
      fetch(url, { ...options, headers: serviceHeaders }),
      fetch(url, { ...options, headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } }),
    ]);
    const ok = service.ok && [401, 403].includes(anon.status);
    console.log("Supabase " + relation + ": service HTTP " + service.status + ", anonymous HTTP " + anon.status + (ok ? " (OK)" : ""));
    return ok;
  } catch {
    console.error("Supabase " + relation + ": connection failed");
    return false;
  }
}
const ok = await Promise.all([
  check("Supabase public Auth", project + "/auth/v1/settings", { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }, (v) => {
    if (v.disable_signup !== true) { console.error("Disable public signup in Supabase Authentication."); return false; }
    return v.external?.email === true;
  }),
  check("Supabase owner", project + "/auth/v1/admin/users/" + env.APP_OWNER_USER_ID, serviceHeaders, (v) => v.id === env.APP_OWNER_USER_ID && !!v.email_confirmed_at),
  check("Telegram bot", bot + "/getMe", {}, (v) => v.ok && v.result?.is_bot),
  check("Telegram private chat", bot + "/getChat?chat_id=" + env.TELEGRAM_ALLOWED_CHAT_ID, {}, (v) => v.ok && v.result?.type === "private" && String(v.result.id) === env.TELEGRAM_ALLOWED_USER_ID),
  check("Gemini model metadata", "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite", { "x-goog-api-key": env.GEMINI_API_KEY }, (v) => v.supportedGenerationMethods?.includes("generateContent")),
  verifyLedgerAccess("active_expenses"),
  verifyLedgerAccess("ai_expense_drafts"),
  ...(process.argv.includes("--recovery") ? [verifyLedgerAccess("telegram_jobs")] : []),
]);
console.log("Check Free tier and quota in AI Studio. Metadata does not establish generation eligibility or billing status.");
if (ok.some((value) => !value)) process.exitCode = 1;
