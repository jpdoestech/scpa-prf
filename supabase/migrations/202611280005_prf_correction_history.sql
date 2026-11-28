begin;

select pg_advisory_xact_lock(hashtextextended('prf_save_staff', 0));

alter table public.request_events add column changes jsonb;

-- An outstanding return still has its original form. Its event snapshot
-- holds the requester name as it appeared when the reviewer returned it.
with latest_return as (
  select distinct on (r.id) e.id as event_id, r.form
  from public.requests r
  join public.request_events e on e.request_id = r.id and e.action = 'returned'
  where r.status = 'returned'
  order by r.id, e.id desc
)
update public.delivery_queue q
set snapshot = q.snapshot || jsonb_build_object('returned_form', latest_return.form)
from latest_return
where q.event_id = latest_return.event_id;

create or replace function public.prf_record_event(
  req public.requests, actor text, stage_name text, action_name text,
  old_status text, comment_text text, notify_id uuid
)
returns void language plpgsql set search_path = '' as $$
declare
  event_number integer;
  notify_email text;
  return_snapshot jsonb;
  event_changes jsonb;
  delivery_snapshot jsonb;
begin
  if action_name = 'resubmitted' then
    select q.snapshot into return_snapshot
    from public.request_events e join public.delivery_queue q on q.event_id = e.id
    where e.request_id = req.id and e.action = 'returned'
    order by e.id desc limit 1;

    select jsonb_object_agg(key, jsonb_build_object('from', original.value, 'to', edited.value))
    into event_changes
    from jsonb_each_text(req.form || jsonb_build_object('requester_name', req.requester_name,
      'branch_name', req.branch_name)) edited
    full join jsonb_each_text(return_snapshot->'returned_form' || jsonb_build_object(
      'requester_name', return_snapshot->>'requester', 'branch_name', return_snapshot->>'branch')) original
      using (key)
    where return_snapshot ? 'returned_form' and coalesce(edited.value, '') <> coalesce(original.value, '');
  end if;

  insert into public.request_events
    (request_id, actor_name, stage, action, previous_status, status, note, changes)
  values (req.id, actor, stage_name, action_name, old_status, req.status, comment_text, event_changes)
  returning id into event_number;

  select u.email into notify_email from auth.users u
    join public.staff s on s.id = u.id and s.active where u.id = notify_id;
  delivery_snapshot := jsonb_build_object(
    'number', req.number, 'requester', req.requester_name, 'branch', req.branch_name,
    'position', req.form->>'position', 'headcount', req.form->>'headcount',
    'area', req.form->>'area', 'needed', req.form->>'needed',
    'requisition', req.form->>'requisition', 'assignment', req.form->>'assignment'
  );
  if action_name = 'returned' then
    delivery_snapshot := delivery_snapshot || jsonb_build_object('returned_form', req.form);
  end if;
  insert into public.delivery_queue (event_id, recipient, snapshot)
    values (event_number, notify_email, delivery_snapshot);
end
$$;

commit;
