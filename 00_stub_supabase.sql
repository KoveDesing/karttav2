-- STUB de Supabase para probar la migración en un Postgres local. NO es el esquema real: es una suposición
-- razonable de las tablas previas (su DDL no está en el repo). Incluye una columna NOT NULL desconocida en payments
-- para comprobar que el preflight de la migración la maneja.
create extension if not exists pgcrypto;
do $$ begin
  create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
create schema if not exists auth; create schema if not exists private;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, private, public to anon, authenticated, service_role;
create table public.platform_admins (user_id uuid primary key);
create or replace function private.is_platform_admin() returns boolean language sql stable security definer as $$ select exists (select 1 from public.platform_admins where user_id = auth.uid()) $$;
create table public.restaurants (id uuid primary key default gen_random_uuid(), name text not null, slug text unique, is_suspended boolean not null default false, created_at timestamptz default now());
create table public.restaurant_members (restaurant_id uuid references public.restaurants(id), user_id uuid, role text, primary key (restaurant_id, user_id));
create table public.plans (id text primary key check (id ~ '^[a-z0-9_]{2,30}$'), name text not null check (char_length(name) between 2 and 60), monthly_price_cop integer check (monthly_price_cop >= 0),
  yearly_monthly_price_cop integer check (yearly_monthly_price_cop >= 0), limits jsonb not null default '{}' check (jsonb_typeof(limits)='object'), is_active boolean not null default true, created_at timestamptz not null default now(), annual_price_cop integer);
insert into public.plans (id, name, limits, monthly_price_cop) values
 ('trial','Prueba','{"rank":0,"max_products":20}',null), ('free','Free','{"rank":0,"max_products":20}',null), ('custom','Custom','{"rank":3}',null),
 ('kartta','Standard','{"rank":1,"max_products":60}',43900), ('pro','Pro','{"rank":2,"max_products":200}',84900);
create table public.subscriptions (id uuid primary key default gen_random_uuid(), restaurant_id uuid not null unique references public.restaurants(id) on delete cascade,
  plan_id text not null references public.plans(id), status text not null check (status in ('active','trialing','past_due','canceled','expired')),
  provider text check (provider in ('wompi','mercadopago','manual')), provider_subscription_id text, current_period_end timestamptz, cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.payments (id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null, provider text not null check (provider in ('wompi','mercadopago','manual')), provider_payment_id text not null,
  amount_cop integer not null check (amount_cop >= 0), status text not null check (status in ('pending','approved','declined','refunded','error')), created_at timestamptz not null default now(),
  provider_reference text, currency text not null default 'COP', paid_at timestamptz, updated_at timestamptz not null default now(), metadata jsonb not null default '{}',
  unique (provider, provider_payment_id));
create unique index payments_provider_reference_unique on public.payments (provider, provider_reference) where provider_reference is not null;
create table public.payment_events (id uuid primary key default gen_random_uuid(), provider text not null check (provider in ('wompi','mercadopago','manual')), provider_event_id text, event_type text not null,
  provider_transaction_id text, provider_reference text, signature_valid boolean not null, processing_status text not null check (processing_status in ('received','processed','ignored','failed')),
  payload jsonb not null, processing_error text, received_at timestamptz not null default now(), processed_at timestamptz);
create unique index payment_events_provider_event_unique on public.payment_events (provider, provider_event_id) where provider_event_id is not null;
create table public.coupons (id uuid primary key default gen_random_uuid(), code text);
-- Supabase concede por defecto todo a service_role (y tiene BYPASSRLS): se replica aquí.
alter role service_role bypassrls;
grant all on all tables in schema public, auth to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
grant select on auth.users to authenticated;
grant select on public.restaurants, public.restaurant_members to authenticated;
