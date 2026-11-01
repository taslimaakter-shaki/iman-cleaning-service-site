create table if not exists public.bookings (
  id text primary key,
  created_at timestamptz not null default now(),
  status text not null default 'New',
  service text not null,
  service_label text not null,
  schedule text not null,
  schedule_label text not null,
  bedrooms_label text not null,
  bathrooms_label text not null,
  sqft integer not null default 0,
  addons jsonb not null default '[]'::jsonb,
  client_name text not null,
  phone text not null,
  email text not null,
  address text not null,
  notes text not null default '',
  estimate jsonb not null default '{}'::jsonb
);

alter table public.bookings enable row level security;

drop policy if exists "No direct browser access to bookings" on public.bookings;
create policy "No direct browser access to bookings"
on public.bookings
for all
using (false)
with check (false);

create index if not exists bookings_created_at_idx
on public.bookings (created_at desc);

create index if not exists bookings_status_idx
on public.bookings (status);

create table if not exists public.cleaner_applications (
  id text primary key,
  created_at timestamptz not null default now(),
  status text not null default 'Submitted',
  full_name text not null,
  phone text not null,
  email text not null,
  city text not null,
  service_area text not null,
  experience text not null default '',
  services jsonb not null default '[]'::jsonb,
  languages text not null default '',
  has_insurance boolean not null default false,
  has_transportation boolean not null default false,
  notes text not null default ''
);

alter table public.cleaner_applications enable row level security;

drop policy if exists "No direct browser access to cleaner applications" on public.cleaner_applications;
create policy "No direct browser access to cleaner applications"
on public.cleaner_applications
for all
using (false)
with check (false);

create index if not exists cleaner_applications_created_at_idx
on public.cleaner_applications (created_at desc);

create index if not exists cleaner_applications_status_idx
on public.cleaner_applications (status);

create table if not exists public.live_chat_sessions (
  id text primary key,
  short_code text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'active',
  visitor_name text not null default '',
  visitor_contact text not null default '',
  page_url text not null default '',
  referrer text not null default '',
  last_visitor_message_at timestamptz,
  last_owner_reply_at timestamptz,
  closed_at timestamptz
);

alter table public.live_chat_sessions enable row level security;

drop policy if exists "No direct browser access to live chat sessions" on public.live_chat_sessions;
create policy "No direct browser access to live chat sessions"
on public.live_chat_sessions
for all
using (false)
with check (false);

create index if not exists live_chat_sessions_updated_at_idx
on public.live_chat_sessions (updated_at desc);

create index if not exists live_chat_sessions_status_idx
on public.live_chat_sessions (status);

create table if not exists public.live_chat_messages (
  id bigint generated always as identity primary key,
  session_id text not null references public.live_chat_sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  sender text not null check (sender in ('visitor', 'owner', 'system')),
  body text not null,
  client_message_id text not null default '',
  twilio_message_sid text not null default ''
);

alter table public.live_chat_messages enable row level security;

drop policy if exists "No direct browser access to live chat messages" on public.live_chat_messages;
create policy "No direct browser access to live chat messages"
on public.live_chat_messages
for all
using (false)
with check (false);

create index if not exists live_chat_messages_session_created_idx
on public.live_chat_messages (session_id, created_at asc);

create unique index if not exists live_chat_messages_client_message_uidx
on public.live_chat_messages (session_id, client_message_id)
where client_message_id <> '';

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

-- Send large payment snapshots in the body, never in a PostgREST URL filter.
begin;
create or replace function public.iman_update_external_payment_booking(
  p_booking_id text, p_expected_status text, p_expected_estimate jsonb,
  p_estimate jsonb, p_status text default null
) returns setof public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if jsonb_typeof(p_estimate) is distinct from 'object' then
    raise exception 'Invalid booking estimate.' using errcode = 'P0001';
  end if;
  return query update public.bookings
    set estimate = p_estimate, status = coalesce(p_status, status)
    where id = p_booking_id and status = p_expected_status
      and coalesce(estimate, '{}'::jsonb) = p_expected_estimate
    returning *;
end;
$$;
revoke all on function public.iman_update_external_payment_booking(text,text,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.iman_update_external_payment_booking(text,text,jsonb,jsonb,text) to service_role;
notify pgrst, 'reload schema';
commit;
