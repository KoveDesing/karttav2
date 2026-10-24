-- Public menu reports. No public table access; only the Edge Function/service role can write.
create table if not exists public.menu_reports (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  product_id uuid,
  category text not null check (category in ('menu','product','order','payment','other')),
  message text not null check (char_length(message) between 3 and 4000),
  page text check (page is null or char_length(page) <= 300),
  contact text check (contact is null or char_length(contact) <= 254),
  source text not null default 'public_menu' check (source in ('public_menu','restaurant_dashboard','admin')),
  status text not null default 'nuevo' check (status in ('nuevo','en_revision','en_proceso','esperando','resuelto','cerrado')),
  priority text not null default 'media' check (priority in ('baja','media','alta')),
  notes text check (notes is null or char_length(notes) <= 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists menu_reports_status_created_idx on public.menu_reports(status, created_at desc);
create index if not exists menu_reports_restaurant_created_idx on public.menu_reports(restaurant_id, created_at desc);
alter table public.menu_reports enable row level security;
revoke all on public.menu_reports from anon, authenticated;
grant select, insert, update, delete on public.menu_reports to service_role;

create table if not exists public.menu_report_rate_limits (
  fingerprint text primary key check (char_length(fingerprint) = 64),
  window_started_at timestamptz not null default now(),
  hits integer not null default 0 check (hits >= 0),
  updated_at timestamptz not null default now()
);
alter table public.menu_report_rate_limits enable row level security;
revoke all on public.menu_report_rate_limits from anon, authenticated;
grant select, insert, update, delete on public.menu_report_rate_limits to service_role;

create or replace function public.consume_menu_report_rate_limit(
  p_fingerprint text,
  p_limit integer default 3,
  p_window_seconds integer default 900
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare current_hits integer;
begin
  if p_fingerprint is null or char_length(p_fingerprint) <> 64
     or p_limit < 1 or p_limit > 20 or p_window_seconds < 60 or p_window_seconds > 86400 then
    return false;
  end if;
  insert into public.menu_report_rate_limits(fingerprint, window_started_at, hits, updated_at)
  values (p_fingerprint, now(), 1, now())
  on conflict (fingerprint) do update set
    window_started_at = case
      when public.menu_report_rate_limits.window_started_at < now() - make_interval(secs => p_window_seconds) then now()
      else public.menu_report_rate_limits.window_started_at end,
    hits = case
      when public.menu_report_rate_limits.window_started_at < now() - make_interval(secs => p_window_seconds) then 1
      else public.menu_report_rate_limits.hits + 1 end,
    updated_at = now()
  returning hits into current_hits;
  return current_hits <= p_limit;
end;
$$;
revoke all on function public.consume_menu_report_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_menu_report_rate_limit(text, integer, integer) to service_role;
