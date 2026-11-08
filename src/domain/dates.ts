const indiaDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
});

export function localDate(instant = new Date()): string {
  const parts = Object.fromEntries(indiaDate.formatToParts(instant).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function monthRange(month: string): [string, string] {
  if (!isCalendarDate(month + "-01") || month === "9999-12") throw new Error("Invalid month.");
  const next = new Date(month + "-01T00:00:00Z");
  next.setUTCMonth(next.getUTCMonth() + 1);
  return [month + "-01", next.toISOString().slice(0, 10)];
}
