begin;

create function public.prf_save_staff(user_id uuid, profile jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  role_name text := profile ->> 'role';
  branch_name text := btrim(profile ->> 'branch');
  branch_key text;
  supervisor uuid := (profile ->> 'supervisor_id')::uuid;
  hrd uuid := (profile ->> 'hrd_id')::uuid;
  enabled boolean := coalesce((profile ->> 'active')::boolean, true);
begin
  perform pg_advisory_xact_lock(hashtextextended('prf_save_staff', 0));
  if role_name is null or role_name not in ('employee', 'supervisor', 'hrd', 'other')
    or branch_name is null or branch_name = '' then
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

  insert into public.branches (id, name) values (gen_random_uuid()::text, branch_name)
  on conflict (name) do update set name = excluded.name returning id into branch_key;

  insert into public.staff (id, name, branch_id, active, supervisor_override, hrd_override, account_role)
  values (user_id, btrim(profile ->> 'name'), branch_key, enabled, supervisor, hrd, role_name)
  on conflict (id) do update set
    name = excluded.name, branch_id = excluded.branch_id, active = excluded.active,
    supervisor_override = excluded.supervisor_override, hrd_override = excluded.hrd_override,
    account_role = excluded.account_role;
end;
$$;

revoke execute on function public.prf_save_staff(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.prf_save_staff(uuid,jsonb) to service_role;
grant select on public.branches to service_role;

create or replace function public.prf_provision_staff()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or not coalesce(old.raw_app_meta_data ? 'prf_staff', false) then
    perform public.prf_save_staff(new.id, new.raw_app_meta_data -> 'prf_staff');
  end if;
  return new;
end;
$$;

commit;
