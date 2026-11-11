begin;
alter table public.iman_additional_work_orders
  add column if not exists team_members integer not null default 1 check (team_members > 0),
  add column if not exists minutes_per_member integer generated always as (total_minutes / team_members) stored,
  add column if not exists time_tracking jsonb not null default '{"entries":[]}'::jsonb;
alter table public.iman_additional_work_orders add constraint additional_work_whole_minutes_per_member check (total_minutes % team_members = 0);
create or replace function public.iman_additional_work_prepare(p_booking_id text,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare b public.bookings; o public.iman_additional_work_orders; m integer; t integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('additional-work:'||p_booking_id,0));
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or b.status<>'Completed' or not coalesce((
    b.estimate#>>'{payment,status}' in ('paid','captured','fully_paid') or b.estimate#>>'{payment,remaining,status}'='captured'
  ),false) then raise exception 'Complete and settle the original booking first.' using errcode='P0001'; end if;
  m := (p_input->>'total_minutes')::integer;
  t := coalesce((p_input->>'team_members')::integer,1);
  if t<1 or m % t <> 0 then raise exception 'Invalid team size or per-person time.'; end if;
  if m is null or m<1 or m>749999 then raise exception 'Invalid additional time.'; end if;
  select * into o from public.iman_additional_work_orders where booking_id=p_booking_id order by created_at desc,id desc limit 1 for update;
  if o.id is not null and o.status not in ('paid','canceled') then
    if o.status<>'draft' or o.id::text is distinct from p_input->>'id' or o.revision is distinct from (p_input->>'revision')::integer
      then raise exception 'An additional-work request already exists. Refresh to review it.' using errcode='P0001'; end if;
    update public.iman_additional_work_orders set total_minutes=m,team_members=t,revision=revision+1,
      stripe_customer_id=p_input->>'stripe_customer_id',payment_method_id=p_input->>'payment_method_id',
      card_brand=p_input->>'card_brand',card_last4=p_input->>'card_last4',updated_at=now()
      where id=o.id returning * into o;
  else
    if o.id is not null and o.id::text is distinct from p_input->>'previous_id'
      then raise exception 'Review the previous additional-work request before starting another.' using errcode='P0001'; end if;
    insert into public.iman_additional_work_orders(booking_id,total_minutes,team_members,stripe_customer_id,payment_method_id,card_brand,card_last4)
      values(p_booking_id,m,t,p_input->>'stripe_customer_id',p_input->>'payment_method_id',p_input->>'card_brand',p_input->>'card_last4') returning * into o;
  end if;
  return to_jsonb(o);
end $$;


create or replace function public.iman_additional_work_clock(p_booking_id text,p_order_id uuid,p_action text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.iman_additional_work_orders; entries jsonb; last_entry jsonb; n integer; stamp timestamptz := clock_timestamp();
begin
  if p_action not in ('clock_in','clock_out') or p_action is null then raise exception 'Invalid clock action.'; end if;
  select * into o from public.iman_additional_work_orders where id=p_order_id and booking_id=p_booking_id for update;
  if not found then raise exception 'Additional-work order not found.'; end if;
  if o.status<>'paid' then raise exception 'Payment must succeed before starting additional work.'; end if;
  stamp := clock_timestamp();
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
