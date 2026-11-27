begin;

create table public.branches (
  id text primary key,
  name text not null unique check (char_length(btrim(name)) between 1 and 100),
  supervisor_id uuid references auth.users(id),
  hrd_id uuid references auth.users(id),
  check (supervisor_id <> hrd_id)
);

create table public.staff (
  id uuid primary key references auth.users(id),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  branch_id text not null references public.branches(id),
  active boolean not null default true,
  supervisor_override uuid references auth.users(id),
  hrd_override uuid references auth.users(id)
);

create sequence public.prf_number_seq;

create table public.requests (
  id uuid primary key,
  number text not null unique,
  requester_id uuid not null references public.staff(id),
  requester_name text not null,
  branch_name text not null,
  supervisor_id uuid not null references public.staff(id),
  hrd_id uuid not null references public.staff(id),
  supervisor_name text not null,
  hrd_name text not null,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  supervisor_at timestamptz,
  hrd_at timestamptz,
  version integer not null default 1,
  status text not null check (status in ('supervisor','hrd','returned','approved','disapproved')),
  form jsonb not null,
  search_text text generated always as
    (number || ' ' || requester_name || ' ' || (form->>'position') || ' ' || (form->>'area')) stored,
  check (requester_id <> supervisor_id and requester_id <> hrd_id and supervisor_id <> hrd_id)
);

create index requests_requester_idx on public.requests (requester_id, updated_at desc);
create index requests_supervisor_idx on public.requests (supervisor_id, updated_at desc);
create index requests_hrd_idx on public.requests (hrd_id, updated_at desc);

create table public.request_events (
  id integer generated always as identity primary key,
  request_id uuid not null references public.requests(id),
  actor_name text not null,
  stage text not null,
  action text not null,
  previous_status text,
  status text not null,
  note text not null default '',
  occurred_at timestamptz not null default now()
);

create index request_events_request_idx on public.request_events (request_id, id);

create table public.delivery_queue (
  event_id integer primary key references public.request_events(id),
  snapshot jsonb not null,
  recipient text,
  sheets_at timestamptz,
  email_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_id uuid,
  attempts integer not null default 0,
  last_error text
);

create index delivery_queue_due_idx on public.delivery_queue (next_attempt_at)
  where sheets_at is null or (recipient is not null and email_at is null);

alter table public.branches enable row level security;
alter table public.staff enable row level security;
alter table public.requests enable row level security;
alter table public.request_events enable row level security;
alter table public.delivery_queue enable row level security;

revoke all on public.branches, public.staff, public.requests, public.request_events, public.delivery_queue from anon, authenticated;
grant select on public.staff, public.requests, public.request_events to authenticated;
grant select, update on public.delivery_queue to service_role;

create policy staff_self on public.staff for select to authenticated
  using (id = (select auth.uid()) and active);
create policy request_participants on public.requests for select to authenticated
  using (
    (select auth.uid()) in (requester_id, supervisor_id, hrd_id)
    and exists (select 1 from public.staff where id = (select auth.uid()) and active)
  );
create policy request_event_participants on public.request_events for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_id));

create function public.prf_context()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'branch', b.name,
    'approver', exists (select 1 from public.branches x where s.id in (x.supervisor_id, x.hrd_id))
      or exists (select 1 from public.staff x where s.id in (x.supervisor_override, x.hrd_override))
      or exists (select 1 from public.requests x where s.id in (x.supervisor_id, x.hrd_id)))
  from public.staff s join public.branches b on b.id = s.branch_id
  where s.id = auth.uid() and s.active
$$;

create function public.prf_validate_form(input jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  limits jsonb := '{"position":100,"needed":10,"area":100,"headcount":4,"service":20,"service_other":120,"assignment":20,"requisition":20,"reason":500,"schedule":120,"salary":36,"allowance":40,"qualifications":650}';
  field text;
  value text;
  normalized jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(input) is distinct from 'object' then
    raise exception 'Enter the request details.';
  end if;
  for field in select jsonb_object_keys(limits) loop
    if coalesce(jsonb_typeof(input->field), 'string') not in ('string', 'null') then
      raise exception 'Invalid value for %.', field;
    end if;
    value := btrim(coalesce(input->>field, ''));
    if char_length(value) > (limits->>field)::integer then
      raise exception 'The % field is too long.', field;
    end if;
    normalized := normalized || jsonb_build_object(field, value);
  end loop;
  if normalized->>'position' = '' or normalized->>'area' = '' or normalized->>'schedule' = '' then
    raise exception 'Enter the position, assigned area, and work schedule.';
  end if;
  if normalized->>'needed' !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Enter a valid date needed.';
  end if;
  perform (normalized->>'needed')::date;
  if normalized->>'headcount' !~ '^[1-9][0-9]{0,3}$' then
    raise exception 'Enter a headcount from 1 to 9999.';
  end if;
  if normalized->>'service' not in ('continuous','year','six_months','three_months','other')
    or normalized->>'assignment' not in ('full_time','part_time','on_call')
    or normalized->>'requisition' not in ('new','replacement','additional','other') then
    raise exception 'Choose a service time frame, work assignment, and requisition type.';
  end if;
  if normalized->>'service' = 'other' and normalized->>'service_other' = '' then
    raise exception 'Describe the service time frame.';
  end if;
  if normalized->>'requisition' <> 'new' and normalized->>'reason' = '' then
    raise exception 'Enter the details for this requisition type.';
  end if;
  if normalized->>'service' <> 'other' then
    normalized := normalized || '{"service_other":""}'::jsonb;
  end if;
  if normalized->>'requisition' = 'new' then
    normalized := normalized || '{"reason":""}'::jsonb;
  end if;
  return normalized;
end
$$;

create function public.prf_record_event(
  req public.requests, actor text, stage_name text, action_name text,
  old_status text, comment_text text, notify_id uuid
)
returns void language plpgsql set search_path = '' as $$
declare
  event_number integer;
  notify_email text;
begin
  insert into public.request_events
    (request_id, actor_name, stage, action, previous_status, status, note)
  values (req.id, actor, stage_name, action_name, old_status, req.status, comment_text)
  returning id into event_number;

  select u.email into notify_email from auth.users u
    join public.staff s on s.id = u.id and s.active where u.id = notify_id;
  insert into public.delivery_queue (event_id, recipient, snapshot)
    values (event_number, notify_email, jsonb_build_object(
      'number', req.number, 'requester', req.requester_name, 'branch', req.branch_name,
      'position', req.form->>'position', 'headcount', req.form->>'headcount',
      'area', req.form->>'area', 'needed', req.form->>'needed',
      'requisition', req.form->>'requisition', 'assignment', req.form->>'assignment'
    ));
end
$$;

create function public.prf_submit(request_id uuid, input jsonb, expected_version integer default null)
returns public.requests language plpgsql security definer set search_path = '' as $$
declare
  me public.staff;
  office public.branches;
  supervisor public.staff;
  hrd public.staff;
  req public.requests;
  clean_form jsonb;
  serial text;
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

  if req.id is not null then
    if not exists (select 1 from public.staff where id = req.supervisor_id and active)
      or not exists (select 1 from public.staff where id = req.hrd_id and active) then
      raise exception 'An assigned approver is inactive. Contact HRD.';
    end if;
    update public.requests set form = clean_form, status = 'supervisor',
      supervisor_at = null, hrd_at = null, version = version + 1, updated_at = now()
      where id = request_id returning * into req;
    perform public.prf_record_event(req, me.name, 'requester', 'resubmitted', 'returned', '', req.supervisor_id);
    return req;
  end if;

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
    lpad(serial, greatest(5, length(serial)), '0'), me.id, me.name, office.name,
    supervisor.id, hrd.id, supervisor.name, hrd.name, 'supervisor', clean_form)
  returning * into req;
  perform public.prf_record_event(req, me.name, 'requester', 'submitted', null, '', req.supervisor_id);
  return req;
end
$$;

create function public.prf_decide(request_id uuid, expected_version integer, decision text, remark text default '')
returns public.requests language plpgsql security definer set search_path = '' as $$
declare
  me public.staff;
  req public.requests;
  stage_name text;
  next_status text;
  action_name text;
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
  update public.requests set status = next_status, updated_at = now(), version = version + 1,
    supervisor_at = case when stage_name = 'supervisor' and decision = 'approve' then now() else supervisor_at end,
    hrd_at = case when stage_name = 'hrd' and decision = 'approve' then now() else hrd_at end
    where id = request_id returning * into req;
  perform public.prf_record_event(req, me.name, stage_name, action_name, stage_name, comment_text,
    case when next_status = 'hrd' then req.hrd_id else req.requester_id end);
  return req;
end
$$;

create function public.prf_claim_deliveries(batch_size integer default 25)
returns table (event_id integer, lease_id uuid, recipient text, snapshot jsonb,
  sheets_at timestamptz, email_at timestamptz, attempts integer, event jsonb)
language sql security definer set search_path = '' as $$
  with due as (
    select q.event_id from public.delivery_queue q
    where (q.sheets_at is null or (q.recipient is not null and q.email_at is null))
      and q.next_attempt_at <= now() and (q.lease_until is null or q.lease_until < now())
    order by q.event_id limit least(greatest(batch_size, 1), 50) for update skip locked
  ), claimed as (
    update public.delivery_queue q set lease_until = now() + interval '5 minutes',
      lease_id = gen_random_uuid(), attempts = q.attempts + 1
    from due where q.event_id = due.event_id returning q.*
  )
  select c.event_id, c.lease_id, c.recipient, c.snapshot, c.sheets_at, c.email_at, c.attempts,
    to_jsonb(e) - 'note' from claimed c join public.request_events e on e.id = c.event_id
$$;

revoke execute on function public.prf_context(), public.prf_validate_form(jsonb),
  public.prf_record_event(public.requests,text,text,text,text,text,uuid),
  public.prf_submit(uuid,jsonb,integer), public.prf_decide(uuid,integer,text,text),
  public.prf_claim_deliveries(integer) from public, anon, authenticated;
grant execute on function public.prf_context(), public.prf_submit(uuid,jsonb,integer),
  public.prf_decide(uuid,integer,text,text) to authenticated;
grant execute on function public.prf_claim_deliveries(integer) to service_role;

commit;
