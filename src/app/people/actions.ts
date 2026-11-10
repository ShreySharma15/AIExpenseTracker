"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { isCalendarDate } from "@/domain/dates";
import { categories } from "@/domain/expense";
import { parsePaise } from "@/domain/money";
import { allocateShares, splitMethods, splitValue } from "@/domain/splits";
import { phase2Session } from "@/server/phase2";

const name = z.string().trim().min(1).max(80);
const description = z.string().trim().min(1).max(200);
const date = z.string().refine(isCalendarDate);
const uuid = z.uuid();
const maybeId = (input: FormDataEntryValue | null) => input ? uuid.parse(input) : null;
const personId = (input: unknown) => input === "self" ? null : uuid.parse(input);

export async function savePhase2(form: FormData) {
  const { db, owner } = await phase2Session();
  let result: string = "saved";
  try {
    const op = form.get("op");
    if (op === "person") {
      const { error } = await db.from("people").upsert({
        owner_id: owner, id: uuid.parse(form.get("id")),
        display_name: name.parse(form.get("name")), is_saved: form.get("saved") === "on",
      }, { onConflict: "id", ignoreDuplicates: true });
      if (error) result = "failed";
    } else if (op === "person_edit") {
      const { error } = await db.from("people").update({
        display_name: name.parse(form.get("name")), is_saved: form.get("saved") === "on",
      }).eq("owner_id", owner).eq("id", uuid.parse(form.get("id"))).is("archived_at", null);
      if (error) result = "failed";
    } else if (op === "person_archive") {
      const { error } = await db.from("people").update({ archived_at: new Date().toISOString() })
        .eq("owner_id", owner).eq("id", uuid.parse(form.get("id"))).is("archived_at", null);
      if (error) result = "failed";
    } else if (op === "alias_add" || op === "alias_remove") {
      const id = uuid.parse(form.get("id"));
      const { error } = op === "alias_add" ? await db.from("person_aliases").upsert({
        id, owner_id: owner, person_id: uuid.parse(form.get("person")), alias: name.parse(form.get("name")),
      }, { onConflict: "id", ignoreDuplicates: true })
        : await db.from("person_aliases").delete().eq("owner_id", owner).eq("id", id);
      if (error) result = "failed";
    } else if (op === "group" || op === "group_archive") {
      const archive = op === "group_archive";
      const { error } = await db.rpc("save_expense_group", {
        p_id: uuid.parse(form.get("id")), p_name: archive ? null : name.parse(form.get("name")),
        p_members: archive ? [] : z.array(uuid).min(1).max(20).parse(form.getAll("member")),
        p_archived: archive,
      });
      if (error) result = "failed";
    } else if (op === "shared") {
      const method = z.enum(splitMethods).parse(form.get("method"));
      const inputs = z.array(z.string()).min(2).max(20).parse(form.getAll("participant"));
      const total = parsePaise(z.string().parse(form.get("amount")));
      const values = inputs.map(id => splitValue(method, z.string().parse(form.get("share_" + id) ?? "")));
      allocateShares(total, method, values);
      const { error } = await db.rpc("record_shared_expense", {
        p_source: "dashboard:" + uuid.parse(form.get("request")), p_date: date.parse(form.get("date")),
        p_description: description.parse(form.get("description")), p_category: z.enum(categories).parse(form.get("category")),
        p_total: total.toString(), p_payer: personId(form.get("payer")), p_group: maybeId(form.get("group")),
        p_replaces: maybeId(form.get("replaces")), p_method: method,
        p_shares: inputs.map((id, i) => ({ person_id: personId(id), value: values[i].toString() })),
      });
      if (error) result = error.code === "23514" ? "linked" : error.code === "40001" ? "stale" : "failed";
    } else if (op === "loan") {
      const { error } = await db.rpc("record_phase2_loan", {
        p_source: "dashboard:" + uuid.parse(form.get("request")), p_date: date.parse(form.get("date")),
        p_description: description.parse(form.get("description")), p_kind: z.enum(["lend","borrow"]).parse(form.get("kind")),
        p_person: uuid.parse(form.get("person")), p_amount: parsePaise(z.string().parse(form.get("amount"))).toString(),
      });
      if (error) result = "failed";
    } else if (op === "settlement") {
      const allocations = [...form].filter(([key, value]) =>
        key.startsWith("allocation_") && typeof value === "string" && value.trim() !== "");
      if (allocations.length < 1 || allocations.length > 20) throw new Error("Choose allocations.");
      const { error } = await db.rpc("record_phase2_settlement", {
        p_source: "dashboard:" + uuid.parse(form.get("request")), p_date: date.parse(form.get("date")),
        p_description: description.parse(form.get("description")),
        p_kind: z.enum(["receive","repay","net"]).parse(form.get("kind")),
        p_allocations: allocations.map(([key, value]) => ({
          obligation_id: uuid.parse(key.slice("allocation_".length)),
          paise: parsePaise(z.string().parse(value)).toString(),
        })),
      });
      if (error) result = "allocation";
    } else if (op === "void") {
      const { error } = await db.rpc("void_phase2_event", { p_id: uuid.parse(form.get("id")) });
      if (error) result = error.code === "23514" ? "linked" : "failed";
    } else {
      result = "invalid";
    }
  } catch {
    result = "invalid";
  }
  redirect("/people?status=" + result);
}
