begin;

create function public.prf_create_branch(branch_name text)
returns public.branches language plpgsql security definer set search_path = '' as $$
declare
  clean_name text := btrim(branch_name);
  branch public.branches;
begin
  if coalesce(char_length(clean_name), 0) not between 1 and 100 then
    raise exception 'Enter a branch name of 1 to 100 characters.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('prf_save_staff', 0));
  if exists (select 1 from public.branches where lower(name) = lower(clean_name)) then
    raise exception 'That branch already exists.';
  end if;
  insert into public.branches (id, name) values (gen_random_uuid()::text, clean_name)
  returning * into branch;
  return branch;
end;
$$;

revoke execute on function public.prf_create_branch(text) from public, anon, authenticated;
grant execute on function public.prf_create_branch(text) to service_role;

commit;
