begin;

create table public.prf_request_option_names (
  kind text not null check (kind in ('position', 'area')),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 100),
  name_key text generated always as (lower(name)) stored,
  primary key (kind, name_key)
);

alter table public.prf_request_option_names enable row level security;
revoke all on public.prf_request_option_names from public, anon, authenticated;

insert into public.prf_request_option_names (kind, name)
select option_kind, btrim(r.form->>option_kind)
from public.requests r cross join (values ('position'), ('area')) as fields(option_kind)
where char_length(btrim(r.form->>option_kind)) between 1 and 100
order by r.submitted_at, r.id
on conflict do nothing;

create function public.prf_can_manage_request_options()
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.staff where id = auth.uid() and active)
    or exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null
      and raw_app_meta_data->'prf_super_admin' = 'true'::jsonb)
$$;

revoke execute on function public.prf_can_manage_request_options() from public, anon, authenticated;

create function public.prf_request_options()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.prf_can_manage_request_options() then
    raise insufficient_privilege using message = 'An active PRF profile is required.';
  end if;
  return jsonb_build_object(
    'branch', (select coalesce(jsonb_agg(name order by lower(name), name), '[]') from public.branches),
    'position', (select coalesce(jsonb_agg(name order by name_key), '[]') from public.prf_request_option_names where kind = 'position'),
    'area', (select coalesce(jsonb_agg(name order by name_key), '[]') from public.prf_request_option_names where kind = 'area')
  );
end
$$;

create function public.prf_add_request_option(option_kind text, option_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  clean_name text := btrim(option_name);
  saved_name text;
begin
  if not public.prf_can_manage_request_options() then
    raise insufficient_privilege using message = 'An active PRF profile is required.';
  end if;
  if option_kind is null or option_kind not in ('branch', 'position', 'area')
    or coalesce(char_length(clean_name), 0) not between 1 and 100 or clean_name !~ '[^[:space:]]' then
    raise exception 'Enter an option name of 1 to 100 characters.';
  end if;

  if option_kind = 'branch' then
    -- Share the lock used by the admin branch and staff functions.
    perform pg_advisory_xact_lock(hashtextextended('prf_save_staff', 0));
    select name into saved_name from public.branches where lower(name) = lower(clean_name) order by name limit 1;
    if not found then
      select name into saved_name from public.prf_create_branch(clean_name);
    end if;
  else
    insert into public.prf_request_option_names (kind, name) values (option_kind, clean_name)
    on conflict (kind, name_key) do nothing;
    select name into saved_name from public.prf_request_option_names
      where kind = option_kind and name_key = lower(clean_name);
  end if;

  return saved_name;
end
$$;

revoke execute on function public.prf_request_options(), public.prf_add_request_option(text, text) from public, anon;
grant execute on function public.prf_request_options(), public.prf_add_request_option(text, text) to authenticated;

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
    select name into selected_branch from public.branches where name = input->>'branch';
    if not found and (input->>'branch') is distinct from req.branch_name then
      raise exception 'Choose an existing branch.';
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
