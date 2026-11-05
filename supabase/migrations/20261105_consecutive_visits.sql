-- One paid booking owns both visits. Its existing atomic calendar guard plans
-- the two days in the same transaction, including release and cancellation.
begin;
lock table public.bookings in share row exclusive mode;
alter table public.booking_calendar_slots add column visit_number smallint not null default 1;
alter table public.booking_calendar_slots drop constraint booking_calendar_slots_pkey;
alter table public.booking_calendar_slots add primary key(booking_id,visit_number);
alter table public.bookings add constraint iman_consecutive_visits check (
  estimate->>'secondVisitSchedule' is null or (
    schedule is not null and ((estimate->>'secondVisitSchedule')::timestamptz at time zone 'America/New_York')::date =
    (schedule::timestamptz at time zone 'America/New_York')::date + 1
    and coalesce(estimate #>> '{arrivalPreference,key}', '') in ('morning','afternoon','any_day')
    and (estimate #>> '{arrivalPreference,key}' = 'any_day' or
      ((estimate->>'secondVisitSchedule')::timestamptz at time zone 'America/New_York')::time =
      (schedule::timestamptz at time zone 'America/New_York')::time)
  )
);
create function public.iman_calendar_visits() returns setof public.bookings
language sql stable set search_path = public, pg_temp as $$
  select b.* from public.bookings b
  union all
  select (jsonb_populate_record(b,jsonb_build_object('schedule',b.estimate->>'secondVisitSchedule'))).*
    from public.bookings b where b.estimate->>'secondVisitSchedule' is not null;
$$;
revoke all on function public.iman_calendar_visits() from public,anon,authenticated;
grant execute on function public.iman_calendar_visits() to service_role;
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
    from public.iman_calendar_visits() stored where public.iman_booking_busy_period(stored) is not null
      and upper(public.iman_booking_busy_period(stored)) > now()
    order by day
  loop
    opens := (day_record.day + time '08:00') at time zone 'America/New_York';
    closes := (day_record.day + time '20:30') at time zone 'America/New_York';
    jobs := '[]'::jsonb;
    for b in select * from public.iman_calendar_visits() stored
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
      insert into public.booking_calendar_slots(booking_id,visit_number,busy,legacy_expires_at)
      select job->>'id', case when ((owner.estimate->>'secondVisitSchedule')::timestamptz at time zone 'America/New_York')::date = day_record.day then 2 else 1 end, tstzrange((job->>'start')::timestamptz, (job->>'finish')::timestamptz + interval '2 hours', '[)'), (job->>'expiry')::timestamptz from public.bookings owner where owner.id=job->>'id';
    end loop;
  end loop;
end;
$$;

create or replace function public.iman_guard_anytime_after_long_booking()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare booking_day date;
begin
 if coalesce(new.estimate #>> '{arrivalPreference,key}','') <> 'any_day'
  or public.iman_booking_busy_period(new) is null then return new; end if;
 booking_day:=(new.schedule::timestamptz at time zone 'America/New_York')::date;
 -- Existing reserved/paid Anytime bookings keep their agreement. Recheck when
 -- acquiring capacity, changing date, or changing from a fixed option to Anytime.
 if tg_op='UPDATE' then
  if public.iman_booking_busy_period(old) is not null
   and old.estimate #>> '{arrivalPreference,key}' = 'any_day'
   and (old.schedule::timestamptz at time zone 'America/New_York')::date=booking_day
   and ((old.estimate->>'secondVisitSchedule')::timestamptz at time zone 'America/New_York')::date is not distinct from
       ((new.estimate->>'secondVisitSchedule')::timestamptz at time zone 'America/New_York')::date then return new; end if;
 end if;
 -- The existing BEFORE STATEMENT mutex serializes this check with every booking
 -- write, including payment acquisition, so simultaneous requests cannot bypass it.
 if exists(select 1 from public.iman_calendar_visits() b where b.id<>new.id
  and (b.schedule::timestamptz at time zone 'America/New_York')::date in (booking_day, ((new.estimate->>'secondVisitSchedule')::timestamptz at time zone 'America/New_York')::date)
  and public.iman_booking_busy_period(b) is not null
  and public.iman_booking_labor_hours(b.estimate)>=6) then
  raise exception 'Anytime is unavailable on this date because another appointment has at least six labor hours. Choose an available Morning or Afternoon time.' using errcode='23514';
 end if;
 return new;
end;
$$;
create or replace function public.iman_payment_snapshot(b public.bookings) returns jsonb language sql immutable as $$
 select jsonb_build_object('schedule',b.schedule,'total',b.estimate->'payment'->'totalCents',
 'deposit',b.estimate->'payment'->'depositCents','duration',coalesce(b.estimate->'calendarReservationHours',b.estimate->'teamHours',b.estimate->'hours'),
 'managedQuote',b.estimate->'managedQuote','savedQuoteId',b.estimate->'savedQuoteId',
 'arrivalPreference',b.estimate->'arrivalPreference','service',b.service_label,'customer',jsonb_build_array(b.client_name,b.email,b.address))
 || case when b.estimate->>'secondVisitSchedule' is null then '{}'::jsonb else jsonb_build_object('secondVisitSchedule',b.estimate->>'secondVisitSchedule') end;
$$;
create function public.iman_consecutive_visit_version() returns integer
language sql stable as $$ select 1; $$;
revoke all on function public.iman_consecutive_visit_version() from public,anon,authenticated;
grant execute on function public.iman_consecutive_visit_version() to service_role;
select public.iman_rebuild_day_plans();
notify pgrst, 'reload schema';
commit;
