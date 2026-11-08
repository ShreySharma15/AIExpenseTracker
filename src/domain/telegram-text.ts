import { localDate } from "./dates.ts";
import { categories, expenseItem } from "./expense.ts";

export function parseTelegramCorrection(input: string, instant: Date) {
  const match = /^\/(edit|undo)(?:@\w+)?\s+([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})\s+([1-9]\d{0,8})(?:\s+(.+))?$/i.exec(input);
  if (!match) throw new Error("Provide the expense ID and version.");
  const [, command, id, version, text] = match;
  if (command.toLowerCase() === "undo") {
    if (text) throw new Error("Undo takes only an expense ID and version.");
    return { id, version: Number(version), item: null };
  }
  if (!text || !/^\d{4}-\d{2}-\d{2}\s/.test(text) || !text.includes("|")) {
    throw new Error("Edit requires the full replacement including date and category.");
  }
  const items = parseExpenseMessage(text, instant);
  if (items.length !== 1) throw new Error("Edit one expense at a time.");
  return { id, version: Number(version), item: items[0] };
}

export function parseExpenseMessage(message: string, instant: Date) {
  const explicit = /^\/add(?:@\w+)?\s+/i.test(message);
  const command = message.replace(/^\/add(?:@\w+)?\s+/i, "");
  if (!explicit && /\b(?:split (?:equally|between|with)|borrowed|lent|repay(?:ment|ing|s)?|paid back|owed|returned)\b/i.test(command)) {
    throw new Error("This message may describe a split or repayment.");
  }
  const entries = command.split(/[;\n]|\s+and\s+(?=₹?\s*\d)/i).map(part => part.trim()).filter(Boolean);
  if (entries.length < 1 || entries.length > 12) throw new Error("Enter up to 12 expenses.");
  let occurred_on = localDate(instant);
  return entries.map(entry => {
    const match = /^(?:(today|yesterday|\d{4}-\d{2}-\d{2})\s+)?(?:spent\s+)?₹?\s*(\d{1,10}(?:\.\d{1,2})?)\s+(?:on\s+)?([^|]+?)(?:\s*\|\s*([^|]+?))?(?:\s*\|\s*([^|]+?))?$/i.exec(entry);
    if (!match) throw new Error("Specify an amount and description.");
    const [, date, amount, description, rawCategory, coverage] = match;
    const day = date?.toLowerCase();
    if (day) {
      occurred_on = day === "yesterday" ? localDate(new Date(instant.valueOf() - 86_400_000))
        : day === "today" ? localDate(instant) : day;
    }
    const category = rawCategory
      ? categories.find(value => value.toLowerCase() === rawCategory.trim().toLowerCase())
      : "Other";
    return expenseItem({ amount, occurred_on, description, category, coverage });
  });
}
