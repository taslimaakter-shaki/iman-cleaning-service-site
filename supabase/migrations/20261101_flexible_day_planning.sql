-- Install before deploying the version-4 calendar code. No customer booking,
-- payment, price or agreed arrival window is rewritten. Slots are internal plans.
begin;

-- Every booking mutation takes this row lock before it takes any booking row
-- locks. Concurrent inserts/updates/deletes therefore replan serially; a failed
-- plan rolls the entire mutation back, including its reservation.
create table if not exists public.booking_calendar_mutex (
  id integer primary key check (id = 1), revision bigint not null default 0
);
insert into public.booking_calendar_mutex(id) values (1) on conflict do nothing;
alter table public.booking_calendar_mutex enable row level security;
revoke all on public.booking_calendar_mutex from public, anon, authenticated;

create or replace function public.iman_lock_booking_day_plan()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.booking_calendar_mutex set revision = revision + 1 where id = 1;
  return null;
end;
$$;

-- Try every feasible order. For a chosen order, starting each job as early as
-- allowed is sufficient. The final job needs its buffer but no outbound travel.
create or replace function public.iman_find_day_plan(jobs jsonb, cursor_at timestamptz)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare job jsonb; rest jsonb; tail jsonb; begins timestamptz; finishes timestamptz;
begin
  if jsonb_array_length(jobs) = 0 then return '[]'::jsonb; end if;
  for job in select value from jsonb_array_elements(jobs) order by (value->>'latest')::timestamptz, value->>'id' loop
    begins := greatest(cursor_at, (job->>'earliest')::timestamptz);
    if begins > (job->>'latest')::timestamptz then continue; end if;
    finishes := begins + (job->>'hours')::numeric * interval '1 hour';
    select coalesce(jsonb_agg(value), '[]'::jsonb) into rest
      from jsonb_array_elements(jobs) where value->>'id' <> job->>'id';
    tail := public.iman_find_day_plan(rest, finishes + interval '2 hours');
    if tail is not null then
      return jsonb_build_array(job || jsonb_build_object('start', begins, 'finish', finishes)) || tail;
    end if;
  end loop;
  return null;
end;
$$;

create or replace function public.iman_rebuild_day_plans()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare day_record record; b public.bookings; jobs jsonb; plan jsonb; job jsonb;
  period tstzrange; opens timestamptz; closes timestamptz; earliest timestamptz;
  latest timestamptz; hours numeric; expiry timestamptz; pref jsonb; movable boolean;
begin
  delete from public.booking_calendar_slots;
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

create or replace function public.iman_sync_day_plans()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.iman_rebuild_day_plans();
  return null;
end;
$$;

lock table public.bookings in share row exclusive mode;
drop trigger if exists iman_booking_calendar_guard on public.bookings;
create trigger iman_booking_calendar_lock before insert or update or delete on public.bookings
  for each statement execute function public.iman_lock_booking_day_plan();
create trigger iman_booking_calendar_guard after insert or update or delete on public.bookings
  for each statement execute function public.iman_sync_day_plans();
select public.iman_rebuild_day_plans();

create or replace function public.iman_booking_calendar_version()
returns integer language sql stable security definer set search_path = public, pg_temp as $$ select 4; $$;
revoke all on function public.iman_lock_booking_day_plan() from public, anon, authenticated;
revoke all on function public.iman_find_day_plan(jsonb,timestamptz) from public, anon, authenticated;
revoke all on function public.iman_rebuild_day_plans() from public, anon, authenticated;
revoke all on function public.iman_sync_day_plans() from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
