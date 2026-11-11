-- ============================================================================
-- KARTTA · Inventario real conectado a productos y pedidos   (20261110)
--
-- Qué hace:
--  1) inventory_items      → existencias por restaurante (ligadas 1:1 a un producto, o insumos sueltos).
--  2) inventory_movements  → historial inmutable de entradas, salidas, ajustes, ventas y devoluciones.
--  3) inventory_order_lines→ registro de qué líneas de pedido ya descontaron stock (evita doble descuento).
--  4) Trigger en order_items: al crearse una línea de pedido se descuenta stock de forma ATÓMICA en el
--     servidor. Si no alcanza, el pedido completo se rechaza (nunca hay cantidades negativas).
--  5) Trigger en orders: al pasar a 'cancelado' se devuelve el stock (una sola vez por línea: idempotente).
--     (La base ya impide sacar un pedido del estado 'cancelado', por eso no hay lógica de reactivación.)
--  6) RPCs para el panel: inventory_save_item, inventory_move, inventory_deactivate_item.
--  7) Cuando un producto llega a 0 se marca "no disponible" en el menú; al reponer vuelve a estar disponible
--     (solo si fue el inventario quien lo ocultó; si el dueño lo ocultó a mano, no se toca).
--
-- Política de descuento: el stock se RESERVA al crear el pedido (estado 'nuevo'), sin esperar al pago, y se
-- devuelve si el pedido se cancela. No modifica place_order, pagos, suscripciones ni tablas existentes.
--
-- Es aditiva y NO destructiva: no borra ni altera datos. Se puede ejecutar más de una vez.
-- Aplicar: Supabase → SQL Editor → pegar todo → Run.
-- ============================================================================

-- 1) Tablas -------------------------------------------------------------------
create table if not exists public.inventory_items (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  product_id    uuid references public.products (id) on delete set null,
  name          text not null check (char_length(btrim(name)) between 1 and 120),
  unit          text not null default 'unidad'
                check (unit in ('unidad','porcion','kg','g','lb','l','ml','caja','paquete')),
  quantity      numeric(12,3) not null default 0 check (quantity >= 0),
  min_stock     numeric(12,3) not null default 0 check (min_stock >= 0),
  track_orders  boolean not null default true,    -- true: los pedidos descuentan automáticamente
  auto_hidden   boolean not null default false,   -- true: el inventario ocultó el producto por agotarse
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists inventory_items_product_uq on public.inventory_items (product_id) where product_id is not null;
create index if not exists inventory_items_rest_idx on public.inventory_items (restaurant_id, is_active);

create table if not exists public.inventory_movements (
  id            bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  item_id       uuid not null references public.inventory_items (id) on delete cascade,
  kind          text not null check (kind in ('inicial','entrada','salida','ajuste','venta','devolucion')),
  delta         numeric(12,3) not null,            -- con signo: + suma, − resta
  balance_after numeric(12,3) not null check (balance_after >= 0),
  order_id      uuid references public.orders (id) on delete set null,
  note          text check (char_length(note) <= 200),
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index if not exists inventory_mov_item_idx on public.inventory_movements (item_id, created_at desc);
create index if not exists inventory_mov_rest_idx on public.inventory_movements (restaurant_id, created_at desc);

create table if not exists public.inventory_order_lines (
  order_item_id uuid primary key references public.order_items (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  item_id       uuid not null references public.inventory_items (id) on delete cascade,
  qty           numeric(12,3) not null check (qty > 0),
  applied       boolean not null default true       -- true = stock descontado actualmente
);
create index if not exists inventory_lines_item_idx on public.inventory_order_lines (item_id);

-- 2) RLS: lectura solo para miembros del propio restaurante; escrituras SOLO vía funciones --------------
alter table public.inventory_items       enable row level security;
alter table public.inventory_movements   enable row level security;
alter table public.inventory_order_lines enable row level security;

drop policy if exists inventory_items_select on public.inventory_items;
create policy inventory_items_select on public.inventory_items for select to authenticated
  using (private.is_member(restaurant_id) or (select private.is_platform_admin()));
drop policy if exists inventory_mov_select on public.inventory_movements;
create policy inventory_mov_select on public.inventory_movements for select to authenticated
  using (private.is_member(restaurant_id) or (select private.is_platform_admin()));

revoke all on public.inventory_items, public.inventory_movements, public.inventory_order_lines from anon, authenticated;
grant select on public.inventory_items, public.inventory_movements to authenticated;

-- 3) Auxiliares internos ------------------------------------------------------
create or replace function private.inv_touch() returns trigger language plpgsql set search_path to '' as $f$
begin new.updated_at := now(); return new; end $f$;
drop trigger if exists trg_inventory_items_updated on public.inventory_items;
create trigger trg_inventory_items_updated before update on public.inventory_items
  for each row execute function private.inv_touch();

-- Sincroniza la disponibilidad del producto con su stock. Nunca debe romper un pedido: si el cambio
-- falla (p. ej. un límite de plan), se ignora y el pedido continúa.
create or replace function private.inv_sync_availability(p_item uuid) returns void
language plpgsql security definer set search_path to '' as $f$
declare it record; v_hit int;
begin
  select * into it from public.inventory_items where id = p_item;
  if not found or it.product_id is null or not it.track_orders or not it.is_active then return; end if;
  begin
    if it.quantity <= 0 and not it.auto_hidden then
      update public.products set is_available = false where id = it.product_id and is_available;
      get diagnostics v_hit = row_count;
      if v_hit > 0 then update public.inventory_items set auto_hidden = true where id = it.id; end if;
    elsif it.quantity > 0 and it.auto_hidden then
      update public.products set is_available = true where id = it.product_id;
      update public.inventory_items set auto_hidden = false where id = it.id;
    end if;
  exception when others then null;
  end;
end $f$;

-- 4) Descuento automático al crearse una línea de pedido ----------------------
create or replace function private.inv_on_order_item() returns trigger
language plpgsql security definer set search_path to '' as $f$
declare it record; v_after numeric;
begin
  if new.product_id is null then return new; end if;
  select * into it from public.inventory_items
   where product_id = new.product_id and restaurant_id = new.restaurant_id and track_orders and is_active
   for update;                                   -- bloquea la fila: pedidos simultáneos se ponen en fila
  if not found then return new; end if;
  update public.inventory_items set quantity = quantity - new.quantity
   where id = it.id and quantity >= new.quantity returning quantity into v_after;
  if not found then
    raise exception 'insufficient stock: %', it.name using errcode = 'K0001';
  end if;
  insert into public.inventory_movements (restaurant_id, item_id, kind, delta, balance_after, order_id)
    values (new.restaurant_id, it.id, 'venta', -new.quantity, v_after, new.order_id);
  insert into public.inventory_order_lines (order_item_id, restaurant_id, item_id, qty)
    values (new.id, new.restaurant_id, it.id, new.quantity) on conflict (order_item_id) do nothing;
  perform private.inv_sync_availability(it.id);
  return new;
end $f$;
drop trigger if exists trg_inventory_order_item on public.order_items;
create trigger trg_inventory_order_item after insert on public.order_items
  for each row execute function private.inv_on_order_item();

-- 5) Cancelar un pedido → devolver el stock (una sola vez por línea) -------------------------------------
create or replace function private.inv_on_order_status() returns trigger
language plpgsql security definer set search_path to '' as $f$
declare l record; v_after numeric;
begin
  if new.status = 'cancelado' and old.status is distinct from 'cancelado' then
    for l in select * from public.inventory_order_lines
              where applied and order_item_id in (select id from public.order_items where order_id = new.id)
              order by item_id for update loop
      update public.inventory_items set quantity = quantity + l.qty where id = l.item_id returning quantity into v_after;
      insert into public.inventory_movements (restaurant_id, item_id, kind, delta, balance_after, order_id, note)
        values (l.restaurant_id, l.item_id, 'devolucion', l.qty, v_after, new.id, 'Pedido cancelado');
      update public.inventory_order_lines set applied = false where order_item_id = l.order_item_id;
      perform private.inv_sync_availability(l.item_id);
    end loop;
  end if;
  return new;
end $f$;
drop trigger if exists trg_inventory_order_status on public.orders;
create trigger trg_inventory_order_status after update of status on public.orders
  for each row when (old.status is distinct from new.status) execute function private.inv_on_order_status();

-- 6) RPCs del panel -----------------------------------------------------------
-- Crear/editar un artículo de inventario (la cantidad solo cambia con inventory_move; aquí solo el inicial).
create or replace function public.inventory_save_item(
  p_restaurant uuid, p_item uuid, p_product uuid, p_name text, p_unit text,
  p_min numeric, p_track boolean, p_initial numeric default 0)
returns uuid language plpgsql security definer set search_path to '' as $f$
declare v_id uuid; v_name text := nullif(btrim(coalesce(p_name, '')), ''); v_pname text;
begin
  if auth.uid() is null or not private.has_role(p_restaurant, array['owner','admin']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_product is not null then
    select name into v_pname from public.products where id = p_product and restaurant_id = p_restaurant;
    if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
    v_name := coalesce(v_name, v_pname);
  end if;
  if v_name is null then raise exception 'name required' using errcode = '22023'; end if;
  if coalesce(p_min, 0) < 0 or coalesce(p_initial, 0) < 0 then raise exception 'invalid quantity' using errcode = '22023'; end if;

  if p_item is null then
    insert into public.inventory_items (restaurant_id, product_id, name, unit, quantity, min_stock, track_orders)
      values (p_restaurant, p_product, left(v_name, 120), coalesce(p_unit, 'unidad'), coalesce(p_initial, 0), coalesce(p_min, 0), coalesce(p_track, true))
      returning id into v_id;
    if coalesce(p_initial, 0) > 0 then
      insert into public.inventory_movements (restaurant_id, item_id, kind, delta, balance_after, note, created_by)
        values (p_restaurant, v_id, 'inicial', p_initial, p_initial, 'Existencia inicial', auth.uid());
    end if;
  else
    update public.inventory_items set name = left(v_name, 120), unit = coalesce(p_unit, unit), min_stock = coalesce(p_min, min_stock),
           track_orders = coalesce(p_track, track_orders), is_active = true
     where id = p_item and restaurant_id = p_restaurant returning id into v_id;
    if v_id is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  end if;
  perform private.inv_sync_availability(v_id);
  return v_id;
end $f$;

-- Entrada / salida manual / ajuste (cantidad final). Bloquea la fila: seguro con usos simultáneos.
create or replace function public.inventory_move(p_item uuid, p_kind text, p_qty numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path to '' as $f$
declare it record; v_new numeric; v_delta numeric;
begin
  if auth.uid() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kind not in ('entrada','salida','ajuste') then raise exception 'invalid kind' using errcode = '22023'; end if;
  if p_qty is null or p_qty < 0 or (p_kind <> 'ajuste' and p_qty = 0) then raise exception 'invalid quantity' using errcode = '22023'; end if;
  select * into it from public.inventory_items where id = p_item for update;
  if not found or not private.is_member(it.restaurant_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kind = 'ajuste' and not private.has_role(it.restaurant_id, array['owner','admin']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_new := case p_kind when 'entrada' then it.quantity + p_qty when 'salida' then it.quantity - p_qty else p_qty end;
  if v_new < 0 then raise exception 'insufficient stock: %', it.name using errcode = 'K0001'; end if;
  v_delta := v_new - it.quantity;
  update public.inventory_items set quantity = v_new where id = it.id;
  insert into public.inventory_movements (restaurant_id, item_id, kind, delta, balance_after, note, created_by)
    values (it.restaurant_id, it.id, p_kind, v_delta, v_new, left(nullif(btrim(coalesce(p_note, '')), ''), 200), auth.uid());
  perform private.inv_sync_availability(it.id);
  return jsonb_build_object('item_id', it.id, 'quantity', v_new, 'delta', v_delta);
end $f$;

-- Quitar del inventario sin borrar historial (el producto del menú no se toca).
create or replace function public.inventory_deactivate_item(p_item uuid) returns void
language plpgsql security definer set search_path to '' as $f$
declare it record;
begin
  select * into it from public.inventory_items where id = p_item for update;
  if not found or auth.uid() is null or not private.has_role(it.restaurant_id, array['owner','admin']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.inventory_items set is_active = false where id = it.id;
  if it.auto_hidden and it.product_id is not null then
    begin update public.products set is_available = true where id = it.product_id; exception when others then null; end;
    update public.inventory_items set auto_hidden = false where id = it.id;
  end if;
end $f$;

revoke all on function public.inventory_save_item(uuid, uuid, uuid, text, text, numeric, boolean, numeric) from public, anon;
revoke all on function public.inventory_move(uuid, text, numeric, text) from public, anon;
revoke all on function public.inventory_deactivate_item(uuid) from public, anon;
grant execute on function public.inventory_save_item(uuid, uuid, uuid, text, text, numeric, boolean, numeric) to authenticated;
grant execute on function public.inventory_move(uuid, text, numeric, text) to authenticated;
grant execute on function public.inventory_deactivate_item(uuid) to authenticated;
revoke all on function private.inv_sync_availability(uuid), private.inv_on_order_item(), private.inv_on_order_status() from public, anon, authenticated;
