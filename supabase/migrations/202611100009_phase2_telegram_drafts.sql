begin;

create table public.phase2_telegram_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null check (length(source_key) between 1 and 140),
  payload jsonb not null check (octet_length(payload::text) <= 8192),
  preview text not null check (length(preview) between 1 and 3500),
  expires_at timestamptz not null default clock_timestamp() + interval '30 minutes',
  cancelled_at timestamptz,
  unique (owner_id, source_key)
);
alter table public.phase2_telegram_drafts enable row level security;
revoke all on public.phase2_telegram_drafts from public, anon, authenticated, service_role;

create function public.phase2_bot_context(p_owner uuid, p_names text[])
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' or p_owner is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_names),0) not between 1 and 20 then
    raise exception 'Invalid contact lookup' using errcode = '22023';
  end if;
  return (
    with contacts as (
      select distinct n.name,p.id,p.display_name
      from unnest(p_names) as n(name)
      join public.people p on p.owner_id = p_owner and p.archived_at is null
        and (lower(btrim(p.display_name)) = n.name or exists (
          select 1 from public.person_aliases a
          where a.owner_id = p_owner and a.person_id = p.id and lower(btrim(a.alias)) = n.name
        ))
    )
    select jsonb_build_object(
      'people', coalesce((select jsonb_agg(to_jsonb(c)) from contacts c),'[]'::jsonb),
      'obligations', coalesce((select jsonb_agg(to_jsonb(o)) from (
        select id,person_id,direction,remaining_paise,occurred_on
        from public.phase2_open_obligations
        where owner_id = p_owner and remaining_paise <> '0' and person_id in (select id from contacts)
        order by id limit 21
      ) o),'[]'::jsonb)
    )
  );
end $$;

create function public.phase2_stage_bot_draft(p_owner uuid, p_source text, p_payload jsonb, p_preview text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare draft public.phase2_telegram_drafts%rowtype;
begin
  if auth.role() is distinct from 'service_role' or p_owner is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  delete from public.phase2_telegram_drafts where owner_id = p_owner and expires_at < now() - interval '7 days';
  insert into public.phase2_telegram_drafts(owner_id,source_key,payload,preview)
    values (p_owner,p_source,p_payload,p_preview) on conflict (owner_id,source_key) do nothing;
  select * into draft from public.phase2_telegram_drafts where owner_id = p_owner and source_key = p_source;
  if draft.cancelled_at is not null or draft.expires_at <= clock_timestamp() then return null; end if;
  return jsonb_build_object('id',draft.id,'preview',draft.preview);
end $$;

create function public.phase2_finish_bot_draft(p_owner uuid, p_id uuid, p_cancel boolean)
returns text language plpgsql security definer set search_path = ''
as $$
declare draft public.phase2_telegram_drafts%rowtype; p jsonb;
begin
  if auth.role() is distinct from 'service_role' or p_owner is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  select * into draft from public.phase2_telegram_drafts where owner_id = p_owner and id = p_id for update;
  if not found or draft.expires_at <= clock_timestamp() or draft.cancelled_at is not null then return 'closed'; end if;
  if exists (select 1 from public.phase2_events where owner_id = p_owner and source_key = draft.source_key) then
    return 'saved';
  end if;
  if p_cancel then
    update public.phase2_telegram_drafts set cancelled_at = clock_timestamp() where id = draft.id;
    return 'closed';
  end if;
  p := draft.payload;
  case p->>'kind'
    when 'shared' then
      perform public.phase2_write_shared(p_owner,draft.source_key,(p->>'date')::date,p->>'description',
        'Other',(p->>'amount')::bigint,(p->>'payer')::uuid,null,'equal',p->'shares',null);
    when 'lend', 'borrow' then
      perform public.phase2_write_loan(p_owner,draft.source_key,(p->>'date')::date,p->>'description',
        p->>'kind',(p->>'person')::uuid,(p->>'amount')::bigint);
    when 'receive', 'repay' then
      perform public.phase2_write_settlement(p_owner,draft.source_key,(p->>'date')::date,
        p->>'description',p->>'kind',p->'allocations');
    else raise exception 'Unsupported draft' using errcode = '22023';
  end case;
  return 'saved';
end $$;

revoke all on function public.phase2_bot_context(uuid,text[]),public.phase2_stage_bot_draft(uuid,text,jsonb,text),
  public.phase2_finish_bot_draft(uuid,uuid,boolean) from public, anon, authenticated, service_role;
grant execute on function public.phase2_bot_context(uuid,text[]),public.phase2_stage_bot_draft(uuid,text,jsonb,text),
  public.phase2_finish_bot_draft(uuid,uuid,boolean) to service_role;

commit;
