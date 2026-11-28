begin;

create or replace function public.prf_validate_form(input jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  limits jsonb := '{"position":100,"needed":10,"needed_to":10,"area":100,"headcount":4,"service":20,"service_other":120,"assignment":20,"requisition":20,"reason":500,"schedule":120,"salary":36,"allowance":40,"qualifications":650}';
  field text;
  value text;
  normalized jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(input) is distinct from 'object' then
    raise exception 'Enter the request details.';
  end if;
  for field in select jsonb_object_keys(limits) loop
    if coalesce(jsonb_typeof(input->field), 'string') not in ('string', 'null') then
      raise exception 'Invalid value for %.', field;
    end if;
    value := btrim(coalesce(input->>field, ''));
    if char_length(value) > (limits->>field)::integer then
      raise exception 'The % field is too long.', field;
    end if;
    normalized := normalized || jsonb_build_object(field, value);
  end loop;
  if normalized->>'position' = '' or normalized->>'area' = '' or normalized->>'schedule' = '' then
    raise exception 'Enter the position, assigned area, and work schedule.';
  end if;
  if normalized->>'needed' !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Enter a valid date needed.';
  end if;
  if not (input ? 'needed_to') then
    normalized := jsonb_set(normalized, '{needed_to}', normalized->'needed');
  end if;
  if normalized->>'needed_to' !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Enter a valid end date for Date needed.';
  end if;
  if (normalized->>'needed_to')::date < (normalized->>'needed')::date then
    raise exception 'The Date needed end must be on or after the start.';
  end if;
  if normalized->>'headcount' !~ '^[1-9][0-9]{0,3}$' then
    raise exception 'Enter a headcount from 1 to 9999.';
  end if;
  if normalized->>'service' not in ('continuous','year','six_months','three_months','other')
    or normalized->>'assignment' not in ('full_time','part_time','on_call')
    or normalized->>'requisition' not in ('new','replacement','additional','other') then
    raise exception 'Choose a service time frame, work assignment, and requisition type.';
  end if;
  if normalized->>'service' = 'other' and normalized->>'service_other' = '' then
    raise exception 'Describe the service time frame.';
  end if;
  if normalized->>'requisition' <> 'new' and normalized->>'reason' = '' then
    raise exception 'Enter the details for this requisition type.';
  end if;
  if normalized->>'service' <> 'other' then
    normalized := normalized || '{"service_other":""}'::jsonb;
  end if;
  if normalized->>'requisition' = 'new' then
    normalized := normalized || '{"reason":""}'::jsonb;
  end if;
  return normalized;
end
$$;

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

    if return_snapshot ? 'returned_form' and not (return_snapshot->'returned_form' ? 'needed_to') then
      return_snapshot := jsonb_set(return_snapshot, '{returned_form,needed_to}',
        return_snapshot #> '{returned_form,needed}');
    end if;
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
    'area', req.form->>'area', 'needed', req.form->>'needed', 'needed_to', req.form->>'needed_to',
    'requisition', req.form->>'requisition', 'assignment', req.form->>'assignment'
  );
  if action_name = 'returned' then
    delivery_snapshot := delivery_snapshot || jsonb_build_object('returned_form', req.form);
  end if;
  insert into public.delivery_queue (event_id, recipient, snapshot)
    values (event_number, notify_email, delivery_snapshot);
end
$$;

create or replace function public.prf_submit(request_id uuid, input jsonb, expected_version integer default null)
returns public.requests language plpgsql security definer set search_path = '' as $$
declare
  me public.staff;
  office public.branches;
  supervisor public.staff;
  hrd public.staff;
  req public.requests;
  clean_form jsonb;
  supervisors uuid[];
  hrd_approvers uuid[];
begin
  perform pg_advisory_xact_lock(hashtextextended('prf_save_staff', 0));
  select * into me from public.staff where id = auth.uid() and active;
  if not found then raise exception 'Your employee account is inactive or unavailable.'; end if;
  if request_id is null then raise exception 'Missing request ID.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(request_id::text, 0));
  select * into req from public.requests where id = request_id for update;
  if found then
    if req.requester_id <> me.id then raise exception 'Request unavailable.'; end if;
    if expected_version is null then return req; end if;
    if req.version is distinct from expected_version or req.status <> 'returned' then
      raise exception 'This request has changed. Refresh it before submitting.';
    end if;
  elsif expected_version is not null then raise exception 'Request unavailable.';
  end if;

  -- A cached form only sends its one date. Retain a saved end when that date is unchanged.
  if req.id is not null and not (input ? 'needed_to') and req.form ? 'needed_to'
    and input->>'needed' = req.form->>'needed' then
    input := jsonb_set(input, '{needed_to}', req.form->'needed_to');
  end if;
  clean_form := public.prf_validate_form(input);
  if input ? 'branch' then
    if jsonb_typeof(input->'branch') is distinct from 'string' then
      raise exception 'Choose an existing branch.';
    end if;
    select * into office from public.branches where name = input->>'branch' and active;

    if not exists (select 1 from public.prf_request_option_names
      where kind = 'position' and name_key = lower(clean_form->>'position') and active) then
      raise exception 'Choose an active position title.';
    end if;
    if not exists (select 1 from public.prf_request_option_names
      where kind = 'area' and name_key = lower(clean_form->>'area') and active) then
      raise exception 'Choose an active assigned area.';
    end if;
  else
    select * into office from public.branches where id = coalesce(req.branch_id, me.branch_id) and active;
  end if;
  if office.id is null or not public.prf_has_branch(me.id, office.id) then
    raise exception 'Choose an active branch assigned to you.';
  end if;
  supervisors := public.prf_eligible_approvers(office.id, 'supervisor', me.id,
    public.prf_staff_approver_ids(me.supervisor_overrides, me.supervisor_override));
  hrd_approvers := public.prf_eligible_approvers(office.id, 'hrd', me.id,
    public.prf_staff_approver_ids(me.hrd_overrides, me.hrd_override));

  if req.branch_id = office.id then
    if cardinality(supervisors) = 0 then
      supervisors := public.prf_eligible_approvers(office.id, 'supervisor', me.id, req.supervisor_ids);
    end if;
    if cardinality(hrd_approvers) = 0 then
      hrd_approvers := public.prf_eligible_approvers(office.id, 'hrd', me.id, req.hrd_ids);
    end if;
  end if;
  if cardinality(supervisors) = 0 then
    supervisor := public.prf_branch_approver(office.id, 'supervisor', me.id, null, office.supervisor_id);
    supervisors := array_remove(array[supervisor.id], null);
  else
    select * into supervisor from public.staff where id = supervisors[1];
  end if;
  if cardinality(hrd_approvers) = 0 then
    hrd := public.prf_branch_approver(office.id, 'hrd', me.id, null, office.hrd_id);
    hrd_approvers := array_remove(array[hrd.id], null);
  else
    select * into hrd from public.staff where id = hrd_approvers[1];
  end if;
  if supervisor.id is null or hrd.id is null then
    raise exception 'This branch needs an assigned supervisor and HRD approver. Contact the PRF administrator.';
  end if;
  if req.id is not null then
    update public.requests set form = clean_form, branch_id = office.id, branch_name = office.name, status = 'supervisor',
      supervisor_id = supervisor.id, hrd_id = hrd.id, supervisor_name = supervisor.name, hrd_name = hrd.name,
      supervisor_ids = supervisors, hrd_ids = hrd_approvers, supervisor_at = null, hrd_at = null, version = version + 1, updated_at = now()
      where id = request_id returning * into req;
    perform public.prf_record_event(req, me.name, 'requester', 'resubmitted', 'returned', '', req.supervisor_id);
    return req;
  end if;

  insert into public.requests (id, requester_id, requester_name, branch_id, branch_name,
    supervisor_id, hrd_id, supervisor_name, hrd_name, supervisor_ids, hrd_ids, status, form)
  values (request_id, me.id, me.name, office.id, office.name,
    supervisor.id, hrd.id, supervisor.name, hrd.name, supervisors, hrd_approvers, 'supervisor', clean_form)
  returning * into req;
  perform public.prf_record_event(req, me.name, 'requester', 'submitted', null, '', req.supervisor_id);
  return req;
end
$$;

commit;
