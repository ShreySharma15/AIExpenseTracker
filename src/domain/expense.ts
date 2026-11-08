import { z } from "zod";
import { isCalendarDate } from "./dates.ts";
import { parsePaise } from "./money.ts";

export const categories = ["Food", "Transport", "Groceries", "Utilities", "Shopping", "Health", "Other"] as const;
export const expenseInput = z.object({
  amount: z.string().max(20),
  description: z.string().trim().min(1).max(200),
  category: z.enum(categories),
  occurred_on: z.string().refine(isCalendarDate, "Enter a valid date."),
  coverage: z.string().trim().max(120).nullish(),
});

export function expenseItem(raw: unknown) {
  const { amount, ...item } = expenseInput.parse(raw);
  return { ...item, paise: parsePaise(amount).toString(), coverage: item.coverage || null };
}
