begin;

-- Use the same lock as staff changes, submissions, and approval decisions.
select pg_advisory_xact_lock(hashtextextended('prf_save_staff', 0));

create or replace function public.prf_update_own_name(display_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  clean_name text := btrim(display_name);
begin
  if coalesce(char_length(clean_name), 0) not between 1 and 100 or clean_name !~ '[^[:space:]]' then
    raise exception 'Enter a display name of 1 to 100 characters.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('prf_save_staff', 0));
  update public.staff set name = clean_name where id = auth.uid() and active;
  if not found then
    raise insufficient_privilege using message = 'An active PRF profile is required.';
  end if;
  return clean_name;
end
$$;

create function public.prf_sync_requester_name()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.requests
  set requester_name = new.name, version = version + 1, updated_at = now()
  where requester_id = new.id and status <> 'approved' and requester_name is distinct from new.name;
  return new;
end
$$;

revoke execute on function public.prf_sync_requester_name() from public, anon, authenticated;

create trigger prf_sync_requester_name
after update of name on public.staff
for each row when (old.name is distinct from new.name)
execute function public.prf_sync_requester_name();

-- Correct requests whose owners already changed their names before this migration.
update public.requests as request
set requester_name = staff.name, version = request.version + 1, updated_at = now()
from public.staff as staff
where request.requester_id = staff.id and request.status <> 'approved'
  and request.requester_name is distinct from staff.name;

commit;
