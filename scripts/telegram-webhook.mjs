import { createHash } from "node:crypto";

try { process.loadEnvFile(".env.local"); } catch { /* CI and hosting can inject variables directly. */ }
const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_WEBHOOK_SECRET: secret } = process.env;

async function call(method, payload) {
  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(method + " returned HTTP " + response.status);
  const body = await response.json();
  if (!body.ok) throw new Error(method + " was rejected");
  return body.result;
}

async function main() {
  if (!/^\d+:[\w-]+$/.test(token ?? "")) throw new Error("Missing or malformed Telegram token.");
  const operation = process.argv[2];
  if (operation === "register") {
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret ?? "")) throw new Error("Generate the webhook secret with npm run verify:setup.");
    const target = new URL(process.argv[3] ?? "");
    if (target.protocol !== "https:" || target.pathname !== "/" || target.username || target.password || target.search || target.hash) {
      throw new Error("Use the production HTTPS origin without a path.");
    }
    const url = new URL("/api/telegram/webhook", target).href;
    const current = await call("getWebhookInfo", {});
    if (current.url && current.url !== url) throw new Error("This bot already has a different webhook. Review that configuration first.");
    await call("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "edited_message", "callback_query"] });
  } else if (operation !== "status") {
    throw new Error("Use status or register <production-https-origin>.");
  }
  const status = await call("getWebhookInfo", {});
  const fingerprint = status.url ? createHash("sha256").update(status.url).digest("hex").slice(0, 12) : "none";
  console.log("Webhook:", fingerprint, "| queued updates:", status.pending_update_count, "| delivery error recorded:", Boolean(status.last_error_date));
}

try { await main(); }
catch (error) {
  // Fetch exceptions can include a token-bearing request URL.
  console.error(error instanceof TypeError ? "Telegram could not be reached or the origin is invalid." : error.message);
  process.exitCode = 1;
}
