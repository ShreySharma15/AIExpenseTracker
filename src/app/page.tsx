import { randomUUID } from "node:crypto";
import { ownerSession } from "@/lib/supabase/server";
import { categories } from "@/domain/expense";
import { localDate, monthRange } from "@/domain/dates";
import { formatPaise } from "@/domain/money";
import { saveExpense } from "./actions";
import { signOut } from "./login/actions";
import { Button } from "@/components/ui/button";

type Expense = {
  id: string; version: number; description: string; paise: string; category: string;
  occurred_on: string; coverage: string | null;
};
type Revision = Pick<Expense, "version" | "description" | "occurred_on"> & {
  expense_id: string; recorded_at: string; action: "create" | "edit" | "void"; paise_text: string;
};

function ExpenseForm({ month, row, today }: { month: string; row?: Expense; today: string }) {
  const amount = row ? (BigInt(row.paise) / 100n).toString() + "." + row.paise.padStart(2, "0").slice(-2) : undefined;
  return <form action={saveExpense} className="grid grid-cols-2 gap-3">
    <input type="hidden" name="month" value={month} />
    {row ? <><input type="hidden" name="id" value={row.id} /><input type="hidden" name="version" value={row.version} /></> : <input type="hidden" name="request" value={randomUUID()} />}
    <label className="col-span-2">Description<input name="description" defaultValue={row?.description} maxLength={200} required /></label>
    <label>Amount (₹)<input name="amount" inputMode="decimal" pattern="[0-9]{1,10}(\.[0-9]{1,2})?" defaultValue={amount} required /></label>
    <label>Date<input name="occurred_on" type="date" defaultValue={row?.occurred_on ?? today} required /></label>
    <label>Category<select name="category" defaultValue={row?.category ?? "Other"}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
    <label>Coverage (optional)<input name="coverage" defaultValue={row?.coverage ?? ""} maxLength={120} /></label>
    <Button type="submit" name="action" value={row ? "edit" : "create"} className="col-span-2">{row ? "Save changes" : "Add expense"}</Button>
  </form>;
}

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { db, owner } = await ownerSession();
  const params = await searchParams;
  const today = localDate();
  let month = today.slice(0, 7);
  if (typeof params.month === "string") {
    try { monthRange(params.month); month = params.month; } catch { /* Default to the current month. */ }
  }
  const [start, end] = monthRange(month);
  const previousEnd = new Date(start + "T00:00:00Z");
  previousEnd.setUTCDate(0);
  const previousStart = previousEnd.toISOString().slice(0, 7) + "-01";
  const category = categories.find(c => c === params.category);
  const search = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const page = typeof params.page === "string" && /^\d{1,5}$/.test(params.page) ? Number(params.page) : 0;
  let rowsQuery = db.from("active_expenses").select("*", { count: "exact" })
    .eq("owner_id", owner).gte("occurred_on", start).lt("occurred_on", end);
  if (category) rowsQuery = rowsQuery.eq("category", category);
  if (search) rowsQuery = rowsQuery.ilike("description", "%" + search.replace(/[\\%_*]/g, "\\$&") + "%");
  const [report, previousReport, rows, audit] = await Promise.all([
    db.rpc("expense_summary", { p_owner: owner, p_start: start, p_end: end }),
    db.rpc("expense_summary", { p_owner: owner, p_start: previousStart, p_end: start }),
    rowsQuery.order("occurred_on", { ascending: false }).order("recorded_at", { ascending: false }).order("id").range(page * 25, page * 25 + 24),
    db.from("expense_revisions").select("expense_id,version,action,occurred_on,description,recorded_at,paise_text:paise::text")
      .gte("occurred_on", start).lt("occurred_on", end).order("recorded_at", { ascending: false })
      .order("expense_id").order("version", { ascending: false }).limit(25),
  ]);
  const totals = (report.data ?? []) as { category: string; total: string }[];
  const total = totals.reduce((acc, row) => acc + BigInt(row.total), 0n);
  const previousTotal = ((previousReport.data ?? []) as { total: string }[])
    .reduce((acc, row) => acc + BigInt(row.total), 0n);
  const pageLink = (p: number) => "/?" + new URLSearchParams({ month, q: search, category: category ?? "", page: String(p) }).toString();
  return <main className="mx-auto max-w-5xl px-4 py-7 sm:px-8">
    <a href="#transactions" className="skip-link mb-3 inline-block font-semibold underline">Skip to transactions</a>
    <header className="mb-6 flex items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">Expense Tracker</h1>
      <form action={signOut}><Button type="submit" variant="outline">Sign out</Button></form>
    </header>
    <nav aria-label="Dashboard sections" className="mb-5 flex flex-wrap gap-4 text-sm font-semibold underline">
      <a href="#home">Home</a><a href="#transactions">Transactions</a><a href="#insights">Insights</a><a href="#people">People &amp; groups</a>
    </nav>
    {(params.saved || params.invalid || params.failed || params.stale) && <p role="status" className="mb-4 rounded-xl bg-white p-3">
      {params.saved ? "Expense updated." : params.invalid ? "Check the date, amount and description." : params.stale ? "This expense changed. Review the current version and try again." : "Could not save the expense."}
    </p>}
    <div className="grid items-start gap-5 md:grid-cols-[1fr_20rem]">
      <section id="home" className="rounded-3xl bg-emerald-950 p-6 text-white">
        <p className="text-sm text-emerald-100">Personal spending · {month}</p>
        <p className="my-2 text-4xl font-bold">{report.error ? "Unavailable" : formatPaise(total)}</p>
        <p className="text-sm text-emerald-100">Payments made {report.error ? "unavailable" : formatPaise(total)}</p>
        <div id="insights" className="mt-5 border-t border-white/20 pt-4">
          <h2 className="font-semibold">Insights</h2>
          {!previousReport.error && <p className="mt-2 text-sm text-emerald-100">Previous calendar month · {formatPaise(previousTotal)}</p>}
          {totals.length > 0 && <ul className="mt-3 space-y-2">{totals.map(row => <li key={row.category} className="flex justify-between gap-3"><span>{row.category}</span><span>{formatPaise(BigInt(row.total))}</span></li>)}</ul>}
        </div>
      </section>
      <section className="rounded-3xl bg-white p-5 md:row-span-2">
        <h2 className="mb-4 text-lg font-bold">New expense</h2>
        <ExpenseForm month={month} today={today} />
      </section>
      <section id="transactions" tabIndex={-1} aria-labelledby="transactions-title" className="min-w-0 rounded-3xl bg-white p-5">
        <h2 id="transactions-title" className="mb-4 text-lg font-bold">Transactions</h2>
        <form className="mb-4 grid grid-cols-2 gap-3">
          <label>Month<input type="month" name="month" defaultValue={month} required /></label>
          <label>Category<select name="category" defaultValue={category ?? ""}><option value="">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
          <label>Search<input name="q" defaultValue={search} maxLength={80} /></label>
          <Button type="submit" variant="outline" className="self-end">Apply filters</Button>
        </form>
        {rows.error ? <p role="alert">Expense data is unavailable. Check that the database migration has been applied.</p> :
          !rows.data.length ? <p>No matching expenses.</p> :
          <ul className="divide-y divide-emerald-900/10">{(rows.data as Expense[]).map(row => <li key={row.id} className="py-3">
            <div className="flex justify-between gap-3"><div className="min-w-0">
              <p className="break-words font-semibold">{row.description}</p>
              <p className="text-sm text-slate-600">{row.occurred_on} · {row.category}{row.coverage ? " · " + row.coverage : ""}</p>
            </div><strong className="shrink-0">{formatPaise(BigInt(row.paise))}</strong></div>
            <details className="mt-2"><summary className="cursor-pointer text-sm font-semibold text-emerald-800">Edit or void</summary>
              <p className="mt-2 break-all text-xs text-slate-600">Expense ID {row.id} · version {row.version}</p>
              <div className="mt-3"><ExpenseForm row={row} today={today} month={month} /></div>
              <form action={saveExpense} className="mt-3">
                <input type="hidden" name="month" value={month} /><input type="hidden" name="id" value={row.id} /><input type="hidden" name="version" value={row.version} />
                <Button type="submit" name="action" value="void" variant="destructive">Void expense</Button>
              </form>
            </details>
          </li>)}</ul>}
        <nav aria-label="Transaction pages" className="mt-3 flex gap-4 text-sm underline">
          {page > 0 && <a href={pageLink(page - 1)}>Previous page</a>}
          {(rows.count ?? 0) > (page + 1) * 25 && <a href={pageLink(page + 1)}>Next page</a>}
        </nav>
      </section>
      <section className="rounded-3xl bg-white p-5">
        <h2 className="mb-3 text-lg font-bold">Revision history</h2>
        <p className="mb-3 text-sm text-slate-600">Latest 25 revisions for expenses dated in {month}.</p>
        {audit.error ? <p role="alert">History is unavailable.</p> : !audit.data.length ? <p>No revisions for this month.</p> :
          <ol className="divide-y divide-emerald-900/10">
            {(audit.data as Revision[]).map(row => <li key={row.expense_id + ":" + row.version} className="flex justify-between gap-3 py-2">
              <div className="min-w-0"><p className="break-words">{row.description}</p>
                <p className="text-sm capitalize text-slate-600">{row.action} · v{row.version} · expense date {row.occurred_on}</p></div>
              <span className="shrink-0 font-semibold">{formatPaise(BigInt(row.paise_text))}</span>
            </li>)}
          </ol>}
      </section>
      <section id="people" className="rounded-3xl bg-white p-5">
        <h2 className="mb-2 text-lg font-bold">People &amp; groups</h2>
        <p className="text-sm text-slate-600">Shared expenses and debts are planned for Phase 2.</p>
      </section>
    </div>
  </main>;
}
