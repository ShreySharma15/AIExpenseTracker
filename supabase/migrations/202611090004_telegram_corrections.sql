begin;

create table public.telegram_corrections (
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null check (length(source_key) between 1 and 140),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  result_version integer not null,
  primary key (owner_id, source_key)
);
alter table public.telegram_corrections enable row level security;
revoke all on public.telegram_corrections from public, anon, authenticated, service_role;

create function public.correct_telegram_expense(p_owner uuid, p_source text, p_id uuid, p_version integer, p_item jsonb)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v integer;
begin
  if auth.role() is distinct from 'service_role' or p_owner is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if p_source is null or length(p_source) not between 1 and 140 then
    raise exception 'Invalid source' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('correction:' || p_owner::text || ':' || p_source, 0));
  select result_version into v from public.telegram_corrections
    where owner_id = p_owner and source_key = p_source;
  if found then return v; end if;
  if not exists (select 1 from public.expenses where id = p_id and owner_id = p_owner) then
    return null;
  end if;
  v := public.change_expense(p_owner, p_id, p_version, p_item);
  insert into public.telegram_corrections values (p_owner, p_source, p_id, v);
  return v;
end $$;
revoke all on function public.correct_telegram_expense(uuid,text,uuid,integer,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.correct_telegram_expense(uuid,text,uuid,integer,jsonb) to service_role;

create or replace function public.confirm_ai_expenses(p_owner uuid, p_draft uuid)
returns uuid[] language plpgsql security definer set search_path = ''
as $$
declare draft public.ai_expense_drafts%rowtype;
begin
  if auth.role() is distinct from 'service_role' or p_owner is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  select * into draft from public.ai_expense_drafts where id = p_draft and owner_id = p_owner for update;
  if not found or draft.expires_at <= clock_timestamp() then return null; end if;
  return public.add_expenses(p_owner, draft.source_key, draft.items);
end $$;

create function public.cancel_ai_draft(p_owner uuid, p_draft uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare draft public.ai_expense_drafts%rowtype;
begin
  if auth.role() is distinct from 'service_role' or p_owner is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  select * into draft from public.ai_expense_drafts where id = p_draft and owner_id = p_owner for update;
  if not found then return true; end if;
  if exists (select 1 from public.expenses where owner_id = p_owner and source_key = draft.source_key || ':1') then
    return false;
  end if;
  delete from public.ai_expense_drafts where id = p_draft and owner_id = p_owner;
  return true;
end $$;
revoke all on function public.cancel_ai_draft(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.cancel_ai_draft(uuid,uuid) to service_role;

commit;
