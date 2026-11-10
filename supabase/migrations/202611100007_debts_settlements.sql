begin;

create table public.phase2_settlements (
  owner_id uuid not null,
  event_id uuid not null,
  obligation_id uuid not null,
  paise bigint not null check (paise between 1 and 999999999999),
  primary key (owner_id,event_id,obligation_id),
  foreign key (owner_id,event_id) references public.phase2_events(owner_id,id),
  foreign key (owner_id,obligation_id) references public.phase2_obligations(owner_id,id)
);
create index phase2_settlement_obligation on public.phase2_settlements(owner_id,obligation_id);

create table public.phase2_voids (
  owner_id uuid not null,
  event_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (owner_id,event_id),
  foreign key (owner_id,event_id) references public.phase2_events(owner_id,id)
);
alter table public.phase2_settlements enable row level security;
alter table public.phase2_voids enable row level security;
create policy phase2_settlements_read on public.phase2_settlements for select to authenticated using (owner_id = auth.uid());
create policy phase2_voids_read on public.phase2_voids for select to authenticated using (owner_id = auth.uid());
revoke all on public.phase2_settlements, public.phase2_voids from public, anon, authenticated, service_role;
grant select on public.phase2_settlements, public.phase2_voids to authenticated;

create view public.phase2_open_obligations with (security_invoker = true) as
  select o.owner_id,o.id,o.event_id,o.person_id,o.direction,e.kind,e.description,e.occurred_on,
    o.paise::text as original_paise,
    (o.paise - coalesce((
      select sum(s.paise) from public.phase2_settlements s
      where s.owner_id = o.owner_id and s.obligation_id = o.id
        and not exists (select 1 from public.phase2_voids v where v.owner_id = s.owner_id and v.event_id = s.event_id)
    ),0))::text as remaining_paise
  from public.phase2_obligations o
  join public.phase2_events e on e.owner_id = o.owner_id and e.id = o.event_id
  where not exists (select 1 from public.phase2_voids v where v.owner_id = o.owner_id and v.event_id = o.event_id);
revoke all on public.phase2_open_obligations from public, anon, authenticated, service_role;
grant select on public.phase2_open_obligations to authenticated;

create function public.void_phase2_event(p_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare owner uuid := auth.uid();
begin
  if owner is null then raise exception 'Unauthorized' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('phase2:' || owner::text,0));
  if not exists (select 1 from public.phase2_events where owner_id = owner and id = p_id) then
    raise exception 'Entry unavailable' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.phase2_obligations o
    join public.phase2_settlements s on s.owner_id = o.owner_id and s.obligation_id = o.id
    where o.owner_id = owner and o.event_id = p_id and not exists (
      select 1 from public.phase2_voids v where v.owner_id = s.owner_id and v.event_id = s.event_id
    )
  ) then raise exception 'Reverse linked settlements first' using errcode = '23514'; end if;
  insert into public.phase2_voids(owner_id,event_id) values (owner,p_id) on conflict do nothing;
  return p_id;
end $$;

create function public.record_shared_expense(
  p_source text, p_date date, p_description text, p_category text, p_total bigint,
  p_payer uuid, p_group uuid, p_method text, p_shares jsonb, p_replaces uuid default null
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare owner uuid := auth.uid(); event uuid;
begin
  if owner is null then raise exception 'Unauthorized' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('phase2:' || owner::text,0));
  if p_replaces is not null and not exists (
    select 1 from public.phase2_events e where e.owner_id = owner and e.id = p_replaces and e.kind = 'shared'
  ) then raise exception 'Shared expense unavailable' using errcode = '22023'; end if;
  -- An exact replay of a replacement returns its existing row. A new replacement
  -- of an already voided row is rejected, even if all of its amounts are valid.
  if p_replaces is not null and exists (
    select 1 from public.phase2_voids v where v.owner_id = owner and v.event_id = p_replaces
  ) and not exists (
    select 1 from public.phase2_events e where e.owner_id = owner and e.replaces_id = p_replaces and e.source_key = p_source
  ) then raise exception 'Original expense already voided' using errcode = '40001'; end if;
  event := public.phase2_write_shared(owner,p_source,p_date,p_description,p_category,p_total,p_payer,p_group,p_method,p_shares,p_replaces);
  if p_replaces is not null then perform public.void_phase2_event(p_replaces); end if;
  return event;
end $$;

create function public.phase2_write_loan(p_owner uuid, p_source text, p_date date, p_description text, p_kind text, p_person uuid, p_amount bigint)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  owner uuid := p_owner;
  signature text := md5(jsonb_build_array(p_kind,p_date,p_description,p_person,p_amount)::text);
  event uuid;
begin
  event := public.phase2_begin(owner,p_source,signature);
  if event is not null then return event; end if;
  if p_kind is null or p_kind not in ('lend','borrow') or not exists (
    select 1 from public.people where owner_id = owner and id = p_person and archived_at is null
  ) then raise exception 'Choose an eligible person and direction' using errcode = '22023'; end if;
  insert into public.phase2_events(owner_id,source_key,fingerprint,kind,occurred_on,description,amount_paise,personal_paise,cash_paise)
    values (owner,p_source,signature,p_kind,p_date,btrim(p_description),p_amount,0,
      case when p_kind = 'lend' then -p_amount else p_amount end) returning id into event;
  insert into public.phase2_obligations(owner_id,event_id,person_id,direction,paise)
    values (owner,event,p_person,case when p_kind = 'lend' then 'receivable' else 'payable' end,p_amount);
  return event;
end $$;

create function public.phase2_write_settlement(p_owner uuid, p_source text, p_date date, p_description text, p_kind text, p_allocations jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  owner uuid := p_owner;
  signature text := md5(jsonb_build_array(p_kind,p_date,p_description,p_allocations)::text);
  event uuid;
  rec numeric := 0;
  pay numeric := 0;
  amount bigint;
  person uuid;
  allocation jsonb;
  obligation public.phase2_open_obligations%rowtype;
  ids uuid[] := array[]::uuid[];
begin
  event := public.phase2_begin(owner,p_source,signature);
  if event is not null then return event; end if;
  if p_kind is null or p_kind not in ('receive','repay','net') or jsonb_typeof(p_allocations) is distinct from 'array'
    then raise exception 'Choose an explicit allocation and direction' using errcode = '22023'; end if;
  if jsonb_array_length(p_allocations) not between 1 and 20 then
    raise exception 'Choose one to twenty obligations' using errcode = '22023';
  end if;
  for allocation in select value from jsonb_array_elements(p_allocations) loop
    if coalesce(allocation->>'paise','') !~ '^[0-9]{1,12}$' then
      raise exception 'Invalid allocation' using errcode = '22023';
    end if;
    amount := (allocation->>'paise')::bigint;
    select * into obligation from public.phase2_open_obligations
      where owner_id = owner and id = (allocation->>'obligation_id')::uuid;
    if not found or obligation.id = any(ids) or amount <= 0 or amount > obligation.remaining_paise::bigint
      or p_date < obligation.occurred_on or (person is not null and person <> obligation.person_id) then
      raise exception 'Allocation exceeds the balance, predates it, or mixes people' using errcode = '22023';
    end if;
    person := obligation.person_id;
    ids := array_append(ids,obligation.id);
    if obligation.direction = 'receivable' then rec := rec + amount; else pay := pay + amount; end if;
  end loop;
  if (p_kind = 'receive' and pay <> 0) or (p_kind = 'repay' and rec <> 0)
    or (p_kind = 'net' and (rec = 0 or rec <> pay)) then
    raise exception 'Allocation does not match settlement direction' using errcode = '22023';
  end if;
  insert into public.phase2_events(owner_id,source_key,fingerprint,kind,occurred_on,description,amount_paise,personal_paise,cash_paise)
    values (owner,p_source,signature,p_kind,p_date,btrim(p_description),greatest(rec,pay),0,rec-pay)
    returning id into event;
  insert into public.phase2_settlements(owner_id,event_id,obligation_id,paise)
    select owner,event,(value->>'obligation_id')::uuid,(value->>'paise')::bigint
    from jsonb_array_elements(p_allocations);
  return event;
end $$;

create function public.record_phase2_loan(p_source text, p_date date, p_description text, p_kind text, p_person uuid, p_amount bigint)
returns uuid language sql security definer set search_path = ''
as $$ select public.phase2_write_loan(auth.uid(),p_source,p_date,p_description,p_kind,p_person,p_amount) $$;

create function public.record_phase2_settlement(p_source text, p_date date, p_description text, p_kind text, p_allocations jsonb)
returns uuid language sql security definer set search_path = ''
as $$ select public.phase2_write_settlement(auth.uid(),p_source,p_date,p_description,p_kind,p_allocations) $$;

revoke all on function public.phase2_write_loan(uuid,text,date,text,text,uuid,bigint),
  public.phase2_write_settlement(uuid,text,date,text,text,jsonb) from public, anon, authenticated, service_role;

revoke all on function public.void_phase2_event(uuid), public.record_shared_expense(text,date,text,text,bigint,uuid,uuid,text,jsonb,uuid),
  public.record_phase2_loan(text,date,text,text,uuid,bigint), public.record_phase2_settlement(text,date,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.void_phase2_event(uuid), public.record_shared_expense(text,date,text,text,bigint,uuid,uuid,text,jsonb,uuid),
  public.record_phase2_loan(text,date,text,text,uuid,bigint), public.record_phase2_settlement(text,date,text,text,jsonb) to authenticated;

commit;
