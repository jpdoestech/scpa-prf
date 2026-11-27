begin;

alter table public.branches add column active boolean not null default true;
alter table public.prf_request_option_names
  add column active boolean not null default true,
  add column id uuid not null default gen_random_uuid() unique;

create function public.prf_can_edit_request_options()
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.staff where id = auth.uid() and active and account_role in ('supervisor', 'hrd'))
    or exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null
      and raw_app_meta_data->'prf_super_admin' = 'true'::jsonb)
$$;
revoke execute on function public.prf_can_edit_request_options() from public, anon, authenticated;

create function public.prf_option_directory(option_kind text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.prf_can_edit_request_options() then
    raise insufficient_privilege using message = 'Only super admins, supervisors, and HRD can manage request options.';
  end if;
  if option_kind = 'branch' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'active', active)
      order by active desc, lower(name), id), '[]') from public.branches);
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'active', active)
    order by active desc, name_key), '[]') from public.prf_request_option_names where kind = option_kind);
end
$$;

create function public.prf_edit_request_option(option_kind text, option_id text, option_action text, option_name text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  clean_name text := btrim(option_name);
  enabled boolean := option_action = 'activate';
  option_key uuid;
begin
  if not public.prf_can_edit_request_options() then
    raise insufficient_privilege using message = 'Only super admins, supervisors, and HRD can manage request options.';
  end if;
  if option_kind is null or option_kind not in ('branch', 'position', 'area') or option_action is null
    or option_action not in ('rename', 'activate', 'deactivate', 'delete') then
    raise exception 'Choose a valid option and action.';
  end if;
  if option_action = 'rename' and (coalesce(char_length(clean_name), 0) not between 1 and 100 or clean_name !~ '[^[:space:]]') then
    raise exception 'Enter an option name of 1 to 100 characters.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('prf_save_staff', 0));
  if option_kind = 'branch' then
    if not exists (select 1 from public.branches where id = option_id) then
      raise exception 'This branch is no longer available.';
    end if;
    if option_action = 'delete' then
      if exists (select 1 from public.staff where branch_id = option_id)
        or exists (select 1 from public.branches where id = option_id and (supervisor_id is not null or hrd_id is not null)) then
        raise exception 'This branch still has staff or approvers assigned. Make it inactive or move those assignments first.';
      end if;
      delete from public.branches where id = option_id;
    elsif option_action = 'rename' then
      if exists (select 1 from public.branches where lower(name) = lower(clean_name) and id <> option_id) then
        raise exception 'That branch name already exists.';
      end if;
      update public.branches set name = clean_name where id = option_id;
    else
      update public.branches set active = enabled where id = option_id;
    end if;
  else
    select id into option_key from public.prf_request_option_names where kind = option_kind and id::text = option_id;
    if not found then raise exception 'This option is no longer available.'; end if;
    if option_action = 'delete' then
      delete from public.prf_request_option_names where id = option_key;
    elsif option_action = 'rename' then
      if exists (select 1 from public.prf_request_option_names
        where kind = option_kind and name_key = lower(clean_name) and id <> option_key) then
        raise exception 'That option name already exists.';
      end if;
      update public.prf_request_option_names set name = clean_name where id = option_key;
    else
      update public.prf_request_option_names set active = enabled where id = option_key;
    end if;
  end if;
end
$$;

revoke execute on function public.prf_option_directory(text), public.prf_edit_request_option(text, text, text, text) from public, anon;
grant execute on function public.prf_option_directory(text), public.prf_edit_request_option(text, text, text, text) to authenticated;

create or replace function public.prf_context()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'branch', b.name,
    'canManageOptions', coalesce(s.account_role in ('supervisor', 'hrd'), false),
    'approver', exists (select 1 from public.branches x where s.id in (x.supervisor_id, x.hrd_id))
      or exists (select 1 from public.staff x where s.id in (x.supervisor_override, x.hrd_override))
      or exists (select 1 from public.requests x where s.id in (x.supervisor_id, x.hrd_id)))
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
    'branch', (select coalesce(jsonb_agg(name order by lower(name), name), '[]') from public.branches where active),
    'position', (select coalesce(jsonb_agg(name order by name_key), '[]') from public.prf_request_option_names where kind = 'position' and active),
    'area', (select coalesce(jsonb_agg(name order by name_key), '[]') from public.prf_request_option_names where kind = 'area' and active)
  );
end
$$;

create or replace function public.prf_add_request_option(option_kind text, option_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  clean_name text := btrim(option_name);
  saved_name text;
  enabled boolean;
begin
  if not public.prf_can_manage_request_options() then
    raise insufficient_privilege using message = 'An active PRF profile is required.';
  end if;
  if option_kind is null or option_kind not in ('branch', 'position', 'area')
    or coalesce(char_length(clean_name), 0) not between 1 and 100 or clean_name !~ '[^[:space:]]' then
    raise exception 'Enter an option name of 1 to 100 characters.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('prf_save_staff', 0));
  if option_kind = 'branch' then
    select name, active into saved_name, enabled from public.branches where lower(name) = lower(clean_name) order by name limit 1;
    if not found then
      select name into saved_name from public.prf_create_branch(clean_name);
      enabled := true;
    end if;
  else
    insert into public.prf_request_option_names (kind, name) values (option_kind, clean_name)
    on conflict (kind, name_key) do nothing;
    select name, active into saved_name, enabled from public.prf_request_option_names
      where kind = option_kind and name_key = lower(clean_name);
  end if;

  if not enabled then
    raise exception 'That option is inactive. Ask a request options manager to reactivate it.';
  end if;
  return saved_name;
end
$$;

create or replace function public.prf_save_staff(user_id uuid, profile jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  role_name text := profile ->> 'role';
  branch_name text := btrim(profile ->> 'branch');
  branch_key text;
  branch_enabled boolean;
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
    or (enabled and role_name = 'employee' and supervisor is null)
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
  if not found or (not branch_enabled and not exists
    (select 1 from public.staff where id = user_id and branch_id = branch_key)) then
    raise exception 'Choose an active branch.';
  end if;

  insert into public.staff (id, name, branch_id, active, supervisor_override, hrd_override, account_role)
  values (user_id, btrim(profile ->> 'name'), branch_key, enabled, supervisor, hrd, role_name)
  on conflict (id) do update set
    name = excluded.name, branch_id = excluded.branch_id, active = excluded.active,
    supervisor_override = excluded.supervisor_override, hrd_override = excluded.hrd_override,
    account_role = excluded.account_role;
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
  serial text;
  selected_branch text;
begin
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
    select name into selected_branch from public.branches where name = input->>'branch' and active;
    if not found then raise exception 'Choose an active branch.'; end if;

    if not exists (select 1 from public.prf_request_option_names
      where kind = 'position' and name_key = lower(clean_form->>'position') and active) then
      raise exception 'Choose an active position title.';
    end if;
    if not exists (select 1 from public.prf_request_option_names
      where kind = 'area' and name_key = lower(clean_form->>'area') and active) then
      raise exception 'Choose an active assigned area.';
    end if;
  end if;

  if req.id is not null then
    if not exists (select 1 from public.staff where id = req.supervisor_id and active)
      or not exists (select 1 from public.staff where id = req.hrd_id and active) then
      raise exception 'An assigned approver is inactive. Contact HRD.';
    end if;
    update public.requests set form = clean_form, branch_name = coalesce(selected_branch, req.branch_name), status = 'supervisor',
      supervisor_at = null, hrd_at = null, version = version + 1, updated_at = now()
      where id = request_id returning * into req;
    perform public.prf_record_event(req, me.name, 'requester', 'resubmitted', 'returned', '', req.supervisor_id);
    return req;
  end if;

  -- Approval routing belongs to the staff profile, even when the work is for another branch.
  select * into office from public.branches where id = me.branch_id;
  if selected_branch is null and not office.active then raise exception 'Choose an active branch.'; end if;
  select * into supervisor from public.staff where id = coalesce(me.supervisor_override, office.supervisor_id) and active;
  select * into hrd from public.staff where id = coalesce(me.hrd_override, office.hrd_id) and active;
  if supervisor.id is null or hrd.id is null or me.id in (supervisor.id, hrd.id) or supervisor.id = hrd.id then
    raise exception 'This employee needs two distinct, active approvers. Contact HRD.';
  end if;
  serial := nextval('public.prf_number_seq')::text;
  insert into public.requests (id, number, requester_id, requester_name, branch_name,
    supervisor_id, hrd_id, supervisor_name, hrd_name, status, form)
  values (request_id, 'PRF-' || to_char(now() at time zone 'Asia/Manila', 'YYYY') || '-' ||
    lpad(serial, greatest(5, length(serial)), '0'), me.id, me.name, coalesce(selected_branch, office.name),
    supervisor.id, hrd.id, supervisor.name, hrd.name, 'supervisor', clean_form)
  returning * into req;
  perform public.prf_record_event(req, me.name, 'requester', 'submitted', null, '', req.supervisor_id);
  return req;
end
$$;

commit;
