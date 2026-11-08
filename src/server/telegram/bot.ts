import "server-only";
import { Bot, InlineKeyboard, webhookCallback, type Context } from "grammy";
import { localDate } from "@/domain/dates";
import { formatPaise } from "@/domain/money";
import { parseExpenseMessage, parseTelegramCorrection } from "@/domain/telegram-text";
import { configuredAiLimit, interpretExpense } from "@/server/ai/gemini";
import { botClient } from "@/lib/supabase/server";

const help = "Add an expense with /add 250 lunch | Food. For several expenses, separate entries with a semicolon. Prefix an entry with yesterday or a date. Use /ai followed by non-sensitive text to request Gemini parsing.";
const correctionHelp = "Use /edit ID VERSION YYYY-MM-DD 250 lunch | Food or /undo ID VERSION. Copy the ID and version from the saved expense or dashboard.";
let handler: ((request: Request) => Promise<Response>) | undefined;

async function showDraft(ctx: Context, draft: { id: string; items: ReturnType<typeof parseExpenseMessage> }) {
  const lines = draft.items.map(row => `${row.occurred_on} · ${formatPaise(BigInt(row.paise))} · ${row.description} · ${row.category}`);
  await ctx.reply("Review these expenses before saving:\n\n" + lines.join("\n"), {
    reply_markup: new InlineKeyboard().text("Save expenses", "save:" + draft.id).text("Cancel", "cancel:" + draft.id),
  });
}

function makeHandler(token: string) {
  const bot = new Bot(token, { client: { timeoutSeconds: 5, canUseWebhookReply: method => method === "sendMessage" || method === "answerCallbackQuery" } });
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== "private" || String(ctx.chat.id) !== process.env.TELEGRAM_ALLOWED_CHAT_ID
      || !ctx.from || String(ctx.from.id) !== process.env.TELEGRAM_ALLOWED_USER_ID) return;
    await next();
  });
  bot.command(["start", "help"], async ctx => { await ctx.reply(help); });
  bot.on("edited_message:text", async ctx => { await ctx.reply(correctionHelp); });
  bot.callbackQuery(/^cancel:([0-9a-f-]{36})$/, async ctx => {
    const owner = process.env.APP_OWNER_USER_ID;
    if (!owner) throw new Error("Owner configuration unavailable");
    const { data, error } = await botClient().rpc("cancel_ai_draft", { p_owner: owner, p_draft: ctx.match[1] });
    if (error?.code === "PGRST202") { await ctx.answerCallbackQuery("Cancellation unavailable. Unsaved drafts expire automatically."); return; }
    if (error) throw new Error("Draft cancellation failed");
    await ctx.answerCallbackQuery(data ? "Draft closed." : "Already saved. Use the dashboard to void it.");
  });
  bot.callbackQuery(/^save:([0-9a-f-]{36})$/, async ctx => {
    const owner = process.env.APP_OWNER_USER_ID;
    if (!owner) throw new Error("Owner configuration unavailable");
    const { data, error } = await botClient().rpc("confirm_ai_expenses", { p_owner: owner, p_draft: ctx.match[1] });
    if (error) throw new Error("Draft save failed");
    await ctx.answerCallbackQuery(data ? `Saved ${data.length} expense(s).` : "This draft has expired. Send a new entry.");
  });
  bot.on("message:text", async ctx => {
    const input = ctx.message.text.trim();
    if (input.length > 1000) { await ctx.reply("Send at most 1,000 characters at a time."); return; }
    const owner = process.env.APP_OWNER_USER_ID;
    if (!owner) throw new Error("Owner configuration unavailable");
    const db = botClient();
    const source = `telegram:${ctx.me.id}:${ctx.chat.id}:${ctx.message.message_id}`;
    const instant = new Date(ctx.message.date * 1000);
    if (/^\/(?:edit|undo)(?:@\w+)?(?:\s|$)/i.test(input)) {
      let correction;
      try { correction = parseTelegramCorrection(input, instant); }
      catch { await ctx.reply(correctionHelp); return; }
      const { data, error } = await db.rpc("correct_telegram_expense", {
        p_owner: owner, p_source: source, p_id: correction.id, p_version: correction.version, p_item: correction.item,
      });
      if (error?.code === "40001") { await ctx.reply("Expense changed. Check its current version in the dashboard."); return; }
      if (error?.code === "PGRST202") { await ctx.reply("Telegram corrections are unavailable. Use the dashboard."); return; }
      if (error) throw new Error("Expense correction failed");
      await ctx.reply(data ? `Expense ${correction.item ? "updated" : "voided"} · version ${data}` : "Expense not found.");
      return;
    }
    let items: ReturnType<typeof parseExpenseMessage>;
    if (/^\/ai(?:@\w+)?\s+/i.test(input)) {
      const limit = configuredAiLimit();
      if (!limit) { await ctx.reply("Gemini is paused. You can use /add or the dashboard."); return; }
      const { data: reservation, error } = await db.rpc("reserve_ai_request", { p_owner: owner, p_source: source, p_limit: limit });
      if (error) throw new Error("Quota reservation failed");
      if (reservation === "duplicate") {
        const { data, error: lookupError } = await db.from("ai_expense_drafts").select("id,items")
          .eq("owner_id", owner).eq("source_key", source).gt("expires_at", new Date().toISOString()).maybeSingle();
        if (lookupError) throw new Error("Draft lookup failed");
        if (data) await showDraft(ctx, { id: data.id, items: data.items });
        else await ctx.reply("No draft is available for this update. Send a new entry if needed.");
        return;
      }
      if (reservation !== "reserved") {
        await ctx.reply(reservation === "slow_down" ? "Wait briefly before another AI request, or use /add." : "AI quota reached. Use /add or the dashboard.");
        return;
      }
      let result: Awaited<ReturnType<typeof interpretExpense>>;
      try {
        result = await interpretExpense(input.replace(/^\/ai(?:@\w+)?\s+/i, ""), localDate(instant));
      } catch {
        await ctx.reply("Gemini could not interpret that entry. Use /add or try again later.");
        return;
      }
      if (result.kind !== "expenses") {
        const reply = result.kind === "clarify" ? result.text + "\nSend a complete revised entry when ready."
          : result.kind === "quota" ? "Gemini quota reached. Use /add or the dashboard."
          : "Gemini is unavailable. Use /add or try again later.";
        await ctx.reply(reply);
        return;
      }
      const { data, error: draftError } = await db.from("ai_expense_drafts")
        .insert({ owner_id: owner, source_key: source, items: result.items }).select("id").single();
      if (draftError) {
        await ctx.reply("The draft could not be saved. Please resend the entry or use /add.");
        return;
      }
      await showDraft(ctx, { id: data.id, items: result.items });
      return;
    } else {
      try {
        if (!/^(?:\/add(?:@\w+)?\s|spent\s|(?:today|yesterday|\d{4}-\d{2}-\d{2})\s)/i.test(input)) throw new Error("Use /add");
        items = parseExpenseMessage(input, instant);
      } catch {
        await ctx.reply(help);
        return;
      }
    }
    const { data, error } = await db.rpc("add_expenses", { p_owner: owner, p_source: source, p_items: items });
    if (error) throw new Error("Expense save failed");
    const total = items.reduce((sum, row) => sum + BigInt(row.paise), 0n);
    await ctx.reply(`Saved ${items.length} expense${items.length === 1 ? "" : "s"} · ${formatPaise(total)}\n`
      + (data as string[]).map(id => id + " · v1").join("\n"));
  });
  return webhookCallback(bot, "std/http", { timeoutMilliseconds: 18000, onTimeout: "throw" });
}

export async function telegramReply(payload: unknown) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Telegram configuration unavailable");
  handler ??= makeHandler(token);
  const response = await handler(new Request("http://localhost/telegram", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }));
  if (!response.ok) throw new Error("Telegram processing failed");
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}
