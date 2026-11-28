begin;

select pg_advisory_xact_lock(hashtextextended('prf_save_staff', 0));

alter table public.staff
  add column supervisor_overrides uuid[] not null default '{}',
  add column hrd_overrides uuid[] not null default '{}';
update public.staff set supervisor_overrides = array_remove(array[supervisor_override], null),
  hrd_overrides = array_remove(array[hrd_override], null);

alter table public.requests
  add column supervisor_ids uuid[] not null default '{}',
  add column hrd_ids uuid[] not null default '{}';
update public.requests set supervisor_ids = array[supervisor_id], hrd_ids = array[hrd_id];
alter table public.requests add constraint prf_request_has_approval_rosters check (
  supervisor_id = any(supervisor_ids) and hrd_id = any(hrd_ids)
  and not (requester_id = any(supervisor_ids) or requester_id = any(hrd_ids) or supervisor_ids && hrd_ids)
  and array_position(supervisor_ids, null) is null and array_position(hrd_ids, null) is null
);
create index prf_request_supervisor_roster_idx on public.requests using gin (supervisor_ids);
create index prf_request_hrd_roster_idx on public.requests using gin (hrd_ids);

alter policy request_participants on public.requests using (
  exists (select 1 from public.staff where id = (select auth.uid()) and active)
  and ((select auth.uid()) = requester_id or (
    public.prf_own_branch_access(branch_id) and exists (select 1 from public.staff s
      where s.id = (select auth.uid()) and (
        (s.account_role = 'supervisor' and supervisor_ids @> array[s.id])
        or (s.account_role = 'hrd' and hrd_ids @> array[s.id])
      ))
  ))
);

create function public.prf_eligible_approvers(branch_key text, staff_role text, requester uuid, candidates uuid[])
returns uuid[] language sql stable set search_path = '' as $$
  select array(select s.id from public.staff s where s.id = any(candidates)
    and s.active and s.account_role = staff_role and s.id <> requester
    and public.prf_has_branch(s.id, branch_key)
    order by lower(s.name), s.id)
$$;
revoke execute on function public.prf_eligible_approvers(text,text,uuid,uuid[]) from public, anon, authenticated;

create function public.prf_staff_approver_ids(assigned uuid[], legacy_id uuid)
returns uuid[] language sql immutable set search_path = '' as $$
  select coalesce(nullif(assigned, '{}'::uuid[]), array_remove(array[legacy_id], null))
$$;
revoke execute on function public.prf_staff_approver_ids(uuid[],uuid) from public, anon, authenticated;

create or replace function public.prf_save_staff(user_id uuid, profile jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  role_name text := profile ->> 'role';
  branch_name text := btrim(profile ->> 'branch');
  branch_key text;
  branch_enabled boolean;
  assignments text[];
  supervisor uuid := (profile ->> 'supervisor_id')::uuid;
  hrd uuid := (profile ->> 'hrd_id')::uuid;
  supervisors uuid[];
  hrd_approvers uuid[];
  existing public.staff;
  enabled boolean := coalesce((profile ->> 'active')::boolean, true);
begin
  perform pg_advisory_xact_lock(hashtextextended('prf_save_staff', 0));
  if role_name is null or role_name not in ('employee', 'supervisor', 'hrd', 'other')
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
        raise exception 'Assign two distinct approvers who are different from the employee.';
      end if;
      supervisors := array_remove(array[supervisor], null);
      hrd_approvers := array_remove(array[hrd], null);
    end if;
  end if;
  if user_id = any(supervisors) or user_id = any(hrd_approvers) or supervisors && hrd_approvers
    or array_position(supervisors, null) is not null or array_position(hrd_approvers, null) is not null then
    raise exception 'Assign distinct approvers who are different from the employee.';
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
    or exists (select 1 from public.requests where supervisor_ids @> array[user_id] and status in ('supervisor','hrd','returned'))
  ) then
    raise exception 'This supervisor is still assigned to staff or open requests. Reassign those first.';
  end if;
  if (not enabled or role_name <> 'hrd') and (
    exists (select 1 from public.staff where (hrd_override = user_id or hrd_overrides @> array[user_id]) and active)
    or exists (select 1 from public.branches where hrd_id = user_id)
    or exists (select 1 from public.requests where hrd_ids @> array[user_id] and status in ('supervisor','hrd','returned'))
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
    select 1 from public.requests r where r.status in ('supervisor','hrd','returned')
      and (r.supervisor_ids @> array[user_id] or r.hrd_ids @> array[user_id])
      and public.prf_has_branch(user_id, r.branch_id) and not r.branch_id = any(assignments)
  ) then raise exception 'This branch has open requests assigned to this approver.'; end if;

  insert into public.staff (id, name, branch_id, active, supervisor_override, hrd_override, account_role, can_override_approval, supervisor_overrides, hrd_overrides)
  values (user_id, btrim(profile ->> 'name'), branch_key, enabled, supervisors[1], hrd_approvers[1], role_name,
    role_name in ('supervisor','hrd') and coalesce(profile->'can_override_approval' = 'true'::jsonb, false), supervisors, hrd_approvers)
  on conflict (id) do update set
    name = excluded.name, branch_id = excluded.branch_id, active = excluded.active,
    supervisor_override = excluded.supervisor_override, hrd_override = excluded.hrd_override,
    account_role = excluded.account_role,
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
end;
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
  if not found then raise exception 'Your employee account is inactive or unavailable.'; end if;
  select * into req from public.requests where id = request_id for update;
  if not found or not (me.id = any(req.supervisor_ids) or me.id = any(req.hrd_ids)) then raise exception 'Request unavailable.'; end if;
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
    if not ((previous_stage = 'supervisor' and me.id = any(req.supervisor_ids) and me.account_role is not distinct from 'supervisor')
      or (previous_stage = 'hrd' and me.id = any(req.hrd_ids) and me.account_role is not distinct from 'hrd')) then
      raise exception 'This request is not awaiting your decision.';
    end if;
    stage_name := previous_stage;
    next_status := case decision when 'return' then 'returned' when 'disapprove' then 'disapproved'
      when 'approve' then case stage_name when 'supervisor' then 'hrd' else 'approved' end end;
    action_name := case decision when 'approve' then 'approved' when 'return' then 'returned' else 'disapproved' end;
  end if;
  if length(comment_text) > 800 or (decision <> 'approve' and comment_text !~ '[^[:space:]]') then
    raise exception 'Enter a reason of 1 to 800 characters for a return, disapproval, or approval override.';
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
    supervisor_id = case when record_supervisor then me.id else supervisor_id end,
    supervisor_name = case when record_supervisor then me.name else supervisor_name end,
    supervisor_at = case when record_supervisor then now() else supervisor_at end,
    hrd_id = case when record_hrd then me.id else hrd_id end,
    hrd_name = case when record_hrd then me.name else hrd_name end,
    hrd_at = case when record_hrd then now() else hrd_at end
    where id = request_id returning * into req;
  perform public.prf_record_event(req, me.name, stage_name, action_name, previous_stage, comment_text,
    case when next_status = 'hrd' then req.hrd_id else req.requester_id end);
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
  if exists (select 1 from public.requests where requester_id = old.id
    or supervisor_ids @> array[old.id] or hrd_ids @> array[old.id]) then
    raise foreign_key_violation using message = 'This account is linked to PRF history.';
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
