import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("expense batches are atomic, idempotent, isolated and reversible", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create function auth.role() returns text language sql stable as
        $$ select current_setting('request.jwt.claim.role', true) $$;
      grant usage on schema auth to authenticated, service_role;
    `);
    await db.exec(await readFile(new URL("../supabase/migrations/202611080001_expenses.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../supabase/migrations/202611080002_ai_quota.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../supabase/migrations/202611080003_telegram_recovery.sql", import.meta.url), "utf8"));
    const owner = "10000000-0000-4000-8000-000000000001";
    const other = "20000000-0000-4000-8000-000000000002";
    await db.query("insert into auth.users values ($1),($2)", [owner, other]);
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
    const item = { occurred_on: "2026-11-08", paise: "1001", description: "Lunch", category: "Food" };
    const add = (key: string, items = [item], who = owner) =>
      db.query<{ ids: string[] }>("select public.add_expenses($1,$2,$3::jsonb) as ids", [who, key, JSON.stringify(items)]);
    await assert.rejects(add("invalid", [item, { ...item, paise: "-1" }]));
    assert.equal((await db.query("select id from public.expenses")).rows.length, 0);
    const first = (await add("telegram:1")).rows[0].ids;
    assert.deepEqual((await add("telegram:1")).rows[0].ids, first);
    assert.deepEqual((await add("telegram:1", [item, item])).rows[0].ids, first);
    await assert.rejects(add("foreign", [item], other));
    await assert.rejects(db.query("update public.expenses set current_version = 7"));
    await db.query("select public.change_expense($1,$2,1,$3)", [owner, first[0], JSON.stringify({ ...item, paise: "900", occurred_on: "2026-10-31" })]);
    await assert.rejects(db.query("select public.change_expense($1,$2,1,null)", [owner, first[0]]));
    assert.deepEqual((await db.query("select total from public.expense_summary($1,'2026-10-01','2026-11-01')", [owner])).rows, [{ total: "900" }]);
    await db.query("select public.change_expense($1,$2,2,null)", [owner, first[0]]);
    assert.equal((await db.query("select * from public.active_expenses")).rows.length, 0);
    assert.equal((await db.query("select * from public.expense_revisions")).rows.length, 3);
    assert.deepEqual((await db.query("select sum(paise::bigint)::text as total from public.expense_postings group by account")).rows, [{ total: "0" }, { total: "0" }]);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [other]);
    assert.equal((await db.query("select * from public.expense_revisions")).rows.length, 0);
    await assert.rejects(db.query("select public.change_expense($1,$2,3,null)", [other, first[0]]));
    await assert.rejects(db.query("select public.reserve_ai_request($1,'draft',1)", [other]));
    await assert.rejects(db.query("select * from public.claim_telegram_job(123, null)"));
    await assert.rejects(db.query("select * from public.telegram_jobs"));
    await db.exec("reset role; set role service_role; select set_config('request.jwt.claim.role', 'service_role', false)");
    assert.deepEqual((await db.query("select public.reserve_ai_request($1,'draft',1) as status", [owner])).rows, [{ status: "reserved" }]);
    assert.deepEqual((await db.query("select public.reserve_ai_request($1,'draft',1) as status", [owner])).rows, [{ status: "duplicate" }]);
    assert.deepEqual((await db.query("select public.reserve_ai_request($1,'later',1) as status", [owner])).rows, [{ status: "daily_limit" }]);
    const { rows: drafts } = await db.query<{ id: string }>(
      "insert into public.ai_expense_drafts(owner_id,source_key,items) values ($1,'draft',$2) returning id",
      [owner, JSON.stringify([item])],
    );
    const confirm = "select public.confirm_ai_expenses($1,$2) as ids";
    assert.equal((await db.query("select * from public.active_expenses")).rows.length, 0);
    assert.deepEqual((await db.query(confirm, [other, drafts[0].id])).rows, [{ ids: null }]);
    assert.equal((await db.query("select * from public.active_expenses")).rows.length, 0);
    const saved = (await db.query(confirm, [owner, drafts[0].id])).rows;
    assert.deepEqual((await db.query(confirm, [owner, drafts[0].id])).rows, saved);
    assert.equal((await db.query("select * from public.active_expenses")).rows.length, 1);
    await db.exec(`
      insert into public.telegram_jobs(bot_id,update_id,payload) values (123,456,'{"update_id":456}');
      insert into public.telegram_jobs(bot_id,update_id,payload) values (123,456,'{"update_id":456}') on conflict do nothing;
    `);
    const claim = (bot = 123) => db.query<{ lease_token: string; stage: string; payload: unknown; reply: unknown }>(
      "select lease_token, stage, payload, reply from public.claim_telegram_job($1,null)", [bot]);
    const firstLease = (await claim()).rows[0];
    assert.equal((await claim()).rows.length, 0);
    assert.equal((await claim(321)).rows.length, 0);
    await db.exec("reset role; update public.telegram_jobs set lease_until = now() - interval '1 second'; set role service_role");
    const recovered = (await claim()).rows[0];
    assert.notEqual(recovered.lease_token, firstLease.lease_token);
    const finish = (lease: string, result: string, reply?: string) => db.query(
      "select public.finish_telegram_job(123,456,$1,$2,$3) as ok", [lease, result, reply ?? null]);
    assert.deepEqual((await finish(firstLease.lease_token, "ok")).rows, [{ ok: false }]);
    const reply = '{"method":"sendMessage","chat_id":123,"text":"Saved"}';
    assert.deepEqual((await finish(recovered.lease_token, "ok", reply)).rows, [{ ok: true }]);
    const send = (await claim()).rows[0];
    assert.equal(send.stage, "send");
    assert.equal(send.payload, null);
    assert.deepEqual(send.reply, JSON.parse(reply));
    assert.deepEqual((await finish(send.lease_token, "retry")).rows, [{ ok: true }]);
    assert.equal((await claim()).rows.length, 0);
    await db.exec("reset role; update public.telegram_jobs set ready_at = now() - interval '1 second'; set role service_role");
    const retry = (await claim()).rows[0];
    assert.deepEqual(retry.reply, send.reply);
    assert.deepEqual((await finish(retry.lease_token, "ok")).rows, [{ ok: true }]);
    assert.deepEqual((await db.query("select stage, payload, reply from public.telegram_jobs")).rows,
      [{ stage: "done", payload: null, reply: null }]);

    await db.exec(`
      reset role;
      create schema vault;
      create schema cron;
      create schema net;
      create table vault.decrypted_secrets(name text, decrypted_secret text);
      create table cron.jobs(name text, cadence text, command text);
      create function cron.schedule(text,text,text) returns void language sql as
        $$ insert into cron.jobs values ($1,$2,$3) $$;
      create table net.calls(url text, headers jsonb, body jsonb);
      create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int)
        returns void language sql as $$ insert into net.calls values ($1,$2,$3) $$;
    `);
    const schedule = await readFile(new URL("../supabase/ops/schedule-telegram-recovery.sql", import.meta.url), "utf8");
    await assert.rejects(db.exec(schedule), /Provision the recovery URL and secret/);
    await db.exec(`
      insert into vault.decrypted_secrets values
        ('expense_tracker_recovery_url','https://example.invalid/api/internal/recovery'),
        ('expense_tracker_cron_secret','test-only-value');
    `);
    await db.exec(schedule);
    const scheduleRow = (await db.query<{ cadence: string; command: string }>("select cadence, command from cron.jobs")).rows[0];
    assert.equal(scheduleRow.cadence, "* * * * *");
    assert.ok(!scheduleRow.command.includes("test-only-value"));
    await db.exec(scheduleRow.command);
    assert.deepEqual((await db.query("select headers->>'Authorization' as auth from net.calls")).rows,
      [{ auth: "Bearer test-only-value" }]);
  } finally {
    await db.close();
  }
});
