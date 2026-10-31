-- =====================================================================
-- APLICADA en Supabase (proyecto Kartta) el 30-oct-2026 como migración «panel_fase1_estado_apertura_y_pagos».
-- Aditiva e idempotente: no borra datos ni redefine funciones existentes
-- (no toca get_public_menu ni place_order, cuyo código no está en este repo).
-- NO se pudo ejecutar contra una base real al prepararla: probar primero en una rama de Supabase.
-- =====================================================================

-- 1) Estado de apertura del negocio (independiente de is_published)
alter table public.restaurants add column if not exists is_open boolean not null default true;

-- Cambiar el estado: solo owner/admin/staff del restaurante (la columna no se escribe directo desde el navegador)
create or replace function public.set_restaurant_open(p_restaurant_id uuid, p_open boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_open is null then raise exception 'invalid_value' using errcode = '22023'; end if;
  if not exists (select 1 from public.restaurant_members
                 where restaurant_id = p_restaurant_id and user_id = auth.uid()
                   and role in ('owner','admin','staff')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.restaurants set is_open = p_open where id = p_restaurant_id;
  return p_open;
end $$;
revoke all on function public.set_restaurant_open(uuid, boolean) from public, anon;
grant execute on function public.set_restaurant_open(uuid, boolean) to authenticated;

-- Estado público mínimo para el menú (no expone nada más)
create or replace function public.get_restaurant_status(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('is_open', r.is_open)
  from public.restaurants r
  where r.slug = lower(btrim(p_slug)) and r.is_published and not r.is_suspended
  limit 1;
$$;
revoke all on function public.get_restaurant_status(text) from public;
grant execute on function public.get_restaurant_status(text) to anon, authenticated;

-- El SERVIDOR rechaza pedidos si el negocio está cerrado (no depende del navegador).
create or replace function public.trg_block_orders_when_closed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.restaurants where id = new.restaurant_id and is_open = false) then
    raise exception 'restaurant_closed' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.trg_block_orders_when_closed() from public, anon, authenticated;
drop trigger if exists trg_orders_block_closed on public.orders;
create trigger trg_orders_block_closed before insert on public.orders
  for each row execute function public.trg_block_orders_when_closed();

-- 2) Conexión de pagos (solo LECTURA para dueño/admin; escribe únicamente el servidor con service_role)
create table if not exists public.payment_accounts (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  provider      text not null check (provider in ('wompi','mercadopago')),
  status        text not null default 'pending' check (status in ('pending','connected','error')),
  external_id   text,            -- id de la cuenta en el proveedor (nunca claves ni tokens)
  last_error    text,
  connected_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, provider)
);
alter table public.payment_accounts enable row level security;
drop policy if exists payment_accounts_select on public.payment_accounts;
create policy payment_accounts_select on public.payment_accounts for select to authenticated
  using (exists (select 1 from public.restaurant_members m
                 where m.restaurant_id = payment_accounts.restaurant_id and m.user_id = auth.uid()
                   and m.role in ('owner','admin')));
revoke all on public.payment_accounts from anon, authenticated;
grant select on public.payment_accounts to authenticated;
-- Credenciales/tokens del proveedor: guardarlos SOLO en secretos de Edge Functions o en una tabla sin acceso desde el navegador.
