-- First create or invite these sample users in Authentication > Users.
-- Replace every example.com email, name, and branch with the approved roster.
begin;

insert into public.branches (id, name) values
  ('manila', 'Metro Manila'),
  ('hq', 'Main Office')
on conflict (id) do update set name = excluded.name;

do $$
declare
  employee uuid := (select id from auth.users where lower(email) = 'employee@example.com');
  supervisor uuid := (select id from auth.users where lower(email) = 'supervisor@example.com');
  hrd uuid := (select id from auth.users where lower(email) = 'hrd@example.com');
  alternate_supervisor uuid := (select id from auth.users where lower(email) = 'alternate-supervisor@example.com');
  alternate_hrd uuid := (select id from auth.users where lower(email) = 'alternate-hrd@example.com');
begin
  if employee is null or supervisor is null or hrd is null
    or alternate_supervisor is null or alternate_hrd is null then
    raise exception 'Provision the company email accounts in Supabase Auth first.';
  end if;

  insert into public.staff (id, name, branch_id, supervisor_override, hrd_override) values
    (employee, 'Mika Reyes', 'manila', null, null),
    (supervisor, 'Alex Garcia', 'manila', alternate_supervisor, null),
    (hrd, 'Jamie Santos', 'hq', null, alternate_hrd),
    (alternate_supervisor, 'Robin Cruz', 'hq', null, null),
    (alternate_hrd, 'Sam Torres', 'hq', null, null)
  on conflict (id) do update set name = excluded.name, branch_id = excluded.branch_id,
    supervisor_override = excluded.supervisor_override, hrd_override = excluded.hrd_override;

  update public.branches set supervisor_id = supervisor, hrd_id = hrd where id = 'manila';
  update public.branches set supervisor_id = alternate_supervisor, hrd_id = hrd where id = 'hq';
  update public.staff set supervisor_override = supervisor where id = alternate_supervisor;
end $$;

commit;
