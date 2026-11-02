-- Keep the daily planner compatible with production safe-update enforcement.
-- Replace only the function; do not modify customer bookings or payments.
begin;
create or replace function public.iman_rebuild_day_plans()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare day_record record; b public.bookings; jobs jsonb; plan jsonb; job jsonb;
  period tstzrange; opens timestamptz; closes timestamptz; earliest timestamptz;
  latest timestamptz; hours numeric; expiry timestamptz; pref jsonb; movable boolean;
begin
  -- Every row is derived calendar data; booking_id is its non-null primary key.
  delete from public.booking_calendar_slots where booking_id is not null;
  for day_record in
    select distinct (schedule::timestamptz at time zone 'America/New_York')::date as day
    from public.bookings stored where public.iman_booking_busy_period(stored) is not null
      and upper(public.iman_booking_busy_period(stored)) > now()
    order by day
  loop
    opens := (day_record.day + time '08:00') at time zone 'America/New_York';
    closes := (day_record.day + time '20:30') at time zone 'America/New_York';
    jobs := '[]'::jsonb;
    for b in select * from public.bookings stored
      where (schedule::timestamptz at time zone 'America/New_York')::date = day_record.day
        and public.iman_booking_busy_period(stored) is not null
        and upper(public.iman_booking_busy_period(stored)) > now()
      order by id
    loop
      period := public.iman_booking_busy_period(b);
      hours := extract(epoch from (upper(period) - lower(period) - interval '2 hours')) / 3600;
      pref := b.estimate->'arrivalPreference';
      movable := coalesce((pref->>'flexible')::boolean, false)
        and coalesce(pref->>'confirmationStatus', '') <> 'confirmed'
        and b.status in ('New', 'Confirmed', 'Cleaner assigned') and b.schedule::timestamptz > now();
      earliest := b.schedule::timestamptz;
      latest := earliest;
      if movable then
        if coalesce(pref->>'windowStart','') !~ '^\d{2}:\d{2}$' or coalesce(pref->>'windowEnd','') !~ '^\d{2}:\d{2}$' then
          raise exception 'A flexible booking has an invalid arrival window.' using errcode = '22023';
        end if;
        earliest := greatest(opens, now(), (day_record.day + (pref->>'windowStart')::time) at time zone 'America/New_York');
        latest := least(closes - hours * interval '1 hour', (day_record.day + (pref->>'windowEnd')::time) at time zone 'America/New_York');
      elsif earliest < opens or earliest + hours * interval '1 hour' > closes then
        raise exception 'Cleaning and its reserved buffer must fit within 8 AM to 8:30 PM.' using errcode = '23P01';
      end if;
      expiry := null;
      if b.status = 'New' and coalesce(b.estimate #>> '{calendarReservation,state}', '') not in ('creating', 'open') then
        expiry := b.created_at + interval '30 minutes';
      end if;
      jobs := jobs || jsonb_build_array(jsonb_build_object('id', b.id, 'earliest', earliest, 'latest', latest, 'hours', hours, 'expiry', expiry));
    end loop;
    -- Reject impossible totals before searching order permutations.
    if (select sum((value->>'hours')::numeric) from jsonb_array_elements(jobs))
        + greatest(0, jsonb_array_length(jobs)-1)*2 > 12.5 then
      raise exception 'The day cannot fit all cleanings, reserved buffers and travel before 8:30 PM.' using errcode = '23P01';
    end if;
    plan := public.iman_find_day_plan(jobs, opens);
    if plan is null then
      raise exception 'No daily schedule fits the agreed arrival windows, reserved buffers and travel.' using errcode = '23P01';
    end if;
    for job in select value from jsonb_array_elements(plan) loop
      insert into public.booking_calendar_slots(booking_id,busy,legacy_expires_at)
      values (job->>'id', tstzrange((job->>'start')::timestamptz, (job->>'finish')::timestamptz + interval '2 hours', '[)'), (job->>'expiry')::timestamptz);
    end loop;
  end loop;
end;
$$;

commit;
