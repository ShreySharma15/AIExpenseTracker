import { randomUUID } from "node:crypto";
import Link from "next/link";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { localDate } from "@/domain/dates";
import { formatPaise } from "@/domain/money";
import { phase2Session } from "@/server/phase2";
import { savePhase2 } from "./actions";
import { SplitForm } from "./split-form";

export const dynamic = "force-dynamic";

type Person = { id: string; display_name: string; is_saved: boolean; archived_at: string | null };
type Alias = { id: string; person_id: string; alias: string };
type Group = { id: string; name: string; archived_at: string | null };
type Member = { group_id: string; person_id: string; position: number };
type Balance = { person_id: string; receivable_paise: string; payable_paise: string };
type Obligation = { id: string; person_id: string; direction: string; description: string; remaining_paise: string; occurred_on: string };
type Entry = {
  id: string; kind: keyof typeof kinds; occurred_on: string; description: string; category: string | null;
  payer_id: string | null; group_id: string | null; amount_paise: string; personal_paise: string;
  cash_paise: string; voided_at: string | null; replaces_id: string | null;
};
type Share = { event_id: string; person_id: string | null; name_snapshot: string; paise_text: string };
type Allocation = { event_id: string; obligation_id: string; person_id: string; direction: string;
  obligation_description: string; obligation_date: string; paise: string };
const kinds = { shared: "Shared expense", lend: "Loan given", borrow: "Loan received", receive: "Repayment received",
  repay: "Repayment paid", net: "Net settlement" };
const statuses: Record<string,string> = {
  saved: "Saved.", invalid: "Check the required fields and amounts.",
  failed: "Could not save. Check the selected records and try again.",
  allocation: "Check the payment direction, amounts, dates and outstanding balances. Each settlement must refer to one person.",
  linked: "Reverse the linked settlements before changing or voiding this entry.",
  stale: "This expense was already changed. Reload the current entry.",
};
const money = (value: string) => formatPaise(BigInt(value));
function decimal(value: string) {
  const amount = BigInt(value);
  return (amount / 100n).toString() + "." + (amount % 100n).toString().padStart(2,"0");
}
function Hidden({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}
function GroupForm({ group, members, people }: { group?: Group; members: string[]; people: Person[] }) {
  return <form action={savePhase2} className="grid gap-2">
    <Hidden name="op" value="group" /><Hidden name="id" value={group?.id ?? randomUUID()} />
    <label>Group name<input name="name" defaultValue={group?.name} maxLength={80} required /></label>
    <fieldset>
      <legend className="text-sm font-semibold">Saved people in this group</legend>
      {people.map(p => <label key={p.id} className="my-1 flex items-center gap-2">
        <input type="checkbox" name="member" value={p.id} defaultChecked={members.includes(p.id)} className="h-5 w-5 min-h-0" />{p.display_name}
      </label>)}
    </fieldset>
    <Button type="submit" disabled={!people.length}>{group ? "Update group" : "Save group"}</Button>
  </form>;
}

export default async function PeoplePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { db, owner } = await phase2Session();
  const query = await searchParams;
  const person = z.uuid().safeParse(query.person).data;
  const group = z.uuid().safeParse(query.group).data;
  const edit = z.uuid().safeParse(query.edit).data;
  const historyPage = typeof query.page === "string" && /^\d{1,4}$/.test(query.page) ? Number(query.page) : 0;
  const today = localDate();
  let historyQuery = db.from(person ? "phase2_person_activity" : "phase2_history").select("*", { count: "exact" }).eq("owner_id",owner);
  if (person) historyQuery = historyQuery.eq("person_id", person);
  let obligationQuery = db.from("phase2_open_obligations").select("*").eq("owner_id",owner).neq("remaining_paise","0");
  if (person) obligationQuery = obligationQuery.eq("person_id",person);
  const [contacts, aliases, groups, members, balances, obligations, history, reconcile, original, originalShares] = await Promise.all([
    db.from("people").select("id,display_name,is_saved,archived_at").eq("owner_id",owner).order("display_name").order("id"),
    db.from("person_aliases").select("id,person_id,alias").eq("owner_id",owner).order("alias"),
    db.from("expense_groups").select("id,name,archived_at").eq("owner_id",owner).is("archived_at",null).order("name"),
    db.from("expense_group_members").select("group_id,person_id,position").eq("owner_id",owner).order("position"),
    db.from("phase2_balances").select("person_id,receivable_paise,payable_paise").eq("owner_id",owner),
    obligationQuery.order("occurred_on").order("id").limit(100),
    historyQuery.order("occurred_on",{ascending:false}).order("recorded_at",{ascending:false}).order("id")
      .range(historyPage*25,historyPage*25+24),
    db.rpc("phase2_reconcile"),
    edit ? db.from("phase2_history").select("*").eq("owner_id",owner).eq("id",edit).eq("kind","shared")
      .is("voided_at",null).maybeSingle() : null,
    edit ? db.from("phase2_shares").select("event_id,person_id,name_snapshot,paise_text:paise::text")
      .eq("owner_id",owner).eq("event_id",edit).order("position") : null,
  ]);
  const responses = [contacts, aliases, groups, members, balances, obligations, history, reconcile, original, originalShares];
  if (responses.some(result => result?.error)) {
    return <main className="mx-auto max-w-3xl p-6"><Link href="/">Dashboard</Link>
      <h1 className="my-4 text-2xl font-bold">People &amp; groups</h1>
      <p role="alert">Shared records are unavailable. Check the Phase 2 migrations and try again.</p></main>;
  }
  const people = (contacts.data ?? []) as Person[];
  const active = people.filter(p => !p.archived_at);
  const saved = active.filter(p => p.is_saved);
  const nameById = new Map(people.map(p => [p.id,p.display_name]));
  const balanceById = new Map(((balances.data ?? []) as Balance[]).map(b => [b.person_id,b]));
  const groupList = (groups.data ?? []) as Group[];
  const allMembers = (members.data ?? []) as Member[];
  const groupById = new Map(groupList.map(g => [g.id,g.name]));
  const chosenGroup = group && groupById.has(group) ? group : undefined;
  const membersFor = (id: string) => allMembers.filter(m => m.group_id === id).map(m => m.person_id);
  const entries = (history.data ?? []) as Entry[];
  const current = original?.data as Entry | null | undefined;
  const originalRows = (originalShares?.data ?? []) as Share[];
  const open = (obligations.data ?? []) as Obligation[];
  const selected = chosenGroup ? membersFor(chosenGroup).filter(id => active.some(p => p.id === id)) : [];
  const url = (page: number) => "/people?" + new URLSearchParams({ ...(person ? {person} : {}),page:String(page) }).toString() + "#history";
  const status = typeof query.status === "string" ? statuses[query.status] : undefined;
  const entryIds = entries.filter(e => e.kind === "shared").map(e => e.id);
  const settlementIds = entries.filter(e => ["receive","repay","net"].includes(e.kind)).map(e => e.id);
  const [details, settlementDetails] = await Promise.all([
    entryIds.length ? db.from("phase2_shares").select("event_id,person_id,name_snapshot,paise_text:paise::text")
      .eq("owner_id",owner).in("event_id",entryIds).order("position") : null,
    settlementIds.length ? db.from("phase2_settlement_details").select("*").eq("owner_id",owner)
      .in("event_id",settlementIds).order("obligation_date").order("obligation_id") : null,
  ]);
  const shares = (details?.data ?? []) as Share[];
  const allocations = (settlementDetails?.data ?? []) as Allocation[];

  return <main className="mx-auto max-w-5xl space-y-5 px-4 py-7">
    <Link href="/" className="underline">Dashboard</Link>
    <h1 className="text-2xl font-bold">People &amp; groups</h1>
    <nav aria-label="People and groups sections" className="flex flex-wrap gap-4 text-sm underline">
      <a href="#contacts">Contacts</a><a href="#groups">Groups</a><a href="#split">Shared expense</a>
      <a href="#loans">Loans</a><a href="#settle">Settle</a><a href="#history">History</a>
    </nav>
    {status && <p role="status" className="rounded-lg bg-white p-3">{status}</p>}
    <p role={reconcile.data === true ? "status" : "alert"} className="rounded-lg bg-white p-3">
      {reconcile.data === true ? "Shared ledger reconciled." : "Shared ledger did not reconcile. Review the entries."}
    </p>
    <section id="contacts" className="space-y-4 rounded-3xl bg-white p-5">
      <h2 className="text-lg font-bold">Contacts and balances</h2>
      <form action={savePhase2} className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Hidden name="op" value="person" /><Hidden name="id" value={randomUUID()} />
        <label>Name<input name="name" maxLength={80} required /></label>
        <label className="flex items-center gap-2"><input type="checkbox" name="saved" defaultChecked className="h-5 min-h-0 w-5" />Save to address book</label>
        <Button type="submit">Add person</Button>
      </form>
      {!people.length && <p>No people yet. Add a saved contact or a one-time participant.</p>}
      <ul className="divide-y">{people.map(p => {
        const balance = balanceById.get(p.id);
        const personAliases = ((aliases.data ?? []) as Alias[]).filter(a => a.person_id === p.id);
        return <li key={p.id} className="space-y-2 py-3">
          <p className="break-words font-semibold">{p.display_name} <span className="text-sm font-normal">{p.archived_at ? "· Archived" : p.is_saved ? "" : "· One-time"}</span></p>
          <p className="text-sm">Owes you {money(balance?.receivable_paise ?? "0")} · You owe {money(balance?.payable_paise ?? "0")}</p>
          <a href={"/people?person=" + p.id + "#history"} className="text-sm underline">History for {p.display_name}</a>
          {!p.archived_at && <details><summary className="cursor-pointer text-sm">Manage {p.display_name}</summary>
            <form action={savePhase2} className="mt-2 grid gap-2">
              <Hidden name="op" value="person_edit" /><Hidden name="id" value={p.id} />
              <label>Name<input name="name" defaultValue={p.display_name} maxLength={80} required /></label>
              <label className="flex items-center gap-2"><input type="checkbox" name="saved" defaultChecked={p.is_saved} className="h-5 min-h-0 w-5" />Save to address book</label>
              <Button type="submit" variant="outline">Update person</Button>
            </form>
            <form action={savePhase2} className="mt-2 grid gap-2">
              <Hidden name="op" value="alias_add" /><Hidden name="id" value={randomUUID()} /><Hidden name="person" value={p.id} />
              <label>Alias<input name="name" maxLength={80} required /></label><Button type="submit" variant="outline">Add alias</Button>
            </form>
            <ul>{personAliases.map(a => <li key={a.id} className="mt-2">
              <form action={savePhase2} className="flex items-center justify-between gap-2">
                <Hidden name="op" value="alias_remove" /><Hidden name="id" value={a.id} />
                <span>{a.alias}</span><Button type="submit" variant="outline">Remove alias</Button>
              </form>
            </li>)}</ul>
            <form action={savePhase2} className="mt-2"><Hidden name="op" value="person_archive" /><Hidden name="id" value={p.id} />
              <Button type="submit" variant="outline">Archive person</Button>
            </form>
          </details>}
        </li>;
      })}</ul>
    </section>
    <section id="groups" className="space-y-4 rounded-3xl bg-white p-5">
      <h2 className="text-lg font-bold">Reusable groups</h2>
      <GroupForm members={[]} people={saved} />
      {groupList.map(g => <details key={g.id}>
        <summary className="cursor-pointer">{g.name}</summary>
        <a href={"/people?group=" + g.id + "#split"} className="my-2 inline-block underline">Use group for a split</a>
        <GroupForm group={g} members={membersFor(g.id)} people={saved} />
        <form action={savePhase2} className="mt-2"><Hidden name="op" value="group_archive" /><Hidden name="id" value={g.id} />
          <Button type="submit" variant="outline">Archive group</Button>
        </form>
      </details>)}
    </section>
    <section id="split" className="space-y-3 rounded-3xl bg-white p-5">
      <h2 className="text-lg font-bold">{current ? "Replace shared expense" : "Shared expense"}</h2>
      <p className="text-sm">{current ? "The old entry will be reversed. Linked settlements must be reversed first." :
        chosenGroup ? "Using group " + groupById.get(chosenGroup) : "Choose participants directly or start with a saved group."}</p>
      <p className="text-sm">Recording just your share? <Link className="underline" href="/#transactions">Add a personal expense on the dashboard</Link>.</p>
      {edit && !current ? <p role="alert">That expense is unavailable for editing.</p> :
        <SplitForm key={current?.id ?? chosenGroup ?? "new"} people={active.map(p => ({ id:p.id,name:p.display_name }))}
          selected={selected} today={today} group={current?.group_id && groupById.has(current.group_id) ? current.group_id : chosenGroup}
          request={randomUUID()} original={current ? {
            id:current.id,amount:decimal(current.amount_paise),description:current.description,category:current.category ?? "Other",
            date:current.occurred_on,payer:current.payer_id ?? "self",
            shares:originalRows.map(s => ({id:s.person_id ?? "self",amount:decimal(s.paise_text)})),
          } : undefined} />}
    </section>
    <section id="loans" className="space-y-3 rounded-3xl bg-white p-5">
      <h2 className="text-lg font-bold">Loans and borrowing</h2>
      <form action={savePhase2} className="grid gap-3">
        <Hidden name="op" value="loan" /><Hidden name="request" value={randomUUID()} />
        <label>Direction<select name="kind"><option value="lend">I lent money</option><option value="borrow">I borrowed money</option></select></label>
        <label>Person<select name="person" required defaultValue=""><option value="" disabled>Choose a person</option>
          {active.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label>
        <label>Note<input name="description" maxLength={200} required /></label>
        <div className="grid grid-cols-2 gap-3">
          <label>Amount (₹)<input name="amount" inputMode="decimal" required /></label>
          <label>Date<input name="date" type="date" defaultValue={today} required /></label>
        </div>
        <Button type="submit" disabled={!active.length}>Save loan</Button>
      </form>
    </section>
    <section id="settle" className="space-y-3 rounded-3xl bg-white p-5">
      <h2 className="text-lg font-bold">Repayments and settlements</h2>
      <p className="text-sm">Enter amounts against specific obligations for one person. For a net settlement, allocate equal amounts to both directions.</p>
      {person && <a href="/people#settle" className="text-sm underline">Show all people</a>}
      {!open.length ? <p>No outstanding obligations in this view.</p> : <form action={savePhase2} className="grid gap-3">
        <Hidden name="op" value="settlement" /><Hidden name="request" value={randomUUID()} />
        <label>Settlement type<select name="kind"><option value="receive">I received a repayment</option>
          <option value="repay">I paid a repayment</option><option value="net">Net opposite balances</option></select></label>
        <label>Note<input name="description" maxLength={200} required /></label>
        <label>Date<input name="date" type="date" defaultValue={today} required /></label>
        <fieldset className="space-y-2"><legend className="text-sm font-semibold">Allocations in rupees</legend>
          {open.map(o => <label key={o.id}>
            {nameById.get(o.person_id)} · {o.direction === "receivable" ? "owes you" : "you owe"} {money(o.remaining_paise)} · {o.description} · {o.occurred_on}
            <input name={"allocation_" + o.id} inputMode="decimal" />
          </label>)}
        </fieldset>
        {open.length === 100 && <p className="text-sm">Showing up to 100 obligations. Open a person’s history to narrow this list.</p>}
        <Button type="submit">Record settlement</Button>
      </form>}
    </section>
    <section id="history" className="space-y-3 rounded-3xl bg-white p-5">
      <h2 className="text-lg font-bold">{person ? "History for " + (nameById.get(person) ?? "person") : "Shared and debt history"}</h2>
      {person && <a href="/people#history" className="text-sm underline">Show all history</a>}
      {!entries.length && <p>No entries in this view.</p>}
      <ul className="divide-y">{entries.map(entry => <li key={entry.id} className="space-y-2 py-3">
        <p className="break-words font-semibold">{entry.description} · {money(entry.amount_paise)}</p>
        <p className="text-sm">{kinds[entry.kind]} · {entry.occurred_on}{entry.voided_at ? " · Voided" : ""}{entry.replaces_id ? " · Replacement" : ""}</p>
        {entry.kind === "shared" && <details><summary className="cursor-pointer text-sm">Allocation details</summary>
          <p className="mt-1 text-sm">Paid by {entry.payer_id ? nameById.get(entry.payer_id) : "me"} · My share {money(entry.personal_paise)}</p>
          {details?.error ? <p role="alert">Allocations are unavailable.</p> : <ol className="ml-5 list-decimal text-sm">
            {shares.filter(s => s.event_id === entry.id).map((s,i) => <li key={i}>{s.name_snapshot} · {money(s.paise_text)}</li>)}
          </ol>}
        </details>}
        {["receive","repay","net"].includes(entry.kind) && <details><summary className="cursor-pointer text-sm">Settlement allocations</summary>
          {settlementDetails?.error ? <p role="alert">Allocations are unavailable.</p> : <ul className="ml-5 list-disc text-sm">
            {allocations.filter(a => a.event_id === entry.id).map(a => <li key={a.obligation_id}>
              {nameById.get(a.person_id)} · {a.direction} · {a.obligation_description} ({a.obligation_date}) · {money(a.paise)}
            </li>)}
          </ul>}
        </details>}
        {!entry.voided_at && <div className="flex flex-wrap items-center gap-4">
          {entry.kind === "shared" && <a className="text-sm underline" href={"/people?edit=" + entry.id + "#split"}>Replace expense</a>}
          <details><summary className="cursor-pointer text-sm underline">Void entry</summary>
            <form action={savePhase2} className="mt-2"><Hidden name="op" value="void" /><Hidden name="id" value={entry.id} />
              <Button type="submit" variant="destructive">Confirm void</Button>
            </form>
          </details>
        </div>}
      </li>)}</ul>
      <nav aria-label="Shared history pages" className="flex gap-4 text-sm underline">
        {historyPage > 0 && <a href={url(historyPage-1)}>Previous page</a>}
        {(history.count ?? 0) > (historyPage+1)*25 && <a href={url(historyPage+1)}>Next page</a>}
      </nav>
    </section>
  </main>;
}
