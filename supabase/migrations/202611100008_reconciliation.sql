begin;

create view public.phase2_history with (security_invoker = true) as
select e.owner_id,e.id,e.kind,e.occurred_on,e.recorded_at,e.description,e.category,e.payer_id,e.group_id,e.replaces_id,
  e.amount_paise::text as amount_paise,e.personal_paise::text as personal_paise,e.cash_paise::text as cash_paise,
  v.recorded_at as voided_at
from public.phase2_events e left join public.phase2_voids v on v.owner_id = e.owner_id and v.event_id = e.id;

create view public.phase2_person_activity with (security_invoker = true) as
select h.*, a.person_id
from public.phase2_history h join (
  select owner_id,event_id,person_id from public.phase2_shares where person_id is not null
  union
  select owner_id,event_id,person_id from public.phase2_obligations
  union
  select s.owner_id,s.event_id,o.person_id from public.phase2_settlements s
    join public.phase2_obligations o on o.owner_id = s.owner_id and o.id = s.obligation_id
) a on a.owner_id = h.owner_id and a.event_id = h.id;

create view public.phase2_balances with (security_invoker = true) as
select owner_id,person_id,
  coalesce(sum(remaining_paise::bigint) filter(where direction = 'receivable'),0)::text as receivable_paise,
  coalesce(sum(remaining_paise::bigint) filter(where direction = 'payable'),0)::text as payable_paise
from public.phase2_open_obligations group by owner_id,person_id;

create view public.phase2_settlement_details with (security_invoker = true) as
select s.owner_id,s.event_id,s.obligation_id,o.person_id,o.direction,
  e.description as obligation_description,e.occurred_on as obligation_date,s.paise::text as paise
from public.phase2_settlements s
join public.phase2_obligations o on o.owner_id = s.owner_id and o.id = s.obligation_id
join public.phase2_events e on e.owner_id = o.owner_id and e.id = o.event_id;

create view public.phase2_postings with (security_invoker = true) as
with entries as (
  select owner_id,id as event_id,'cash' as account,null::uuid as person_id,cash_paise as paise from public.phase2_events
  union all
  select owner_id,id,'expense',null::uuid,personal_paise from public.phase2_events
  union all
  select owner_id,event_id,direction,person_id,case when direction='receivable' then paise else -paise end
    from public.phase2_obligations
  union all
  select s.owner_id,s.event_id,o.direction,o.person_id,case when o.direction='receivable' then -s.paise else s.paise end
    from public.phase2_settlements s join public.phase2_obligations o on o.owner_id = s.owner_id and o.id = s.obligation_id
)
select x.owner_id,x.event_id,e.occurred_on,x.account,x.person_id,x.paise::text as paise,false as reversal
from entries x join public.phase2_events e on e.owner_id = x.owner_id and e.id = x.event_id
where x.paise <> 0
union all
select x.owner_id,x.event_id,e.occurred_on,x.account,x.person_id,(-x.paise)::text,true
from entries x join public.phase2_events e on e.owner_id = x.owner_id and e.id = x.event_id
join public.phase2_voids v on v.owner_id = x.owner_id and v.event_id = x.event_id
where x.paise <> 0;

revoke all on public.phase2_history, public.phase2_person_activity, public.phase2_balances, public.phase2_postings, public.phase2_settlement_details
  from public, anon, authenticated, service_role;
grant select on public.phase2_history, public.phase2_person_activity, public.phase2_balances, public.phase2_postings, public.phase2_settlement_details to authenticated;

create function public.phase2_month(p_start date,p_end date)
returns table(category text, personal text, paid text, received text)
language sql stable security invoker set search_path = ''
as $$
  select h.category, sum(h.personal_paise::bigint)::text,
    sum(greatest(-h.cash_paise::bigint,0))::text,
    sum(greatest(h.cash_paise::bigint,0))::text
  from public.phase2_history h
  where h.owner_id = auth.uid() and h.voided_at is null and h.occurred_on >= p_start and h.occurred_on < p_end
  group by h.category
$$;

create function public.phase2_reconcile()
returns boolean language sql stable security invoker set search_path = ''
as $$
  with postings as (
    select event_id, reversal, sum(paise::bigint) as total
    from public.phase2_postings where owner_id = auth.uid() group by event_id,reversal
  ), posted_debts as (
    select person_id, account, sum(paise::bigint) as balance
    from public.phase2_postings where owner_id = auth.uid() and account in ('receivable','payable')
    group by person_id,account
  ), outstanding as (
    select person_id,direction,sum(remaining_paise::bigint) as balance from public.phase2_open_obligations
    where owner_id = auth.uid() group by person_id,direction
  )
  select auth.uid() is not null
    and not exists (select 1 from postings where total <> 0)
    and not exists (select 1 from public.phase2_open_obligations where owner_id = auth.uid() and remaining_paise::bigint < 0)
    and not exists (
      select 1 from posted_debts p full join outstanding o on p.person_id = o.person_id and p.account = o.direction
      where coalesce(p.balance,0) <> case when coalesce(p.account,o.direction) = 'payable'
        then -coalesce(o.balance,0) else coalesce(o.balance,0) end
    )
$$;
revoke all on function public.phase2_month(date,date),public.phase2_reconcile() from public, anon, authenticated, service_role;
grant execute on function public.phase2_month(date,date),public.phase2_reconcile() to authenticated;

commit;
