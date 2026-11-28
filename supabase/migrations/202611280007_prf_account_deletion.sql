begin;

create function public.prf_delete_staff_on_auth_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.raw_app_meta_data->'prf_super_admin' = 'true'::jsonb then
    raise insufficient_privilege using message = 'A PRF super administrator cannot be deleted.';
  end if;
  if exists (select 1 from public.requests where requester_id = old.id
    or supervisor_id = old.id or hrd_id = old.id) then
    raise foreign_key_violation using message = 'This account is linked to PRF history.';
  end if;

  update public.branches set supervisor_id = null where supervisor_id = old.id;
  update public.branches set hrd_id = null where hrd_id = old.id;
  update public.staff set supervisor_override = null, hrd_override = null
    where supervisor_override = old.id or hrd_override = old.id;
  delete from public.staff where id = old.id;
  return old;
end
$$;

revoke execute on function public.prf_delete_staff_on_auth_delete() from public, anon, authenticated;

create trigger prf_delete_staff_on_auth_delete
before delete on auth.users for each row
execute function public.prf_delete_staff_on_auth_delete();

-- A deleted account can still hold an unexpired access token.
create function public.prf_can_use_avatar()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.prf_is_super_admin()
    or exists (select 1 from public.staff where id = auth.uid() and active)
$$;
revoke execute on function public.prf_can_use_avatar() from public, anon;
grant execute on function public.prf_can_use_avatar() to authenticated;

alter policy prf_read_own_avatar on storage.objects
  using (bucket_id = 'prf-avatars' and name = (select auth.uid())::text || '/avatar.jpg'
    and (select public.prf_can_use_avatar()));
alter policy prf_upload_own_avatar on storage.objects
  with check (bucket_id = 'prf-avatars' and name = (select auth.uid())::text || '/avatar.jpg'
    and (select public.prf_can_use_avatar()));
alter policy prf_update_own_avatar on storage.objects
  using (bucket_id = 'prf-avatars' and name = (select auth.uid())::text || '/avatar.jpg'
    and (select public.prf_can_use_avatar()))
  with check (bucket_id = 'prf-avatars' and name = (select auth.uid())::text || '/avatar.jpg'
    and (select public.prf_can_use_avatar()));

commit;
