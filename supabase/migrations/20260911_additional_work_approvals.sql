-- Separate additional-work ledger: never rewrites original booking/payment totals.
begin;
create table if not exists public.iman_additional_work_orders (
  id uuid primary key default gen_random_uuid(),
  booking_id text not null references public.bookings(id),
  revision integer not null default 1 check (revision > 0),
  status text not null default 'draft' check (status in ('draft','setting_up','approved','processing','requires_action','payment_failed','paid','canceled')),
  total_minutes integer not null check (total_minutes > 0 and total_minutes <= 749999),
  amount_cents integer generated always as (round(total_minutes::numeric * 8000 / 60)::integer) stored,
  stripe_customer_id text,
  payment_method_id text,
  card_brand text,
  card_last4 text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  payment_intent_id text unique,
  setup_session_id text,
  approved_at timestamptz,
  approval_text text,
  paid_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists iman_additional_work_one_open
  on public.iman_additional_work_orders(booking_id) where status not in ('paid','canceled');
create index if not exists iman_additional_work_booking on public.iman_additional_work_orders(booking_id,created_at desc);
create table if not exists public.iman_additional_work_notifications (
  order_id uuid not null references public.iman_additional_work_orders(id),
  revision integer not null,
  channel text not null check(channel in ('email','sms')),
  snapshot jsonb not null,
  status text not null default 'pending' check(status in ('pending','sending','sent','failed','uncertain','skipped','not_configured')),
  attempted_at timestamptz,
  sent_at timestamptz,
  provider_id text,
  error text,
  primary key(order_id,revision,channel)
);
alter table public.iman_additional_work_orders enable row level security;
alter table public.iman_additional_work_notifications enable row level security;
revoke all on public.iman_additional_work_orders, public.iman_additional_work_notifications from public,anon,authenticated;
grant select,insert,update on public.iman_additional_work_orders, public.iman_additional_work_notifications to service_role;

create or replace function public.iman_additional_work_prepare(p_booking_id text,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare b public.bookings; o public.iman_additional_work_orders; m integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('additional-work:'||p_booking_id,0));
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or b.status<>'Completed' or not coalesce((
    b.estimate#>>'{payment,status}' in ('paid','captured','fully_paid') or b.estimate#>>'{payment,remaining,status}'='captured'
  ),false) then raise exception 'Complete and settle the original booking first.' using errcode='P0001'; end if;
  m := (p_input->>'total_minutes')::integer;
  if m is null or m<1 or m>749999 then raise exception 'Invalid additional time.'; end if;
  select * into o from public.iman_additional_work_orders where booking_id=p_booking_id order by created_at desc,id desc limit 1 for update;
  if o.id is not null and o.status not in ('paid','canceled') then
    if o.status<>'draft' or o.id::text is distinct from p_input->>'id' or o.revision is distinct from (p_input->>'revision')::integer
      then raise exception 'An additional-work request already exists. Refresh to review it.' using errcode='P0001'; end if;
    update public.iman_additional_work_orders set total_minutes=m,revision=revision+1,
      stripe_customer_id=p_input->>'stripe_customer_id',payment_method_id=p_input->>'payment_method_id',
      card_brand=p_input->>'card_brand',card_last4=p_input->>'card_last4',updated_at=now()
      where id=o.id returning * into o;
  else
    if o.id is not null and o.id::text is distinct from p_input->>'previous_id'
      then raise exception 'Review the previous additional-work request before starting another.' using errcode='P0001'; end if;
    insert into public.iman_additional_work_orders(booking_id,total_minutes,stripe_customer_id,payment_method_id,card_brand,card_last4)
      values(p_booking_id,m,p_input->>'stripe_customer_id',p_input->>'payment_method_id',p_input->>'card_brand',p_input->>'card_last4') returning * into o;
  end if;
  return to_jsonb(o);
end $$;

create or replace function public.iman_additional_work_approve(p_booking_id text,p_id uuid,p_revision integer,p_text text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.iman_additional_work_orders; b public.bookings;
begin
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or b.status<>'Completed' or not coalesce((b.estimate#>>'{payment,status}' in ('paid','captured','fully_paid') or b.estimate#>>'{payment,remaining,status}'='captured'),false)
    then raise exception 'Complete and settle the original booking first.' using errcode='P0001'; end if;
  select * into o from public.iman_additional_work_orders where id=p_id and booking_id=p_booking_id for update;
  if not found or o.revision<>p_revision then raise exception 'This offer changed. Review and approve it again.' using errcode='P0001'; end if;
  if o.approved_at is not null then return to_jsonb(o); end if;
  if o.status<>'draft' or o.payment_method_id is null or o.stripe_customer_id is null or o.card_last4 is null then raise exception 'Add a valid card before approving.' using errcode='P0001'; end if;
  update public.iman_additional_work_orders set status='approved',approved_at=now(),approval_text=p_text,updated_at=now() where id=p_id returning * into o;
  insert into public.iman_additional_work_notifications(order_id,revision,channel,snapshot)
    select o.id,o.revision,c,to_jsonb(o)||jsonb_build_object('customer_name',b.client_name,'email',b.email,'phone',b.phone)
    from unnest(array['email','sms']) c on conflict do nothing;
  return to_jsonb(o);
end $$;
revoke all on function public.iman_additional_work_prepare(text,jsonb),public.iman_additional_work_approve(text,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.iman_additional_work_prepare(text,jsonb),public.iman_additional_work_approve(text,uuid,integer,text) to service_role;
notify pgrst,'reload schema';
commit;
