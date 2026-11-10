begin;

create table public.phase2_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null check (length(source_key) between 1 and 140),
  fingerprint text not null,
  kind text not null check (kind in ('shared', 'lend', 'borrow', 'receive', 'repay', 'net')),
  occurred_on date not null check (occurred_on between '0001-01-01' and '9999-12-31'),
  description text not null check (length(btrim(description)) between 1 and 200),
  category text check (category in ('Food','Transport','Groceries','Utilities','Shopping','Health','Other')),
  amount_paise bigint not null check (amount_paise between 1 and 999999999999),
  personal_paise bigint not null check (personal_paise between 0 and amount_paise),
  cash_paise bigint not null check (cash_paise between -amount_paise and amount_paise),
  payer_id uuid,
  group_id uuid,
  replaces_id uuid,
  recorded_at timestamptz not null default clock_timestamp(),
  unique (owner_id, source_key),
  unique (owner_id, id),
  foreign key (owner_id, payer_id) references public.people(owner_id,id),
  foreign key (owner_id, group_id) references public.expense_groups(owner_id,id),
  foreign key (owner_id, replaces_id) references public.phase2_events(owner_id,id)
);
create index phase2_events_month on public.phase2_events(owner_id, occurred_on);

create table public.phase2_shares (
  owner_id uuid not null,
  event_id uuid not null,
  position integer not null check (position between 1 and 20),
  person_id uuid,
  name_snapshot text not null,
  paise bigint not null check (paise between 0 and 999999999999),
  primary key (owner_id,event_id,position),
  unique nulls not distinct (owner_id,event_id,person_id),
  foreign key (owner_id,event_id) references public.phase2_events(owner_id,id),
  foreign key (owner_id,person_id) references public.people(owner_id,id)
);

create table public.phase2_obligations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  event_id uuid not null,
  person_id uuid not null,
  direction text not null check (direction in ('receivable','payable')),
  paise bigint not null check (paise between 1 and 999999999999),
  unique (owner_id,id),
  unique (owner_id,event_id,person_id,direction),
  foreign key (owner_id,event_id) references public.phase2_events(owner_id,id),
  foreign key (owner_id,person_id) references public.people(owner_id,id)
);
create index phase2_obligations_person on public.phase2_obligations(owner_id,person_id);

alter table public.phase2_events enable row level security;
alter table public.phase2_shares enable row level security;
alter table public.phase2_obligations enable row level security;
create policy phase2_events_read on public.phase2_events for select to authenticated using (owner_id = auth.uid());
create policy phase2_shares_read on public.phase2_shares for select to authenticated using (owner_id = auth.uid());
create policy phase2_obligations_read on public.phase2_obligations for select to authenticated using (owner_id = auth.uid());
revoke all on public.phase2_events, public.phase2_shares, public.phase2_obligations from public, anon, authenticated, service_role;
grant select on public.phase2_events, public.phase2_shares, public.phase2_obligations to authenticated;

-- Serialize Phase 2 writes by owner so a settlement cannot race a source edit or another settlement.
create function public.phase2_begin(p_owner uuid, p_source text, p_fingerprint text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare owner uuid := p_owner; saved public.phase2_events%rowtype;
begin
  if owner is null then raise exception 'Unauthorized' using errcode = '42501'; end if;
  if p_source is null or length(p_source) not between 1 and 140 then
    raise exception 'Invalid request ID' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('phase2:' || owner::text, 0));
  select * into saved from public.phase2_events where owner_id = owner and source_key = p_source;
  if found and saved.fingerprint is distinct from p_fingerprint then
    raise exception 'Request ID already used with different details' using errcode = '22023';
  end if;
  return saved.id;
end $$;
revoke all on function public.phase2_begin(uuid,text,text) from public, anon, authenticated, service_role;

-- Use numeric integer products to avoid both bigint overflow and fractional rounding.
create function public.allocate_shared_paise(p_total bigint, p_method text, p_values bigint[])
returns bigint[] language plpgsql immutable set search_path = ''
as $$
declare denominator numeric; result bigint[];
begin
  if p_total is null or p_total not between 1 and 999999999999
    or coalesce(cardinality(p_values),0) not between 1 and 20
    or p_method is null or p_method not in ('equal','exact','weights','percent')
    or exists (select 1 from unnest(p_values) as u(v) where v is null or v not between 0 and 999999999999) then
    raise exception 'Invalid split' using errcode = '22023';
  end if;
  if p_method = 'equal' then
    p_values := array_fill(1::bigint, array[cardinality(p_values)]);
  end if;
  select sum(v) into denominator from unnest(p_values) as u(v);
  if p_method = 'exact' then
    if denominator <> p_total then raise exception 'Exact shares must equal the total' using errcode = '22023'; end if;
    return p_values;
  end if;
  if (p_method = 'percent' and denominator <> 10000)
    or (p_method = 'weights' and exists (select 1 from unnest(p_values) as u(v) where v = 0)) then
    raise exception 'Percentages must total 100 percent and weights must be positive' using errcode = '22023';
  end if;
  with portions as (
    select ord, div(p_total::numeric * v, denominator)::bigint as base,
      mod(p_total::numeric * v, denominator) as remainder
    from unnest(p_values) with ordinality as u(v, ord)
  ), ranked as (
    select ord, base, row_number() over(order by remainder desc, ord) as priority, sum(base) over() as allocated
    from portions
  )
  select array_agg(base + case when priority <= p_total - allocated then 1 else 0 end order by ord)
    into result from ranked;
  return result;
end $$;
revoke all on function public.allocate_shared_paise(bigint,text,bigint[]) from public, anon, authenticated, service_role;
grant execute on function public.allocate_shared_paise(bigint,text,bigint[]) to authenticated;

create function public.phase2_write_shared(
  p_owner uuid, p_source text, p_date date, p_description text, p_category text, p_total bigint,
  p_payer uuid, p_group uuid, p_method text, p_shares jsonb, p_replaces uuid default null
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  owner uuid := p_owner;
  signature text := md5(jsonb_build_array('shared',p_date,p_description,p_category,p_total,p_payer,p_group,p_method,p_shares,p_replaces)::text);
  event uuid;
  people_ids uuid[];
  portions bigint[];
  values_in bigint[];
  personal bigint := 0;
  n integer;
begin
  event := public.phase2_begin(owner, p_source, signature);
  if event is not null then return event; end if;
  if jsonb_typeof(p_shares) is distinct from 'array' then raise exception 'Choose participants' using errcode = '22023'; end if;
  n := jsonb_array_length(p_shares);
  if n not between 2 and 20 or exists (
    select 1 from jsonb_array_elements(p_shares) as s(item)
    where jsonb_typeof(item) <> 'object' or not (item ? 'person_id')
      or (p_method <> 'equal' and coalesce(item->>'value','') !~ '^[0-9]{1,12}$')
  ) then raise exception 'Invalid participants or shares' using errcode = '22023'; end if;
  select array_agg((item->>'person_id')::uuid order by ord),
         array_agg(case when p_method = 'equal' then 1 else (item->>'value')::bigint end order by ord)
    into people_ids, values_in from jsonb_array_elements(p_shares) with ordinality as s(item,ord);
  if (select count(distinct coalesce(person::text,'self')) from unnest(people_ids) as u(person)) <> n
    or not (array_position(people_ids,p_payer) is not null)
    or (select count(*) from public.people where owner_id = owner and id = any(people_ids) and archived_at is null)
       <> n - (case when array_position(people_ids,null) is not null then 1 else 0 end)
    or (p_group is not null and not exists (
      select 1 from public.expense_groups where owner_id = owner and id = p_group and archived_at is null
    )) then raise exception 'Choose unique participants and one eligible payer' using errcode = '22023'; end if;
  portions := public.allocate_shared_paise(p_total,p_method,values_in);
  personal := coalesce(portions[array_position(people_ids,null)],0);
  if p_category is null then raise exception 'Category required' using errcode = '22023'; end if;
  if p_payer is not null and array_position(people_ids,null) is null then
    raise exception 'Include yourself when someone else pays' using errcode = '22023';
  end if;
  insert into public.phase2_events(owner_id,source_key,fingerprint,kind,occurred_on,description,category,
    amount_paise,personal_paise,cash_paise,payer_id,group_id,replaces_id)
    values (owner,p_source,signature,'shared',p_date,btrim(p_description),p_category,
      p_total,personal,case when p_payer is null then -p_total else 0 end,p_payer,p_group,p_replaces)
    returning id into event;
  insert into public.phase2_shares(owner_id,event_id,position,person_id,name_snapshot,paise)
    select owner,event,ord::integer,person,coalesce(p.display_name,'Me'),portions[ord::integer]
    from unnest(people_ids) with ordinality as u(person,ord)
    left join public.people p on p.owner_id = owner and p.id = person;
  if p_payer is null then
    insert into public.phase2_obligations(owner_id,event_id,person_id,direction,paise)
      select owner,event,person_id,'receivable',paise from public.phase2_shares
      where owner_id = owner and event_id = event and person_id is not null and paise > 0;
  elsif personal > 0 then
    insert into public.phase2_obligations(owner_id,event_id,person_id,direction,paise)
      values (owner,event,p_payer,'payable',personal);
  end if;
  return event;
end $$;
revoke all on function public.phase2_write_shared(uuid,text,date,text,text,bigint,uuid,uuid,text,jsonb,uuid)
  from public, anon, authenticated, service_role;

commit;
