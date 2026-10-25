-- Run once in the Supabase SQL Editor. No bookings, prices or payments are deleted.
-- The transaction rolls back if existing active appointments already overlap.
begin;

create table if not exists public.booking_calendar_slots (
  booking_id text primary key references public.bookings(id) on delete cascade
    deferrable initially deferred,
  busy tstzrange not null,
  legacy_expires_at timestamptz,
  constraint booking_calendar_no_overlap exclude using gist (busy with &&)
);
alter table public.booking_calendar_slots enable row level security;
revoke all on public.booking_calendar_slots from public, anon, authenticated;

create or replace function public.iman_booking_busy_period(b public.bookings)
returns tstzrange language plpgsql stable set search_path = public, pg_temp as $$
declare
  hours numeric;
  starts timestamptz;
  reservation_state text := coalesce(b.estimate #>> '{calendarReservation,state}', '');
begin
  if b.status not in ('Confirmed', 'Cleaner assigned', 'In progress', 'Completed') then
    if b.status <> 'New' then return null; end if;
    if reservation_state in ('draft', 'released') then return null; end if;
    -- A Stripe-backed checkout is released only after Stripe confirms expiry.
    if reservation_state not in ('creating', 'open') and
       b.created_at + interval '30 minutes' <= now() then return null; end if;
  end if;
  hours := coalesce(nullif(b.estimate ->> 'teamHours', '')::numeric,
                    nullif(b.estimate ->> 'hours', '')::numeric, 2);
  if hours <= 0 or hours > 200 or hours = 'NaN'::numeric then
    raise exception 'Enter a valid appointment duration.' using errcode = '22023';
  end if;
  starts := b.schedule::timestamptz;
  if not isfinite(starts) then
    raise exception 'Enter a valid appointment start time.' using errcode = '22023';
  end if;
  -- [start, finish + 3 hours): exactly three hours between jobs is allowed.
  return tstzrange(starts, starts + hours * interval '1 hour' + interval '3 hours', '[)');
end;
$$;

create or replace function public.iman_sync_booking_calendar()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare period tstzrange; expiry timestamptz;
begin
  delete from public.booking_calendar_slots where legacy_expires_at <= now();
  period := public.iman_booking_busy_period(new);
  if period is null or upper(period) <= now() then
    delete from public.booking_calendar_slots where booking_id = new.id;
    return new;
  end if;
  if new.status = 'New' and coalesce(new.estimate #>> '{calendarReservation,state}', '') not in ('creating', 'open') then
    expiry := new.created_at + interval '30 minutes';
  end if;
  insert into public.booking_calendar_slots(booking_id, busy, legacy_expires_at)
    values (new.id, period, expiry)
    on conflict (booking_id) do update set busy = excluded.busy, legacy_expires_at = excluded.legacy_expires_at;
  return new;
exception when exclusion_violation then
  raise exception 'That appointment conflicts with another booking or its three-hour buffer. Choose another time.' using errcode = '23P01';
end;
$$;

-- Block concurrent booking writes while existing reservations are registered.
lock table public.bookings in share row exclusive mode;
insert into public.booking_calendar_slots(booking_id, busy, legacy_expires_at)
  select b.id, public.iman_booking_busy_period(b),
    case when b.status = 'New' and coalesce(b.estimate #>> '{calendarReservation,state}', '') not in ('creating', 'open')
      then b.created_at + interval '30 minutes' end
  from public.bookings b
  where public.iman_booking_busy_period(b) is not null
    and upper(public.iman_booking_busy_period(b)) > now()
  on conflict (booking_id) do nothing;

drop trigger if exists iman_booking_calendar_guard on public.bookings;
create trigger iman_booking_calendar_guard before insert or update of schedule, status, estimate
  on public.bookings for each row execute function public.iman_sync_booking_calendar();

create or replace function public.iman_booking_calendar_version()
returns integer language sql stable security definer set search_path = public, pg_temp as $$ select 1; $$;
revoke all on function public.iman_booking_busy_period(public.bookings) from public, anon, authenticated;
revoke all on function public.iman_sync_booking_calendar() from public, anon, authenticated;
revoke all on function public.iman_booking_calendar_version() from public, anon, authenticated;
grant execute on function public.iman_booking_calendar_version() to service_role;
notify pgrst, 'reload schema';
commit;

select public.iman_booking_calendar_version() as shared_calendar_version;
