import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { allocateShares, splitValue } from "../src/domain/splits.ts";
import { parsePhase2Text } from "../src/domain/phase2-text.ts";

test("paise allocation is exact, deterministic and bounded", () => {
  assert.deepEqual(allocateShares(100n,"equal",[1n,1n,1n]), [34n,33n,33n]);
  assert.deepEqual(allocateShares(101n,"weights",[1n,2n,3n]), [17n,34n,50n]);
  assert.deepEqual(allocateShares(101n,"percent",[3333n,3333n,3334n]), [34n,33n,34n]);
  assert.deepEqual(allocateShares(101n,"exact",[0n,1n,100n]), [0n,1n,100n]);
  assert.equal(splitValue("percent","25.50"),2550n);
  assert.equal(splitValue("exact","0.00"),0n);
  assert.throws(() => allocateShares(101n,"exact",[100n]));
  assert.throws(() => allocateShares(101n,"weights",[0n,1n]));
  assert.throws(() => allocateShares(101n,"percent",[9999n]));
  assert.throws(() => splitValue("weights","1.5"));
  for (let n = 1; n <= 20; n++) {
    const total = 999_999_999_999n;
    const values = Array.from({ length:n }, (_,i) => BigInt(i + 1));
    assert.equal(allocateShares(total,"weights",values).reduce((a,b)=>a+b,0n), total);
  }
});

test("Telegram parses the documented shared, loan and repayment phrases without AI", () => {
  const now = new Date("2026-11-10T10:00:00Z");
  assert.deepEqual(parsePhase2Text("Paid 1200 for dinner split equally between me, Rahul, and Siddharth",now),{
    kind:"shared",date:"2026-11-10",description:"dinner",amount:120000n,payer:null,participants:[null,"Rahul","Siddharth"],
  });
  assert.deepEqual(parsePhase2Text("Yesterday Siddharth borrowed 500 from me",now),
    {kind:"lend",date:"2026-11-09",person:"Siddharth",amount:50000n});
  assert.deepEqual(parsePhase2Text("I borrowed 1000 from Aditya",now),
    {kind:"borrow",date:"2026-11-10",person:"Aditya",amount:100000n});
  assert.deepEqual(parsePhase2Text("Siddharth returned 200",now),
    {kind:"receive",date:"2026-11-10",person:"Siddharth",amount:20000n});
  assert.equal(parsePhase2Text("Spent 250 on lunch",now),null);
  assert.throws(()=>parsePhase2Text("Someone borrowed money",now));
});

test("Phase 2 migrations preserve owner isolation, allocations, repayments and reversals", async () => {
  const db = new PGlite();
  const owner = "a0000000-0000-4000-8000-000000000001";
  const other = "a0000000-0000-4000-8000-000000000002";
  const a = "a0000000-0000-4000-8000-000000000003";
  const b = "a0000000-0000-4000-8000-000000000004";
  const outsider = "a0000000-0000-4000-8000-000000000005";
  const group = "a0000000-0000-4000-8000-000000000006";
  const day = "2026-11-10";
  const asOwner = (id: string) => db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
  const value = async <T>(sql: string, params: unknown[] = []) =>
    (await db.query<{ value:T }>(sql,params)).rows[0]?.value;
  const shared = (key: string, payer: string | null, amount: number, replaces: string | null = null,
    participants: (string | null)[] = [null,a,b]) =>
    value<string>("select public.record_shared_expense($1,$2,'Dinner','Food',$3,$4,null,'equal',$5::jsonb,$6) as value",
      [key,day,amount,payer,JSON.stringify(participants.map(person_id=>({person_id}))),replaces]);
  const loan = (key:string, kind:string, person:string, amount:number) =>
    value<string>("select public.record_phase2_loan($1,$2,'Loan',$3,$4,$5) as value",[key,day,kind,person,amount]);
  const obligation = (event: string, person: string) =>
    value<string>("select id as value from public.phase2_open_obligations where event_id=$1 and person_id=$2",[event,person]);
  const settle = (key: string, kind: string, allocations: [string,number][], date = day) =>
    value<string>("select public.record_phase2_settlement($1,$2,'Settlement',$3,$4::jsonb) as value",
      [key,date,kind,JSON.stringify(allocations.map(([obligation_id,paise])=>({obligation_id,paise:String(paise)})))]);
  const voidEvent = (id: string) => value<string>("select public.void_phase2_event($1) as value",[id]);
  const remaining = (id: string) => value<string>("select remaining_paise as value from public.phase2_open_obligations where id=$1",[id]);
  const balance = async (id:string) => (await db.query(
    "select receivable_paise,payable_paise from public.phase2_balances where person_id=$1",[id])).rows[0];
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.role() returns text language sql stable as
        $$ select current_setting('request.jwt.claim.role',true) $$;
      grant usage on schema auth to authenticated,service_role;
    `);
    const path = new URL("../supabase/migrations/",import.meta.url);
    for (const file of (await readdir(path)).filter(file=>file.endsWith(".sql")).sort()) {
      try { await db.exec(await readFile(new URL(file,path),"utf8")); }
      catch (error) { throw new Error(`${file}: ${error instanceof Error ? error.message : error}`, { cause:error }); }
    }
    await db.query("insert into auth.users values ($1),($2)",[owner,other]);
    await db.exec("set role authenticated");
    await asOwner(other);
    await db.query("insert into public.people(id,owner_id,display_name) values ($1,$2,'Other owner contact')",[outsider,other]);
    await asOwner(owner);
    await db.query("insert into public.people(id,owner_id,display_name) values ($1,$3,'Person A'),($2,$3,'Person B')",[a,b,owner]);
    await db.query("insert into public.person_aliases(id,owner_id,person_id,alias) values (gen_random_uuid(),$1,$2,'A')",[owner,a]);
    await assert.rejects(db.query("insert into public.person_aliases(id,owner_id,person_id,alias) values (gen_random_uuid(),$1,$2,'X')",[owner,outsider]));
    assert.equal(await value("select public.save_expense_group($1,'Dinner group',$2) as value",[group,[a,b]]), group);
    await assert.rejects(value("select public.save_expense_group($1,'Bad group',$2) as value",[group,[outsider]]));
    await assert.rejects(shared("bad-person",null,120000,null,[null,outsider]));
    await assert.rejects(shared("duplicate-person",null,120000,null,[null,a,a]));
    const dinner = await shared("dinner",null,120000);
    assert.equal(await shared("dinner",null,120000),dinner);
    await assert.rejects(shared("dinner",null,120001));
    assert.deepEqual((await db.query("select paise::text as paise from public.phase2_shares where event_id=$1 order by position",[dinner])).rows,
      [{paise:"40000"},{paise:"40000"},{paise:"40000"}]);
    assert.equal(await value("select personal_paise as value from public.phase2_history where id=$1",[dinner]),"40000");
    assert.equal(await value("select cash_paise as value from public.phase2_history where id=$1",[dinner]),"-120000");
    const otherDinner = await shared("other-paid",a,120000);
    assert.deepEqual(await balance(a),{receivable_paise:"40000",payable_paise:"40000"});
    assert.deepEqual(await balance(b),{receivable_paise:"40000",payable_paise:"0"});
    assert.equal(await value("select cash_paise as value from public.phase2_history where id=$1",[otherDinner]),"0");
    const receivable = await obligation(dinner,a);
    const payable = await obligation(otherDinner,a);
    await assert.rejects(settle("wrong-direction","repay",[[receivable,1000]]));
    await assert.rejects(settle("overpayment","receive",[[receivable,40001]]));
    await assert.rejects(settle("backdated","receive",[[receivable,1000]],"2026-11-09"));
    await assert.rejects(settle("mixed","receive",[[receivable,1000],[await obligation(dinner,b),1000]]));
    await assert.rejects(settle("unequal-net","net",[[receivable,1000],[payable,1001]]));
    const net = await settle("net","net",[[receivable,1000],[payable,1000]]);
    assert.deepEqual((await db.query("select direction,paise from public.phase2_settlement_details where event_id=$1 order by direction",[net])).rows,
      [{direction:"payable",paise:"1000"},{direction:"receivable",paise:"1000"}]);
    assert.deepEqual(await balance(a),{receivable_paise:"39000",payable_paise:"39000"});
    await assert.rejects(voidEvent(dinner));
    await assert.rejects(shared("invalid-replacement",null,300,dinner));
    assert.equal(await value("select count(*)::integer as value from public.phase2_events where source_key='invalid-replacement'"),0);
    await voidEvent(net);
    const replacement = await shared("replacement",null,100,dinner);
    assert.equal(await shared("replacement",null,100,dinner),replacement);
    await assert.rejects(shared("replace-twice",null,100,dinner));
    assert.deepEqual((await db.query("select paise::text as paise from public.phase2_shares where event_id=$1 order by position",[replacement])).rows,
      [{paise:"34"},{paise:"33"},{paise:"33"}]);
    assert.deepEqual(await value("select public.allocate_shared_paise(101,'weights',array[1,2,3]::bigint[]) as value"), [17,34,50]);
    assert.deepEqual(await value("select public.allocate_shared_paise(101,'percent',array[3333,3333,3334]::bigint[]) as value"), [34,33,34]);
    const lend = await loan("lend","lend",b,50000);
    const lent = await obligation(lend,b);
    const returned = await settle("returned","receive",[[lent,20000]]);
    assert.equal(await settle("returned","receive",[[lent,20000]]),returned);
    assert.equal(await remaining(lent),"30000");
    const concurrent = await Promise.allSettled([
      settle("full","receive",[[lent,30000]]),settle("too-late","receive",[[lent,30000]]),
    ]);
    assert.equal(concurrent.filter(r=>r.status==="fulfilled").length,1);
    assert.equal(await remaining(lent),"0");
    const paidId = concurrent.find(r=>r.status==="fulfilled");
    assert.ok(paidId?.status==="fulfilled");
    await voidEvent(paidId.value);
    assert.equal(await remaining(lent),"30000");
    const borrow = await loan("borrow","borrow",a,100000);
    await settle("repay","repay",[[await obligation(borrow,a),30000]]);
    assert.deepEqual(await balance(a),{receivable_paise:"33",payable_paise:"110000"});
    assert.deepEqual(await balance(b),{receivable_paise:"30033",payable_paise:"0"});
    assert.equal(await value("select public.phase2_reconcile() as value"),true);
    assert.deepEqual((await db.query("select category,personal,paid,received from public.phase2_month('2026-11-01','2026-12-01') order by category nulls last")).rows,
      [{category:"Food",personal:"40034",paid:"100",received:"0"},{category:null,personal:"0",paid:"80000",received:"120000"}]);
    assert.equal(await value("select count(*)::integer as value from public.phase2_person_activity where person_id=$1 and kind='receive'",[b]),2);
    const groupExpense = await value<string>(
      "select public.record_shared_expense('group-exact','2026-12-01','Group meal','Food',101,null,$1,'exact',$2::jsonb) as value",
      [group,JSON.stringify([{person_id:null,value:"50"},{person_id:a,value:"0"},{person_id:b,value:"51"}])]);
    await value("select public.save_expense_group($1,'Updated group',$2) as value",[group,[a]]);
    assert.deepEqual((await db.query("select name_snapshot,paise::text as paise from public.phase2_shares where event_id=$1 order by position",[groupExpense])).rows,
      [{name_snapshot:"Me",paise:"50"},{name_snapshot:"Person A",paise:"0"},{name_snapshot:"Person B",paise:"51"}]);
    const personalOnly = await value<string[]>("select public.add_expenses($1,'personal-only',$2::jsonb) as value",
      [owner,JSON.stringify([{occurred_on:"2026-12-01",paise:"50000",description:"My share only",category:"Food"}])]);
    assert.equal(personalOnly.length,1);
    assert.equal(await value("select count(*)::integer as value from public.phase2_events where description='My share only'"),0);
    await asOwner(other);
    assert.equal(await value("select count(*)::integer as value from public.phase2_history"),0);
    await assert.rejects(voidEvent(replacement));
    await assert.rejects(settle("foreign","receive",[[lent,10]]));
    await assert.rejects(db.query("update public.phase2_events set personal_paise = 0"));
    await assert.rejects(db.query("select public.phase2_bot_context($1,array['a'])",[owner]));
    await db.exec("reset role; set role service_role; select set_config('request.jwt.claim.role','service_role',false)");
    const context = await value<{ people:{ id:string }[] }>("select public.phase2_bot_context($1,$2) as value",[owner,["a","other owner contact"]]);
    assert.deepEqual(context.people.map(person=>person.id),[a]);
    const stage = (key: string) => value<{id:string; preview:string}>(
      "select public.phase2_stage_bot_draft($1,$2,$3::jsonb,'Review loan') as value",
      [owner,key,JSON.stringify({kind:"lend",date:day,description:"Bot loan",person:b,amount:"100"})]);
    const finish = (id: string, cancel: boolean, who = owner) =>
      value<string>("select public.phase2_finish_bot_draft($1,$2,$3) as value",[who,id,cancel]);
    const draft = await stage("bot-1");
    assert.deepEqual(await stage("bot-1"),draft);
    assert.equal(await finish(draft.id,false,other),"closed");
    assert.equal(await finish(draft.id,false),"saved");
    assert.equal(await finish(draft.id,false),"saved");
    const cancelled = await stage("bot-2");
    assert.equal(await finish(cancelled.id,true),"closed");
    assert.equal(await finish(cancelled.id,false),"closed");
    await db.exec("reset role; set role authenticated");
    await asOwner(owner);
    assert.equal(await value("select count(*)::integer as value from public.phase2_events where source_key in ('bot-1','bot-2')"),1);
    assert.equal(await value("select public.phase2_reconcile() as value"),true);
    await db.exec("reset role; set role anon");
    await assert.rejects(db.query("select * from public.phase2_balances"));
    await assert.rejects(loan("anon","lend",a,100));
  } finally {
    await db.close();
  }
});
