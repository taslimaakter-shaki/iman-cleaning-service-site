begin;
alter table public.iman_additional_work_orders
  add column if not exists completed_at timestamptz,
  add column if not exists completion_invoice_status text not null default 'not_sent'
    check (completion_invoice_status in ('not_sent','sending','sent','failed','skipped')),
  add column if not exists completion_invoice_attempted_at timestamptz,
  add column if not exists completion_invoice_sent_at timestamptz,
  add column if not exists completion_invoice_provider_id text,
  add column if not exists completion_invoice_error text;

create or replace function public.iman_additional_work_complete(p_booking_id text,p_order_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.iman_additional_work_orders; entries jsonb; last_entry jsonb; n integer; applied boolean := false;
begin
  select * into o from public.iman_additional_work_orders where id=p_order_id and booking_id=p_booking_id for update;
  if not found then raise exception 'Additional-work order not found.'; end if;
  if o.status<>'paid' then raise exception 'Additional work must be paid before completion.'; end if;
  entries := coalesce(o.time_tracking->'entries','[]'::jsonb);
  n := jsonb_array_length(entries);
  last_entry := case when n>0 then entries->(n-1) else null end;
  if last_entry is null or last_entry->>'clockOutAt' is null then raise exception 'Clock out additional work before marking it completed.'; end if;
  if o.completion_invoice_status='sent' then return to_jsonb(o)||jsonb_build_object('completionTransitionApplied',false); end if;
  if o.completion_invoice_status='sending' and o.completion_invoice_attempted_at > now()-interval '5 minutes'
    then return to_jsonb(o)||jsonb_build_object('completionTransitionApplied',false); end if;
  update public.iman_additional_work_orders set completed_at=coalesce(completed_at,now()),completion_invoice_status='sending',
    completion_invoice_attempted_at=now(),completion_invoice_error=null,updated_at=now()
    where id=o.id returning * into o;
  applied := true;
  return to_jsonb(o)||jsonb_build_object('completionTransitionApplied',applied);
end $$;
revoke all on function public.iman_additional_work_complete(text,uuid) from public,anon,authenticated;
grant execute on function public.iman_additional_work_complete(text,uuid) to service_role;
notify pgrst,'reload schema';
commit;
