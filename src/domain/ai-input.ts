const vocabulary = new Set(
  ("i me my spent spend paid pay bought purchased cost for on at in of and also plus today yesterday " +
   "morning evening night lunch dinner breakfast snacks snack food meal restaurant groceries grocery " +
   "transport taxi cab bus train metro auto fuel petrol parking utilities electricity water internet " +
   "shopping health medicine pharmacy rent coffee tea chocolate other rupee rupees inr rs " +
   "jan january feb february mar march apr april may jun june jul july aug august sep september " +
   "oct october nov november dec december monday tuesday wednesday thursday friday saturday sunday " +
   "split shared loan borrowed lent repay repayment returned owes owed reimburse reimbursement")
    .split(" "),
);
const unsupported = /\b(?:split|loan|borrow(?:ed|ing)?|lent|lend(?:ing)?|repay(?:ment|ing)?|returned|paid back|owed|owes|reimburse(?:ment|d)?)\b/i;

export function prepareAiInput(input: string) {
  if (/[@]|https?:|www\.|\b[a-z]{2}\d{2}(?:[a-z0-9][ -]?){10,}|(?:\d[ -]?){7,}|expenseword\d+/i.test(input)
    || unsupported.test(input)) return null;
  const words: string[] = [];
  const text = input.replace(/\p{L}[\p{L}\p{M}'’\-]*/gu, word => {
    if (vocabulary.has(word.toLowerCase())) return word;
    words.push(word);
    return "expenseword" + words.length;
  });
  return {
    text,
    restore: (value: string) => value.replace(/\bexpenseword(\d+)\b/gi, (token, n: string) => words[Number(n) - 1] ?? token),
  };
}
