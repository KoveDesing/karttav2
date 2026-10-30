-- =====================================================================
-- KARTTA — FIDELIZACIÓN (fase 2)   *** NO APLICADA NI PROBADA contra Postgres ***
-- Probar primero en una rama de Supabase. Aditiva e idempotente; no toca tablas existentes
-- salvo añadir un trigger sobre public.orders (acumula puntos cuando un pedido queda pagado).
-- Principios: los puntos SOLO se mueven dentro de funciones SECURITY DEFINER (nunca por escritura directa),
-- cada movimiento deja registro auditable, el saldo no puede ser negativo y no se duplican abonos por pedido.
-- Requiere: public.restaurants(id, slug, name, is_published, is_suspended, logo_path),
--           public.restaurant_members(restaurant_id, user_id, role), public.orders(id, restaurant_id, customer_phone, total, paid, status).
-- =====================================================================

-- ---------- utilidades ----------
create or replace function public.loyalty_norm_phone(p text)
returns text language sql immutable as $$
  select case
    when s.d is null then null
    when length(s.d) = 10 and s.d like '3%' then '57' || s.d      -- celular colombiano sin indicativo
    when length(s.d) between 8 and 15 then s.d
    else null end
  from (select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '') as d) s;
$$;

create or replace function public.loyalty_is_member(p_rid uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.restaurant_members m
                 where m.restaurant_id = p_rid and m.user_id = auth.uid() and m.role = any (p_roles));
$$;
revoke all on function public.loyalty_is_member(uuid, text[]) from public, anon;
grant execute on function public.loyalty_is_member(uuid, text[]) to authenticated;

-- ---------- tablas ----------
create table if not exists public.loyalty_settings (
  restaurant_id    uuid primary key references public.restaurants(id) on delete cascade,
  enabled          boolean not null default false,
  program_name     text not null default 'Puntos' check (char_length(program_name) between 1 and 40),
  points_per_1000  integer not null default 10 check (points_per_1000 between 0 and 1000),   -- puntos por cada $1.000 COP
  min_order_total  integer not null default 0 check (min_order_total between 0 and 10000000),
  welcome_points   integer not null default 0 check (welcome_points between 0 and 10000),
  spin_enabled     boolean not null default false,
  spin_prizes      jsonb not null default '[]'::jsonb,   -- [{label, points, weight}]
  card             jsonb not null default '{}'::jsonb,   -- diseño de la tarjeta (validado en loyalty_save_settings)
  terms            text check (char_length(terms) <= 600),
  updated_at       timestamptz not null default now()
);

create table if not exists public.loyalty_customers (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  phone           text not null check (phone ~ '^[0-9]{8,15}$'),
  name            text check (char_length(name) <= 80),
  balance         integer not null default 0 check (balance >= 0),
  lifetime        integer not null default 0 check (lifetime >= 0),
  card_token      uuid not null unique default gen_random_uuid(),
  consent_at      timestamptz not null,
  consent_source  text not null check (consent_source in ('self', 'staff')),
  created_at      timestamptz not null default now(),
  last_visit_at   timestamptz,
  unique (restaurant_id, phone)
);
create index if not exists loyalty_customers_rest_idx on public.loyalty_customers (restaurant_id, created_at desc);

create table if not exists public.loyalty_rewards (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 80),
  description    text check (char_length(description) <= 200),
  cost_points    integer not null check (cost_points between 1 and 1000000),
  active         boolean not null default true,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists loyalty_rewards_rest_idx on public.loyalty_rewards (restaurant_id, active, cost_points);

create table if not exists public.loyalty_movements (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  customer_id    uuid not null references public.loyalty_customers(id) on delete cascade,
  kind           text not null check (kind in ('earn', 'welcome', 'redeem', 'refund', 'adjust', 'game')),
  points         integer not null check (points <> 0),
  balance_after  integer not null check (balance_after >= 0),
  order_id       uuid,
  reward_id      uuid,
  redemption_id  uuid,
  day            date,
  note           text check (char_length(note) <= 200),
  created_by     uuid,
  created_at     timestamptz not null default now()
);
create index if not exists loyalty_mov_customer_idx on public.loyalty_movements (customer_id, created_at desc);
create unique index if not exists loyalty_mov_one_earn_per_order on public.loyalty_movements (order_id) where kind = 'earn';
create unique index if not exists loyalty_mov_one_welcome on public.loyalty_movements (customer_id) where kind = 'welcome';
create unique index if not exists loyalty_mov_one_game_per_day on public.loyalty_movements (customer_id, day) where kind = 'game';

create table if not exists public.loyalty_redemptions (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  customer_id    uuid not null references public.loyalty_customers(id) on delete cascade,
  reward_id      uuid,
  reward_name    text not null,
  points         integer not null check (points > 0),
  code           text not null,
  status         text not null default 'pending' check (status in ('pending', 'delivered', 'cancelled')),
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  resolved_by    uuid
);
create unique index if not exists loyalty_red_code_pending on public.loyalty_redemptions (restaurant_id, code) where status = 'pending';
create index if not exists loyalty_red_rest_idx on public.loyalty_redemptions (restaurant_id, status, created_at desc);

-- ---------- RLS: lectura para el equipo del restaurante; NINGUNA escritura directa ----------
alter table public.loyalty_settings    enable row level security;
alter table public.loyalty_customers   enable row level security;
alter table public.loyalty_rewards     enable row level security;
alter table public.loyalty_movements   enable row level security;
alter table public.loyalty_redemptions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['loyalty_settings', 'loyalty_customers', 'loyalty_rewards', 'loyalty_movements', 'loyalty_redemptions'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.loyalty_is_member(restaurant_id, array[''owner'',''admin'',''staff'']))', t || '_select', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------- núcleo: único punto que mueve saldos ----------
create or replace function public._loyalty_move(
  p_customer uuid, p_points integer, p_kind text,
  p_order uuid default null, p_reward uuid default null, p_redemption uuid default null,
  p_note text default null, p_by uuid default null, p_day date default null)
returns integer language plpgsql security definer set search_path = public as $$
declare c public.loyalty_customers; nb integer;
begin
  select * into c from public.loyalty_customers where id = p_customer for update;
  if not found then raise exception 'customer_not_found' using errcode = 'P0002'; end if;
  nb := c.balance + p_points;
  if nb < 0 then raise exception 'insufficient_points' using errcode = 'P0001'; end if;
  update public.loyalty_customers
     set balance = nb,
         lifetime = lifetime + case when p_kind in ('earn', 'welcome', 'game') then greatest(p_points, 0) else 0 end,
         last_visit_at = case when p_kind = 'earn' then now() else last_visit_at end
   where id = p_customer;
  insert into public.loyalty_movements (restaurant_id, customer_id, kind, points, balance_after, order_id, reward_id, redemption_id, day, note, created_by)
  values (c.restaurant_id, p_customer, p_kind, p_points, nb, p_order, p_reward, p_redemption, p_day, left(p_note, 200), p_by);
  return nb;
end $$;
revoke all on function public._loyalty_move(uuid, integer, text, uuid, uuid, uuid, text, uuid, date) from public, anon, authenticated;

-- Abono por pedido pagado (idempotente por pedido)
create or replace function public._loyalty_award(p_order uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; s public.loyalty_settings; c public.loyalty_customers; pts integer; ph text;
begin
  select id, restaurant_id, customer_phone, total, paid, status::text as status into o from public.orders where id = p_order;
  if not found then return jsonb_build_object('awarded', false, 'reason', 'order_not_found'); end if;
  if not coalesce(o.paid, false) or o.status = 'cancelado' then return jsonb_build_object('awarded', false, 'reason', 'not_paid'); end if;
  select * into s from public.loyalty_settings where restaurant_id = o.restaurant_id and enabled;
  if not found then return jsonb_build_object('awarded', false, 'reason', 'disabled'); end if;
  ph := public.loyalty_norm_phone(o.customer_phone);
  if ph is null then return jsonb_build_object('awarded', false, 'reason', 'no_phone'); end if;
  select * into c from public.loyalty_customers where restaurant_id = o.restaurant_id and phone = ph;
  if not found then return jsonb_build_object('awarded', false, 'reason', 'no_customer'); end if;
  if coalesce(o.total, 0) < s.min_order_total then return jsonb_build_object('awarded', false, 'reason', 'below_minimum'); end if;
  pts := floor(coalesce(o.total, 0) * s.points_per_1000 / 1000.0);
  if pts <= 0 then return jsonb_build_object('awarded', false, 'reason', 'zero_points'); end if;
  begin
    perform public._loyalty_move(c.id, pts, 'earn', p_order => o.id, p_note => 'Pedido pagado');
  exception when unique_violation then
    return jsonb_build_object('awarded', false, 'reason', 'already_awarded');
  end;
  return jsonb_build_object('awarded', true, 'points', pts);
end $$;
revoke all on function public._loyalty_award(uuid) from public, anon, authenticated;

-- Staff: abonar puntos de un pedido (por si el cliente se registró después de pagar)
create or replace function public.loyalty_award_order(p_order uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  select restaurant_id into rid from public.orders where id = p_order;
  if rid is null or not public.loyalty_is_member(rid, array['owner', 'admin', 'staff']) then raise exception 'forbidden' using errcode = '42501'; end if;
  return public._loyalty_award(p_order);
end $$;
revoke all on function public.loyalty_award_order(uuid) from public, anon;
grant execute on function public.loyalty_award_order(uuid) to authenticated;

-- Automático: cuando un pedido queda pagado (o cambia de estado ya pagado) se intenta abonar; nunca rompe la actualización del pedido
create or replace function public.trg_loyalty_auto_award()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin perform public._loyalty_award(new.id); exception when others then null; end;
  return new;
end $$;
revoke all on function public.trg_loyalty_auto_award() from public, anon, authenticated;
drop trigger if exists trg_orders_loyalty_award on public.orders;
create trigger trg_orders_loyalty_award after update of paid, status on public.orders
  for each row
  when (new.paid is true and new.status::text <> 'cancelado' and (old.paid is distinct from new.paid or old.status is distinct from new.status))
  execute function public.trg_loyalty_auto_award();

-- ---------- configuración (dueño/administrador) ----------
create or replace function public.loyalty_save_settings(p_restaurant uuid, p_settings jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare card jsonb := coalesce(p_settings -> 'card', '{}'::jsonb); prizes jsonb := coalesce(p_settings -> 'spin_prizes', '[]'::jsonb); pr jsonb; k text;
begin
  if not public.loyalty_is_member(p_restaurant, array['owner', 'admin']) then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(card) <> 'object' then raise exception 'invalid_card'; end if;
  foreach k in array array['bg1', 'bg2', 'text', 'accent'] loop
    if card ? k and (jsonb_typeof(card -> k) <> 'string' or (card ->> k) !~ '^#[0-9a-fA-F]{6}$') then raise exception 'invalid_color_%', k; end if;
  end loop;
  if card ? 'style' and (card ->> 'style') not in ('gradient', 'solid', 'dots', 'lines') then raise exception 'invalid_style'; end if;
  if card ? 'title' and char_length(card ->> 'title') > 30 then raise exception 'invalid_title'; end if;
  if card ? 'subtitle' and char_length(card ->> 'subtitle') > 40 then raise exception 'invalid_subtitle'; end if;
  if jsonb_typeof(prizes) <> 'array' or jsonb_array_length(prizes) > 8 then raise exception 'invalid_prizes'; end if;
  for pr in select * from jsonb_array_elements(prizes) loop
    if jsonb_typeof(pr) <> 'object' or char_length(coalesce(pr ->> 'label', '')) not between 1 and 30
       or coalesce((pr ->> 'points')::int, 0) not between 1 and 1000 or coalesce((pr ->> 'weight')::int, 0) not between 1 and 100 then
      raise exception 'invalid_prize';
    end if;
  end loop;
  insert into public.loyalty_settings (restaurant_id, enabled, program_name, points_per_1000, min_order_total, welcome_points, spin_enabled, spin_prizes, card, terms, updated_at)
  values (p_restaurant,
          coalesce((p_settings ->> 'enabled')::boolean, false),
          coalesce(nullif(btrim(p_settings ->> 'program_name'), ''), 'Puntos'),
          coalesce((p_settings ->> 'points_per_1000')::int, 10),
          coalesce((p_settings ->> 'min_order_total')::int, 0),
          coalesce((p_settings ->> 'welcome_points')::int, 0),
          coalesce((p_settings ->> 'spin_enabled')::boolean, false),
          prizes, card, nullif(btrim(p_settings ->> 'terms'), ''), now())
  on conflict (restaurant_id) do update set
    enabled = excluded.enabled, program_name = excluded.program_name, points_per_1000 = excluded.points_per_1000,
    min_order_total = excluded.min_order_total, welcome_points = excluded.welcome_points, spin_enabled = excluded.spin_enabled,
    spin_prizes = excluded.spin_prizes, card = excluded.card, terms = excluded.terms, updated_at = now();
end $$;
revoke all on function public.loyalty_save_settings(uuid, jsonb) from public, anon;
grant execute on function public.loyalty_save_settings(uuid, jsonb) to authenticated;

create or replace function public.loyalty_upsert_reward(p_restaurant uuid, p_id uuid, p_name text, p_description text, p_cost integer, p_active boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if not public.loyalty_is_member(p_restaurant, array['owner', 'admin']) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_id is null then
    insert into public.loyalty_rewards (restaurant_id, name, description, cost_points, active)
    values (p_restaurant, btrim(p_name), nullif(btrim(p_description), ''), p_cost, coalesce(p_active, true)) returning id into rid;
  else
    update public.loyalty_rewards set name = btrim(p_name), description = nullif(btrim(p_description), ''), cost_points = p_cost, active = coalesce(p_active, true)
     where id = p_id and restaurant_id = p_restaurant returning id into rid;
    if rid is null then raise exception 'reward_not_found' using errcode = 'P0002'; end if;
  end if;
  return rid;
end $$;
revoke all on function public.loyalty_upsert_reward(uuid, uuid, text, text, integer, boolean) from public, anon;
grant execute on function public.loyalty_upsert_reward(uuid, uuid, text, text, integer, boolean) to authenticated;

-- ---------- clientes ----------
-- Alta por el equipo (el cliente aceptó en persona). Si ya existe, devuelve su enlace para reenviarlo.
create or replace function public.loyalty_staff_create_customer(p_restaurant uuid, p_name text, p_phone text, p_consent_confirmed boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ph text := public.loyalty_norm_phone(p_phone); c public.loyalty_customers; s public.loyalty_settings; created boolean := false;
begin
  if not public.loyalty_is_member(p_restaurant, array['owner', 'admin', 'staff']) then raise exception 'forbidden' using errcode = '42501'; end if;
  if ph is null then raise exception 'invalid_phone'; end if;
  if not coalesce(p_consent_confirmed, false) then raise exception 'consent_required'; end if;
  select * into c from public.loyalty_customers where restaurant_id = p_restaurant and phone = ph;
  if not found then
    insert into public.loyalty_customers (restaurant_id, phone, name, consent_at, consent_source)
    values (p_restaurant, ph, left(nullif(btrim(p_name), ''), 80), now(), 'staff') returning * into c;
    created := true;
    select * into s from public.loyalty_settings where restaurant_id = p_restaurant;
    if found and s.welcome_points > 0 then perform public._loyalty_move(c.id, s.welcome_points, 'welcome', p_note => 'Bono de bienvenida', p_by => auth.uid()); end if;
  end if;
  return jsonb_build_object('created', created, 'customer_id', c.id, 'token', c.card_token);
end $$;
revoke all on function public.loyalty_staff_create_customer(uuid, text, text, boolean) from public, anon;
grant execute on function public.loyalty_staff_create_customer(uuid, text, text, boolean) to authenticated;

-- Ajuste manual (solo dueño/administrador; nota obligatoria; nunca deja saldo negativo)
create or replace function public.loyalty_adjust(p_customer uuid, p_delta integer, p_note text)
returns integer language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  select restaurant_id into rid from public.loyalty_customers where id = p_customer;
  if rid is null or not public.loyalty_is_member(rid, array['owner', 'admin']) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000 then raise exception 'invalid_points'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'note_required'; end if;
  return public._loyalty_move(p_customer, p_delta, 'adjust', p_note => p_note, p_by => auth.uid());
end $$;
revoke all on function public.loyalty_adjust(uuid, integer, text) from public, anon;
grant execute on function public.loyalty_adjust(uuid, integer, text) to authenticated;

-- Entregar o cancelar (devuelve los puntos) un canje pendiente
create or replace function public.loyalty_resolve_redemption(p_redemption uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.loyalty_redemptions;
begin
  if p_status not in ('delivered', 'cancelled') then raise exception 'invalid_status'; end if;
  select * into r from public.loyalty_redemptions where id = p_redemption for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.loyalty_is_member(r.restaurant_id, array['owner', 'admin', 'staff']) then raise exception 'forbidden' using errcode = '42501'; end if;
  if r.status <> 'pending' then raise exception 'already_resolved'; end if;
  update public.loyalty_redemptions set status = p_status, resolved_at = now(), resolved_by = auth.uid() where id = r.id;
  if p_status = 'cancelled' then
    perform public._loyalty_move(r.customer_id, r.points, 'refund', p_reward => r.reward_id, p_redemption => r.id, p_note => 'Canje cancelado', p_by => auth.uid());
  end if;
end $$;
revoke all on function public.loyalty_resolve_redemption(uuid, text) from public, anon;
grant execute on function public.loyalty_resolve_redemption(uuid, text) to authenticated;

-- ---------- PÚBLICO (anon): menú y tarjeta del cliente ----------
create or replace function public.get_loyalty_public(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('enabled', true, 'program_name', s.program_name, 'welcome_points', s.welcome_points, 'restaurant', r.name)
  from public.restaurants r join public.loyalty_settings s on s.restaurant_id = r.id
  where r.slug = lower(btrim(p_slug)) and r.is_published and not r.is_suspended and s.enabled
  limit 1;
$$;
revoke all on function public.get_loyalty_public(text) from public;
grant execute on function public.get_loyalty_public(text) to anon, authenticated;

-- Registro del cliente desde el menú. NO devuelve el enlace de un cliente ya existente (el teléfono no es una contraseña).
create or replace function public.loyalty_join(p_slug text, p_name text, p_phone text, p_consent boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.restaurants; s public.loyalty_settings; ph text := public.loyalty_norm_phone(p_phone); c public.loyalty_customers;
begin
  select * into r from public.restaurants where slug = lower(btrim(p_slug)) and is_published and not is_suspended;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into s from public.loyalty_settings where restaurant_id = r.id and enabled;
  if not found then raise exception 'disabled'; end if;
  if not coalesce(p_consent, false) then raise exception 'consent_required'; end if;
  if ph is null then raise exception 'invalid_phone'; end if;
  if (select count(*) from public.loyalty_customers where restaurant_id = r.id and created_at > now() - interval '1 minute') >= 30 then raise exception 'rate_limited'; end if;
  insert into public.loyalty_customers (restaurant_id, phone, name, consent_at, consent_source)
  values (r.id, ph, left(nullif(btrim(p_name), ''), 80), now(), 'self')
  on conflict (restaurant_id, phone) do nothing returning * into c;
  if not found then return jsonb_build_object('status', 'exists'); end if;
  if s.welcome_points > 0 then perform public._loyalty_move(c.id, s.welcome_points, 'welcome', p_note => 'Bono de bienvenida'); end if;
  return jsonb_build_object('status', 'created', 'token', c.card_token);
end $$;
revoke all on function public.loyalty_join(text, text, text, boolean) from public;
grant execute on function public.loyalty_join(text, text, text, boolean) to anon, authenticated;

create or replace function public.get_loyalty_card(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.loyalty_customers; r public.restaurants; s public.loyalty_settings; played boolean;
begin
  select * into c from public.loyalty_customers where card_token = p_token;
  if not found then return null; end if;
  select * into r from public.restaurants where id = c.restaurant_id;
  select * into s from public.loyalty_settings where restaurant_id = c.restaurant_id;
  if not found or not s.enabled or r.is_suspended then return null; end if;
  select exists (select 1 from public.loyalty_movements where customer_id = c.id and kind = 'game' and day = (now() at time zone 'America/Bogota')::date) into played;
  return jsonb_build_object(
    'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'logo_path', r.logo_path),
    'program', jsonb_build_object('name', s.program_name, 'card', s.card, 'terms', s.terms),
    'customer', jsonb_build_object('name', c.name, 'phone_last4', right(c.phone, 4), 'balance', c.balance, 'lifetime', c.lifetime),
    'rewards', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'description', w.description, 'cost_points', w.cost_points) order by w.cost_points)
                         from public.loyalty_rewards w where w.restaurant_id = c.restaurant_id and w.active), '[]'::jsonb),
    'movements', coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'points', m.points, 'note', m.note, 'at', m.created_at) order by m.created_at desc)
                           from (select * from public.loyalty_movements where customer_id = c.id order by created_at desc limit 15) m), '[]'::jsonb),
    'pending', coalesce((select jsonb_agg(jsonb_build_object('code', d.code, 'reward', d.reward_name, 'points', d.points) order by d.created_at desc)
                         from public.loyalty_redemptions d where d.customer_id = c.id and d.status = 'pending'), '[]'::jsonb),
    'spin', jsonb_build_object('enabled', s.spin_enabled and jsonb_array_length(s.spin_prizes) > 0, 'played_today', played,
                               'prizes', case when s.spin_enabled then (select coalesce(jsonb_agg(p ->> 'label'), '[]'::jsonb) from jsonb_array_elements(s.spin_prizes) p) else '[]'::jsonb end));
end $$;
revoke all on function public.get_loyalty_card(uuid) from public;
grant execute on function public.get_loyalty_card(uuid) to anon, authenticated;

-- El cliente pide un canje: se descuentan los puntos de inmediato y queda PENDIENTE hasta que el local lo entregue (o cancele y devuelva los puntos)
create or replace function public.loyalty_request_redemption(p_token uuid, p_reward uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.loyalty_customers; w public.loyalty_rewards; s public.loyalty_settings; rid uuid; code text; tries integer := 0; nb integer;
begin
  select * into c from public.loyalty_customers where card_token = p_token for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into s from public.loyalty_settings where restaurant_id = c.restaurant_id and enabled;
  if not found then raise exception 'disabled'; end if;
  select * into w from public.loyalty_rewards where id = p_reward and restaurant_id = c.restaurant_id and active;
  if not found then raise exception 'reward_not_available'; end if;
  if (select count(*) from public.loyalty_redemptions where customer_id = c.id and status = 'pending') >= 3 then raise exception 'too_many_pending'; end if;
  if c.balance < w.cost_points then raise exception 'insufficient_points'; end if;
  rid := gen_random_uuid();
  loop
    code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into public.loyalty_redemptions (id, restaurant_id, customer_id, reward_id, reward_name, points, code)
      values (rid, c.restaurant_id, c.id, w.id, w.name, w.cost_points, code);
      exit;
    exception when unique_violation then
      tries := tries + 1; if tries > 5 then raise; end if;
    end;
  end loop;
  nb := public._loyalty_move(c.id, -w.cost_points, 'redeem', p_reward => w.id, p_redemption => rid, p_note => w.name);
  return jsonb_build_object('code', code, 'reward', w.name, 'balance', nb);
end $$;
revoke all on function public.loyalty_request_redemption(uuid, uuid) from public;
grant execute on function public.loyalty_request_redemption(uuid, uuid) to anon, authenticated;

-- Juego: ruleta de 1 giro al día; el azar y el límite se resuelven en el servidor
create or replace function public.loyalty_play_spin(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.loyalty_customers; s public.loyalty_settings; total integer := 0; roll numeric; acc integer := 0; pr jsonb; chosen jsonb; nb integer; today date := (now() at time zone 'America/Bogota')::date;
begin
  select * into c from public.loyalty_customers where card_token = p_token for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into s from public.loyalty_settings where restaurant_id = c.restaurant_id and enabled and spin_enabled;
  if not found or jsonb_array_length(s.spin_prizes) = 0 then raise exception 'disabled'; end if;
  if exists (select 1 from public.loyalty_movements where customer_id = c.id and kind = 'game' and day = today) then raise exception 'already_played'; end if;
  for pr in select * from jsonb_array_elements(s.spin_prizes) loop total := total + (pr ->> 'weight')::int; end loop;
  roll := random() * total;
  for pr in select * from jsonb_array_elements(s.spin_prizes) loop
    acc := acc + (pr ->> 'weight')::int;
    if roll < acc then chosen := pr; exit; end if;
  end loop;
  if chosen is null then chosen := s.spin_prizes -> 0; end if;
  nb := public._loyalty_move(c.id, (chosen ->> 'points')::int, 'game', p_note => 'Ruleta: ' || (chosen ->> 'label'), p_day => today);
  return jsonb_build_object('label', chosen ->> 'label', 'points', (chosen ->> 'points')::int, 'balance', nb);
end $$;
revoke all on function public.loyalty_play_spin(uuid) from public;
grant execute on function public.loyalty_play_spin(uuid) to anon, authenticated;
