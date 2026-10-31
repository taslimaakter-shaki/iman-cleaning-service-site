-- Protect manual payment history and prevent one bank reference paying two quotes.
begin;
create table if not exists public.iman_external_payment_references (
  reference_key text primary key,
  booking_id text not null references public.bookings(id) on delete restrict deferrable initially deferred,
  operation_id text not null,
  payment jsonb not null,
  recorded_at timestamptz not null default now(),
  unique (booking_id, operation_id)
);
alter table public.iman_external_payment_references enable row level security;
revoke all on public.iman_external_payment_references from public, anon, authenticated;

create or replace function public.iman_guard_external_payment_history()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  entries jsonb := coalesce(new.estimate #> '{payment,externalPayments}', '[]'::jsonb);
  prior jsonb; item jsonb; next_item jsonb; channel text; prior_status text; next_status text; existing public.iman_external_payment_references;
begin
  if jsonb_typeof(entries) <> 'array' or jsonb_array_length(entries) > 100 then
    raise exception 'Invalid external payment history.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    for prior in select value from jsonb_array_elements(coalesce(old.estimate #> '{payment,externalPayments}', '[]'::jsonb)) loop
      if not exists (select 1 from jsonb_array_elements(entries) e where e - 'delivery' = prior - 'delivery') then
        raise exception 'Recorded payment history cannot be overwritten. Refresh the booking.' using errcode = 'P0001';
      end if;
      select e into next_item from jsonb_array_elements(entries) e where e->>'operationId' = prior->>'operationId';
      foreach channel in array array['email','sms'] loop
        prior_status := prior #>> array['delivery',channel,'status'];
        next_status := next_item #>> array['delivery',channel,'status'];
        if (prior_status in ('sent','needs_review','failed','skipped') and next_status is distinct from prior_status)
          or (prior_status = 'sending' and coalesce(next_status,'pending') = 'pending') then
          raise exception 'Payment notification history changed. Refresh before continuing.' using errcode = 'P0001';
        end if;
      end loop;
    end loop;
  end if;
  if jsonb_array_length(entries) <> (select count(distinct e->>'operationId') from jsonb_array_elements(entries) e) then
    raise exception 'Duplicate payment operation.' using errcode = 'P0001';
  end if;
  for item in select value from jsonb_array_elements(entries) loop
    if coalesce(length(item->>'referenceKey'),0) < 3 or coalesce(length(item->>'operationId'),0) < 16
       or coalesce((item->>'amountCents')::bigint,0) <= 0 then
      raise exception 'Invalid payment reference or amount.' using errcode = 'P0001';
    end if;
    insert into public.iman_external_payment_references(reference_key,booking_id,operation_id,payment)
      values(item->>'referenceKey',new.id,item->>'operationId',item - 'delivery') on conflict do nothing;
    select * into existing from public.iman_external_payment_references where reference_key = item->>'referenceKey';
    if existing.booking_id is distinct from new.id or existing.operation_id is distinct from item->>'operationId'
       or existing.payment is distinct from item - 'delivery' then
      raise exception 'That payment reference is already recorded. Check payment history.' using errcode = 'P0001';
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists iman_external_payment_guard on public.bookings;
create trigger iman_external_payment_guard before insert or update of estimate on public.bookings
  for each row execute function public.iman_guard_external_payment_history();
create or replace function public.iman_external_payment_version()
returns integer language sql stable security definer set search_path = public, pg_temp as $$ select 1; $$;
revoke all on function public.iman_guard_external_payment_history() from public, anon, authenticated;
revoke all on function public.iman_external_payment_version() from public, anon, authenticated;
grant execute on function public.iman_external_payment_version() to service_role;
notify pgrst, 'reload schema';
commit;
