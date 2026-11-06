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
create table public.plans (id text primary key, name text not null, limits jsonb not null default '{}', monthly_price_cop integer, is_active boolean not null default true, description text);
insert into public.plans (id, name, limits, monthly_price_cop) values
 ('free','Free','{"rank":0}',0), ('trial','Prueba gratis','{"rank":0}',0),
 ('kartta','Standard','{"rank":1,"max_products":500}',null), ('pro','Pro','{"rank":2,"max_products":2000}',84900);
create table public.subscriptions (id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id),
  plan_id text not null references public.plans(id), status text not null check (status in ('trialing','active','canceled')), current_period_end timestamptz, created_at timestamptz not null default now());
create table public.payments (id uuid primary key default gen_random_uuid(), provider text not null, amount_cop integer);
create table public.payment_events (id uuid primary key default gen_random_uuid(), raw jsonb not null);
create table public.coupons (id uuid primary key default gen_random_uuid(), code text);
-- Supabase concede por defecto todo a service_role (y tiene BYPASSRLS): se replica aquí.
alter role service_role bypassrls;
grant all on all tables in schema public, auth to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
grant select on auth.users to authenticated;
grant select on public.restaurants, public.restaurant_members to authenticated;
