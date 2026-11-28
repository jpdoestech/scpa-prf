begin;

select pg_advisory_xact_lock(hashtextextended('prf_save_staff', 0));

-- Retain the existing employee role key for Officer/Agent accounts and cached clients.
alter table public.staff drop constraint staff_account_role_check;
alter table public.staff
  add constraint staff_account_role_check check (account_role in ('employee', 'coordinator', 'supervisor', 'hrd', 'other')),
  add column require_officer_approval boolean not null default true;

create table public.prf_coordinator_officers (
  coordinator_id uuid not null references public.staff(id) on delete cascade,
  officer_id uuid not null references public.staff(id),
  primary key (coordinator_id, officer_id),
  check (coordinator_id <> officer_id)
);
create index prf_coordinator_officer_idx on public.prf_coordinator_officers(officer_id);
alter table public.prf_coordinator_officers enable row level security;
revoke all on public.prf_coordinator_officers from public, anon, authenticated;
grant select on public.prf_coordinator_officers to service_role;

alter table public.requests drop constraint requests_status_check;
alter table public.requests
  add column officer_id uuid references public.staff(id),
  add column officer_name text,
  add column officer_approval_required boolean not null default false,
  add column officer_at timestamptz,
  add constraint requests_status_check check (status in ('officer','supervisor','hrd','returned','approved','disapproved')),
  add constraint prf_officer_request check (
    (officer_id is not null or (officer_name is null and not officer_approval_required and officer_at is null))
    and (officer_id is null or (officer_name is not null and officer_id <> requester_id
      and not (officer_id = any(supervisor_ids) or officer_id = any(hrd_ids))))
    and (status <> 'officer' or (officer_id is not null and officer_approval_required and officer_at is null))
    and (officer_id is null or status not in ('supervisor','hrd','approved') or officer_at is not null)
  );
create index prf_request_officer_idx on public.requests(officer_id, status) where officer_id is not null;

alter policy request_participants on public.requests using (
  exists (select 1 from public.staff where id = (select auth.uid()) and active)
  and ((select auth.uid()) = requester_id or (
    public.prf_own_branch_access(branch_id) and exists (select 1 from public.staff s
      where s.id = (select auth.uid()) and (
        (s.account_role = 'employee' and s.id = officer_id)
        or (s.account_role = 'supervisor' and supervisor_ids @> array[s.id])
        or (s.account_role = 'hrd' and hrd_ids @> array[s.id])
      ))
  ))
);

create or replace function public.prf_sync_requester_name()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.requests r
  set requester_name = requester.name || ' (' || officer.name || ')',
      officer_name = officer.name, version = r.version + 1, updated_at = now()
  from public.staff requester, public.staff officer
  where r.requester_id = requester.id and officer.id = r.officer_id
    and (r.requester_id = new.id or r.officer_id = new.id) and r.status <> 'approved';

  update public.requests set requester_name = new.name, version = version + 1, updated_at = now()
  where requester_id = new.id and officer_id is null and status <> 'approved'
    and requester_name is distinct from new.name;
  return new;
end
$$;

create or replace function public.prf_save_staff(user_id uuid, profile jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  role_name text := profile ->> 'role';
  branch_name text := btrim(profile ->> 'branch');
  branch_key text;
  branch_enabled boolean;
  assignments text[];
  assigned_officers uuid[];
  require_officer boolean := coalesce((profile->>'require_officer_approval')::boolean, true);
  supervisor uuid := (profile ->> 'supervisor_id')::uuid;
  hrd uuid := (profile ->> 'hrd_id')::uuid;
  supervisors uuid[];
  hrd_approvers uuid[];
  existing public.staff;
  enabled boolean := coalesce((profile ->> 'active')::boolean, true);
begin
  perform pg_advisory_xact_lock(hashtextextended('prf_save_staff', 0));
  if role_name is null or role_name not in ('employee', 'coordinator', 'supervisor', 'hrd', 'other')
    or (nullif(profile->>'branch_id', '') is null and (branch_name is null or branch_name = '')) then
    raise exception 'Enter a valid role and branch.';
  end if;
  if profile ?| array['supervisor_ids','hrd_ids'] then
    if jsonb_typeof(profile->'supervisor_ids') is distinct from 'array'
      or jsonb_typeof(profile->'hrd_ids') is distinct from 'array' then
      raise exception 'Choose an approver list for each stage.';
    end if;
    if jsonb_array_length(profile->'supervisor_ids') > 100 or jsonb_array_length(profile->'hrd_ids') > 100 then
      raise exception 'Choose up to 100 approvers per stage.';
    end if;
    supervisors := array(select distinct value::uuid from jsonb_array_elements_text(profile->'supervisor_ids') order by value::uuid);
    hrd_approvers := array(select distinct value::uuid from jsonb_array_elements_text(profile->'hrd_ids') order by value::uuid);
  else
    select * into existing from public.staff where id = user_id;
    if existing.id is not null and existing.supervisor_override is not distinct from supervisor
      and existing.hrd_override is not distinct from hrd then
      supervisors := public.prf_staff_approver_ids(existing.supervisor_overrides, supervisor);
      hrd_approvers := public.prf_staff_approver_ids(existing.hrd_overrides, hrd);
    else
      if (supervisor is null) <> (hrd is null) then
        raise exception 'Assign two distinct approvers who are different from the requester.';
      end if;
      supervisors := array_remove(array[supervisor], null);
      hrd_approvers := array_remove(array[hrd], null);
    end if;
  end if;
  if user_id = any(supervisors) or user_id = any(hrd_approvers) or supervisors && hrd_approvers
    or array_position(supervisors, null) is not null or array_position(hrd_approvers, null) is not null then
    raise exception 'Assign distinct approvers who are different from the requester.';
  end if;
  if enabled and (exists (
    select 1 from unnest(supervisors) as a(id) where not exists (
      select 1 from public.staff where id = a.id and active and account_role = 'supervisor'))
    or exists (
    select 1 from unnest(hrd_approvers) as a(id) where not exists (
      select 1 from public.staff where id = a.id and active and account_role = 'hrd'))
  ) then raise exception 'Choose active approvers for the correct stages.'; end if;
  if (not enabled or role_name <> 'supervisor') and (
    exists (select 1 from public.staff where (supervisor_override = user_id or supervisor_overrides @> array[user_id]) and active)
    or exists (select 1 from public.branches where supervisor_id = user_id)
    or exists (select 1 from public.requests where supervisor_ids @> array[user_id] and status in ('officer','supervisor','hrd','returned'))
  ) then
    raise exception 'This supervisor is still assigned to staff or open requests. Reassign those first.';
  end if;
  if (not enabled or role_name <> 'hrd') and (
    exists (select 1 from public.staff where (hrd_override = user_id or hrd_overrides @> array[user_id]) and active)
    or exists (select 1 from public.branches where hrd_id = user_id)
    or exists (select 1 from public.requests where hrd_ids @> array[user_id] and status in ('officer','supervisor','hrd','returned'))
  ) then
    raise exception 'This HRD approver is still assigned to staff or open requests. Reassign those first.';
  end if;

  select id, active into branch_key, branch_enabled from public.branches
    where case when nullif(profile->>'branch_id', '') is not null then id = profile->>'branch_id' else name = branch_name end;
  if not found then raise exception 'Choose an existing branch.'; end if;
  if profile ? 'branch_ids' then
    if jsonb_typeof(profile->'branch_ids') is distinct from 'array' then raise exception 'Choose branches.'; end if;
    assignments := array(select distinct value from jsonb_array_elements_text(profile->'branch_ids'));
    if not coalesce(branch_key = any(assignments), false) or exists (
      select 1 from unnest(assignments) as a(id) left join public.branches b on b.id = a.id
      where b.id is null or (not b.active and not public.prf_has_branch(user_id, b.id))
    ) then raise exception 'Choose active branches.'; end if;
  else
    if not branch_enabled and not public.prf_has_branch(user_id, branch_key) then raise exception 'Choose an active branch.'; end if;
    assignments := array(select branch_id from public.staff_extra_branches where staff_id = user_id union select branch_key);
  end if;
  if exists (
    select 1 from public.requests r where r.status in ('officer','supervisor','hrd','returned')
      and (r.supervisor_ids @> array[user_id] or r.hrd_ids @> array[user_id])
      and public.prf_has_branch(user_id, r.branch_id) and not r.branch_id = any(assignments)
  ) then raise exception 'This branch has open requests assigned to this approver.'; end if;

  if role_name = 'coordinator' then
    if jsonb_typeof(profile->'officer_ids') is distinct from 'array'
      or jsonb_array_length(profile->'officer_ids') not between 1 and 100 then
      raise exception 'Assign one or more Officer/Agent accounts.';
    end if;
    assigned_officers := array(select distinct value::uuid from jsonb_array_elements_text(profile->'officer_ids'));
    if exists (
      select 1 from unnest(assigned_officers) a(id)
      where not exists (select 1 from public.staff s where s.id = a.id and s.id <> user_id
        and s.active and s.account_role = 'employee'
        and exists (select 1 from public.staff_branch_memberships m join public.branches b on b.id = m.branch_id
          where m.staff_id = s.id and m.branch_id = any(assignments) and b.active))
    ) then raise exception 'Choose active Officer/Agent accounts with at least one shared branch.'; end if;
  elsif exists (select 1 from public.requests where requester_id = user_id and officer_id is not null
    and status in ('officer','supervisor','hrd','returned')) then
    raise exception 'This Coordinator has open requests submitted on behalf of an Officer/Agent.';
  end if;
  if (not enabled or role_name <> 'employee') and (
    exists (select 1 from public.prf_coordinator_officers where officer_id = user_id)
    or exists (select 1 from public.requests where officer_id = user_id and status in ('officer','supervisor','hrd','returned'))
  ) then raise exception 'This Officer/Agent is assigned to a Coordinator or an open request.'; end if;
  if exists (select 1 from public.requests where officer_id = user_id
    and status in ('officer','supervisor','hrd','returned') and not branch_id = any(assignments))
  then raise exception 'Keep branches with open requests assigned to this Officer/Agent.'; end if;

  insert into public.staff (id, name, branch_id, active, supervisor_override, hrd_override, account_role, can_override_approval, supervisor_overrides, hrd_overrides, require_officer_approval)
  values (user_id, btrim(profile ->> 'name'), branch_key, enabled, supervisors[1], hrd_approvers[1], role_name,
    role_name in ('supervisor','hrd') and coalesce(profile->'can_override_approval' = 'true'::jsonb, false), supervisors, hrd_approvers, require_officer)
  on conflict (id) do update set
    name = excluded.name, branch_id = excluded.branch_id, active = excluded.active,
    supervisor_override = excluded.supervisor_override, hrd_override = excluded.hrd_override,
    account_role = excluded.account_role, require_officer_approval = excluded.require_officer_approval,
    supervisor_overrides = excluded.supervisor_overrides, hrd_overrides = excluded.hrd_overrides,
    can_override_approval = case
      when excluded.account_role not in ('supervisor','hrd') then false
      when profile ? 'can_override_approval' or public.staff.account_role is distinct from excluded.account_role
        then excluded.can_override_approval
      else public.staff.can_override_approval
    end;
  delete from public.staff_extra_branches where staff_id = user_id;
  insert into public.staff_extra_branches (staff_id, branch_id)
    select user_id, id from unnest(assignments) as b(id) where id <> branch_key;

  delete from public.prf_coordinator_officers where coordinator_id = user_id;
  if role_name = 'coordinator' then
    insert into public.prf_coordinator_officers(coordinator_id, officer_id)
    select user_id, id from unnest(assigned_officers) a(id);
  end if;
end;
$$;

create or replace function public.prf_save_employee_branches(employee_id uuid, branch_ids text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  scope text[];
  assignments text[];
  primary_branch text;
begin
  perform pg_advisory_xact_lock(hashtextextended('prf_save_staff', 0));
  scope := array(select public.prf_manager_branches());
  if cardinality(scope) = 0 or not exists (
    select 1 from public.staff s join auth.users u on u.id = s.id
    join public.staff_branch_memberships m on m.staff_id = s.id
    where s.id = employee_id and s.account_role = 'employee' and m.branch_id = any(scope)
      and u.raw_app_meta_data->'prf_super_admin' is distinct from 'true'::jsonb
  ) then raise insufficient_privilege using message = 'This Officer/Agent is outside your branch access.'; end if;
  if branch_ids is null or exists (select 1 from unnest(branch_ids) as b(id) where id is null or not id = any(scope)) then
    raise insufficient_privilege using message = 'Choose branches within your own access.';
  end if;

  assignments := array(
    select m.branch_id from public.staff_branch_memberships m where m.staff_id = employee_id and not m.branch_id = any(scope)
    union select unnest(branch_ids)
  );
  if cardinality(assignments) = 0 then raise exception 'Keep at least one branch assigned to the Officer/Agent.'; end if;
  if exists (select 1 from public.requests where officer_id = employee_id
    and status in ('officer','supervisor','hrd','returned') and not branch_id = any(assignments))
  then raise exception 'Keep branches with open requests assigned to this Officer/Agent.'; end if;
  select s.branch_id into primary_branch from public.staff s where s.id = employee_id;
  if not primary_branch = any(assignments) then
    -- Prefer an active branch as the new request default.
    select id into primary_branch from public.branches where id = any(assignments) order by active desc, name, id limit 1;
    update public.staff set branch_id = primary_branch where id = employee_id;
  end if;
  delete from public.staff_extra_branches m where m.staff_id = employee_id;
  insert into public.staff_extra_branches (staff_id, branch_id)
  select employee_id, id from unnest(assignments) as b(id) where id <> primary_branch;
end
$$;

create or replace function public.prf_context()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'branch', b.name, 'role', s.account_role, 'canOverrideApproval', s.can_override_approval,
    'canManageOptions', coalesce(s.account_role in ('supervisor', 'hrd'), false),
    'approver', coalesce(s.account_role in ('supervisor', 'hrd'), false)
      or (s.account_role = 'employee' and (
        exists (select 1 from public.prf_coordinator_officers c where c.officer_id = s.id)
        or exists (select 1 from public.requests r where r.officer_id = s.id)
      )))
  from public.staff s join public.branches b on b.id = s.branch_id
  where s.id = auth.uid() and s.active
$$;

create or replace function public.prf_request_options()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.prf_can_manage_request_options() then
    raise insufficient_privilege using message = 'An active PRF profile is required.';
  end if;
  return jsonb_build_object(
    'branch', (select coalesce(jsonb_agg(name order by lower(name), name), '[]') from public.branches where active and public.prf_has_branch(auth.uid(), id)),
    'officers', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'branches', shared.names)
      order by lower(s.name), s.id), '[]')
      from public.prf_coordinator_officers c join public.staff s on s.id = c.officer_id
      cross join lateral (select array_agg(b.name order by b.name) as names from public.branches b
        where b.active and public.prf_has_branch(s.id, b.id) and public.prf_has_branch(auth.uid(), b.id)) shared
      where c.coordinator_id = auth.uid() and s.active and s.account_role = 'employee' and shared.names is not null),
    'position', (select coalesce(jsonb_agg(name order by name_key), '[]') from public.prf_request_option_names where kind = 'position' and active),
    'area', (select coalesce(jsonb_agg(name order by name_key), '[]') from public.prf_request_option_names where kind = 'area' and active)
  );
end
$$;

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
      raise exception 'A correction must keep the same Officer/Agent.';
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
    perform public.prf_record_event(req, me.name, 'requester', 'resubmitted', 'returned', '',
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

create or replace function public.prf_decide(request_id uuid, expected_version integer, decision text, remark text default '')
returns public.requests language plpgsql security definer set search_path = '' as $$
declare
  me public.staff;
  req public.requests;
  stage_name text;
  record_supervisor boolean;
  record_hrd boolean;
  previous_stage text;
  next_status text;
  action_name text;
  serial text;
  approved_number text;
  comment_text text := btrim(coalesce(remark, ''));
begin
  perform pg_advisory_xact_lock(hashtextextended('prf_save_staff', 0));
  select * into me from public.staff where id = auth.uid() and active;
  if not found then raise exception 'Your PRF account is inactive or unavailable.'; end if;
  select * into req from public.requests where id = request_id for update;
  if not found or not (me.id = any(req.supervisor_ids) or me.id = any(req.hrd_ids) or me.id is not distinct from req.officer_id) then raise exception 'Request unavailable.'; end if;
  if req.version is distinct from expected_version then raise exception 'This request changed. Refresh it before deciding.'; end if;
  if not public.prf_has_branch(me.id, req.branch_id) then raise insufficient_privilege using message = 'This request is outside your branch access.'; end if;
  if decision is null or decision not in ('approve','return','disapprove','override') then raise exception 'Select a decision.'; end if;

  previous_stage := req.status;
  if decision = 'override' then
    if not me.can_override_approval or not (
      (me.id = any(req.supervisor_ids) and me.account_role = 'supervisor' and previous_stage in ('supervisor','hrd'))
      or (me.id = any(req.hrd_ids) and me.account_role = 'hrd' and previous_stage = 'supervisor')
    ) then raise insufficient_privilege using message = 'Approval override is unavailable for this request.'; end if;
    if me.id = req.requester_id then
      raise insufficient_privilege using message = 'You cannot override approval on your own request.';
    end if;
    stage_name := me.account_role;
    next_status := 'approved';
    action_name := 'approval_override';
  else
    if not ((previous_stage = 'officer' and me.id is not distinct from req.officer_id and me.account_role = 'employee')
      or (previous_stage = 'supervisor' and me.id = any(req.supervisor_ids) and me.account_role is not distinct from 'supervisor')
      or (previous_stage = 'hrd' and me.id = any(req.hrd_ids) and me.account_role is not distinct from 'hrd')) then
      raise exception 'This request is not awaiting your decision.';
    end if;
    stage_name := previous_stage;
    next_status := case decision when 'return' then 'returned' when 'disapprove' then 'disapproved'
      when 'approve' then case stage_name when 'officer' then 'supervisor' when 'supervisor' then 'hrd' else 'approved' end end;
    action_name := case decision when 'approve' then 'approved' when 'return' then 'returned' else 'disapproved' end;
  end if;
  if length(comment_text) > 800 or (decision <> 'approve' and comment_text !~ '[^[:space:]]') then
    raise exception 'Enter a reason of 1 to 800 characters for a return, disapproval, or approval override.';
  end if;
  if next_status = 'supervisor' and cardinality(public.prf_eligible_approvers(req.branch_id, 'supervisor', req.requester_id, req.supervisor_ids)) = 0 then
    raise exception 'No assigned Supervisor is active in this branch. Contact the PRF administrator.';
  end if;
  if next_status = 'hrd' and cardinality(public.prf_eligible_approvers(req.branch_id, 'hrd', req.requester_id, req.hrd_ids)) = 0 then
    raise exception 'The assigned HRD approver is inactive. Contact HRD.';
  end if;
  if next_status = 'approved' then
    if decision <> 'override' and req.supervisor_at is null then
      raise exception 'Supervisor approval is required before final approval.';
    end if;
    if req.number is null then
      serial := nextval('public.prf_number_seq')::text;
      approved_number := 'PRF-' || to_char(now() at time zone 'Asia/Manila', 'YYYY') || '-' ||
        lpad(serial, greatest(5, length(serial)), '0');
    end if;
  end if;
  record_supervisor := stage_name = 'supervisor' and decision in ('approve','override') and req.supervisor_at is null;
  record_hrd := stage_name = 'hrd' and decision in ('approve','override');
  update public.requests set number = coalesce(approved_number, number), status = next_status, updated_at = now(), version = version + 1,
    officer_at = case when stage_name = 'officer' and decision = 'approve' then now() else officer_at end,
    supervisor_id = case when record_supervisor then me.id else supervisor_id end,
    supervisor_name = case when record_supervisor then me.name else supervisor_name end,
    supervisor_at = case when record_supervisor then now() else supervisor_at end,
    hrd_id = case when record_hrd then me.id else hrd_id end,
    hrd_name = case when record_hrd then me.name else hrd_name end,
    hrd_at = case when record_hrd then now() else hrd_at end
    where id = request_id returning * into req;
  perform public.prf_record_event(req, me.name, stage_name, action_name, previous_stage, comment_text,
    case next_status when 'supervisor' then req.supervisor_id when 'hrd' then req.hrd_id else req.requester_id end);
  return req;
end
$$;

create or replace function public.prf_delete_staff_on_auth_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('prf_save_staff', 0));
  if old.raw_app_meta_data->'prf_super_admin' = 'true'::jsonb then
    raise insufficient_privilege using message = 'A PRF super administrator cannot be deleted.';
  end if;
  if exists (select 1 from public.requests where requester_id = old.id or officer_id = old.id
    or supervisor_ids @> array[old.id] or hrd_ids @> array[old.id]) then
    raise foreign_key_violation using message = 'This account is linked to PRF history.';
  end if;

  if exists (select 1 from public.prf_coordinator_officers where officer_id = old.id) then
    raise foreign_key_violation using message = 'Reassign this Officer/Agent’s Coordinators before deleting the account.';
  end if;
  update public.branches set supervisor_id = null where supervisor_id = old.id;
  update public.branches set hrd_id = null where hrd_id = old.id;
  update public.staff set
    supervisor_overrides = array_remove(public.prf_staff_approver_ids(supervisor_overrides, supervisor_override), old.id),
    hrd_overrides = array_remove(public.prf_staff_approver_ids(hrd_overrides, hrd_override), old.id),
    supervisor_override = (array_remove(public.prf_staff_approver_ids(supervisor_overrides, supervisor_override), old.id))[1],
    hrd_override = (array_remove(public.prf_staff_approver_ids(hrd_overrides, hrd_override), old.id))[1]
    where supervisor_override = old.id or hrd_override = old.id
      or supervisor_overrides @> array[old.id] or hrd_overrides @> array[old.id];
  delete from public.staff where id = old.id;
  return old;
end
$$;

commit;
