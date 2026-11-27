begin;

alter table public.staff add column account_role text
  check (account_role in ('employee', 'supervisor', 'hrd', 'other'));

-- Auth and staff creation share a transaction. Only trusted Auth admins can set app metadata.
create function public.prf_provision_staff()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  profile jsonb := new.raw_app_meta_data -> 'prf_staff';
  role_name text := profile ->> 'role';
  branch_name text := btrim(profile ->> 'branch');
  branch_key text;
  supervisor uuid := (profile ->> 'supervisor_id')::uuid;
  hrd uuid := (profile ->> 'hrd_id')::uuid;
begin
  if tg_op = 'UPDATE' and old.raw_app_meta_data ? 'prf_staff' then
    return new;
  end if;
  if role_name is null or role_name not in ('employee', 'supervisor', 'hrd', 'other')
    or branch_name is null or branch_name = '' then
    raise exception 'Invalid PRF staff details.';
  end if;
  if (supervisor is null) <> (hrd is null)
    or (role_name = 'employee' and supervisor is null)
    or supervisor = hrd then
    raise exception 'Assign two distinct PRF approvers.';
  end if;
  if supervisor is not null and (
    not exists (select 1 from public.staff where id = supervisor and active and account_role = 'supervisor')
    or not exists (select 1 from public.staff where id = hrd and active and account_role = 'hrd')
  ) then
    raise exception 'Choose active PRF approvers.';
  end if;

  insert into public.branches (id, name) values (gen_random_uuid()::text, branch_name)
  on conflict (name) do update set name = excluded.name returning id into branch_key;

  insert into public.staff (id, name, branch_id, supervisor_override, hrd_override, account_role)
  values (new.id, btrim(profile ->> 'name'), branch_key, supervisor, hrd, role_name);
  return new;
end;
$$;

revoke execute on function public.prf_provision_staff() from public, anon, authenticated;

create trigger prf_provision_staff_on_auth_write
after insert or update of raw_app_meta_data on auth.users for each row
when (new.raw_app_meta_data ? 'prf_staff')
execute function public.prf_provision_staff();

grant select on public.staff to service_role;

commit;
