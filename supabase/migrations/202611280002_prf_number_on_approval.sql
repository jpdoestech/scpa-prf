begin;

alter table public.requests alter column number drop not null;

-- Keep pre-approval requests searchable by their existing descriptive fields.
alter table public.requests drop column search_text;
alter table public.requests add column search_text text generated always as
  (coalesce(number, '') || ' ' || requester_name || ' ' || (form->>'position') || ' ' || (form->>'area')) stored;
alter table public.requests add constraint prf_approved_has_number check (status <> 'approved' or number is not null);

create or replace function public.prf_submit(request_id uuid, input jsonb, expected_version integer default null)
returns public.requests language plpgsql security definer set search_path = '' as $$
declare
  me public.staff;
  office public.branches;
  supervisor public.staff;
  hrd public.staff;
  req public.requests;
  clean_form jsonb;
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
    select name into selected_branch from public.branches where name = input->>'branch' and active;
    if not found then raise exception 'Choose an active branch.'; end if;

    if not exists (select 1 from public.prf_request_option_names
      where kind = 'position' and name_key = lower(clean_form->>'position') and active) then
      raise exception 'Choose an active position title.';
    end if;
    if not exists (select 1 from public.prf_request_option_names
      where kind = 'area' and name_key = lower(clean_form->>'area') and active) then
      raise exception 'Choose an active assigned area.';
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
  if selected_branch is null and not office.active then raise exception 'Choose an active branch.'; end if;
  select * into supervisor from public.staff where id = coalesce(me.supervisor_override, office.supervisor_id) and active;
  select * into hrd from public.staff where id = coalesce(me.hrd_override, office.hrd_id) and active;
  if supervisor.id is null or hrd.id is null or me.id in (supervisor.id, hrd.id) or supervisor.id = hrd.id then
    raise exception 'This employee needs two distinct, active approvers. Contact HRD.';
  end if;
  insert into public.requests (id, requester_id, requester_name, branch_name,
    supervisor_id, hrd_id, supervisor_name, hrd_name, status, form)
  values (request_id, me.id, me.name, coalesce(selected_branch, office.name),
    supervisor.id, hrd.id, supervisor.name, hrd.name, 'supervisor', clean_form)
  returning * into req;
  perform public.prf_record_event(req, me.name, 'requester', 'submitted', null, '', req.supervisor_id);
  return req;
end
$$;

create or replace function public.prf_decide(request_id uuid, expected_version integer, decision text, remark text default '')
returns public.requests language plpgsql security definer set search_path = '' as $$
declare
  me public.staff;
  req public.requests;
  stage_name text;
  next_status text;
  action_name text;
  serial text;
  approved_number text;
  comment_text text := btrim(coalesce(remark, ''));
begin
  select * into me from public.staff where id = auth.uid() and active;
  if not found then raise exception 'Your employee account is inactive or unavailable.'; end if;
  select * into req from public.requests where id = request_id for update;
  if not found or not (me.id in (req.supervisor_id, req.hrd_id)) then raise exception 'Request unavailable.'; end if;
  if req.version is distinct from expected_version then raise exception 'This request changed. Refresh it before deciding.'; end if;
  if not ((req.status = 'supervisor' and me.id = req.supervisor_id)
    or (req.status = 'hrd' and me.id = req.hrd_id)) then
    raise exception 'This request is not awaiting your decision.';
  end if;
  if decision is null or decision not in ('approve','return','disapprove') then raise exception 'Select a decision.'; end if;
  if length(comment_text) > 800 or (decision <> 'approve' and comment_text = '') then
    raise exception 'Enter a reason of 1–800 characters for returns and disapprovals.';
  end if;
  stage_name := req.status;
  next_status := case decision when 'return' then 'returned' when 'disapprove' then 'disapproved'
    when 'approve' then case stage_name when 'supervisor' then 'hrd' else 'approved' end end;
  action_name := case decision when 'approve' then 'approved' when 'return' then 'returned' else 'disapproved' end;
  if next_status = 'hrd' and not exists (select 1 from public.staff where id = req.hrd_id and active) then
    raise exception 'The assigned HRD approver is inactive. Contact HRD.';
  end if;
  if next_status = 'approved' then
    if req.supervisor_at is null then
      raise exception 'Supervisor approval is required before final approval.';
    end if;
    if req.number is null then
      serial := nextval('public.prf_number_seq')::text;
      approved_number := 'PRF-' || to_char(now() at time zone 'Asia/Manila', 'YYYY') || '-' ||
        lpad(serial, greatest(5, length(serial)), '0');
    end if;
  end if;
  update public.requests set number = coalesce(approved_number, number), status = next_status, updated_at = now(), version = version + 1,
    supervisor_at = case when stage_name = 'supervisor' and decision = 'approve' then now() else supervisor_at end,
    hrd_at = case when stage_name = 'hrd' and decision = 'approve' then now() else hrd_at end
    where id = request_id returning * into req;
  perform public.prf_record_event(req, me.name, stage_name, action_name, stage_name, comment_text,
    case when next_status = 'hrd' then req.hrd_id else req.requester_id end);
  return req;
end
$$;

commit;
