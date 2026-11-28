begin;

create function public.prf_delete_records(
  request_ids uuid[], start_on date, end_before date,
  shown_at timestamptz, expected_count integer
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  targets uuid[];
  deleted_count integer;
begin
  if coalesce(expected_count, 0) < 1 or shown_at is null or shown_at > now() then
    raise exception 'Refresh the record list before deleting.';
  end if;
  if request_ids is not null then
    if cardinality(request_ids) <> expected_count or cardinality(request_ids) > 100
      or array_position(request_ids, null) is not null or start_on is not null or end_before is not null then
      raise exception 'Choose the records to delete again.';
    end if;
  elsif start_on is null or end_before is null or end_before <= start_on or end_before - start_on > 366 then
    raise exception 'Choose a valid day, month, or year.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('prf_save_staff', 0));
  if request_ids is not null then
    select array_agg(id) into targets from public.requests
    where id = any(request_ids) and submitted_at <= shown_at;
  else
    select array_agg(id) into targets from public.requests where submitted_at <= shown_at
      and submitted_at >= (start_on::timestamp at time zone 'Asia/Manila')
      and submitted_at < (end_before::timestamp at time zone 'Asia/Manila');
  end if;
  if coalesce(cardinality(targets), 0) <> expected_count then
    raise exception 'The matching records changed. Refresh the list and confirm again.';
  end if;

  perform q.event_id from public.delivery_queue q
    join public.request_events e on e.id = q.event_id
    where e.request_id = any(targets) for update of q;
  if exists (select 1 from public.delivery_queue q join public.request_events e on e.id = q.event_id
    where e.request_id = any(targets) and q.lease_until > now()) then
    raise exception 'Some selected records are syncing. Try again after the sync finishes.';
  end if;

  delete from public.delivery_queue q using public.request_events e
    where q.event_id = e.id and e.request_id = any(targets);
  delete from public.request_events where request_id = any(targets);
  delete from public.requests where id = any(targets);
  get diagnostics deleted_count = row_count;
  return deleted_count;
end
$$;

revoke execute on function public.prf_delete_records(uuid[],date,date,timestamptz,integer) from public, anon, authenticated;
grant execute on function public.prf_delete_records(uuid[],date,date,timestamptz,integer) to service_role;

commit;
