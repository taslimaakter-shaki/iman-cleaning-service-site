begin;
create or replace function public.iman_additional_work_clock(p_booking_id text,p_order_id uuid,p_action text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.iman_additional_work_orders; entries jsonb; last_entry jsonb; n integer; stamp timestamptz := clock_timestamp();
begin
  if p_action not in ('clock_in','clock_out') or p_action is null then raise exception 'Invalid clock action.'; end if;
  select * into o from public.iman_additional_work_orders where id=p_order_id and booking_id=p_booking_id for update;
  if not found then raise exception 'Additional-work order not found.'; end if;
  if o.status<>'paid' then raise exception 'Payment must succeed before starting additional work.'; end if;
  entries := coalesce(o.time_tracking->'entries','[]'::jsonb);
  n := jsonb_array_length(entries);
  last_entry := case when n>0 then entries->(n-1) else null end;
  if p_action='clock_in' then
    if last_entry->>'clockInAt' is not null and last_entry->>'clockOutAt' is null then return to_jsonb(o)||jsonb_build_object('clockTransitionApplied',false); end if;
    entries := entries || jsonb_build_array(jsonb_build_object('clockInAt',stamp));
  else
    if last_entry is null or last_entry->>'clockOutAt' is not null then return to_jsonb(o)||jsonb_build_object('clockTransitionApplied',false); end if;
    last_entry := last_entry || jsonb_build_object('clockOutAt',stamp,'seconds',greatest(0,extract(epoch from stamp-(last_entry->>'clockInAt')::timestamptz)));
    entries := jsonb_set(entries,array[(n-1)::text],last_entry);
  end if;
  update public.iman_additional_work_orders set time_tracking=jsonb_build_object('entries',entries),updated_at=stamp where id=o.id returning * into o;
  return to_jsonb(o)||jsonb_build_object('clockTransitionApplied',true);
end $$;
revoke all on function public.iman_additional_work_clock(text,uuid,text) from public,anon,authenticated;
grant execute on function public.iman_additional_work_clock(text,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
