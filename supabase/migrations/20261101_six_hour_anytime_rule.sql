begin;
create or replace function public.iman_booking_labor_hours(e jsonb)
returns numeric language plpgsql immutable set search_path = public, pg_temp as $$
declare field text; value numeric; service_hours numeric; cleaners numeric;
begin
 foreach field in array array['manHours','laborHours'] loop
  if coalesce(e->>field,'') ~ '^[0-9]+([.][0-9]+)?$' then
   value:=(e->>field)::numeric;
   if value>0 then return value; end if;
  end if;
 end loop;
 foreach field in array array['teamHours','hours'] loop
  if coalesce(e->>field,'') ~ '^[0-9]+([.][0-9]+)?$' then
   value:=(e->>field)::numeric;
   if value>0 then service_hours:=value; exit; end if;
  end if;
 end loop;
 if coalesce(e->>'cleanerCount','') ~ '^[0-9]+([.][0-9]+)?$' then cleaners:=(e->>'cleanerCount')::numeric; end if;
 return coalesce(service_hours,0)*case when cleaners>0 then cleaners else 2 end;
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
   and (old.schedule::timestamptz at time zone 'America/New_York')::date=booking_day then return new; end if;
 end if;
 -- The existing BEFORE STATEMENT mutex serializes this check with every booking
 -- write, including payment acquisition, so simultaneous requests cannot bypass it.
 if exists(select 1 from public.bookings b where b.id<>new.id
  and (b.schedule::timestamptz at time zone 'America/New_York')::date=booking_day
  and public.iman_booking_busy_period(b) is not null
  and public.iman_booking_labor_hours(b.estimate)>=6) then
  raise exception 'Anytime is unavailable on this date because another appointment has at least six labor hours. Choose an available Morning or Afternoon time.' using errcode='23514';
 end if;
 return new;
end;
$$;
drop trigger if exists iman_guard_anytime_after_long_booking on public.bookings;
create trigger iman_guard_anytime_after_long_booking before insert or update on public.bookings
 for each row execute function public.iman_guard_anytime_after_long_booking();
revoke all on function public.iman_booking_labor_hours(jsonb) from public,anon,authenticated;
grant execute on function public.iman_booking_labor_hours(jsonb) to service_role;
revoke all on function public.iman_guard_anytime_after_long_booking() from public,anon,authenticated;
commit;
