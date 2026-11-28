begin;

create table public.staff_extra_branches (
  staff_id uuid not null references public.staff(id) on delete cascade,
  branch_id text not null references public.branches(id),
  primary key (staff_id, branch_id)
);
create index staff_extra_branches_branch_idx on public.staff_extra_branches(branch_id);
alter table public.staff_extra_branches enable row level security;
revoke all on public.staff_extra_branches from public, anon, authenticated;

create view public.staff_branch_memberships as
  select id as staff_id, branch_id from public.staff
  union
  select staff_id, branch_id from public.staff_extra_branches;
revoke all on public.staff_branch_memberships from public, anon, authenticated;
grant select on public.staff_branch_memberships to service_role;

-- Preserve the printed branch name as a snapshot and use the stable ID for access.
alter table public.requests add column branch_id text references public.branches(id) on delete set null;
update public.requests r set branch_id = b.id from public.branches b where b.name = r.branch_name;

create function public.prf_has_branch(staff_key uuid, branch_key text)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.staff_branch_memberships m
    where m.staff_id = staff_key and m.branch_id = branch_key)
$$;
revoke execute on function public.prf_has_branch(uuid, text) from public, anon, authenticated;

create function public.prf_own_branch_access(branch_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.prf_has_branch(auth.uid(), branch_key)
$$;
revoke execute on function public.prf_own_branch_access(text) from public, anon;
grant execute on function public.prf_own_branch_access(text) to authenticated;

alter policy request_participants on public.requests using (
  exists (select 1 from public.staff where id = (select auth.uid()) and active)
  and ((select auth.uid()) = requester_id or (
    public.prf_own_branch_access(branch_id) and exists (select 1 from public.staff s
      where s.id = (select auth.uid()) and (
        (s.account_role = 'supervisor' and s.id = supervisor_id) or (s.account_role = 'hrd' and s.id = hrd_id)
      ))
  ))
);

create function public.prf_manager_branches()
returns setof text language sql stable set search_path = '' as $$
  select m.branch_id from public.staff s join public.staff_branch_memberships m on m.staff_id = s.id
  join public.branches b on b.id = m.branch_id and b.active
  where s.id = auth.uid() and s.active and s.account_role in ('hrd','supervisor')
$$;
revoke execute on function public.prf_manager_branches() from public, anon, authenticated;

create function public.prf_employee_directory()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  scope text[] := array(select public.prf_manager_branches());
begin
  if cardinality(scope) = 0 then raise insufficient_privilege using message = 'An active branch assignment is required.'; end if;
  return jsonb_build_object(
    'branches', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.name), '[]')
      from public.branches b where b.id = any(scope)),
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name,
      'branch_ids', array(select m.branch_id from public.staff_branch_memberships m
        where m.staff_id = s.id and m.branch_id = any(scope) order by m.branch_id)) order by s.name, s.id), '[]')
      from public.staff s join auth.users u on u.id = s.id
      where s.account_role = 'employee' and u.raw_app_meta_data->'prf_super_admin' is distinct from 'true'::jsonb
        and exists (select 1 from public.staff_branch_memberships m where m.staff_id = s.id and m.branch_id = any(scope)))
  );
end
$$;

create function public.prf_save_employee_branches(employee_id uuid, branch_ids text[])
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
  ) then raise insufficient_privilege using message = 'This employee is outside your branch access.'; end if;
  if branch_ids is null or exists (select 1 from unnest(branch_ids) as b(id) where id is null or not id = any(scope)) then
    raise insufficient_privilege using message = 'Choose branches within your own access.';
  end if;

  assignments := array(
    select m.branch_id from public.staff_branch_memberships m where m.staff_id = employee_id and not m.branch_id = any(scope)
    union select unnest(branch_ids)
  );
  if cardinality(assignments) = 0 then raise exception 'Keep at least one branch assigned to the employee.'; end if;
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
revoke execute on function public.prf_employee_directory(), public.prf_save_employee_branches(uuid, text[]) from public, anon;
grant execute on function public.prf_employee_directory(), public.prf_save_employee_branches(uuid, text[]) to authenticated;

create function public.prf_branch_approver(branch_key text, staff_role text, requester uuid, preferred uuid, branch_default uuid)
returns public.staff language sql stable set search_path = '' as $$
  with candidates as (
    select s.*, count(*) over () as eligible_count
    from public.staff s
    where s.active and s.account_role = staff_role and s.id <> requester and public.prf_has_branch(s.id, branch_key)
  )
  select s.* from public.staff s join candidates c on c.id = s.id
  where c.id in (preferred, branch_default) or c.eligible_count = 1
  order by (c.id is not distinct from preferred) desc, (c.id is not distinct from branch_default) desc, c.id
  limit 1
$$;
revoke execute on function public.prf_branch_approver(text, text, uuid, uuid, uuid) from public, anon, authenticated;

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

  insert into public.staff (id, name, branch_id, active, supervisor_override, hrd_override, account_role)
  values (user_id, btrim(profile ->> 'name'), branch_key, enabled, supervisor, hrd, role_name)
  on conflict (id) do update set
    name = excluded.name, branch_id = excluded.branch_id, active = excluded.active,
    supervisor_override = excluded.supervisor_override, hrd_override = excluded.hrd_override,
    account_role = excluded.account_role;
  delete from public.staff_extra_branches where staff_id = user_id;
  insert into public.staff_extra_branches (staff_id, branch_id)
    select user_id, id from unnest(assignments) as b(id) where id <> branch_key;
end;
$$;

create or replace function public.prf_context()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'branch', b.name,
    'canManageOptions', coalesce(s.account_role in ('supervisor', 'hrd'), false),
    'approver', coalesce(s.account_role in ('supervisor', 'hrd'), false))
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
    'position', (select coalesce(jsonb_agg(name order by name_key), '[]') from public.prf_request_option_names where kind = 'position' and active),
    'area', (select coalesce(jsonb_agg(name order by name_key), '[]') from public.prf_request_option_names where kind = 'area' and active)
  );
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
  supervisor := public.prf_branch_approver(office.id, 'supervisor', me.id,
    case when req.branch_id = office.id then req.supervisor_id else me.supervisor_override end, office.supervisor_id);
  hrd := public.prf_branch_approver(office.id, 'hrd', me.id,
    case when req.branch_id = office.id then req.hrd_id else me.hrd_override end, office.hrd_id);
  if supervisor.id is null or hrd.id is null then
    raise exception 'This branch needs an assigned supervisor and HRD approver. Contact the PRF administrator.';
  end if;
  if req.id is not null then
    update public.requests set form = clean_form, branch_id = office.id, branch_name = office.name, status = 'supervisor',
      supervisor_id = supervisor.id, hrd_id = hrd.id, supervisor_name = supervisor.name, hrd_name = hrd.name,
      supervisor_at = null, hrd_at = null, version = version + 1, updated_at = now()
      where id = request_id returning * into req;
    perform public.prf_record_event(req, me.name, 'requester', 'resubmitted', 'returned', '', req.supervisor_id);
    return req;
  end if;

  insert into public.requests (id, requester_id, requester_name, branch_id, branch_name,
    supervisor_id, hrd_id, supervisor_name, hrd_name, status, form)
  values (request_id, me.id, me.name, office.id, office.name,
    supervisor.id, hrd.id, supervisor.name, hrd.name, 'supervisor', clean_form)
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
  if not ((req.status = 'supervisor' and me.id = req.supervisor_id and me.account_role is not distinct from 'supervisor')
    or (req.status = 'hrd' and me.id = req.hrd_id and me.account_role is not distinct from 'hrd')) then
    raise exception 'This request is not awaiting your decision.';
  end if;
  if decision is null or decision not in ('approve','return','disapprove') then raise exception 'Select a decision.'; end if;
  if length(comment_text) > 800 or (decision <> 'approve' and comment_text = '') then
    raise exception 'Enter a reason of 1â€“800 characters for returns and disapprovals.';
  end if;
  stage_name := req.status;
  next_status := case decision when 'return' then 'returned' when 'disapprove' then 'disapproved'
    when 'approve' then case stage_name when 'supervisor' then 'hrd' else 'approved' end end;
  action_name := case decision when 'approve' then 'approved' when 'return' then 'returned' else 'disapproved' end;
  if next_status = 'hrd' and not exists (select 1 from public.staff where id = req.hrd_id and active and public.prf_has_branch(id, req.branch_id)) then
    raise exception 'The assigned HRD approver is inactive. Contact HRD.';
  end if;
  if next_status = 'approved' then
    if req.supervisor_at is null then
      raise exception 'Supervisor approval is required before final approval.';
    end if;
    if req.number is null then
      serial := nextval('public.prf_number_seq')::text;
      approved_number := 'PRF-' || to_char(now() at time zone 'Asia/Manila', 'YYYY') || '-' ||
        lpad(serial, greatest(5, length(serial)), '0');
    end if;
  end if;
  update public.requests set number = coalesce(approved_number, number), status = next_status, updated_at = now(), version = version + 1,
    supervisor_at = case when stage_name = 'supervisor' and decision = 'approve' then now() else supervisor_at end,
    hrd_at = case when stage_name = 'hrd' and decision = 'approve' then now() else hrd_at end
    where id = request_id returning * into req;
  perform public.prf_record_event(req, me.name, stage_name, action_name, stage_name, comment_text,
    case when next_status = 'hrd' then req.hrd_id else req.requester_id end);
  return req;
end
$$;

commit;
