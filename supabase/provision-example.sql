-- The super administrator first creates the three users in Authentication > Users.
-- Replace the emails, names, and branch values with the approved pilot roster.
begin;

insert into public.branches (id, name) values ('pilot-office', 'Pilot Office')
on conflict (id) do nothing;

do $$
declare
  employee uuid := (select id from auth.users where lower(email) = 'employee@example.com');
  supervisor uuid := (select id from auth.users where lower(email) = 'supervisor@example.com');
  hrd uuid := (select id from auth.users where lower(email) = 'hrd@example.com');
begin
  if employee is null or supervisor is null or hrd is null then
    raise exception 'Create the three pilot accounts in Supabase Auth first.';
  end if;
  if employee = supervisor or employee = hrd or supervisor = hrd then
    raise exception 'The employee, supervisor, and HRD approver must be three distinct people.';
  end if;

  insert into public.staff (id, name, branch_id) values
    (employee, 'Mika Reyes', 'pilot-office'),
    (supervisor, 'Alex Garcia', 'pilot-office'),
    (hrd, 'Jamie Santos', 'pilot-office');

  -- Route the pilot employee without changing any branch defaults.
  update public.staff set supervisor_override = supervisor, hrd_override = hrd where id = employee;
end $$;

commit;
