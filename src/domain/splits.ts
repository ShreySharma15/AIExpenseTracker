import { maxPaise, parsePaise } from "./money.ts";

export const splitMethods = ["equal", "exact", "weights", "percent"] as const;
export type SplitMethod = typeof splitMethods[number];

export function splitValue(method: SplitMethod, raw: string): bigint {
  if (method === "equal") return 1n;
  if (method === "weights") {
    if (!/^\d{1,12}$/.test(raw.trim())) throw new Error("Enter integer weights.");
    return BigInt(raw);
  }
  if (/^0+(?:\.0{1,2})?$/.test(raw.trim())) return 0n;
  return parsePaise(raw);
}

export function allocateShares(total: bigint, method: SplitMethod, inputs: readonly bigint[]): bigint[] {
  if (total <= 0n || total > maxPaise || inputs.length < 1 || inputs.length > 20
      || inputs.some(value => value < 0n || value > maxPaise)) throw new Error("Invalid split.");
  const values = method === "equal" ? inputs.map(() => 1n) : inputs;
  const sum = values.reduce((acc, value) => acc + value, 0n);
  if (method === "exact") {
    if (sum !== total) throw new Error("Exact shares must equal the total.");
    return [...values];
  }
  if ((method === "percent" && sum !== 10_000n) || (method === "weights" && values.some(v => v === 0n))) {
    throw new Error("Percentages must total 100%, and weights must be positive.");
  }
  const shares = values.map(value => total * value / sum);
  let remainder = total - shares.reduce((acc, value) => acc + value, 0n);
  const priority = values.map((value, index) => ({ index, fraction: total * value % sum }));
  priority.sort((a, b) => a.fraction === b.fraction ? a.index - b.index : a.fraction > b.fraction ? -1 : 1);
  for (const { index } of priority) {
    if (remainder === 0n) break;
    shares[index]++;
    remainder--;
  }
  return shares;
}
