import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPaise, parsePaise } from "../src/domain/money.ts";
import { isCalendarDate, localDate, monthRange } from "../src/domain/dates.ts";
import { parseExpenseMessage } from "../src/domain/telegram-text.ts";

test("money is exact and rejects excess precision, zero and unsupported notation", () => {
  assert.equal(parsePaise("123.04"), 12304n);
  assert.equal(parsePaise("0.01"), 1n);
  assert.equal(formatPaise(-123456789n), "−₹12,34,567.89");
  for (const invalid of ["0", "1.005", "1e3", "-1", "1,000", "10000000000"]) {
    assert.throws(() => parsePaise(invalid));
  }
});

test("monthly boundaries and date validation respect the India calendar", () => {
  assert.equal(localDate(new Date("2026-11-30T18:29:59Z")), "2026-11-30");
  assert.equal(localDate(new Date("2026-11-30T18:30:00Z")), "2026-12-01");
  assert.equal(isCalendarDate("2026-02-29"), false);
  assert.equal(isCalendarDate("2028-02-29"), true);
  assert.deepEqual(monthRange("2026-12"), ["2026-12-01", "2027-01-01"]);
});

test("Telegram entries preserve paise, relative dates and coverage", () => {
  const received = new Date("2026-11-30T18:30:00Z");
  const rows = parseExpenseMessage("/add yesterday 250 lunch | Food; 600.05 electricity | Utilities | October–November", received);
  assert.deepEqual(rows.map(row => [row.paise, row.occurred_on, row.category, row.coverage]), [
    ["25000", "2026-11-30", "Food", null], ["60005", "2026-11-30", "Utilities", "October–November"],
  ]);
  assert.throws(() => parseExpenseMessage("/add 300", received));
  assert.throws(() => parseExpenseMessage("/add 2026-02-30 300 lunch", received));
  assert.throws(() => parseExpenseMessage("Spent 1200 on dinner split equally", received));
  assert.equal(parseExpenseMessage("Yesterday 150 auto and 200 groceries", received).length, 2);
});
