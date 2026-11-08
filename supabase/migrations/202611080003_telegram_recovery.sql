begin;

create table public.telegram_jobs (
  bot_id bigint not null,
  update_id bigint not null,
  stage text not null default 'process' check (stage in ('process', 'send', 'done', 'failed')),
  payload jsonb,
  reply jsonb,
  attempts integer not null default 0,
  ready_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (bot_id, update_id)
);
alter table public.telegram_jobs enable row level security;
revoke all on public.telegram_jobs from public, anon, authenticated, service_role;
grant select, insert on public.telegram_jobs to service_role;
create index telegram_jobs_ready on public.telegram_jobs (bot_id, ready_at)
  where stage in ('process', 'send');

create function public.claim_telegram_job(p_bot bigint, p_update bigint default null)
returns setof public.telegram_jobs language plpgsql security definer set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Unauthorized' using errcode = '42501'; end if;
  delete from public.telegram_jobs
    where bot_id = p_bot and stage in ('done', 'failed') and updated_at < now() - interval '7 days';
  update public.telegram_jobs set stage = 'failed', payload = null, reply = null,
    lease_token = null, lease_until = null, updated_at = now()
    where bot_id = p_bot and stage in ('process', 'send') and attempts >= 4 and lease_until <= now();
  return query
    with next_job as (
      select bot_id, update_id from public.telegram_jobs
      where bot_id = p_bot and (p_update is null or update_id = p_update)
        and stage in ('process', 'send') and ready_at <= now() and attempts < 4
        and (lease_until is null or lease_until <= now())
      order by ready_at, update_id limit 1 for update skip locked
    )
    update public.telegram_jobs j set lease_token = gen_random_uuid(), lease_until = now() + interval '90 seconds',
      attempts = j.attempts + 1, updated_at = now()
    from next_job n where j.bot_id = n.bot_id and j.update_id = n.update_id returning j.*;
end $$;

create function public.finish_telegram_job(p_bot bigint, p_update bigint, p_lease uuid, p_result text, p_reply jsonb default null, p_delay integer default 30)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Unauthorized' using errcode = '42501'; end if;
  if p_result not in ('ok', 'retry', 'failed') or p_result is null then raise exception 'Invalid result'; end if;
  update public.telegram_jobs j set
    stage = case when p_result = 'retry' and attempts < 4 then stage
                 when p_result <> 'ok' then 'failed'
                 when stage = 'process' and p_reply is not null then 'send' else 'done' end,
    payload = case when p_result = 'retry' and attempts < 4 then payload end,
    reply = case when p_result = 'retry' and attempts < 4 then reply
                 when p_result = 'ok' and stage = 'process' then p_reply end,
    attempts = case when p_result = 'ok' then 0 else attempts end,
    ready_at = now() + case when p_result = 'retry' then make_interval(secs => greatest(5, least(3600, p_delay))) else interval '0' end,
    lease_token = null, lease_until = null, updated_at = now()
    where j.bot_id = p_bot and j.update_id = p_update and j.lease_token = p_lease and j.lease_until > now();
  return found;
end $$;
revoke all on function public.claim_telegram_job(bigint,bigint),
  public.finish_telegram_job(bigint,bigint,uuid,text,jsonb,integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_telegram_job(bigint,bigint),
  public.finish_telegram_job(bigint,bigint,uuid,text,jsonb,integer) to service_role;

commit;
