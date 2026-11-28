-- Let the requester edit before Supervisor or HRD approval using the same version lock as decisions.
create or replace function public.prf_submit(request_id uuid, input jsonb, expected_version integer default null)
returns public.requests language plpgsql security definer set search_path = '' as $$
declare
  me public.staff;
  officer public.staff;
  routing_staff public.staff;
  selected_officer uuid;
  requires_review boolean := false;
  next_status text := 'supervisor';
  submitted_by text;
  office public.branches;
  supervisor public.staff;
  hrd public.staff;
  req public.requests;
  previous_status text;
  clean_form jsonb;
  supervisors uuid[];
  hrd_approvers uuid[];
begin
  perform pg_advisory_xact_lock(hashtextextended('prf_save_staff', 0));
  select * into me from public.staff where id = auth.uid() and active;
  if not found then raise exception 'Your PRF account is inactive or unavailable.'; end if;
  if request_id is null then raise exception 'Missing request ID.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(request_id::text, 0));
  select * into req from public.requests where id = request_id for update;
  if found then
    if req.requester_id <> me.id then raise exception 'Request unavailable.'; end if;
    if expected_version is null then return req; end if;
    if req.version is distinct from expected_version or not (
      req.status = 'returned' or
      (req.status in ('officer', 'supervisor') and req.supervisor_at is null and req.hrd_at is null)
    ) then
      raise exception 'This request has changed. Refresh it before submitting.';
    end if;
    previous_status := req.status;
  elsif expected_version is not null then raise exception 'Request unavailable.';
  end if;

  -- A cached form only sends its one date. Retain a saved end when that date is unchanged.
  if req.id is not null and not (input ? 'needed_to') and req.form ? 'needed_to'
    and input->>'needed' = req.form->>'needed' then
    input := jsonb_set(input, '{needed_to}', req.form->'needed_to');
  end if;
  -- Older forms can revise a request without sending the new assignment fields.
  if req.id is not null and jsonb_typeof(input) = 'object'
    and input->>'assignment' = req.form->>'assignment' then
    input := jsonb_build_object(
      'assignment_description', req.form->'assignment_description',
      'assignment_remarks', req.form->'assignment_remarks'
    ) || input;
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
    if me.account_role = 'coordinator' and req.id is null then raise exception 'Choose an assigned branch.'; end if;
    select * into office from public.branches where id = coalesce(req.branch_id, me.branch_id) and active;
  end if;
  if office.id is null or not public.prf_has_branch(me.id, office.id) then
    raise exception 'Choose an active branch assigned to you.';
  end if;
  submitted_by := me.name;
  routing_staff := me;
  if (me.account_role = 'coordinator' and req.id is null) or req.officer_id is not null then
    if me.account_role is distinct from 'coordinator' then raise exception 'A Coordinator account is required.'; end if;
    selected_officer := coalesce(req.officer_id, nullif(input->>'officer_id', '')::uuid);
    if req.officer_id is not null and input ? 'officer_id'
      and (input->>'officer_id')::uuid is distinct from req.officer_id then
      raise exception 'An edit must keep the same Officer/Agent.';
    end if;
    select s.* into officer from public.staff s
    where s.id = selected_officer and s.active and s.account_role = 'employee'
      and public.prf_has_branch(s.id, office.id)
      and (req.id is not null or exists (select 1 from public.prf_coordinator_officers c
        where c.coordinator_id = me.id and c.officer_id = s.id));
    if not found then raise exception 'Choose an assigned Officer/Agent for this branch.'; end if;
    routing_staff := officer;
    submitted_by := me.name || ' (' || officer.name || ')';
    requires_review := case when req.id is null then me.require_officer_approval else req.officer_approval_required end;
    if requires_review then next_status := 'officer'; end if;
  elsif input ? 'officer_id' then
    raise exception 'Only Coordinators can submit on behalf of an Officer/Agent.';
  end if;

  supervisors := public.prf_eligible_approvers(office.id, 'supervisor', me.id,
    public.prf_staff_approver_ids(routing_staff.supervisor_overrides, routing_staff.supervisor_override));
  hrd_approvers := public.prf_eligible_approvers(office.id, 'hrd', me.id,
    public.prf_staff_approver_ids(routing_staff.hrd_overrides, routing_staff.hrd_override));

  if officer.id is not null and (
    (cardinality(supervisors) = 0 and cardinality(public.prf_staff_approver_ids(officer.supervisor_overrides, officer.supervisor_override)) > 0)
    or (cardinality(hrd_approvers) = 0 and cardinality(public.prf_staff_approver_ids(officer.hrd_overrides, officer.hrd_override)) > 0)
  ) then raise exception 'The selected Officer/Agent needs eligible Supervisor and HRD approvers for this branch.'; end if;

  if officer.id is null and req.branch_id = office.id then
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
    update public.requests set form = clean_form, branch_id = office.id, branch_name = office.name, status = next_status,
      requester_name = submitted_by, officer_name = officer.name,
      officer_at = case when officer.id is not null and not requires_review then now() end,
      supervisor_id = supervisor.id, hrd_id = hrd.id, supervisor_name = supervisor.name, hrd_name = hrd.name,
      supervisor_ids = supervisors, hrd_ids = hrd_approvers, supervisor_at = null, hrd_at = null, version = version + 1, updated_at = now()
      where id = request_id returning * into req;
    perform public.prf_record_event(req, me.name, 'requester',
      case when previous_status = 'returned' then 'resubmitted' else 'edited' end, previous_status, '',
      case when requires_review then officer.id else req.supervisor_id end);
  else
    insert into public.requests (id, requester_id, requester_name, branch_id, branch_name,
      supervisor_id, hrd_id, supervisor_name, hrd_name, supervisor_ids, hrd_ids, status, form,
      officer_id, officer_name, officer_approval_required, officer_at)
    values (request_id, me.id, submitted_by, office.id, office.name,
      supervisor.id, hrd.id, supervisor.name, hrd.name, supervisors, hrd_approvers, next_status, clean_form,
      officer.id, officer.name, requires_review, case when officer.id is not null and not requires_review then now() end)
    returning * into req;
    perform public.prf_record_event(req, me.name, 'requester', 'submitted', null, '',
      case when requires_review then officer.id else req.supervisor_id end);
  end if;
  if officer.id is not null and not requires_review then
    perform public.prf_record_event(req, 'System', 'officer', 'auto_approved', null, '', null);
  end if;
  return req;
end
$$;
