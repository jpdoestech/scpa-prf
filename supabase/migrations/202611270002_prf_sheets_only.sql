begin;

-- Keep historical delivery data and claim only events still awaiting a Sheets write.
create or replace function public.prf_claim_deliveries(batch_size integer default 25)
returns table (event_id integer, lease_id uuid, recipient text, snapshot jsonb,
  sheets_at timestamptz, email_at timestamptz, attempts integer, event jsonb)
language sql security definer set search_path = '' as $$
  with due as (
    select q.event_id from public.delivery_queue q
    where q.sheets_at is null
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

commit;
