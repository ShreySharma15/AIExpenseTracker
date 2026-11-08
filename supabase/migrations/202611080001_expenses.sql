begin;

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null check (length(source_key) between 1 and 150),
  current_version integer not null check (current_version > 0),
  unique (owner_id, source_key)
);

create table public.expense_revisions (
  expense_id uuid not null references public.expenses(id) on delete cascade,
  version integer not null check (version > 0),
  action text not null check (action in ('create', 'edit', 'void')),
  occurred_on date not null,
  paise bigint not null check (paise between 1 and 999999999999),
  description text not null check (length(btrim(description)) between 1 and 200),
  category text not null check (category in ('Food','Transport','Groceries','Utilities','Shopping','Health','Other')),
  coverage text check (length(coverage) <= 120),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (expense_id, version)
);

alter table public.expenses add constraint expenses_current_revision
  foreign key (id, current_version) references public.expense_revisions(expense_id, version)
  deferrable initially deferred;

alter table public.expenses enable row level security;
alter table public.expense_revisions enable row level security;
create policy expense_owner on public.expenses for select to authenticated using (owner_id = auth.uid());
create policy revision_owner on public.expense_revisions for select to authenticated using (
  exists (select 1 from public.expenses e where e.id = expense_id and e.owner_id = auth.uid())
);

revoke all on public.expenses, public.expense_revisions from public, anon, authenticated, service_role;
grant select on public.expenses, public.expense_revisions to authenticated, service_role;

create view public.active_expenses with (security_invoker = true) as
  select e.id, e.owner_id, r.version, r.occurred_on, r.paise::text as paise,
         r.description, r.category, r.coverage, r.recorded_at
    from public.expenses e join public.expense_revisions r
      on r.expense_id = e.id and r.version = e.current_version
    where r.action <> 'void';

-- Every non-void revision posts expense and cash movements. Edits and voids
-- reverse the previous posting at its original effective date.
create view public.expense_postings with (security_invoker = true) as
  select r.expense_id, r.version, r.occurred_on, leg.account, leg.amount::text as paise
    from public.expense_revisions r
    cross join lateral (values ('expense', r.paise), ('cash', -r.paise)) leg(account, amount)
    where r.action <> 'void'
  union all
  select r.expense_id, r.version, previous.occurred_on, leg.account, leg.amount::text
    from public.expense_revisions r join public.expense_revisions previous
      on previous.expense_id = r.expense_id and previous.version = r.version - 1
    cross join lateral (values ('expense', -previous.paise), ('cash', previous.paise)) leg(account, amount)
    where previous.action <> 'void';

revoke all on public.active_expenses, public.expense_postings from public, anon, authenticated, service_role;
grant select on public.active_expenses, public.expense_postings to authenticated, service_role;
create index expense_revisions_date on public.expense_revisions (occurred_on, expense_id);

create function public.add_expenses(p_owner uuid, p_source text, p_items jsonb)
returns uuid[] language plpgsql security definer set search_path = ''
as $$
declare
  item jsonb;
  entry_id uuid;
  entry_key text;
  result uuid[] := array[]::uuid[];
  item_no integer := 0;
begin
  if p_owner is null or (auth.uid() is distinct from p_owner and auth.role() is distinct from 'service_role') then
    raise exception 'Unauthorized owner' using errcode = '42501';
  end if;
  if p_source is null or length(p_source) not between 1 and 140
     or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Invalid batch';
  end if;
  if jsonb_array_length(p_items) not between 1 and 12 then
    raise exception 'Invalid batch size';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text || ':' || p_source, 0));
  select array_agg(e.id order by split_part(e.source_key, ':', -1)::integer) into result
    from public.expenses e
    where e.owner_id = p_owner and left(e.source_key, length(p_source) + 1) = p_source || ':'
      and substr(e.source_key, length(p_source) + 2) ~ '^[0-9]+$';
  if result is not null then return result; end if;
  result := array[]::uuid[];
  for item in select value from jsonb_array_elements(p_items) loop
    item_no := item_no + 1;
    entry_key := p_source || ':' || item_no;
    insert into public.expenses(owner_id, source_key, current_version)
      values (p_owner, entry_key, 1)
      on conflict (owner_id, source_key) do nothing
      returning id into entry_id;
    if found then
      insert into public.expense_revisions(expense_id, version, action, occurred_on, paise, description, category, coverage)
      values (entry_id, 1, 'create', (item->>'occurred_on')::date, (item->>'paise')::bigint,
              btrim(item->>'description'), item->>'category', item->>'coverage');
    else
      select e.id into strict entry_id from public.expenses e where e.owner_id = p_owner and e.source_key = entry_key;
    end if;
    result := array_append(result, entry_id);
  end loop;
  return result;
end
$$;

create function public.change_expense(p_owner uuid, p_id uuid, p_version integer, p_item jsonb)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  current_row public.expense_revisions%rowtype;
  next_version integer;
begin
  if p_owner is null or (auth.uid() is distinct from p_owner and auth.role() is distinct from 'service_role') then
    raise exception 'Unauthorized owner' using errcode = '42501';
  end if;
  select r.* into current_row from public.expenses e
    join public.expense_revisions r on r.expense_id = e.id and r.version = e.current_version
    where e.id = p_id and e.owner_id = p_owner for update of e;
  if not found then raise exception 'Expense not found'; end if;
  if p_version is distinct from current_row.version or current_row.action = 'void' then
    raise exception 'Expense has changed. Reload and try again.' using errcode = '40001';
  end if;
  next_version := current_row.version + 1;
  if p_item is null then
    insert into public.expense_revisions(expense_id, version, action, occurred_on, paise, description, category, coverage)
    values (p_id, next_version, 'void', current_row.occurred_on, current_row.paise,
            current_row.description, current_row.category, current_row.coverage);
  else
    insert into public.expense_revisions(expense_id, version, action, occurred_on, paise, description, category, coverage)
    values (p_id, next_version, 'edit', (p_item->>'occurred_on')::date, (p_item->>'paise')::bigint,
            btrim(p_item->>'description'), p_item->>'category', p_item->>'coverage');
  end if;
  update public.expenses set current_version = next_version where id = p_id;
  return next_version;
end
$$;

revoke all on function public.add_expenses(uuid,text,jsonb), public.change_expense(uuid,uuid,integer,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.add_expenses(uuid,text,jsonb), public.change_expense(uuid,uuid,integer,jsonb)
  to authenticated, service_role;

create function public.expense_summary(p_owner uuid, p_start date, p_end date)
returns table(category text, total text, count bigint) language sql stable security invoker set search_path = ''
as $$
  select r.category, sum(r.paise)::text, count(*)
    from public.expenses e join public.expense_revisions r
      on r.expense_id = e.id and r.version = e.current_version
    where e.owner_id = p_owner and r.action <> 'void' and r.occurred_on >= p_start and r.occurred_on < p_end
    group by r.category
$$;
revoke all on function public.expense_summary(uuid,date,date) from public, anon;
grant execute on function public.expense_summary(uuid,date,date) to authenticated, service_role;

commit;
