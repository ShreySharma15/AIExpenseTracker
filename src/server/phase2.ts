import "server-only";
import { notFound } from "next/navigation";
import { ownerSession } from "@/lib/supabase/server";

export function phase2Enabled() {
  return process.env.EXPENSE_PHASE_2_ENABLED === "true";
}

export async function phase2Session() {
  if (!phase2Enabled()) notFound();
  return ownerSession();
}
