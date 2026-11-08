"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { expenseItem } from "@/domain/expense";
import { ownerSession } from "@/lib/supabase/server";

export async function saveExpense(form: FormData) {
  const { db, owner } = await ownerSession();
  const month = String(form.get("month") ?? "");
  const path = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? "/?month=" + month : "/?";
  const back = (flag: string) => path + (path.endsWith("?") ? "" : "&") + flag + "=1";
  let error;
  try {
    const action = form.get("action");
    const item = action === "void" ? null : expenseItem(Object.fromEntries(form));
    if (action === "create" && item) {
      const request = z.uuid().parse(form.get("request"));
      ({ error } = await db.rpc("add_expenses", { p_owner: owner, p_source: "dashboard:" + request, p_items: [item] }));
    } else if (action === "edit" || action === "void") {
      const id = z.uuid().parse(form.get("id"));
      const version = z.coerce.number().int().positive().parse(form.get("version"));
      ({ error } = await db.rpc("change_expense", { p_owner: owner, p_id: id, p_version: version, p_item: item }));
    } else {
      throw new Error("Invalid action");
    }
  } catch {
    redirect(back("invalid"));
  }
  if (error) redirect(back(error.code === "40001" ? "stale" : "failed"));
  redirect(back("saved"));
}
