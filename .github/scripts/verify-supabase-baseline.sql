do $$
begin
  if (select count(*) from pg_tables where schemaname = 'public' and rowsecurity
    and tablename in ('branches', 'staff', 'requests', 'request_events', 'delivery_queue')) <> 5
    or (select count(*) from pg_policies where schemaname = 'public'
      and policyname in ('staff_self', 'request_participants', 'request_event_participants')) <> 3
    or to_regclass('public.prf_number_seq') is null
    or to_regprocedure('public.prf_context()') is null
    or to_regprocedure('public.prf_submit(uuid,jsonb,integer)') is null
    or to_regprocedure('public.prf_decide(uuid,integer,text,text)') is null then
    raise exception 'The base PRF schema or approval policies are missing.';
  end if;

  if coalesce(position('where q.sheets_at is null' in
    pg_get_functiondef(to_regprocedure('public.prf_claim_deliveries(integer)'))), 0) = 0 then
    raise exception 'The Sheets-only delivery migration is missing.';
  end if;

  if not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff' and column_name = 'account_role')
    or not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass
      and tgname = 'prf_provision_staff_on_auth_write' and tgenabled <> 'D')
    or to_regprocedure('public.prf_save_staff(uuid,jsonb)') is null then
    raise exception 'The user provisioning or management migration is missing.';
  end if;

  if to_regprocedure('public.prf_create_branch(text)') is null then
    raise exception 'The branch directory migration is missing.';
  end if;
end;
$$;
