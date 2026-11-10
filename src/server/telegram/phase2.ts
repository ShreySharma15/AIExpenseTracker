import "server-only";
import { botClient } from "@/lib/supabase/server";
import { formatPaise } from "@/domain/money";
import { parsePhase2Text } from "@/domain/phase2-text";
import { allocateShares } from "@/domain/splits";

type Lookup = {
  people: { name: string; id: string; display_name: string }[];
  obligations: { id: string; person_id: string; direction: string; remaining_paise: string; occurred_on: string }[];
};
type Draft = { id: string; preview: string };
const normalize = (name: string) => name.trim().toLowerCase();

export async function stagePhase2Message(owner: string, source: string, input: string, instant: Date):
  Promise<{ text: string; id?: string } | null> {
  if (input.startsWith("/")) return null;
  let parsed;
  try { parsed = parsePhase2Text(input,instant); }
  catch { return {text:"Please clarify the date, amount, names and payment direction, or use People & Groups."}; }
  if (!parsed) return null;
  const names = parsed.kind === "shared" ? [...parsed.participants,parsed.payer].filter((name): name is string => name !== null)
    : [parsed.person];
  const db = botClient();
  const { data, error } = await db.rpc("phase2_bot_context", { p_owner:owner,p_names:[...new Set(names.map(normalize))] });
  if (error) throw new Error("Phase 2 contact lookup failed");
  const context = data as Lookup;
  const contacts = new Map<string,Lookup["people"][number]>();
  for (const name of names) {
    const matches = context.people.filter(p=>p.name===normalize(name));
    if (matches.length !== 1) return {text:"A name is missing or matches multiple contacts. Check names or aliases in People & Groups."};
    contacts.set(normalize(name),matches[0]);
  }
  const contact = (name: string) => contacts.get(normalize(name))!;
  const date = parsed.date;
  const amount = parsed.amount.toString();
  let payload: Record<string,unknown>;
  let preview: string;
  if (parsed.kind === "shared") {
    const ids = parsed.participants.map(name=>name === null ? null : contact(name).id);
    const payer = parsed.payer === null ? null : contact(parsed.payer).id;
    if (new Set(ids).size !== ids.length || !ids.includes(payer) || !ids.includes(null)) {
      return {text:"List unique participants, including yourself and the payer."};
    }
    const portions = allocateShares(parsed.amount,"equal",ids.map(()=>1n));
    const payerName = parsed.payer === null ? "Me" : contact(parsed.payer).display_name;
    payload = {kind:"shared",date,amount,payer,description:parsed.description,shares:ids.map(person_id=>({person_id}))};
    preview = [date + " · " + parsed.description + " · " + formatPaise(parsed.amount), "Paid by " + payerName,
      ...parsed.participants.map((name,i)=>(name === null ? "Me" : contact(name).display_name) + " · " + formatPaise(portions[i])),
      "Category: Other"].join("\n");
  } else {
    const person = contact(parsed.person);
    const kind = parsed.kind;
    const titles = {lend:"Loan given to",borrow:"Loan received from",receive:"Repayment received from",repay:"Repayment paid to"};
    const description = titles[kind] + " " + person.display_name;
    payload = {kind,date,amount,person:person.id,description};
    preview = date + " · " + description + " · " + formatPaise(parsed.amount);
    if (kind === "receive" || kind === "repay") {
      const direction = kind === "receive" ? "receivable" : "payable";
      const eligible = context.obligations.filter(o=>o.person_id===person.id && o.direction===direction);
      if (context.obligations.length === 21 || eligible.length !== 1 || eligible[0].occurred_on > date
        || BigInt(eligible[0].remaining_paise) < parsed.amount) {
        return {text:"I can’t identify one outstanding obligation for that amount and direction. Choose the allocation in People & Groups."};
      }
      payload.allocations = [{obligation_id:eligible[0].id,paise:amount}];
      preview += "\nAgainst the obligation dated " + eligible[0].occurred_on;
    }
  }
  const staged = await db.rpc("phase2_stage_bot_draft", {p_owner:owner,p_source:source,p_payload:payload,p_preview:preview});
  if (staged.error) throw new Error("Phase 2 draft save failed");
  const draft = staged.data as Draft | null;
  return draft ? {text:"Review before saving:\n\n"+draft.preview,id:draft.id} : {text:"This draft is closed."};
}

export async function finishPhase2Message(owner: string, id: string, cancel: boolean) {
  const { data,error } = await botClient().rpc("phase2_finish_bot_draft",{p_owner:owner,p_id:id,p_cancel:cancel});
  if (error && ["22023","23514","40001"].includes(error.code)) return "Details changed. Review the entry in People & Groups.";
  if (error) throw new Error("Phase 2 draft confirmation failed");
  return data === "saved" ? "Entry saved." : "Draft closed.";
}
