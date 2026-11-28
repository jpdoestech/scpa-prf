begin;

alter table public.staff
  add column can_override_approval boolean not null default false,
  add constraint prf_override_requires_approver_role check (
    not can_override_approval or coalesce(account_role in ('supervisor','hrd'), false)
  );

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
  enabled boolean := coalesce((profile ->> 'active')::boolean, true);
begin
  perform pg_advisory_xact_lock(hashtextextended('prf_save_staff', 0));
  if role_name is null or role_name not in ('employee', 'supervisor', 'hrd', 'other')
    or (nullif(profile->>'branch_id', '') is null and (branch_name is null or branch_name = '')) then
    raise exception 'Enter a valid role and branch.';
  end if;
  if (supervisor is null) <> (hrd is null)
    or supervisor = hrd or user_id in (supervisor, hrd) then
    raise exception 'Assign two distinct approvers who are different from the employee.';
  end if;
  if enabled and supervisor is not null and (
    not exists (select 1 from public.staff where id = supervisor and active and account_role = 'supervisor')
    or not exists (select 1 from public.staff where id = hrd and active and account_role = 'hrd')
  ) then
    raise exception 'Choose active approvers for the correct stages.';
  end if;
  if (not enabled or role_name <> 'supervisor') and (
    exists (select 1 from public.staff where supervisor_override = user_id and active)
    or exists (select 1 from public.branches where supervisor_id = user_id)
    or exists (select 1 from public.requests where supervisor_id = user_id and status in ('supervisor','hrd','returned'))
  ) then
    raise exception 'This supervisor is still assigned to staff or open requests. Reassign those first.';
  end if;
  if (not enabled or role_name <> 'hrd') and (
    exists (select 1 from public.staff where hrd_override = user_id and active)
    or exists (select 1 from public.branches where hrd_id = user_id)
    or exists (select 1 from public.requests where hrd_id = user_id and status in ('supervisor','hrd','returned'))
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
      and (r.supervisor_id = user_id or r.hrd_id = user_id)
      and public.prf_has_branch(user_id, r.branch_id) and not r.branch_id = any(assignments)
  ) then raise exception 'This branch has open requests assigned to this approver.'; end if;

  insert into public.staff (id, name, branch_id, active, supervisor_override, hrd_override, account_role, can_override_approval)
  values (user_id, btrim(profile ->> 'name'), branch_key, enabled, supervisor, hrd, role_name,
    role_name in ('supervisor','hrd') and coalesce(profile->'can_override_approval' = 'true'::jsonb, false))
  on conflict (id) do update set
    name = excluded.name, branch_id = excluded.branch_id, active = excluded.active,
    supervisor_override = excluded.supervisor_override, hrd_override = excluded.hrd_override,
    account_role = excluded.account_role,
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

create or replace function public.prf_context()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'branch', b.name, 'canOverrideApproval', s.can_override_approval,
    'canManageOptions', coalesce(s.account_role in ('supervisor', 'hrd'), false),
    'approver', coalesce(s.account_role in ('supervisor', 'hrd'), false))
  from public.staff s join public.branches b on b.id = s.branch_id
  where s.id = auth.uid() and s.active
$$;

create or replace function public.prf_decide(request_id uuid, expected_version integer, decision text, remark text default '')
returns public.requests language plpgsql security definer set search_path = '' as $$
declare
  me public.staff;
  req public.requests;
  stage_name text;
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
  if not found or not (me.id in (req.supervisor_id, req.hrd_id)) then raise exception 'Request unavailable.'; end if;
  if req.version is distinct from expected_version then raise exception 'This request changed. Refresh it before deciding.'; end if;
  if not public.prf_has_branch(me.id, req.branch_id) then raise insufficient_privilege using message = 'This request is outside your branch access.'; end if;
  if decision is null or decision not in ('approve','return','disapprove','override') then raise exception 'Select a decision.'; end if;

  previous_stage := req.status;
  if decision = 'override' then
    if not me.can_override_approval or not (
      (me.id = req.supervisor_id and me.account_role = 'supervisor' and previous_stage in ('supervisor','hrd'))
      or (me.id = req.hrd_id and me.account_role = 'hrd' and previous_stage = 'supervisor')
    ) then raise insufficient_privilege using message = 'Approval override is unavailable for this request.'; end if;
    if me.id = req.requester_id then
      raise insufficient_privilege using message = 'You cannot override approval on your own request.';
    end if;
    stage_name := me.account_role;
    next_status := 'approved';
    action_name := 'approval_override';
  else
    if not ((previous_stage = 'supervisor' and me.id = req.supervisor_id and me.account_role is not distinct from 'supervisor')
      or (previous_stage = 'hrd' and me.id = req.hrd_id and me.account_role is not distinct from 'hrd')) then
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
  if next_status = 'hrd' and not exists (select 1 from public.staff where id = req.hrd_id and active and public.prf_has_branch(id, req.branch_id)) then
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
  update public.requests set number = coalesce(approved_number, number), status = next_status, updated_at = now(), version = version + 1,
    supervisor_at = case when stage_name = 'supervisor' and decision in ('approve','override') then coalesce(supervisor_at, now()) else supervisor_at end,
    hrd_at = case when stage_name = 'hrd' and decision in ('approve','override') then now() else hrd_at end
    where id = request_id returning * into req;
  perform public.prf_record_event(req, me.name, stage_name, action_name, previous_stage, comment_text,
    case when next_status = 'hrd' then req.hrd_id else req.requester_id end);
  return req;
end
$$;

commit;
