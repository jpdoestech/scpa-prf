begin;

create function public.prf_is_super_admin()
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null
    and raw_app_meta_data->'prf_super_admin' = 'true'::jsonb)
$$;
revoke execute on function public.prf_is_super_admin() from public, anon, authenticated;

create or replace function public.prf_option_directory(option_kind text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if option_kind = 'branch' and not public.prf_is_super_admin() then
    raise insufficient_privilege using message = 'Only super admins can manage branches.';
  end if;
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

create or replace function public.prf_edit_request_option(option_kind text, option_id text, option_action text, option_name text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  clean_name text := btrim(option_name);
  enabled boolean := option_action = 'activate';
  option_key uuid;
begin
  if option_kind = 'branch' and not public.prf_is_super_admin() then
    raise insufficient_privilege using message = 'Only super admins can manage branches.';
  end if;
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

create or replace function public.prf_add_request_option(option_kind text, option_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  clean_name text := btrim(option_name);
  saved_name text;
  enabled boolean;
begin
  if option_kind = 'branch' and not public.prf_is_super_admin() then
    raise insufficient_privilege using message = 'Only super admins can manage branches.';
  end if;
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

commit;
