import { after } from "next/server";
import { botClient } from "@/lib/supabase/server";
import { matchesSecret } from "@/server/secret";
import { processTelegramJobs } from "@/server/telegram/recovery";
import { allowedTelegramUpdate, botId } from "@/server/telegram/update";
import { reportEvent } from "@/server/monitoring";

export const runtime = "nodejs";
export const maxDuration = 50;

export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const bot = botId();
  if (!secret || !bot) {
    reportEvent("webhook_config", { status: 503 });
    return new Response(null, { status: 503 });
  }
  if (!matchesSecret(request.headers.get("x-telegram-bot-api-secret-token"), secret)) return new Response(null, { status: 401 });
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  let size = 0;
  const chunks: Uint8Array[] = [];
  let body: unknown;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) { await reader.cancel(); return new Response(null, { status: 413 }); }
      chunks.push(value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    reportEvent("webhook_invalid_body", { status: 400 });
    return new Response(null, { status: 400 });
  }
  const update = allowedTelegramUpdate(body);
  if (!update) return new Response(null, { status: 200 });
  try {
    const { error } = await botClient().from("telegram_jobs").upsert({
      bot_id: bot, update_id: update.update_id, payload: update,
    }, { onConflict: "bot_id,update_id", ignoreDuplicates: true });
    if (error) throw new Error("Webhook enqueue failed");
  } catch {
    reportEvent("webhook_enqueue", { status: 503 });
    return new Response(null, { status: 503 });
  }
  after(async () => {
    try { await processTelegramJobs(update.update_id); }
    catch { reportEvent("webhook_deferred"); }
  });
  return new Response(null, { status: 200 });
}
