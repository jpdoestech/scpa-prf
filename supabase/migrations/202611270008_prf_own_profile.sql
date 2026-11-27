begin;

create function public.prf_update_own_name(display_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  clean_name text := btrim(display_name);
begin
  if coalesce(char_length(clean_name), 0) not between 1 and 100 or clean_name !~ '[^[:space:]]' then
    raise exception 'Enter a display name of 1 to 100 characters.';
  end if;
  update public.staff set name = clean_name where id = auth.uid() and active;
  if not found then
    raise insufficient_privilege using message = 'An active PRF profile is required.';
  end if;
  return clean_name;
end
$$;

revoke execute on function public.prf_update_own_name(text) from public, anon;
grant execute on function public.prf_update_own_name(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('prf-avatars', 'prf-avatars', false, 262144, array['image/jpeg']);

create policy prf_read_own_avatar on storage.objects for select to authenticated
  using (bucket_id = 'prf-avatars' and name = (select auth.uid())::text || '/avatar.jpg');

create policy prf_upload_own_avatar on storage.objects for insert to authenticated
  with check (bucket_id = 'prf-avatars' and name = (select auth.uid())::text || '/avatar.jpg');

create policy prf_update_own_avatar on storage.objects for update to authenticated
  using (bucket_id = 'prf-avatars' and name = (select auth.uid())::text || '/avatar.jpg')
  with check (bucket_id = 'prf-avatars' and name = (select auth.uid())::text || '/avatar.jpg');

commit;
