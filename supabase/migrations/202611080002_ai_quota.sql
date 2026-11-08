begin;

create table public.ai_requests (
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null check (length(source_key) between 1 and 140),
  quota_date date not null,
  requested_at timestamptz not null default clock_timestamp(),
  primary key (owner_id, source_key)
);
alter table public.ai_requests enable row level security;
revoke all on public.ai_requests from public, anon, authenticated, service_role;
create index ai_requests_date on public.ai_requests(owner_id, quota_date, requested_at desc);

create table public.ai_expense_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  source_key text not null,
  items jsonb not null,
  expires_at timestamptz not null default clock_timestamp() + interval '30 minutes',
  unique (owner_id, source_key),
  foreign key (owner_id, source_key) references public.ai_requests(owner_id, source_key) on delete cascade
);
alter table public.ai_expense_drafts enable row level security;
revoke all on public.ai_expense_drafts from public, anon, authenticated, service_role;
grant select, insert on public.ai_expense_drafts to service_role;

create function public.confirm_ai_expenses(p_owner uuid, p_draft uuid)
returns uuid[] language plpgsql security definer set search_path = ''
as $$
declare draft public.ai_expense_drafts%rowtype;
begin
  if auth.role() is distinct from 'service_role' or p_owner is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  select * into draft from public.ai_expense_drafts where id = p_draft and owner_id = p_owner;
  if not found or draft.expires_at < clock_timestamp() then return null; end if;
  return public.add_expenses(p_owner, draft.source_key, draft.items);
end
$$;
revoke all on function public.confirm_ai_expenses(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.confirm_ai_expenses(uuid,uuid) to service_role;

create function public.reserve_ai_request(p_owner uuid, p_source text, p_limit integer)
returns text language plpgsql security definer set search_path = ''
as $$
declare quota_day date := (clock_timestamp() at time zone 'America/Los_Angeles')::date;
begin
  if auth.role() is distinct from 'service_role' or p_owner is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then return 'disabled'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ai:' || p_owner::text, 0));
  if exists (select 1 from public.ai_requests where owner_id = p_owner and source_key = p_source) then
    return 'duplicate';
  end if;
  if (select count(*) from public.ai_requests where owner_id = p_owner and quota_date = quota_day) >= p_limit then
    return 'daily_limit';
  end if;
  if exists (select 1 from public.ai_requests where owner_id = p_owner and quota_date = quota_day
             and requested_at > clock_timestamp() - interval '15 seconds') then return 'slow_down'; end if;
  delete from public.ai_requests where owner_id = p_owner and quota_date < quota_day - 7;
  insert into public.ai_requests(owner_id, source_key, quota_date) values (p_owner, p_source, quota_day);
  return 'reserved';
end
$$;
revoke all on function public.reserve_ai_request(uuid,text,integer) from public, anon, authenticated, service_role;
grant execute on function public.reserve_ai_request(uuid,text,integer) to service_role;

commit;
