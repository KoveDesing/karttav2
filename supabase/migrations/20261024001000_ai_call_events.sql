create table if not exists public.ai_call_events (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  provider text not null default 'groq',
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  total_tokens bigint not null default 0 check (total_tokens >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  ok boolean not null default true,
  error_code text,
  created_at timestamptz not null default now()
);
create index if not exists ai_call_events_created_idx on public.ai_call_events(created_at desc);
create index if not exists ai_call_events_restaurant_created_idx on public.ai_call_events(restaurant_id, created_at desc);
alter table public.ai_call_events enable row level security;
revoke all on public.ai_call_events from anon, authenticated;
grant select, insert, update, delete on public.ai_call_events to service_role;
grant usage, select on sequence public.ai_call_events_id_seq to service_role;
