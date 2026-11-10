"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { categories } from "@/domain/expense";
import { formatPaise, parsePaise } from "@/domain/money";
import { allocateShares, splitValue, type SplitMethod } from "@/domain/splits";
import { savePhase2 } from "./actions";

export type Participant = { id: string; name: string };
type Original = {
  id: string; amount: string; description: string; category: string; date: string; payer: string;
  shares: { id: string; amount: string }[];
};

export function SplitForm({ people, selected, today, group, request, original }: {
  people: Participant[]; selected: string[]; today: string; group?: string; request: string; original?: Original;
}) {
  const available = [{ id: "self", name: "Me" }, ...people];
  const [chosen, choose] = useState(original ? original.shares.map(s => s.id) : ["self", ...selected]);
  const [method, setMethod] = useState<SplitMethod>(original ? "exact" : "equal");
  const [payer, setPayer] = useState(original?.payer ?? "self");
  const [amount, setAmount] = useState(original?.amount ?? "");
  const [values, setValues] = useState<Record<string,string>>(
    Object.fromEntries(original?.shares.map(s => [s.id,s.amount]) ?? []),
  );
  const peopleById = new Map(available.map(person => [person.id,person]));
  const participants = chosen.flatMap(id => peopleById.has(id) ? [peopleById.get(id)!] : []);
  let preview: bigint[] | undefined;
  let warning = "";
  try {
    if (participants.length < 2 || participants.length > 20) throw new Error("Choose two to twenty participants.");
    if (!participants.some(p => p.id === payer)) throw new Error("Choose a payer from the participants.");
    if (payer !== "self" && !participants.some(p => p.id === "self")) throw new Error("Include your share when someone else pays.");
    preview = allocateShares(parsePaise(amount),method,participants.map(p => splitValue(method,values[p.id] ?? "")));
  } catch (error) {
    warning = error instanceof Error ? error.message : "Check the allocation.";
  }
  return <form action={savePhase2} className="grid gap-3">
    <input type="hidden" name="op" value="shared" />
    <input type="hidden" name="request" value={request} />
    <input type="hidden" name="group" value={group ?? ""} />
    {original && <input type="hidden" name="replaces" value={original.id} />}
    <label>Description<input name="description" defaultValue={original?.description} maxLength={200} required /></label>
    <div className="grid grid-cols-2 gap-3">
      <label>Total (₹)<input name="amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} required /></label>
      <label>Date<input name="date" type="date" defaultValue={original?.date ?? today} required /></label>
    </div>
    <label>Category<select name="category" defaultValue={original?.category ?? "Other"}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">Participants</legend>
      {available.map(p => <label key={p.id} className="flex items-center gap-2">
        <input type="checkbox" checked={chosen.includes(p.id)} className="h-5 min-h-0 w-5"
          onChange={e => choose(e.target.checked ? [...chosen,p.id] : chosen.filter(id => id !== p.id))} />{p.name}
      </label>)}
    </fieldset>
    <label>Paid by<select name="payer" value={payer} onChange={e => setPayer(e.target.value)} required>
      <option value="" disabled>Choose a payer</option>
      {participants.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}
    </select></label>
    <label>Split by<select name="method" value={method} onChange={e => setMethod(e.target.value as SplitMethod)}>
      <option value="equal">Equal shares</option><option value="exact">Exact amounts in rupees</option>
      <option value="weights">Integer weights</option><option value="percent">Percentages</option>
    </select></label>
    <div aria-live="polite" className="rounded-lg bg-slate-50 p-3">
      <p className="text-sm">Extra paise go to the largest remainders. Ties follow the order below.</p>
      <ol className="mt-2 space-y-2">{participants.map((p, i) => <li key={p.id}>
        <input type="hidden" name="participant" value={p.id} />
        {method !== "equal" ? <label>{p.name} share input<input inputMode={method === "weights" ? "numeric" : "decimal"}
          name={"share_" + p.id} value={values[p.id] ?? ""} onChange={e => setValues({ ...values, [p.id]: e.target.value })} required /></label> : p.name}
        {preview && <span className="ml-2 text-sm font-semibold">{formatPaise(preview[i])}</span>}
      </li>)}</ol>
      {!preview && <p className="mt-2 text-sm">{warning}</p>}
    </div>
    <Button type="submit" disabled={!preview}>{original ? "Replace expense" : "Save shared expense"}</Button>
  </form>;
}
