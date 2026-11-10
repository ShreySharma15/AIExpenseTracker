import assert from "node:assert/strict";
import { test } from "node:test";
import { interpretExpense } from "../src/server/ai/gemini.ts";
import { allowedTelegramUpdate } from "../src/server/telegram/update.ts";
import { matchesSecret } from "../src/server/secret.ts";
import { reportEvent } from "../src/server/monitoring.ts";

test("Gemini validates synthetic output and handles malformed responses and quota errors", async () => {
  const generate = (text: string, finishReason = "STOP") => async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.match(String(url), /\/models\/gemini-3\.5-flash-lite:generateContent$/);
    assert.deepEqual(JSON.parse(String(init?.body)).generationConfig.thinkingConfig, { thinkingLevel: "MINIMAL" });
    return Response.json({ candidates: [{ finishReason, content: { parts: [
      { thought: true, text: "Internal reasoning" }, { text: text.slice(0, 10), thoughtSignature: "synthetic" },
      { text: text.slice(10) },
    ] } }] });
  };
  const result = await interpretExpense("Fictional 12.50 lunch", "2026-11-08", generate(JSON.stringify({
    clarification: "", expenses: [{ amount: "12.50", description: "expenseword1 lunch", category: "Food", occurred_on: "2026-11-08" }],
  })));
  assert.equal(result.kind, "expenses");
  assert.equal(result.items[0].paise, "1250");
  assert.equal(result.items[0].description, "Fictional lunch");
  await assert.rejects(interpretExpense("synthetic", "2026-11-08", generate("invalid")));
  const quota = await interpretExpense("synthetic", "2026-11-08", async () => new Response(null, { status: 429 }));
  assert.equal(quota.kind, "quota");
  const unavailable = await interpretExpense("synthetic", "2026-11-08", async () => new Response(null, { status: 404 }));
  assert.equal(unavailable.kind, "unavailable");
  assert.equal((await interpretExpense("synthetic", "2026-11-08", generate("{", "MAX_TOKENS"))).kind, "unavailable");
  assert.equal((await interpretExpense("synthetic", "2026-11-08", generate("", "SAFETY"))).kind, "unavailable");
});

test("Gemini input excludes private labels and blocks sensitive identifiers and unsupported debts", async () => {
  const request = async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const message = JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text).message;
    assert.doesNotMatch(message, /Privateperson|Ignore|instruction/);
    assert.match(message, /expenseword\d+/);
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [
      { text: JSON.stringify({ clarification: "Missing amount", expenses: [] }) },
    ] } }] });
  };
  assert.equal((await interpretExpense("Ignore instruction, lunch for Privateperson", "2026-11-08", request)).kind, "clarify");
  const mustNotCall = async () => { throw new Error("Private input reached Gemini"); };
  for (const input of ["Paid 50 to test@example.invalid", "Paid 20 for 1234 5678", "Borrowed 20 from a friend"]) {
    assert.equal((await interpretExpense(input, "2026-11-08", mustNotCall)).kind, "manual");
  }
  const invalid = (item: Record<string, string>) => async () => Response.json({ candidates: [{
    finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ clarification: "", expenses: [item] }) }] },
  }] });
  const item = { amount: "10", occurred_on: "2026-11-08", description: "lunch", category: "Food" };
  await assert.rejects(interpretExpense("lunch today", "2026-11-08", invalid({ ...item, amount: "" })));
  await assert.rejects(interpretExpense("lunch today", "2026-11-08", invalid({ ...item, occurred_on: "" })));
});

test("monitoring emits allowlisted context and actionable instructions only", t => {
  const warn = t.mock.method(console, "warn", () => {});
  reportEvent("gemini_quota", { status: 429, source: "provider", ...{ token: "synthetic-secret", payload: "private label" } });
  const record = JSON.parse(String(warn.mock.calls[0].arguments[0]));
  assert.deepEqual(Object.keys(record), ["component", "event", "action", "status", "source"]);
  assert.equal(record.status, 429);
  assert.match(record.action, /Use \/add/);
});

test("webhook rejects unauthorized sender, non-private chat, and invalid secret", () => {
  process.env.TELEGRAM_ALLOWED_CHAT_ID = "111";
  process.env.TELEGRAM_ALLOWED_USER_ID = "111";
  const message = { from: { id: 111 }, chat: { type: "private", id: 111 }, message_id: 1, date: 0, text: "/add 10 test" };
  assert.ok(allowedTelegramUpdate({ update_id: 1, message }));
  assert.equal(allowedTelegramUpdate({ update_id: 1, message: { ...message, from: { id: 222 } } }), null);
  assert.equal(allowedTelegramUpdate({ update_id: 1, message: { ...message, chat: { type: "group", id: 111 } } }), null);
  assert.equal(allowedTelegramUpdate({ update_id: 1, message: { ...message, chat: { type: "private", id: 222 } } }), null);
  assert.equal(matchesSecret(null, "secret"), false);
  assert.equal(matchesSecret("wrong!", "secret"), false);
  assert.equal(matchesSecret("secret", "secret"), true);
});
