import { z } from "zod";

const telegramId = z.number().int().positive();
const sender = z.object({ id: telegramId });
const chat = z.object({ id: telegramId, type: z.literal("private") });
const message = z.object({
  from: sender, chat, message_id: telegramId, date: z.number().int().nonnegative(), text: z.string(),
  entities: z.array(z.object({ type: z.string(), offset: z.number().int(), length: z.number().int() })).optional(),
});
const updateId = z.object({ update_id: z.number().int().nonnegative() });
const envelope = z.union([
  updateId.extend({ message }),
  updateId.extend({ edited_message: message }),
  updateId.extend({ callback_query: z.object({
    from: sender, message: z.object({ chat, message_id: telegramId, date: z.number().int().nonnegative() }),
    id: z.string(), data: z.string(), chat_instance: z.string(),
  }) }),
]);

export function botId() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return /^(\d+):[\w-]+$/.exec(token ?? "")?.[1];
}

export function allowedTelegramUpdate(input: unknown) {
  const result = envelope.safeParse(input);
  if (!result.success) return null;
  const update = result.data;
  const event = "message" in update ? update.message : "edited_message" in update ? update.edited_message : update.callback_query;
  const privateChat = "chat" in event ? event.chat : event.message.chat;
  if (String(event.from.id) !== process.env.TELEGRAM_ALLOWED_USER_ID
    || String(privateChat.id) !== process.env.TELEGRAM_ALLOWED_CHAT_ID) return null;
  return update;
}
