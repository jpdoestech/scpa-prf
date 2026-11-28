begin;

create table public.prf_print_settings (
  singleton boolean primary key default true check (singleton),
  templates text[] not null check (templates in (array['original'], array['wrapped'], array['original','wrapped']))
);
alter table public.prf_print_settings enable row level security;
revoke all on public.prf_print_settings from public, anon, authenticated;
insert into public.prf_print_settings (templates) values (array['original']);

create function public.prf_print_templates()
returns text[] language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.prf_is_super_admin() and not exists (
    select 1 from public.staff where id = auth.uid() and active
  ) then raise insufficient_privilege using message = 'An active PRF account is required.'; end if;
  return (select templates from public.prf_print_settings where singleton);
end
$$;

create function public.prf_save_print_templates(enabled_templates text[])
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  selected text[];
begin
  if not public.prf_is_super_admin() then
    raise insufficient_privilege using message = 'Only super admins can change print templates.';
  end if;
  if coalesce(cardinality(enabled_templates), 0) not between 1 and 2
    or array_position(enabled_templates, null) is not null
    or not (enabled_templates <@ array['original','wrapped']) then
    raise exception 'Enable at least one print template.';
  end if;
  select array_agg(template order by template) into selected from (
    select distinct unnest(enabled_templates) as template
  ) valid;
  update public.prf_print_settings set templates = selected where singleton;
  return selected;
end
$$;

revoke execute on function public.prf_print_templates(), public.prf_save_print_templates(text[]) from public, anon;
grant execute on function public.prf_print_templates(), public.prf_save_print_templates(text[]) to authenticated;

commit;
