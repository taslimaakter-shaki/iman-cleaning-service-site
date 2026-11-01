begin;
create table if not exists public.booking_payment_orders (
 id uuid primary key, booking_id text not null references public.bookings(id),
 draft jsonb not null, snapshot jsonb not null,
 state text not null default 'draft', attempt uuid, confirmation_token text,
 intent_id text, customer_id text, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), started_at timestamptz
);
alter table public.booking_payment_orders enable row level security;
revoke all on public.booking_payment_orders from public, anon, authenticated;
grant all on public.booking_payment_orders to service_role;
create or replace function public.iman_payment_snapshot(b public.bookings) returns jsonb language sql immutable as $$
 select jsonb_build_object('schedule',b.schedule,'total',b.estimate->'payment'->'totalCents',
 'deposit',b.estimate->'payment'->'depositCents','duration',coalesce(b.estimate->'calendarReservationHours',b.estimate->'teamHours',b.estimate->'hours'),
 'managedQuote',b.estimate->'managedQuote','savedQuoteId',b.estimate->'savedQuoteId',
 'arrivalPreference',b.estimate->'arrivalPreference','service',b.service_label,'customer',jsonb_build_array(b.client_name,b.email,b.address));
$$;
create or replace function public.iman_payment_order(p_action text, p_id uuid, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.booking_payment_orders; b public.bookings; held jsonb; attempt_id uuid;
begin
 -- Same lock order as every booking write. Capacity and payment ownership commit together.
 update public.booking_calendar_mutex set revision=revision+1 where id=1;
 if p_action='prepare' then
  select * into b from public.bookings where id=p_data->>'bookingId' for update;
  if not found or b.status <> 'New' then raise exception 'This booking is no longer awaiting payment.'; end if;
  held:=b.estimate->'calendarReservation';
  if coalesce(held->>'state','') not in ('draft','released','') then raise exception 'A payment is already in progress. Reopen your payment page.'; end if;
  if coalesce(held->>'state','')='' then update public.bookings set estimate=jsonb_set(estimate,'{calendarReservation}','{"state":"draft"}'::jsonb) where id=b.id; end if;
  insert into public.booking_payment_orders(id,booking_id,draft,snapshot) values(p_id,b.id,p_data->'draft',public.iman_payment_snapshot(b)) returning * into o;
  return to_jsonb(o);
 end if;
 select * into o from public.booking_payment_orders where id=p_id for update;
 if not found then raise exception 'Payment link was not found.'; end if;
 select * into b from public.bookings where id=o.booking_id for update;
 if p_action='acquire' then
  if o.state='paid' then return to_jsonb(o); end if;
  if b.status <> 'New' then raise exception 'This booking is no longer awaiting payment.'; end if;
  if public.iman_payment_snapshot(b) <> o.snapshot then raise exception 'This quote changed. Reopen your booking link.'; end if;
  if o.created_at < now()-interval '24 hours' then raise exception 'This payment link expired. Reopen your booking link.'; end if;
  if o.state in ('creating','ready','processing','requires_action') then return to_jsonb(o)||'{"acquired":false}'::jsonb; end if;
  held:=b.estimate->'calendarReservation';
  if coalesce(held->>'state','') not in ('draft','released','') then raise exception 'A payment is already in progress for this booking.'; end if;
  if coalesce(b.estimate->>'savedQuoteId','') <> '' and exists(
   select 1 from public.bookings other where other.id<>b.id and other.estimate->>'savedQuoteId'=b.estimate->>'savedQuoteId'
    and (other.status in ('Confirmed','Cleaner assigned','In progress','Completed') or (other.status='New' and other.estimate->'calendarReservation'->>'state' in ('creating','open')))
  ) then raise exception 'A payment is already in progress or received for this quote.'; end if;
  attempt_id:=(p_data->>'attempt')::uuid;
  -- The existing daily planner trigger rejects an over-capacity UPDATE atomically.
  update public.bookings set estimate=jsonb_set(estimate,'{calendarReservation}',jsonb_build_object('state','creating','attempt',attempt_id,'paymentOrderId',o.id,'startedAt',now())) where id=b.id;
  update public.booking_payment_orders set state='creating',attempt=attempt_id,confirmation_token=p_data->>'confirmationToken',intent_id=null,started_at=now(),updated_at=now() where id=o.id returning * into o;
  return to_jsonb(o)||'{"acquired":true}'::jsonb;
 elsif p_action='attach' then
  if o.attempt::text <> p_data->>'attempt' or o.state not in ('creating','ready') or b.status<>'New'
   or b.estimate->'calendarReservation'->>'attempt' <> o.attempt::text then raise exception 'Payment attempt changed.'; end if;
  if o.intent_id is not null and o.intent_id <> p_data->>'intentId' then raise exception 'Payment attempt already has an intent.'; end if;
  update public.booking_payment_orders set intent_id=p_data->>'intentId',customer_id=p_data->>'customerId',state='ready',updated_at=now() where id=o.id returning * into o;
 elsif p_action='record' then
  if o.attempt::text <> p_data->>'attempt' or o.intent_id is distinct from p_data->>'intentId' then return to_jsonb(o); end if;
  if o.state='paid' then return to_jsonb(o); end if;
  if p_data->>'status'='succeeded' then
   if b.estimate->'calendarReservation'->>'attempt' <> o.attempt::text then raise exception 'Paid reservation needs review.'; end if;
   update public.bookings set status=case when status='New' then 'Confirmed' else status end where id=b.id;
   update public.booking_payment_orders set state='paid',confirmation_token=null,updated_at=now() where id=o.id returning * into o;
  elsif p_data->>'status'='canceled' then
   update public.bookings set estimate=jsonb_set(estimate,'{calendarReservation}',(estimate->'calendarReservation')||jsonb_build_object('state','released','releasedAt',now()))
    where id=b.id and status='New' and estimate->'calendarReservation'->>'attempt'=o.attempt::text;
   update public.booking_payment_orders set state='cancelled',confirmation_token=null,updated_at=now() where id=o.id returning * into o;
  elsif p_data->>'status' in ('processing','requires_action') then
   update public.booking_payment_orders set state=p_data->>'status',updated_at=now() where id=o.id and state not in ('cancelled','paid') returning * into o;
  end if;
 elsif p_action='cancel_unattached' then
  if o.intent_id is null and o.attempt::text=p_data->>'attempt' and o.state='creating' then
   update public.bookings set estimate=jsonb_set(estimate,'{calendarReservation}',(estimate->'calendarReservation')||'{"state":"released"}'::jsonb)
    where id=b.id and status='New' and estimate->'calendarReservation'->>'attempt'=o.attempt::text;
   update public.booking_payment_orders set state='cancelled',confirmation_token=null,updated_at=now() where id=o.id returning * into o;
  end if;
 else raise exception 'Unsupported payment action.';
 end if;
 return to_jsonb(o);
end;
$$;
revoke all on function public.iman_payment_order(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.iman_payment_order(text,uuid,jsonb) to service_role;
revoke all on function public.iman_payment_snapshot(public.bookings) from public,anon,authenticated;
grant execute on function public.iman_payment_snapshot(public.bookings) to service_role;
commit;
