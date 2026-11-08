export const maxPaise = 999_999_999_999n;

export function parsePaise(rupees: string): bigint {
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(rupees.trim());
  if (!match) throw new Error("Enter a rupee amount with up to two decimal places.");
  const paise = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (paise <= 0n || paise > maxPaise) throw new Error("Amount is outside the supported range.");
  return paise;
}

export function formatPaise(paise: bigint): string {
  const amount = paise < 0n ? -paise : paise;
  return (paise < 0n ? "−" : "") + "₹" + (amount / 100n).toLocaleString("en-IN")
    + "." + (amount % 100n).toString().padStart(2, "0");
}
