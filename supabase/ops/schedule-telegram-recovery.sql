-- Provision Vault values expense_tracker_recovery_url (full HTTPS endpoint)
-- and expense_tracker_cron_secret (same value as Vercel CRON_SECRET) first.
do $$
begin
  if (select count(distinct name) from vault.decrypted_secrets
      where name in ('expense_tracker_recovery_url', 'expense_tracker_cron_secret')) <> 2 then
    raise exception 'Provision the recovery URL and secret in Vault first';
  end if;
end $$;

select cron.schedule('expense-tracker-telegram-recovery', '* * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'expense_tracker_recovery_url'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'expense_tracker_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
$job$);
