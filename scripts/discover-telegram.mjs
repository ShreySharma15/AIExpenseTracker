try {
  process.loadEnvFile(".env.local");
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const marker = process.argv[2];
  if (!/^\d+:[\w-]+$/.test(token ?? "") || !/^[a-zA-Z0-9_-]{12,64}$/.test(marker ?? "")) {
    throw new Error("Set the token locally and supply a unique 12–64 character setup marker.");
  }
  async function call(method) {
    const res = await fetch("https://api.telegram.org/bot" + token + "/" + method,
      { redirect: "error", signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error("Telegram request failed with HTTP " + res.status + ".");
    const body = await res.json();
    if (!body.ok) throw new Error("Telegram rejected the request.");
    return body.result;
  }
  if ((await call("getWebhookInfo")).url) throw new Error("Webhook is active. Use verify:setup for existing IDs or a separate setup bot.");
  const updates = await call("getUpdates");
  const matches = new Set(updates.flatMap(({ message }) =>
    message?.text === marker && message.chat?.type === "private" && message.from?.id === message.chat.id
      && Number.isSafeInteger(message.from.id) ? [String(message.from.id)] : []));
  if (matches.size !== 1) throw new Error("Send the exact marker from the intended owner's private chat and retry.");
  const [id] = matches;
  console.log("TELEGRAM_ALLOWED_USER_ID=" + id);
  console.log("TELEGRAM_ALLOWED_CHAT_ID=" + id);
} catch (error) {
  // A network exception can contain the token-bearing request URL.
  console.error(error?.message?.startsWith("Set the token") || error?.message?.startsWith("Webhook is active")
    || error?.message?.startsWith("Send the exact") || error?.message?.startsWith("Telegram ")
    ? error.message : "Telegram discovery could not finish.");
  process.exitCode = 1;
}
