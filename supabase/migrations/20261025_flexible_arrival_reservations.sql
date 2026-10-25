-- Reserve the customer-facing service duration plus the one-hour extension
-- allowance for every arrival-time option. No prices or bookings
-- are deleted. The transaction rolls back if the rebuilt calendar conflicts.
begin;

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
    if reservation_state not in ('creating', 'open') and
       b.created_at + interval '30 minutes' <= now() then return null; end if;
  end if;
  hours := coalesce(nullif(b.estimate ->> 'calendarReservationHours', '')::numeric,
                    nullif(b.estimate ->> 'teamHours', '')::numeric,
                    nullif(b.estimate ->> 'hours', '')::numeric, 2);
  if hours <= 0 or hours > 200 or hours = 'NaN'::numeric then
    raise exception 'Enter a valid appointment duration.' using errcode = '22023';
  end if;
  starts := b.schedule::timestamptz;
  if not isfinite(starts) then
    raise exception 'Enter a valid appointment start time.' using errcode = '22023';
  end if;
  return tstzrange(starts, starts + hours * interval '1 hour' + interval '3 hours', '[)');
end;
$$;

lock table public.bookings in share row exclusive mode;
delete from public.booking_calendar_slots;
insert into public.booking_calendar_slots(booking_id, busy, legacy_expires_at)
  select b.id, public.iman_booking_busy_period(b),
    case when b.status = 'New' and coalesce(b.estimate #>> '{calendarReservation,state}', '') not in ('creating', 'open')
      then b.created_at + interval '30 minutes' end
  from public.bookings b
  where public.iman_booking_busy_period(b) is not null
    and upper(public.iman_booking_busy_period(b)) > now();

create or replace function public.iman_booking_calendar_version()
returns integer language sql stable security definer set search_path = public, pg_temp as $$ select 2; $$;
revoke all on function public.iman_booking_busy_period(public.bookings) from public, anon, authenticated;
revoke all on function public.iman_booking_calendar_version() from public, anon, authenticated;
grant execute on function public.iman_booking_calendar_version() to service_role;
notify pgrst, 'reload schema';
commit;

select public.iman_booking_calendar_version() as shared_calendar_version;
