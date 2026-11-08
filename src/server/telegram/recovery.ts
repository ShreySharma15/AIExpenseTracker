import "server-only";
import { z } from "zod";
import { botClient } from "@/lib/supabase/server";
import { telegramReply } from "./bot";
import { allowedTelegramUpdate, botId } from "./update";

const replySchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("sendMessage"), chat_id: z.union([z.string(), z.number()]), text: z.string() }).passthrough(),
  z.object({ method: z.literal("answerCallbackQuery"), callback_query_id: z.string() }).passthrough(),
]);
type Outcome = { result: "ok" | "retry" | "failed"; reply?: unknown; delay?: number };
type Job = {
  update_id: number; stage: "process" | "send"; payload: unknown; reply: unknown; lease_token: string; attempts: number;
};

async function deliver(raw: unknown): Promise<Outcome> {
  const reply = replySchema.parse(raw);
  if (reply.method === "sendMessage" && String(reply.chat_id) !== process.env.TELEGRAM_ALLOWED_CHAT_ID) {
    return { result: "failed" };
  }
  const { method, ...payload } = reply;
  const response = await fetch("https://api.telegram.org/bot" + process.env.TELEGRAM_BOT_TOKEN + "/" + method, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    redirect: "error", signal: AbortSignal.timeout(5000), cache: "no-store",
  });
  const body = await response.json();
  if (response.ok && body.ok === true) return { result: "ok" };
  if (response.status === 429) return { result: "retry", delay: Number(body.parameters?.retry_after) || 60 };
  return { result: response.status >= 500 ? "retry" : "failed" };
}

export async function processTelegramJobs(update?: number) {
  const bot = botId();
  if (!bot) throw new Error("Telegram configuration unavailable");
  const db = botClient();
  let processed = 0;
  let failed = 0;
  const started = Date.now();
  for (let i = 0; i < 2 && Date.now() - started < 23_000; i++) {
    const { data, error } = await db.rpc("claim_telegram_job", { p_bot: bot, p_update: update ?? null });
    if (error) throw new Error("Telegram claim failed");
    const job = (data as Job[] | null)?.[0];
    if (!job) break;
    let outcome: Outcome;
    try {
      if (job.stage === "send") outcome = await deliver(job.reply);
      else {
        const payload = allowedTelegramUpdate(job.payload);
        outcome = payload ? { result: "ok", reply: await telegramReply(payload) } : { result: "failed" };
      }
    } catch {
      outcome = { result: "retry" };
    }
    const result = outcome.result === "retry" && job.attempts >= 4 ? "failed" : outcome.result;
    const finished = await db.rpc("finish_telegram_job", {
      p_bot: bot, p_update: job.update_id, p_lease: job.lease_token, p_result: result,
      p_reply: outcome.reply ?? null, p_delay: outcome.delay ?? 30 * 2 ** (job.attempts - 1),
    });
    if (finished.error || finished.data !== true) throw new Error("Telegram lease could not be finalized");
    if (result === "failed") { failed++; console.error("Telegram job reached terminal failure"); }
    processed++;
  }
  return { processed, failed };
}
