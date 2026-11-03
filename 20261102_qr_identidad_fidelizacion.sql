-- =====================================================================================
-- KARTTA · 02-nov-2026 · Acceso por QR de mesa, identidad verificada del cliente (OTP)
--          y tarjeta digital de fidelización ampliada.
-- Idempotente (se puede ejecutar más de una vez). Aplicar primero en una rama de Supabase.
-- No borra datos. Cambios de comportamiento a tener presentes:
--   · public.place_order(...) deja de ser invocable desde el navegador (se usa place_table_order).
--   · public.loyalty_join / get_loyalty_card / loyalty_request_redemption / loyalty_play_spin
--     dejan de ser invocables con el enlace secreto: ahora se usa una sesión verificada por OTP.
-- =====================================================================================

-- ---------- 1) MESAS: token QR único, activación y sesiones de mesa ----------

alter table public.restaurant_tables add column if not exists qr_token uuid not null default gen_random_uuid();
alter table public.restaurant_tables add column if not exists is_active boolean not null default true;
create unique index if not exists restaurant_tables_qr_token_key on public.restaurant_tables (qr_token);
grant select (qr_token, is_active) on public.restaurant_tables to authenticated;

create or replace function public.table_set_active(p_table uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_rid uuid;
begin
  select restaurant_id into v_rid from public.restaurant_tables where id = p_table;
  if v_rid is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not private.has_role(v_rid, array['owner', 'admin']) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.restaurant_tables set is_active = coalesce(p_active, true) where id = p_table;
end $$;

-- Regenerar el QR invalida el QR impreso anterior y las sesiones abiertas de esa mesa.
create or replace function public.table_rotate_qr(p_table uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_rid uuid; v_new uuid := gen_random_uuid();
begin
  select restaurant_id into v_rid from public.restaurant_tables where id = p_table;
  if v_rid is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not private.has_role(v_rid, array['owner', 'admin']) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.restaurant_tables set qr_token = v_new where id = p_table;
  delete from public.table_qr_sessions where table_id = p_table;
  return v_new;
end $$;

create table if not exists public.table_qr_sessions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_id uuid not null references public.restaurant_tables (id) on delete cascade,
  session_token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '6 hours',
  last_seen_at timestamptz
);
create index if not exists table_qr_sessions_rest_idx on public.table_qr_sessions (restaurant_id, created_at desc);
create index if not exists table_qr_sessions_exp_idx on public.table_qr_sessions (expires_at);
alter table public.table_qr_sessions enable row level security;
revoke all on public.table_qr_sessions from anon, authenticated;

alter table public.orders add column if not exists table_id uuid references public.restaurant_tables (id) on delete set null;
alter table public.orders add column if not exists qr_session_id uuid references public.table_qr_sessions (id) on delete set null;
alter table public.orders add column if not exists customer_id uuid references public.loyalty_customers (id) on delete set null;
create index if not exists orders_customer_idx on public.orders (customer_id) where customer_id is not null;
grant select (table_id, qr_session_id, customer_id) on public.orders to authenticated;

-- El cliente escanea el QR → recibe una sesión de mesa (el servidor valida restaurante y mesa).
create or replace function public.start_table_session(p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t record; s public.table_qr_sessions;
begin
  select tb.id, tb.restaurant_id, tb.label, tb.is_active, r.slug, r.name as rname, r.is_published, r.is_suspended
    into t from public.restaurant_tables tb join public.restaurants r on r.id = tb.restaurant_id
   where tb.qr_token = p_token;
  if not found then raise exception 'invalid_qr' using errcode = 'P0002'; end if;
  if not t.is_active then raise exception 'table_disabled' using errcode = 'P0001'; end if;
  if not t.is_published or t.is_suspended then raise exception 'restaurant_unavailable' using errcode = 'P0002'; end if;
  if (select count(*) from public.table_qr_sessions where restaurant_id = t.restaurant_id and created_at > now() - interval '1 minute') >= 120 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  delete from public.table_qr_sessions where expires_at < now() - interval '2 days';
  insert into public.table_qr_sessions (restaurant_id, table_id) values (t.restaurant_id, t.id) returning * into s;
  return jsonb_build_object('session', s.session_token, 'expires_at', s.expires_at, 'slug', t.slug, 'table', t.label, 'restaurant', t.rname);
end $$;

create or replace function public.get_table_session(p_session uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  select qs.expires_at, tb.label, tb.is_active, r.slug, r.name as rname, r.is_published, r.is_suspended
    into t from public.table_qr_sessions qs
    join public.restaurant_tables tb on tb.id = qs.table_id
    join public.restaurants r on r.id = qs.restaurant_id
   where qs.session_token = p_session;
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  if t.expires_at <= now() then return jsonb_build_object('status', 'expired', 'slug', t.slug); end if;
  if not t.is_active then return jsonb_build_object('status', 'table_disabled', 'slug', t.slug); end if;
  if not t.is_published or t.is_suspended then return jsonb_build_object('status', 'invalid'); end if;
  return jsonb_build_object('status', 'valid', 'slug', t.slug, 'table', t.label, 'restaurant', t.rname, 'expires_at', t.expires_at);
end $$;

-- ---------- 2) FIDELIZACIÓN: columnas nuevas ----------

alter table public.loyalty_customers add column if not exists phone_verified_at timestamptz;
alter table public.loyalty_customers add column if not exists marketing_consent boolean not null default false;
alter table public.loyalty_customers add column if not exists marketing_consent_at timestamptz;
alter table public.loyalty_customers add column if not exists privacy_version text;
grant select (phone_verified_at, marketing_consent, marketing_consent_at, privacy_version) on public.loyalty_customers to authenticated;

alter table public.loyalty_settings add column if not exists tiers_enabled boolean not null default false;
alter table public.loyalty_settings add column if not exists tiers jsonb not null default '[]'::jsonb;
alter table public.loyalty_settings add column if not exists require_identity boolean not null default false;
grant select (tiers_enabled, tiers, require_identity) on public.loyalty_settings to authenticated;

alter table public.loyalty_rewards add column if not exists conditions text check (char_length(conditions) <= 200);
alter table public.loyalty_rewards add column if not exists valid_from timestamptz;
alter table public.loyalty_rewards add column if not exists valid_until timestamptz;
alter table public.loyalty_rewards add column if not exists max_per_customer integer check (max_per_customer between 1 and 1000);
alter table public.loyalty_rewards add column if not exists max_total integer check (max_total between 1 and 1000000);
grant select (conditions, valid_from, valid_until, max_per_customer, max_total) on public.loyalty_rewards to authenticated;

-- (El reverso/re-abono por pedido es idempotente por saldo neto del pedido; no necesita índice único.)
drop index if exists public.loyalty_mov_one_reversal_per_order;

-- ---------- 3) VERIFICACIÓN DE TELÉFONO (OTP) Y SESIONES DE CLIENTE ----------

create table if not exists public.customer_phone_verifications (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  phone text not null check (phone ~ '^[0-9]{8,15}$'),
  channel text not null check (channel in ('sms', 'whatsapp')),
  code_hash text not null check (char_length(code_hash) = 64),
  attempts integer not null default 0 check (attempts >= 0),
  ip_hash text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index if not exists cpv_lookup_idx on public.customer_phone_verifications (restaurant_id, phone, created_at desc);
create index if not exists cpv_ip_idx on public.customer_phone_verifications (ip_hash, created_at desc) where ip_hash is not null;
alter table public.customer_phone_verifications enable row level security;
revoke all on public.customer_phone_verifications from anon, authenticated;

create table if not exists public.customer_sessions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  customer_id uuid not null references public.loyalty_customers (id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists customer_sessions_customer_idx on public.customer_sessions (customer_id);
alter table public.customer_sessions enable row level security;
revoke all on public.customer_sessions from anon, authenticated;

-- Resuelve el cliente de una sesión (solo uso interno desde funciones SECURITY DEFINER).
create or replace function public._customer_from_session(p_token text, p_restaurant uuid default null)
returns public.loyalty_customers language plpgsql security definer set search_path = 'public' as $$
declare s public.customer_sessions; c public.loyalty_customers;
begin
  if p_token is null or char_length(p_token) not between 32 and 128 then return null; end if;
  select * into s from public.customer_sessions
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and revoked_at is null and expires_at > now();
  if not found then return null; end if;
  if p_restaurant is not null and s.restaurant_id <> p_restaurant then return null; end if;
  select * into c from public.loyalty_customers where id = s.customer_id;
  if not found then return null; end if;
  update public.customer_sessions set last_used_at = now()
   where id = s.id and (last_used_at is null or last_used_at < now() - interval '5 minutes');
  return c;
end $$;

-- Emite un código (solo service_role: la Edge Function genera el código, lo envía y guarda solo su hash).
create or replace function public.otp_issue(p_slug text, p_phone text, p_channel text, p_code_hash text, p_ip_hash text)
returns jsonb language plpgsql security definer set search_path = 'public' as $$
declare r public.restaurants; ph text := public.loyalty_norm_phone(p_phone);
begin
  select * into r from public.restaurants where slug = lower(btrim(p_slug)) and is_published and not is_suspended;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.loyalty_settings where restaurant_id = r.id and enabled) then raise exception 'disabled'; end if;
  if ph is null then raise exception 'invalid_phone'; end if;
  if p_channel not in ('sms', 'whatsapp') then raise exception 'invalid_channel'; end if;
  if p_code_hash is null or char_length(p_code_hash) <> 64 then raise exception 'invalid_request'; end if;
  if (select count(*) from public.customer_phone_verifications where restaurant_id = r.id and phone = ph and created_at > now() - interval '10 minutes') >= 3 then raise exception 'rate_limited'; end if;
  if p_ip_hash is not null and (select count(*) from public.customer_phone_verifications where ip_hash = p_ip_hash and created_at > now() - interval '10 minutes') >= 10 then raise exception 'rate_limited'; end if;
  if (select count(*) from public.customer_phone_verifications where restaurant_id = r.id and created_at > now() - interval '1 minute') >= 30 then raise exception 'rate_limited'; end if;
  update public.customer_phone_verifications set consumed_at = now() where restaurant_id = r.id and phone = ph and consumed_at is null;
  insert into public.customer_phone_verifications (restaurant_id, phone, channel, code_hash, ip_hash, expires_at)
  values (r.id, ph, p_channel, p_code_hash, p_ip_hash, now() + interval '10 minutes');
  delete from public.customer_phone_verifications where created_at < now() - interval '2 days';
  return jsonb_build_object('phone', ph, 'restaurant', r.name);
end $$;

-- Comprueba el código; si es correcto crea (o reconoce) al cliente y abre su sesión. Los fallos NO lanzan
-- excepción para que el contador de intentos quede guardado.
create or replace function public.otp_verify(p_slug text, p_phone text, p_code_hash text, p_name text, p_consent boolean, p_marketing boolean, p_session_hash text)
returns jsonb language plpgsql security definer set search_path = 'public' as $$
declare r public.restaurants; s public.loyalty_settings; ph text := public.loyalty_norm_phone(p_phone);
        v public.customer_phone_verifications; c public.loyalty_customers; is_new boolean := false;
begin
  select * into r from public.restaurants where slug = lower(btrim(p_slug)) and is_published and not is_suspended;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into s from public.loyalty_settings where restaurant_id = r.id and enabled;
  if not found then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;
  if ph is null or p_session_hash is null or char_length(p_session_hash) <> 64 then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;
  select * into v from public.customer_phone_verifications
   where restaurant_id = r.id and phone = ph and consumed_at is null order by created_at desc limit 1 for update;
  if not found or v.expires_at < now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if v.attempts >= 5 then return jsonb_build_object('ok', false, 'reason', 'too_many_attempts'); end if;
  if v.code_hash <> p_code_hash then
    update public.customer_phone_verifications set attempts = attempts + 1 where id = v.id;
    return jsonb_build_object('ok', false, 'reason', 'invalid_code', 'attempts_left', greatest(0, 4 - v.attempts));
  end if;

  select * into c from public.loyalty_customers where restaurant_id = r.id and phone = ph for update;
  if not found then
    if not coalesce(p_consent, false) then return jsonb_build_object('ok', false, 'reason', 'consent_required'); end if;
    if nullif(btrim(coalesce(p_name, '')), '') is null then return jsonb_build_object('ok', false, 'reason', 'name_required'); end if;
    insert into public.loyalty_customers (restaurant_id, phone, name, consent_at, consent_source, phone_verified_at, marketing_consent, marketing_consent_at, privacy_version)
    values (r.id, ph, left(btrim(p_name), 80), now(), 'self', now(), coalesce(p_marketing, false), case when coalesce(p_marketing, false) then now() end, 'v1')
    returning * into c;
    is_new := true;
    if s.welcome_points > 0 then perform public._loyalty_move(c.id, s.welcome_points, 'welcome', p_note => 'Bono de bienvenida'); end if;
  else
    update public.loyalty_customers
       set phone_verified_at = coalesce(phone_verified_at, now()),
           name = coalesce(name, left(nullif(btrim(coalesce(p_name, '')), ''), 80))
     where id = c.id returning * into c;
  end if;

  update public.customer_phone_verifications set consumed_at = now() where id = v.id;
  insert into public.customer_sessions (restaurant_id, customer_id, token_hash) values (r.id, c.id, p_session_hash);
  delete from public.customer_sessions where customer_id = c.id and id not in
    (select id from public.customer_sessions where customer_id = c.id order by created_at desc limit 10);
  return jsonb_build_object('ok', true, 'is_new', is_new, 'name', c.name);
end $$;

revoke all on function public.otp_issue(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.otp_verify(text, text, text, text, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.otp_issue(text, text, text, text, text) to service_role;
grant execute on function public.otp_verify(text, text, text, text, boolean, boolean, text) to service_role;
revoke all on function public._customer_from_session(text, uuid) from public, anon, authenticated;

-- ---------- 4) PEDIDOS: solo con sesión de mesa válida ----------

create or replace function public.place_table_order(p_session uuid, p_name text, p_phone text, p_items jsonb, p_customer_session text default null)
returns jsonb language plpgsql security definer set search_path = 'public' as $$
declare s record; c public.loyalty_customers; ls public.loyalty_settings; has_ls boolean; res jsonb; v_name text := p_name; v_phone text := p_phone;
begin
  select qs.id as sid, qs.restaurant_id as rid, qs.table_id as tid, qs.expires_at, tb.label, tb.is_active, r.slug, r.is_published, r.is_suspended
    into s from public.table_qr_sessions qs
    join public.restaurant_tables tb on tb.id = qs.table_id
    join public.restaurants r on r.id = qs.restaurant_id
   where qs.session_token = p_session;
  if not found or s.expires_at <= now() then raise exception 'invalid_table_session' using errcode = 'P0001'; end if;
  if not s.is_active then raise exception 'table_disabled' using errcode = 'P0001'; end if;
  if not s.is_published or s.is_suspended then raise exception 'restaurant not available' using errcode = 'P0002'; end if;

  select * into ls from public.loyalty_settings where restaurant_id = s.rid; has_ls := found;
  if p_customer_session is not null and p_customer_session <> '' then
    c := public._customer_from_session(p_customer_session, s.rid);
    if c.id is null then raise exception 'invalid_customer_session' using errcode = 'P0001'; end if;
    v_name := coalesce(nullif(c.name, ''), p_name); v_phone := c.phone;
  elsif has_ls and ls.enabled and ls.require_identity then
    raise exception 'identity_required' using errcode = 'P0001';
  end if;

  res := public.place_order(s.slug, s.label, v_name, v_phone, p_items);
  if not coalesce((res ->> 'duplicate')::boolean, false) then
    update public.orders set table_id = s.tid, qr_session_id = s.sid, customer_id = c.id where id = (res ->> 'order_id')::uuid;
  end if;
  return res || jsonb_build_object('table', s.label);
end $$;

-- El navegador ya no puede crear pedidos con una mesa escrita a mano.
revoke execute on function public.place_order(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.place_table_order(uuid, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.start_table_session(uuid) to anon, authenticated;
grant execute on function public.get_table_session(uuid) to anon, authenticated;
grant execute on function public.table_set_active(uuid, boolean) to authenticated;
grant execute on function public.table_rotate_qr(uuid) to authenticated;
revoke execute on function public.table_set_active(uuid, boolean) from public, anon;
revoke execute on function public.table_rotate_qr(uuid) from public, anon;

-- ---------- 5) PUNTOS: solo clientes verificados, con reverso por cancelación/reembolso ----------

create or replace function public._loyalty_award(p_order uuid)
returns jsonb language plpgsql security definer set search_path = 'public' as $$
declare o record; s public.loyalty_settings; c public.loyalty_customers; pts integer; net integer; delta integer; has_earn boolean;
begin
  select id, restaurant_id, customer_id, total, paid, status::text as status into o from public.orders where id = p_order;
  if not found then return jsonb_build_object('awarded', false, 'reason', 'order_not_found'); end if;
  if not coalesce(o.paid, false) or o.status = 'cancelado' then return jsonb_build_object('awarded', false, 'reason', 'not_paid'); end if;
  select * into s from public.loyalty_settings where restaurant_id = o.restaurant_id and enabled;
  if not found then return jsonb_build_object('awarded', false, 'reason', 'disabled'); end if;
  if o.customer_id is null then return jsonb_build_object('awarded', false, 'reason', 'no_verified_customer'); end if;
  select * into c from public.loyalty_customers where id = o.customer_id and restaurant_id = o.restaurant_id and phone_verified_at is not null for update;
  if not found then return jsonb_build_object('awarded', false, 'reason', 'no_verified_customer'); end if;
  if coalesce(o.total, 0) < s.min_order_total then return jsonb_build_object('awarded', false, 'reason', 'below_minimum'); end if;
  pts := floor(coalesce(o.total, 0) * s.points_per_1000 / 1000.0);
  if pts <= 0 then return jsonb_build_object('awarded', false, 'reason', 'zero_points'); end if;
  -- saldo neto que este pedido ya aporta (abono menos reversos); el cliente está bloqueado, así que es seguro
  select coalesce(sum(points), 0), coalesce(bool_or(kind = 'earn'), false) into net, has_earn
    from public.loyalty_movements where order_id = p_order and kind in ('earn', 'adjust');
  if not has_earn then
    begin
      perform public._loyalty_move(c.id, pts, 'earn', p_order => o.id, p_note => 'Pedido pagado');
    exception when unique_violation then
      return jsonb_build_object('awarded', false, 'reason', 'already_awarded');
    end;
    return jsonb_build_object('awarded', true, 'points', pts);
  end if;
  delta := pts - net;
  if delta <= 0 then return jsonb_build_object('awarded', false, 'reason', 'already_awarded'); end if;
  perform public._loyalty_move(c.id, delta, 'adjust', p_order => o.id, p_note => 'Pedido pagado (reactivado)');
  update public.loyalty_customers set lifetime = lifetime + delta where id = c.id;
  return jsonb_build_object('awarded', true, 'points', delta);
end $$;

create or replace function public._loyalty_reverse(p_order uuid)
returns jsonb language plpgsql security definer set search_path = 'public' as $$
declare m public.loyalty_movements; c public.loyalty_customers; net integer; amt integer;
begin
  select * into m from public.loyalty_movements where order_id = p_order and kind = 'earn';
  if not found then return jsonb_build_object('reversed', false, 'reason', 'no_award'); end if;
  select * into c from public.loyalty_customers where id = m.customer_id for update;
  if not found then return jsonb_build_object('reversed', false, 'reason', 'no_customer'); end if;
  select coalesce(sum(points), 0) into net from public.loyalty_movements where order_id = p_order and kind in ('earn', 'adjust');
  if net <= 0 then return jsonb_build_object('reversed', false, 'reason', 'already_reversed'); end if;
  amt := least(net, c.balance);
  if amt <= 0 then return jsonb_build_object('reversed', false, 'reason', 'no_balance'); end if;
  perform public._loyalty_move(c.id, -amt, 'adjust', p_order => p_order,
    p_note => case when amt < net then 'Reversión parcial (' || amt || ' de ' || net || '): pedido cancelado o sin pago'
                   else 'Reversión: pedido cancelado o sin pago' end);
  update public.loyalty_customers set lifetime = greatest(0, lifetime - amt) where id = c.id;
  return jsonb_build_object('reversed', true, 'points', amt);
end $$;

create or replace function public.trg_loyalty_auto_reverse()
returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  begin perform public._loyalty_reverse(new.id); exception when others then null; end;
  return new;
end $$;

drop trigger if exists trg_orders_loyalty_reverse on public.orders;
create trigger trg_orders_loyalty_reverse after update of paid, status on public.orders
  for each row when (old.paid is true and (new.paid is not true or new.status = 'cancelado'))
  execute function public.trg_loyalty_auto_reverse();

-- ---------- 6) RECOMPENSAS: vigencia, límites y condiciones ----------

create or replace function public.loyalty_upsert_reward_v2(p_restaurant uuid, p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare rid uuid; v_from timestamptz; v_until timestamptz; v_mpc integer; v_mt integer; v_cost integer;
begin
  if not public.loyalty_is_member(p_restaurant, array['owner', 'admin']) then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'invalid_reward'; end if;
  if char_length(btrim(coalesce(p ->> 'name', ''))) not between 1 and 80 then raise exception 'invalid_reward_name'; end if;
  if char_length(coalesce(p ->> 'description', '')) > 200 then raise exception 'invalid_reward_description'; end if;
  if char_length(coalesce(p ->> 'conditions', '')) > 200 then raise exception 'invalid_reward_conditions'; end if;
  v_cost := (p ->> 'cost_points')::int;
  if v_cost is null or v_cost not between 1 and 1000000 then raise exception 'invalid_reward_cost'; end if;
  v_from := nullif(p ->> 'valid_from', '')::timestamptz; v_until := nullif(p ->> 'valid_until', '')::timestamptz;
  if v_from is not null and v_until is not null and v_until <= v_from then raise exception 'invalid_reward_dates'; end if;
  v_mpc := nullif(p ->> 'max_per_customer', '')::int; v_mt := nullif(p ->> 'max_total', '')::int;
  if v_mpc is not null and v_mpc not between 1 and 1000 then raise exception 'invalid_reward_limit'; end if;
  if v_mt is not null and v_mt not between 1 and 1000000 then raise exception 'invalid_reward_limit'; end if;
  if p_id is null then
    insert into public.loyalty_rewards (restaurant_id, name, description, cost_points, active, conditions, valid_from, valid_until, max_per_customer, max_total)
    values (p_restaurant, btrim(p ->> 'name'), nullif(btrim(coalesce(p ->> 'description', '')), ''), v_cost, coalesce((p ->> 'active')::boolean, true),
            nullif(btrim(coalesce(p ->> 'conditions', '')), ''), v_from, v_until, v_mpc, v_mt) returning id into rid;
  else
    update public.loyalty_rewards set name = btrim(p ->> 'name'), description = nullif(btrim(coalesce(p ->> 'description', '')), ''), cost_points = v_cost,
           active = coalesce((p ->> 'active')::boolean, true), conditions = nullif(btrim(coalesce(p ->> 'conditions', '')), ''),
           valid_from = v_from, valid_until = v_until, max_per_customer = v_mpc, max_total = v_mt
     where id = p_id and restaurant_id = p_restaurant returning id into rid;
    if rid is null then raise exception 'reward_not_found' using errcode = 'P0002'; end if;
  end if;
  return rid;
end $$;
grant execute on function public.loyalty_upsert_reward_v2(uuid, uuid, jsonb) to authenticated;
revoke execute on function public.loyalty_upsert_reward_v2(uuid, uuid, jsonb) from public, anon;

-- Canje con vigencia y límites (por cliente y totales), serializado por premio.
create or replace function public.loyalty_request_redemption(p_token uuid, p_reward uuid)
returns jsonb language plpgsql security definer set search_path = 'public' as $$
declare c public.loyalty_customers; w public.loyalty_rewards; s public.loyalty_settings; rid uuid; code text; tries integer := 0; nb integer;
begin
  select * into c from public.loyalty_customers where card_token = p_token for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into s from public.loyalty_settings where restaurant_id = c.restaurant_id and enabled;
  if not found then raise exception 'disabled'; end if;
  perform pg_advisory_xact_lock(hashtext(p_reward::text));
  select * into w from public.loyalty_rewards where id = p_reward and restaurant_id = c.restaurant_id and active;
  if not found then raise exception 'reward_not_available'; end if;
  if (w.valid_from is not null and w.valid_from > now()) or (w.valid_until is not null and w.valid_until < now()) then raise exception 'reward_not_available'; end if;
  if w.max_per_customer is not null and (select count(*) from public.loyalty_redemptions where customer_id = c.id and reward_id = w.id and status <> 'cancelled') >= w.max_per_customer then raise exception 'reward_limit_reached'; end if;
  if w.max_total is not null and (select count(*) from public.loyalty_redemptions where reward_id = w.id and status <> 'cancelled') >= w.max_total then raise exception 'reward_sold_out'; end if;
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

-- ---------- 7) AJUSTES (programa, tarjeta, niveles) ----------

create or replace function public.loyalty_save_settings(p_restaurant uuid, p_settings jsonb)
returns void language plpgsql security definer set search_path = 'public' as $$
declare card jsonb := coalesce(p_settings -> 'card', '{}'::jsonb); prizes jsonb := coalesce(p_settings -> 'spin_prizes', '[]'::jsonb);
        tiers jsonb := coalesce(p_settings -> 'tiers', '[]'::jsonb); pr jsonb; k text;
begin
  if not public.loyalty_is_member(p_restaurant, array['owner', 'admin']) then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(card) <> 'object' then raise exception 'invalid_card'; end if;
  if pg_column_size(card) > 4000 then raise exception 'invalid_card'; end if;
  foreach k in array array['bg1', 'bg2', 'text', 'accent', 'sec', 'pts', 'bar'] loop
    if card ? k and (jsonb_typeof(card -> k) <> 'string' or (card ->> k) !~ '^#[0-9a-fA-F]{6}$') then raise exception 'invalid_color_%', k; end if;
  end loop;
  if card ? 'style' and (card ->> 'style') not in ('gradient', 'solid', 'dots', 'lines', 'grid', 'diagonal', 'waves', 'rings') then raise exception 'invalid_style'; end if;
  if card ? 'template' and (card ->> 'template') not in ('kartta', 'minimal', 'premium', 'modern', 'elegant', 'light', 'cafe', 'neon') then raise exception 'invalid_template'; end if;
  if card ? 'font' and (card ->> 'font') not in ('sans', 'serif', 'rounded', 'mono', 'display') then raise exception 'invalid_font'; end if;
  if card ? 'size' and (card ->> 'size') not in ('s', 'm', 'l') then raise exception 'invalid_size'; end if;
  if card ? 'weight' and (card ->> 'weight') not in ('500', '700', '800') then raise exception 'invalid_weight'; end if;
  if card ? 'align' and (card ->> 'align') not in ('left', 'center') then raise exception 'invalid_align'; end if;
  if card ? 'icon' and (card ->> 'icon') not in ('none', 'star', 'crown', 'heart', 'coffee', 'flame', 'gem', 'leaf') then raise exception 'invalid_icon'; end if;
  if card ? 'angle' and (jsonb_typeof(card -> 'angle') <> 'number' or (card ->> 'angle')::numeric not between 0 and 360) then raise exception 'invalid_angle'; end if;
  if card ? 'show_logo' and jsonb_typeof(card -> 'show_logo') <> 'boolean' then raise exception 'invalid_show_logo'; end if;
  if card ? 'title' and char_length(card ->> 'title') > 30 then raise exception 'invalid_title'; end if;
  if card ? 'subtitle' and char_length(card ->> 'subtitle') > 40 then raise exception 'invalid_subtitle'; end if;
  foreach k in array array['membership', 'points_label'] loop
    if card ? k and char_length(card ->> k) > 30 then raise exception 'invalid_%', k; end if;
  end loop;
  foreach k in array array['welcome', 'reward_msg', 'custom'] loop
    if card ? k and char_length(card ->> k) > 80 then raise exception 'invalid_%', k; end if;
  end loop;
  if jsonb_typeof(prizes) <> 'array' or jsonb_array_length(prizes) > 8 then raise exception 'invalid_prizes'; end if;
  for pr in select * from jsonb_array_elements(prizes) loop
    if jsonb_typeof(pr) <> 'object' or char_length(coalesce(pr ->> 'label', '')) not between 1 and 30
       or coalesce((pr ->> 'points')::int, 0) not between 1 and 1000 or coalesce((pr ->> 'weight')::int, 0) not between 1 and 100 then
      raise exception 'invalid_prize';
    end if;
  end loop;
  if jsonb_typeof(tiers) <> 'array' or jsonb_array_length(tiers) > 5 then raise exception 'invalid_tiers'; end if;
  for pr in select * from jsonb_array_elements(tiers) loop
    if jsonb_typeof(pr) <> 'object' or char_length(btrim(coalesce(pr ->> 'name', ''))) not between 1 and 20
       or coalesce((pr ->> 'min_lifetime')::int, -1) not between 0 and 10000000 then
      raise exception 'invalid_tier';
    end if;
  end loop;
  insert into public.loyalty_settings (restaurant_id, enabled, program_name, points_per_1000, min_order_total, welcome_points, spin_enabled, spin_prizes, card, terms, tiers_enabled, tiers, require_identity, updated_at)
  values (p_restaurant,
          coalesce((p_settings ->> 'enabled')::boolean, false),
          coalesce(nullif(btrim(p_settings ->> 'program_name'), ''), 'Puntos'),
          coalesce((p_settings ->> 'points_per_1000')::int, 10),
          coalesce((p_settings ->> 'min_order_total')::int, 0),
          coalesce((p_settings ->> 'welcome_points')::int, 0),
          coalesce((p_settings ->> 'spin_enabled')::boolean, false),
          prizes, card, nullif(btrim(p_settings ->> 'terms'), ''),
          coalesce((p_settings ->> 'tiers_enabled')::boolean, false), tiers,
          coalesce((p_settings ->> 'require_identity')::boolean, false), now())
  on conflict (restaurant_id) do update set
    enabled = excluded.enabled, program_name = excluded.program_name, points_per_1000 = excluded.points_per_1000,
    min_order_total = excluded.min_order_total, welcome_points = excluded.welcome_points, spin_enabled = excluded.spin_enabled,
    spin_prizes = excluded.spin_prizes, card = excluded.card, terms = excluded.terms,
    tiers_enabled = excluded.tiers_enabled, tiers = excluded.tiers, require_identity = excluded.require_identity, updated_at = now();
end $$;

-- ---------- 8) LECTURA PÚBLICA / TARJETA DEL CLIENTE ----------

create or replace function public.get_loyalty_public(p_slug text)
returns jsonb language sql stable security definer set search_path = 'public' as $$
  select jsonb_build_object('enabled', true, 'program_name', s.program_name, 'welcome_points', s.welcome_points, 'restaurant', r.name,
                            'require_identity', s.require_identity)
  from public.restaurants r join public.loyalty_settings s on s.restaurant_id = r.id
  where r.slug = lower(btrim(p_slug)) and r.is_published and not r.is_suspended and s.enabled
  limit 1;
$$;

create or replace function public.get_loyalty_card(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = 'public' as $$
declare c public.loyalty_customers; r public.restaurants; s public.loyalty_settings; played boolean; tier jsonb; next_tier jsonb;
begin
  select * into c from public.loyalty_customers where card_token = p_token;
  if not found then return null; end if;
  select * into r from public.restaurants where id = c.restaurant_id;
  select * into s from public.loyalty_settings where restaurant_id = c.restaurant_id;
  if not found or not s.enabled or r.is_suspended then return null; end if;
  select exists (select 1 from public.loyalty_movements where customer_id = c.id and kind = 'game' and day = (now() at time zone 'America/Bogota')::date) into played;
  if s.tiers_enabled then
    select t into tier from jsonb_array_elements(s.tiers) t where (t ->> 'min_lifetime')::int <= c.lifetime order by (t ->> 'min_lifetime')::int desc limit 1;
    select t into next_tier from jsonb_array_elements(s.tiers) t where (t ->> 'min_lifetime')::int > c.lifetime order by (t ->> 'min_lifetime')::int asc limit 1;
  end if;
  return jsonb_build_object(
    'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'logo_path', r.logo_path),
    'program', jsonb_build_object('name', s.program_name, 'card', s.card, 'terms', s.terms, 'tiers_enabled', s.tiers_enabled),
    'customer', jsonb_build_object('name', c.name, 'phone_last4', right(c.phone, 4), 'balance', c.balance, 'lifetime', c.lifetime,
                                   'tier', case when tier is null then null else tier ->> 'name' end,
                                   'next_tier', case when next_tier is null then null else jsonb_build_object('name', next_tier ->> 'name', 'min_lifetime', (next_tier ->> 'min_lifetime')::int) end,
                                   'marketing', c.marketing_consent, 'verified', c.phone_verified_at is not null),
    'rewards', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'description', w.description, 'cost_points', w.cost_points,
                           'conditions', w.conditions, 'valid_until', w.valid_until,
                           'limit_reached', (w.max_per_customer is not null and (select count(*) from public.loyalty_redemptions d where d.customer_id = c.id and d.reward_id = w.id and d.status <> 'cancelled') >= w.max_per_customer)
                                         or (w.max_total is not null and (select count(*) from public.loyalty_redemptions d where d.reward_id = w.id and d.status <> 'cancelled') >= w.max_total)) order by w.cost_points)
                         from public.loyalty_rewards w where w.restaurant_id = c.restaurant_id and w.active
                          and (w.valid_from is null or w.valid_from <= now()) and (w.valid_until is null or w.valid_until >= now())), '[]'::jsonb),
    'movements', coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'points', m.points, 'note', m.note, 'at', m.created_at) order by m.created_at desc)
                           from (select * from public.loyalty_movements where customer_id = c.id order by created_at desc limit 15) m), '[]'::jsonb),
    'pending', coalesce((select jsonb_agg(jsonb_build_object('code', d.code, 'reward', d.reward_name, 'points', d.points) order by d.created_at desc)
                         from public.loyalty_redemptions d where d.customer_id = c.id and d.status = 'pending'), '[]'::jsonb),
    'spin', jsonb_build_object('enabled', s.spin_enabled and jsonb_array_length(s.spin_prizes) > 0, 'played_today', played,
                               'prizes', case when s.spin_enabled then (select coalesce(jsonb_agg(p ->> 'label'), '[]'::jsonb) from jsonb_array_elements(s.spin_prizes) p) else '[]'::jsonb end));
end $$;

-- ---------- 9) API DEL CLIENTE CON SESIÓN VERIFICADA ----------

create or replace function public.get_my_loyalty(p_slug text, p_session text)
returns jsonb language plpgsql security definer set search_path = 'public' as $$
declare r public.restaurants; c public.loyalty_customers; card jsonb;
begin
  select * into r from public.restaurants where slug = lower(btrim(p_slug)) and is_published and not is_suspended;
  if not found then return null; end if;
  c := public._customer_from_session(p_session, r.id);
  if c.id is null then return null; end if;
  card := public.get_loyalty_card(c.card_token);
  if card is null then return null; end if;
  return card || jsonb_build_object('orders', coalesce((select jsonb_agg(jsonb_build_object('code', upper(right(o.id::text, 4)), 'total', o.total, 'status', o.status, 'paid', o.paid, 'at', o.created_at) order by o.created_at desc)
                                                       from (select * from public.orders where customer_id = c.id order by created_at desc limit 10) o), '[]'::jsonb));
end $$;

create or replace function public.loyalty_request_redemption_s(p_session text, p_reward uuid)
returns jsonb language plpgsql security definer set search_path = 'public' as $$
declare c public.loyalty_customers;
begin
  c := public._customer_from_session(p_session, null);
  if c.id is null then raise exception 'invalid_customer_session' using errcode = 'P0001'; end if;
  return public.loyalty_request_redemption(c.card_token, p_reward);
end $$;

create or replace function public.loyalty_play_spin_s(p_session text)
returns jsonb language plpgsql security definer set search_path = 'public' as $$
declare c public.loyalty_customers;
begin
  c := public._customer_from_session(p_session, null);
  if c.id is null then raise exception 'invalid_customer_session' using errcode = 'P0001'; end if;
  return public.loyalty_play_spin(c.card_token);
end $$;

create or replace function public.customer_logout(p_session text)
returns void language sql security definer set search_path = 'public' as $$
  update public.customer_sessions set revoked_at = now()
   where token_hash = encode(sha256(convert_to(coalesce(p_session, ''), 'UTF8')), 'hex') and revoked_at is null;
$$;

create or replace function public.customer_set_marketing(p_session text, p_value boolean)
returns void language plpgsql security definer set search_path = 'public' as $$
declare c public.loyalty_customers;
begin
  c := public._customer_from_session(p_session, null);
  if c.id is null then raise exception 'invalid_customer_session' using errcode = 'P0001'; end if;
  update public.loyalty_customers set marketing_consent = coalesce(p_value, false),
         marketing_consent_at = case when coalesce(p_value, false) then now() else null end where id = c.id;
end $$;

-- Derecho de supresión: borra la identidad y los puntos; los pedidos quedan sin datos personales (contabilidad).
create or replace function public.customer_delete_my_data(p_session text)
returns void language plpgsql security definer set search_path = 'public' as $$
declare c public.loyalty_customers;
begin
  c := public._customer_from_session(p_session, null);
  if c.id is null then raise exception 'invalid_customer_session' using errcode = 'P0001'; end if;
  update public.orders set customer_phone = null, customer_name = 'Cliente eliminado', customer_id = null
   where restaurant_id = c.restaurant_id and (customer_id = c.id or public.loyalty_norm_phone(customer_phone) = c.phone);
  delete from public.loyalty_movements where customer_id = c.id;
  delete from public.loyalty_redemptions where customer_id = c.id;
  delete from public.customer_phone_verifications where restaurant_id = c.restaurant_id and phone = c.phone;
  delete from public.loyalty_customers where id = c.id;   -- customer_sessions cae en cascada
end $$;

grant execute on function public.get_my_loyalty(text, text) to anon, authenticated;
grant execute on function public.loyalty_request_redemption_s(text, uuid) to anon, authenticated;
grant execute on function public.loyalty_play_spin_s(text) to anon, authenticated;
grant execute on function public.customer_logout(text) to anon, authenticated;
grant execute on function public.customer_set_marketing(text, boolean) to anon, authenticated;
grant execute on function public.customer_delete_my_data(text) to anon, authenticated;

-- Acceso por enlace secreto y alta sin verificación: retirados del navegador.
revoke execute on function public.loyalty_join(text, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.get_loyalty_card(uuid) from public, anon, authenticated;
revoke execute on function public.loyalty_request_redemption(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.loyalty_play_spin(uuid) from public, anon, authenticated;

-- ---------- 10) PANEL DEL RESTAURANTE: métricas e historial de clientes ----------

create or replace function public.loyalty_customer_stats(p_restaurant uuid)
returns jsonb language plpgsql stable security definer set search_path = 'public' as $$
declare min_cost integer;
begin
  if not public.loyalty_is_member(p_restaurant, array['owner', 'admin', 'staff']) then raise exception 'forbidden' using errcode = '42501'; end if;
  select min(cost_points) into min_cost from public.loyalty_rewards where restaurant_id = p_restaurant and active;
  return jsonb_build_object(
    'total', (select count(*) from public.loyalty_customers where restaurant_id = p_restaurant),
    'verified', (select count(*) from public.loyalty_customers where restaurant_id = p_restaurant and phone_verified_at is not null),
    'new_30d', (select count(*) from public.loyalty_customers where restaurant_id = p_restaurant and created_at > now() - interval '30 days'),
    'recurring', (select count(*) from (select customer_id from public.orders where restaurant_id = p_restaurant and customer_id is not null and status <> 'cancelado' group by customer_id having count(*) >= 2) x),
    'with_rewards', case when min_cost is null then 0 else (select count(*) from public.loyalty_customers where restaurant_id = p_restaurant and balance >= min_cost) end,
    'top', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'phone', t.phone, 'balance', t.balance) order by t.balance desc)
                     from (select id, name, phone, balance from public.loyalty_customers where restaurant_id = p_restaurant and balance > 0 order by balance desc limit 5) t), '[]'::jsonb));
end $$;

create or replace function public.loyalty_customer_orders(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = 'public' as $$
declare c public.loyalty_customers;
begin
  select * into c from public.loyalty_customers where id = p_customer;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.loyalty_is_member(c.restaurant_id, array['owner', 'admin', 'staff']) then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'orders', coalesce((select jsonb_agg(jsonb_build_object('code', upper(right(o.id::text, 4)), 'total', o.total, 'status', o.status, 'paid', o.paid, 'table', o.table_label, 'at', o.created_at) order by o.created_at desc)
                        from (select * from public.orders where restaurant_id = c.restaurant_id and customer_id = c.id order by created_at desc limit 30) o), '[]'::jsonb),
    'last_order_at', (select max(created_at) from public.orders where restaurant_id = c.restaurant_id and customer_id = c.id),
    'orders_count', (select count(*) from public.orders where restaurant_id = c.restaurant_id and customer_id = c.id and status <> 'cancelado'));
end $$;
grant execute on function public.loyalty_customer_stats(uuid) to authenticated;
grant execute on function public.loyalty_customer_orders(uuid) to authenticated;
revoke execute on function public.loyalty_customer_stats(uuid) from public, anon;
revoke execute on function public.loyalty_customer_orders(uuid) from public, anon;
