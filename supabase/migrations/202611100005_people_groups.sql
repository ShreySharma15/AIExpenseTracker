begin;

create table public.people (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  is_saved boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, id)
);

create table public.person_aliases (
  id uuid primary key,
  owner_id uuid not null,
  person_id uuid not null,
  alias text not null check (length(btrim(alias)) between 1 and 80),
  foreign key (owner_id, person_id) references public.people(owner_id, id)
);
create unique index person_alias_once on public.person_aliases(owner_id, person_id, lower(btrim(alias)));

create table public.expense_groups (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  archived_at timestamptz,
  unique (owner_id, id)
);

create table public.expense_group_members (
  owner_id uuid not null,
  group_id uuid not null,
  person_id uuid not null,
  position integer not null check (position between 1 and 20),
  primary key (owner_id, group_id, person_id),
  unique (owner_id, group_id, position),
  foreign key (owner_id, group_id) references public.expense_groups(owner_id, id),
  foreign key (owner_id, person_id) references public.people(owner_id, id)
);

alter table public.people enable row level security;
alter table public.person_aliases enable row level security;
alter table public.expense_groups enable row level security;
alter table public.expense_group_members enable row level security;
create policy people_read on public.people for select to authenticated using (owner_id = auth.uid());
create policy people_insert on public.people for insert to authenticated with check (owner_id = auth.uid());
create policy people_update on public.people for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy alias_read on public.person_aliases for select to authenticated using (owner_id = auth.uid());
create policy alias_insert on public.person_aliases for insert to authenticated with check (owner_id = auth.uid());
create policy alias_delete on public.person_aliases for delete to authenticated using (owner_id = auth.uid());
create policy group_read on public.expense_groups for select to authenticated using (owner_id = auth.uid());
create policy group_members_read on public.expense_group_members for select to authenticated using (owner_id = auth.uid());

revoke all on public.people, public.person_aliases, public.expense_groups, public.expense_group_members
  from public, anon, authenticated, service_role;
grant select on public.people, public.person_aliases, public.expense_groups, public.expense_group_members to authenticated;
grant insert (id, owner_id, display_name, is_saved), update (display_name, is_saved, archived_at) on public.people to authenticated;
grant insert (id, owner_id, person_id, alias), delete on public.person_aliases to authenticated;

create function public.save_expense_group(p_id uuid, p_name text, p_members uuid[], p_archived boolean default false)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare owner uuid := auth.uid();
begin
  if owner is null then raise exception 'Unauthorized' using errcode = '42501'; end if;
  if p_archived then
    update public.expense_groups set archived_at = coalesce(archived_at, now()) where id = p_id and owner_id = owner;
    if not found then raise exception 'Group unavailable' using errcode = '22023'; end if;
    return p_id;
  end if;
  if coalesce(cardinality(p_members), 0) not between 1 and 20 or
     (select count(*) from public.people where owner_id = owner and id = any(p_members)
       and archived_at is null and is_saved) <> cardinality(p_members) then
    raise exception 'Choose unique active saved people' using errcode = '22023';
  end if;
  insert into public.expense_groups(id, owner_id, name) values (p_id, owner, btrim(p_name))
  on conflict (id) do update set name = excluded.name
    where expense_groups.owner_id = owner and expense_groups.archived_at is null;
  if not found then raise exception 'Group unavailable' using errcode = '22023'; end if;
  delete from public.expense_group_members where owner_id = owner and group_id = p_id;
  insert into public.expense_group_members(owner_id, group_id, person_id, position)
    select owner, p_id, member, ord::integer from unnest(p_members) with ordinality as x(member, ord);
  return p_id;
end $$;

revoke all on function public.save_expense_group(uuid,text,uuid[],boolean) from public, anon, authenticated, service_role;
grant execute on function public.save_expense_group(uuid,text,uuid[],boolean) to authenticated;

commit;
