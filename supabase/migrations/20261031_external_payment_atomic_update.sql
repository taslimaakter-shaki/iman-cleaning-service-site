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
