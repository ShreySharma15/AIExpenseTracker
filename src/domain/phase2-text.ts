import { isCalendarDate, localDate } from "./dates.ts";
import { parsePaise } from "./money.ts";

const self = /^(?:i|me|myself)$/i;
const amount = "₹?\\s*(\\d{1,10}(?:\\.\\d{1,2})?)";
const shared = new RegExp("^(?:(.{1,80}?)\\s+)?paid\\s+" + amount + "\\s+for\\s+(.{1,200}?)\\s+split\\s+equally\\s+between\\s+(.+)$","i");
const fromMe = new RegExp("^(.{1,80}?)\\s+borrowed\\s+" + amount + "\\s+from me$","i");
const iLent = new RegExp("^I lent\\s+" + amount + "\\s+to\\s+(.{1,80})$","i");
const iBorrowed = new RegExp("^I borrowed\\s+" + amount + "\\s+from\\s+(.{1,80})$","i");
const returned = new RegExp("^(.{1,80}?)\\s+(?:returned|repaid)\\s+" + amount + "(?:\\s+to me)?$","i");
const iReturned = new RegExp("^I (?:returned|repaid)\\s+" + amount + "\\s+to\\s+(.{1,80})$","i");

export function parsePhase2Text(message: string, instant: Date) {
  if (!/\b(?:split|borrow(?:ed|ing)?|lent|lend(?:ing)?|returned|repay(?:ment|ing)?|repaid|settle(?:ment|d)?)\b/i.test(message)) return null;
  const prefix = /^(today|yesterday|\d{4}-\d{2}-\d{2})\s+/i.exec(message);
  const day = prefix?.[1].toLowerCase();
  const date = day === "yesterday" ? localDate(new Date(instant.valueOf()-86_400_000))
    : !day || day === "today" ? localDate(instant) : day;
  if (!isCalendarDate(date)) throw new Error("Use a valid expense date.");
  const text = prefix ? message.slice(prefix[0].length) : message;
  const split = shared.exec(text);
  if (split) {
    const participants = split[4].split(/\s*,\s*(?:and\s+)?|\s+and\s+/i).map(p=>p.trim());
    if (participants.length < 2 || participants.length > 20 || participants.some(p=>!p || p.length > 80)) {
      throw new Error("List the participants by saved name.");
    }
    const payer = split[1]?.trim();
    return { kind:"shared" as const, date, description:split[3].trim(), amount:parsePaise(split[2]),
      payer:!payer || self.test(payer) ? null : payer,
      participants:participants.map(p=>self.test(p) ? null : p) };
  }
  for (const [pattern, kind, nameFirst] of [
    [fromMe,"lend",true],[iLent,"lend",false],[iBorrowed,"borrow",false],
    [returned,"receive",true],[iReturned,"repay",false],
  ] as const) {
    const match = pattern.exec(text);
    if (match) {
      const person = match[nameFirst ? 1 : 2].trim();
      if (self.test(person)) continue;
      return {kind,date,person,amount:parsePaise(match[nameFirst ? 2 : 1])};
    }
  }
  throw new Error("Clarify the amount, person and direction. For unequal splits or several debts, use People & Groups.");
}
