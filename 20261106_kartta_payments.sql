-- =====================================================================================
-- KARTTA PAYMENTS — suscripciones, pagos Wompi, facturación y administración financiera
-- Migración ADITIVA e idempotente. NO APLICADA en Supabase (aplicar primero en una rama / entorno de pruebas).
--
-- Fuente de verdad (auditada): Supabase Postgres. Los permisos reales ya salen de
--   subscriptions (status in ('active','trialing') y current_period_end > now())  ->  plans.limits
-- (lo usan editor_menu_v3, ia_chat_cuotas, imágenes IA, soporte). Por eso ACTIVAR UN PLAN = escribir
-- subscriptions.plan_id/status/current_period_end; no se duplican reglas en otra parte.
--
-- Seguridad: TODA escritura financiera ocurre en funciones SECURITY DEFINER que solo puede ejecutar
-- service_role (Edge Functions). El navegador solo lee (RLS) o llama RPC de solo gestión propia.
-- Dependencia (ya existe en producción): private.is_platform_admin().
-- =====================================================================================
begin;

create schema if not exists private;

do $$ begin
  if to_regprocedure('private.is_platform_admin()') is null then
    raise exception 'Falta private.is_platform_admin() (la usa el centro de soporte). No se puede aplicar la migración.';
  end if;
  if to_regclass('public.plans') is null or to_regclass('public.subscriptions') is null
     or to_regclass('public.payments') is null or to_regclass('public.payment_events') is null then
    raise exception 'Faltan tablas base (plans, subscriptions, payments, payment_events).';
  end if;
end $$;

-- ------------------------------------------------------------------------------------
-- 0) PREFLIGHT de payments / payment_events (su DDL no está en el repo; hoy no se usan: sin checkout ni webhook)
--    Si tuvieran filas, se aborta para revisión manual. Las columnas NOT NULL desconocidas y sin default
--    se vuelven NULL-ables para que las inserciones del servidor no fallen.
-- ------------------------------------------------------------------------------------
do $$
declare t text; r record; n bigint;
begin
  foreach t in array array['payments','payment_events'] loop
    execute format('select count(*) from public.%I', t) into n;
    if n > 0 then
      raise exception 'public.% tiene % filas. Revisa su estructura antes de aplicar (esta migración asume que está vacía).', t, n;
    end if;
    for r in
      select a.attname from pg_attribute a
       where a.attrelid = ('public.' || t)::regclass and a.attnum > 0 and not a.attisdropped
         and a.attnotnull and a.attname <> 'id'
         and not exists (select 1 from pg_attrdef d where d.adrelid = a.attrelid and d.adnum = a.attnum)
         and a.attname not in ('restaurant_id')
    loop
      execute format('alter table public.%I alter column %I drop not null', t, r.attname);
      raise notice 'public.%.%: NOT NULL retirado (columna previa desconocida)', t, r.attname;
    end loop;
  end loop;
end $$;

-- ------------------------------------------------------------------------------------
-- 1) Configuración editable (sin tocar código) — fila única
-- ------------------------------------------------------------------------------------
create table if not exists public.billing_settings (
  id                        boolean primary key default true check (id),
  trial_days                int     not null default 30 check (trial_days between 0 and 365),
  annual_sales_enabled      boolean not null default false,      -- el cobro anual NO se activa hasta que el propietario confirme precio
  renewal_reminder_days     int[]   not null default '{7,3,1}',
  trial_reminder_days       int[]   not null default '{3,1}',
  expire_after_days         int     not null default 7 check (expire_after_days between 0 and 90),  -- días en past_due antes de 'expired'
  payment_window_minutes    int     not null default 30 check (payment_window_minutes between 10 and 1440),
  updated_at                timestamptz not null default now(),
  updated_by                uuid
);
insert into public.billing_settings (id) values (true) on conflict (id) do nothing;
alter table public.billing_settings enable row level security;
revoke all on public.billing_settings from anon, authenticated;

-- ------------------------------------------------------------------------------------
-- 2) plans: precios centralizados (el frontend nunca decide cuánto se cobra)
-- ------------------------------------------------------------------------------------
alter table public.plans add column if not exists monthly_price_cop integer;
alter table public.plans add column if not exists annual_price_cop  integer;
alter table public.plans add column if not exists currency text not null default 'COP';
alter table public.plans add column if not exists is_purchasable boolean not null default false;
alter table public.plans add column if not exists updated_at timestamptz not null default now();
-- Precios mensuales indicados por el propietario. El ANUAL no se inventa: queda NULL hasta confirmarlo.
update public.plans set monthly_price_cop = 43900, is_purchasable = true, updated_at = now() where id = 'kartta' and (monthly_price_cop is distinct from 43900 or not is_purchasable);
update public.plans set monthly_price_cop = 84900, is_purchasable = true, updated_at = now() where id = 'pro'    and (monthly_price_cop is distinct from 84900 or not is_purchasable);

do $$ begin
  if not exists (select 1 from public.plans where id = 'kartta') or not exists (select 1 from public.plans where id = 'pro') then
    raise warning 'No existen los planes con id kartta (Standard) y/o pro: créalos antes de vender (ver 20261105_planes_free_standard_pro.sql).';
  end if;
end $$;

-- ------------------------------------------------------------------------------------
-- 3) subscriptions: campos de ciclo de vida
-- ------------------------------------------------------------------------------------
alter table public.subscriptions add column if not exists owner_id uuid;
alter table public.subscriptions add column if not exists billing_cycle text;
alter table public.subscriptions add column if not exists trial_start timestamptz;
alter table public.subscriptions add column if not exists trial_end timestamptz;
alter table public.subscriptions add column if not exists current_period_start timestamptz;
alter table public.subscriptions add column if not exists current_period_end timestamptz;
alter table public.subscriptions add column if not exists next_billing_date timestamptz;
alter table public.subscriptions add column if not exists auto_renew boolean not null default false;
alter table public.subscriptions add column if not exists cancel_at_period_end boolean not null default false;
alter table public.subscriptions add column if not exists canceled_at timestamptz;
alter table public.subscriptions add column if not exists payment_source_id uuid;
alter table public.subscriptions add column if not exists updated_at timestamptz not null default now();

do $$
declare c record; v text;
begin
  select string_agg(distinct status, ', ') into v from public.subscriptions;
  raise notice 'Estados existentes en subscriptions: %', coalesce(v, '(sin filas)');
  for c in select conname from pg_constraint
            where conrelid = 'public.subscriptions'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%'
  loop execute format('alter table public.subscriptions drop constraint %I', c.conname); end loop;
  alter table public.subscriptions add constraint subscriptions_status_chk
    check (status in ('trialing','active','pending_payment','past_due','canceled','expired')) not valid;   -- filas previas no se revalidan
end $$;
do $$ begin
  alter table public.subscriptions add constraint subscriptions_cycle_chk check (billing_cycle is null or billing_cycle in ('monthly','annual'));
exception when duplicate_object then null; end $$;

do $$ begin
  create unique index if not exists subscriptions_restaurant_uidx on public.subscriptions (restaurant_id);
exception when unique_violation then
  raise exception 'Hay restaurantes con más de una suscripción: depúralo antes (solo debe haber una por restaurante).';
end $$;
create index if not exists subscriptions_period_idx on public.subscriptions (status, current_period_end);

-- Reutiliza la prueba existente (plan 'trial', 30 días según el repo): rellena trial_start/trial_end sin cambiar permisos.
update public.subscriptions
   set trial_start = coalesce(trial_start, created_at),
       trial_end   = coalesce(trial_end, current_period_end)
 where plan_id = 'trial' and (trial_start is null or trial_end is null);

update public.subscriptions s set owner_id = m.user_id
  from public.restaurant_members m
 where s.owner_id is null and m.restaurant_id = s.restaurant_id and m.role = 'owner';

-- Si create_restaurant no fija fechas de prueba, este trigger usa billing_settings.trial_days (no pisa lo que ya venga fijado).
create or replace function private.billing_trial_defaults() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare d int;
begin
  if new.plan_id = 'trial' and new.status = 'trialing' then
    select trial_days into d from public.billing_settings where id;
    new.trial_start := coalesce(new.trial_start, now());
    new.trial_end   := coalesce(new.trial_end, new.current_period_end, new.trial_start + make_interval(days => coalesce(d, 30)));
    new.current_period_end := coalesce(new.current_period_end, new.trial_end);
  end if;
  return new;
end $$;
drop trigger if exists trg_billing_trial_defaults on public.subscriptions;
create trigger trg_billing_trial_defaults before insert on public.subscriptions
  for each row execute function private.billing_trial_defaults();

-- ------------------------------------------------------------------------------------
-- 4) payments
-- ------------------------------------------------------------------------------------
alter table public.payments add column if not exists restaurant_id uuid;
alter table public.payments add column if not exists owner_id uuid;
alter table public.payments add column if not exists subscription_id uuid;
alter table public.payments add column if not exists plan_id text;
alter table public.payments add column if not exists billing_cycle text;
alter table public.payments add column if not exists reference text;
alter table public.payments add column if not exists wompi_transaction_id text;
alter table public.payments add column if not exists transaction_reference text;   -- alias legible (= reference) por compatibilidad con la especificación
alter table public.payments add column if not exists amount_in_cents bigint;
alter table public.payments add column if not exists currency text not null default 'COP';
alter table public.payments add column if not exists status text;
alter table public.payments add column if not exists payment_method text;
alter table public.payments add column if not exists environment text;
alter table public.payments add column if not exists billing_period text;
alter table public.payments add column if not exists period_start timestamptz;
alter table public.payments add column if not exists period_end timestamptz;
alter table public.payments add column if not exists is_renewal boolean not null default false;
alter table public.payments add column if not exists expires_at timestamptz;
alter table public.payments add column if not exists confirmed_at timestamptz;
alter table public.payments add column if not exists applied_at timestamptz;       -- se fijó al conceder el plan: garantiza idempotencia
alter table public.payments add column if not exists revoked_at timestamptz;
alter table public.payments add column if not exists amount_cop bigint;             -- espejo para lectores previos (panel/admin-api): solo se llena en PRODUCCIÓN aprobada
alter table public.payments add column if not exists fee_in_cents bigint;          -- solo si se registra desde datos reales de Wompi
alter table public.payments add column if not exists metadata jsonb not null default '{}'::jsonb;  -- NUNCA datos de tarjeta ni secretos
alter table public.payments add column if not exists created_at timestamptz not null default now();
alter table public.payments add column if not exists updated_at timestamptz not null default now();

do $$ begin alter table public.payments add constraint payments_status_chk check (status in ('CREATED','PENDING','APPROVED','DECLINED','VOIDED','ERROR','EXPIRED')); exception when duplicate_object then null; end $$;
do $$ begin alter table public.payments add constraint payments_env_chk check (environment in ('sandbox','production')); exception when duplicate_object then null; end $$;
do $$ begin alter table public.payments add constraint payments_amount_chk check (amount_in_cents > 0); exception when duplicate_object then null; end $$;
do $$ begin alter table public.payments add constraint payments_currency_chk check (currency = 'COP'); exception when duplicate_object then null; end $$;
do $$ begin alter table public.payments add constraint payments_cycle_chk check (billing_cycle in ('monthly','annual')); exception when duplicate_object then null; end $$;
do $$ begin alter table public.payments add constraint payments_restaurant_fk foreign key (restaurant_id) references public.restaurants(id) on delete restrict; exception when duplicate_object then null; end $$;
create unique index if not exists payments_reference_uidx on public.payments (reference);
create unique index if not exists payments_wompi_tx_uidx  on public.payments (wompi_transaction_id) where wompi_transaction_id is not null;
create index if not exists payments_restaurant_idx on public.payments (restaurant_id, created_at desc);
create index if not exists payments_status_idx on public.payments (environment, status, created_at desc);

alter table public.payments enable row level security;
drop policy if exists payments_select_own on public.payments;
create policy payments_select_own on public.payments for select to authenticated
  using (exists (select 1 from public.restaurant_members m
                  where m.restaurant_id = payments.restaurant_id and m.user_id = auth.uid() and m.role in ('owner','admin')));
revoke all on public.payments from anon, authenticated;
grant select (id, restaurant_id, subscription_id, plan_id, billing_cycle, reference, wompi_transaction_id, amount_in_cents, currency,
              status, payment_method, environment, period_start, period_end, is_renewal, confirmed_at, created_at)
  on public.payments to authenticated;

-- ------------------------------------------------------------------------------------
-- 5) payment_events (auditoría de webhooks; sin acceso desde el navegador, como ya estaba)
-- ------------------------------------------------------------------------------------
alter table public.payment_events add column if not exists provider text not null default 'wompi';
alter table public.payment_events add column if not exists transaction_id text;           -- id de la transacción en Wompi
alter table public.payment_events add column if not exists event_type text;
alter table public.payment_events add column if not exists event_reference text;         -- checksum del evento (identifica reenvíos)
alter table public.payment_events add column if not exists reference text;               -- referencia KARTTA
alter table public.payment_events add column if not exists environment text;
alter table public.payment_events add column if not exists verification_status text;     -- received|verified|invalid_signature|mismatch|unknown_reference|duplicate|error
alter table public.payment_events add column if not exists result text;
alter table public.payment_events add column if not exists attempts int not null default 1;
alter table public.payment_events add column if not exists received_at timestamptz not null default now();
alter table public.payment_events add column if not exists processed_at timestamptz;
alter table public.payment_events add column if not exists payload jsonb;                 -- solo data.transaction; Wompi no envía datos de tarjeta
create unique index if not exists payment_events_ref_uidx on public.payment_events (provider, event_reference) where event_reference is not null;
create index if not exists payment_events_tx_idx on public.payment_events (transaction_id);
alter table public.payment_events enable row level security;
revoke all on public.payment_events from anon, authenticated;

-- ------------------------------------------------------------------------------------
-- 6) Tablas nuevas
-- ------------------------------------------------------------------------------------
create table if not exists public.billing_profiles (               -- datos de facturación del restaurante
  restaurant_id   uuid primary key references public.restaurants(id) on delete cascade,
  legal_name      text not null check (char_length(legal_name) between 2 and 120),
  document_type   text not null check (document_type in ('CC','CE','NIT','PP','TI','DNI','RG','OTHER')),
  document_number text not null check (document_number ~ '^[A-Za-z0-9.-]{3,20}$'),
  billing_email   text not null check (billing_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(billing_email) <= 160),
  phone           text check (phone is null or phone ~ '^[0-9+ ()-]{7,20}$'),
  city            text check (city is null or char_length(city) <= 80),
  address         text check (address is null or char_length(address) <= 200),
  updated_at      timestamptz not null default now()
);
alter table public.billing_profiles enable row level security;
drop policy if exists billing_profiles_select on public.billing_profiles;
create policy billing_profiles_select on public.billing_profiles for select to authenticated
  using (exists (select 1 from public.restaurant_members m where m.restaurant_id = billing_profiles.restaurant_id and m.user_id = auth.uid() and m.role in ('owner','admin')));
revoke all on public.billing_profiles from anon, authenticated;
grant select on public.billing_profiles to authenticated;          -- escribe solo billing_save_profile()

create table if not exists public.billing_payment_sources (        -- preparado para renovación automática (aún sin uso: ver docs)
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants(id) on delete cascade,
  owner_id         uuid,
  provider         text not null default 'wompi',
  wompi_source_id  text not null,                                  -- id de la fuente en Wompi (nunca número de tarjeta, CVC ni token)
  source_type      text not null check (source_type in ('CARD','NEQUI','DAVIPLATA','BANCOLOMBIA_TRANSFER')),
  display_label    text,
  status           text not null default 'AVAILABLE' check (status in ('AVAILABLE','VOIDED')),
  consent_at       timestamptz not null,
  consent_version  text not null,
  created_at       timestamptz not null default now(),
  voided_at        timestamptz,
  unique (provider, wompi_source_id)
);
alter table public.billing_payment_sources enable row level security;
revoke all on public.billing_payment_sources from anon, authenticated;
do $$ begin
  alter table public.subscriptions add constraint subscriptions_source_fk foreign key (payment_source_id) references public.billing_payment_sources(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.billing_notifications (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants(id) on delete cascade,
  subscription_id  uuid,
  payment_id       uuid,
  notification_type text not null check (notification_type in (
    'subscription_welcome','trial_started','trial_ending','payment_approved','payment_pending','payment_declined',
    'renewal_upcoming','renewal_success','renewal_failed','subscription_expiring','subscription_canceled','plan_updated','subscription_expired')),
  dedupe_key       text not null unique,                           -- evita duplicados aunque el cron corra dos veces
  scheduled_at     timestamptz not null default now(),
  sent_at          timestamptz,
  delivery_status  text not null default 'pending' check (delivery_status in ('pending','sending','sent','failed','skipped')),
  attempts         int not null default 0,
  claimed_at       timestamptz,
  last_error       text,
  provider_message_id text,
  context          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists billing_notifications_due_idx on public.billing_notifications (delivery_status, scheduled_at);
alter table public.billing_notifications enable row level security;
revoke all on public.billing_notifications from anon, authenticated;

create table if not exists public.billing_audit_log (              -- append-only
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  actor_type    text not null check (actor_type in ('system','webhook','user','admin')),
  actor_id      uuid,
  action        text not null,
  restaurant_id uuid,
  subscription_id uuid,
  payment_id    uuid,
  detail        jsonb not null default '{}'::jsonb
);
create index if not exists billing_audit_rest_idx on public.billing_audit_log (restaurant_id, created_at desc);
alter table public.billing_audit_log enable row level security;
revoke all on public.billing_audit_log from anon, authenticated;
create or replace function private.billing_audit_immutable() returns trigger language plpgsql as $$
begin raise exception 'billing_audit_log es de solo anexar' using errcode = '42501'; end $$;
drop trigger if exists trg_billing_audit_immutable on public.billing_audit_log;
create trigger trg_billing_audit_immutable before update or delete on public.billing_audit_log
  for each row execute function private.billing_audit_immutable();

create table if not exists public.billing_payouts (                -- desembolsos que el administrador registra (NO son ingresos cobrados)
  id            uuid primary key default gen_random_uuid(),
  amount_in_cents bigint not null check (amount_in_cents > 0),
  paid_on       date not null,
  environment   text not null default 'production' check (environment in ('sandbox','production')),
  reference     text check (reference is null or char_length(reference) <= 120),
  note          text check (note is null or char_length(note) <= 300),
  created_by    uuid,
  created_at    timestamptz not null default now()
);
alter table public.billing_payouts enable row level security;
revoke all on public.billing_payouts from anon, authenticated;

-- ------------------------------------------------------------------------------------
-- 7) Helpers internos (no expuestos)
-- ------------------------------------------------------------------------------------
create or replace function private.billing_is_manager(p_restaurant uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.restaurant_members m where m.restaurant_id = p_restaurant and m.user_id = p_user and m.role in ('owner','admin'));
$$;

create or replace function private.billing_add_period(p_from timestamptz, p_cycle text) returns timestamptz
language sql immutable as $$
  select ((p_from at time zone 'America/Bogota') + case p_cycle when 'annual' then interval '1 year' else interval '1 month' end) at time zone 'America/Bogota';
$$;

create or replace function private.billing_audit(p_actor_type text, p_actor uuid, p_action text, p_rest uuid, p_sub uuid, p_pay uuid, p_detail jsonb)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.billing_audit_log (actor_type, actor_id, action, restaurant_id, subscription_id, payment_id, detail)
  values (p_actor_type, p_actor, p_action, p_rest, p_sub, p_pay, coalesce(p_detail, '{}'::jsonb));
$$;

create or replace function private.billing_enqueue(p_rest uuid, p_sub uuid, p_pay uuid, p_type text, p_key text, p_ctx jsonb, p_at timestamptz default now())
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.billing_notifications (restaurant_id, subscription_id, payment_id, notification_type, dedupe_key, scheduled_at, context)
  values (p_rest, p_sub, p_pay, p_type, p_key, p_at, coalesce(p_ctx, '{}'::jsonb))
  on conflict (dedupe_key) do nothing;
$$;

-- ------------------------------------------------------------------------------------
-- 8) Preparar cobro (solo service_role: el Edge Function ya validó el JWT y pasa el usuario)
--    El importe SIEMPRE sale de plans; el navegador no puede influir.
-- ------------------------------------------------------------------------------------
create or replace function public.billing_prepare_checkout(
  p_user uuid, p_restaurant uuid, p_plan text, p_cycle text, p_environment text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pl public.plans%rowtype; st public.billing_settings%rowtype; sub public.subscriptions%rowtype;
  v_amount bigint; v_ref text; v_id uuid; v_exp timestamptz; v_open int; v_cur_rank int; v_new_rank int;
begin
  if p_environment not in ('sandbox','production') then raise exception 'invalid_environment'; end if;
  if p_cycle not in ('monthly','annual') then raise exception 'invalid_cycle'; end if;
  if p_user is null or not private.billing_is_manager(p_restaurant, p_user) then raise exception 'forbidden'; end if;
  if exists (select 1 from public.restaurants where id = p_restaurant and is_suspended) then raise exception 'restaurant_suspended'; end if;

  select * into pl from public.plans where id = p_plan and is_active and is_purchasable;
  if not found then raise exception 'plan_not_available'; end if;
  select * into st from public.billing_settings where id;

  if p_cycle = 'annual' then
    if not st.annual_sales_enabled or coalesce(pl.annual_price_cop, 0) <= 0 then raise exception 'annual_not_available'; end if;
    v_amount := pl.annual_price_cop::bigint * 100;
  else
    if coalesce(pl.monthly_price_cop, 0) <= 0 then raise exception 'price_not_configured'; end if;
    v_amount := pl.monthly_price_cop::bigint * 100;
  end if;

  -- No se permite bajar de plan mientras un plan superior pagado siga vigente (evita perder tiempo ya pagado).
  select * into sub from public.subscriptions where restaurant_id = p_restaurant;
  if found and sub.status = 'active' and sub.current_period_end > now() then
    select coalesce((limits->>'rank')::int, 0) into v_cur_rank from public.plans where id = sub.plan_id;
    v_new_rank := coalesce((pl.limits->>'rank')::int, 0);
    if v_new_rank < v_cur_rank then raise exception 'downgrade_not_allowed_until_period_end'; end if;
  end if;

  select count(*) into v_open from public.payments
   where restaurant_id = p_restaurant and status in ('CREATED','PENDING') and created_at > now() - interval '1 hour';
  if v_open >= 8 then raise exception 'too_many_open_payments'; end if;

  v_ref := 'KT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20));
  v_exp := now() + make_interval(mins => st.payment_window_minutes);
  insert into public.payments (restaurant_id, owner_id, subscription_id, plan_id, billing_cycle, reference, transaction_reference,
                               amount_in_cents, currency, status, environment, billing_period, expires_at, is_renewal, metadata)
  values (p_restaurant, p_user, sub.id, p_plan, p_cycle, v_ref, v_ref, v_amount, 'COP', 'CREATED', p_environment, p_cycle, v_exp,
          exists (select 1 from public.payments x where x.restaurant_id = p_restaurant and x.plan_id = p_plan and x.status = 'APPROVED' and x.applied_at is not null),
          jsonb_build_object('plan_name', pl.name))
  returning id into v_id;
  perform private.billing_audit('user', p_user, 'checkout_created', p_restaurant, sub.id, v_id, jsonb_build_object('plan', p_plan, 'cycle', p_cycle, 'amount_in_cents', v_amount));
  return jsonb_build_object('payment_id', v_id, 'reference', v_ref, 'amount_in_cents', v_amount, 'currency', 'COP',
                            'plan_id', p_plan, 'plan_name', pl.name, 'billing_cycle', p_cycle, 'expires_at', v_exp);
end $$;

-- ------------------------------------------------------------------------------------
-- 9) Aplicar el resultado verificado de una transacción (webhook y verificación activa).
--    Atómico, idempotente y protegido contra concurrencia: bloquea la fila del pago y la suscripción.
-- ------------------------------------------------------------------------------------
create or replace function public.billing_apply_transaction(
  p_reference text, p_wompi_tx_id text, p_status text, p_amount_in_cents bigint, p_currency text,
  p_payment_method text, p_environment text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pay public.payments%rowtype; sub public.subscriptions%rowtype; pl public.plans%rowtype;
  v_status text := upper(coalesce(p_status, ''));
  v_start timestamptz; v_end timestamptz; v_first boolean; v_changed boolean; v_renewal boolean; v_prev_plan text; v_owner uuid;
  v_ctx jsonb;
begin
  if v_status not in ('PENDING','APPROVED','DECLINED','VOIDED','ERROR') then
    return jsonb_build_object('ok', false, 'result', 'invalid_status');
  end if;
  select * into pay from public.payments where reference = p_reference for update;
  if not found then return jsonb_build_object('ok', false, 'result', 'unknown_reference'); end if;

  if pay.environment is distinct from p_environment then
    perform private.billing_audit('webhook', null, 'environment_mismatch', pay.restaurant_id, pay.subscription_id, pay.id,
      jsonb_build_object('expected', pay.environment, 'received', p_environment, 'tx', p_wompi_tx_id));
    return jsonb_build_object('ok', false, 'result', 'environment_mismatch');
  end if;
  if pay.currency is distinct from upper(coalesce(p_currency, '')) or pay.amount_in_cents is distinct from p_amount_in_cents then
    update public.payments set metadata = metadata || jsonb_build_object('integrity_alert', jsonb_build_object('at', now(), 'tx', p_wompi_tx_id,
           'amount_in_cents', p_amount_in_cents, 'currency', p_currency)), updated_at = now() where id = pay.id;
    perform private.billing_audit('webhook', null, 'amount_mismatch', pay.restaurant_id, pay.subscription_id, pay.id,
      jsonb_build_object('expected', pay.amount_in_cents, 'received', p_amount_in_cents, 'currency', p_currency, 'tx', p_wompi_tx_id));
    return jsonb_build_object('ok', false, 'result', 'amount_mismatch');
  end if;

  if pay.wompi_transaction_id is not null and pay.wompi_transaction_id <> p_wompi_tx_id and pay.applied_at is not null then
    perform private.billing_audit('webhook', null, 'other_transaction_ignored', pay.restaurant_id, pay.subscription_id, pay.id, jsonb_build_object('tx', p_wompi_tx_id));
    return jsonb_build_object('ok', true, 'result', 'ignored_other_transaction');
  end if;

  if pay.applied_at is not null then                                   -- ya concedido: reenvío o evento fuera de orden
    if v_status = 'VOIDED' and pay.status = 'APPROVED' and pay.wompi_transaction_id = p_wompi_tx_id then
      select * into sub from public.subscriptions where restaurant_id = pay.restaurant_id for update;
      update public.payments set status = 'VOIDED', revoked_at = now(), updated_at = now() where id = pay.id;
      if sub.id is not null and sub.current_period_end is not distinct from pay.period_end then
        update public.subscriptions set status = 'canceled', canceled_at = now(), current_period_end = least(current_period_end, now()),
               next_billing_date = null, auto_renew = false, updated_at = now() where id = sub.id;
        perform private.billing_enqueue(pay.restaurant_id, sub.id, pay.id, 'subscription_canceled', 'voided:' || pay.id, jsonb_build_object('reason', 'payment_voided'));
      end if;
      perform private.billing_audit('webhook', null, 'payment_voided_plan_revoked', pay.restaurant_id, pay.subscription_id, pay.id, '{}'::jsonb);
      return jsonb_build_object('ok', true, 'result', 'voided_revoked');
    end if;
    return jsonb_build_object('ok', true, 'result', 'duplicate', 'subscription_id', pay.subscription_id, 'period_end', pay.period_end);
  end if;

  update public.payments set wompi_transaction_id = p_wompi_tx_id, status = v_status,
         payment_method = coalesce(p_payment_method, payment_method), updated_at = now() where id = pay.id;

  if v_status <> 'APPROVED' then
    if v_status = 'PENDING' then
      perform private.billing_enqueue(pay.restaurant_id, pay.subscription_id, pay.id, 'payment_pending', 'pending:' || pay.id,
        jsonb_build_object('plan_id', pay.plan_id, 'amount_in_cents', pay.amount_in_cents, 'reference', pay.reference));
    elsif v_status in ('DECLINED','ERROR') then
      perform private.billing_enqueue(pay.restaurant_id, pay.subscription_id, pay.id, 'payment_declined', 'declined:' || pay.id,
        jsonb_build_object('plan_id', pay.plan_id, 'amount_in_cents', pay.amount_in_cents, 'reference', pay.reference));
    end if;
    perform private.billing_audit('webhook', null, 'payment_' || lower(v_status), pay.restaurant_id, pay.subscription_id, pay.id, jsonb_build_object('tx', p_wompi_tx_id));
    return jsonb_build_object('ok', true, 'result', lower(v_status));
  end if;

  -- ---------- APPROVED: conceder el plan ----------
  select * into pl from public.plans where id = pay.plan_id;
  select user_id into v_owner from public.restaurant_members where restaurant_id = pay.restaurant_id and role = 'owner' limit 1;
  select * into sub from public.subscriptions where restaurant_id = pay.restaurant_id for update;

  v_first := not exists (select 1 from public.payments x where x.restaurant_id = pay.restaurant_id and x.id <> pay.id and x.status = 'APPROVED' and x.applied_at is not null and x.environment = pay.environment);
  v_prev_plan := case when found and sub.status = 'active' and sub.current_period_end > now() then sub.plan_id end;
  v_renewal := v_prev_plan is not distinct from pay.plan_id and v_prev_plan is not null
               or (not v_first and exists (select 1 from public.payments x where x.restaurant_id = pay.restaurant_id and x.id <> pay.id and x.plan_id = pay.plan_id and x.status = 'APPROVED' and x.applied_at is not null and x.environment = pay.environment));
  v_changed := v_prev_plan is not null and v_prev_plan <> pay.plan_id;

  -- Renovar el mismo plan antes de vencer SUMA tiempo al final del periodo vigente; un cambio de plan o un plan vencido empieza ahora.
  v_start := case when v_prev_plan = pay.plan_id then sub.current_period_end else now() end;
  v_end   := private.billing_add_period(v_start, pay.billing_cycle);

  if sub.id is null then
    insert into public.subscriptions (restaurant_id, owner_id, plan_id, status, billing_cycle, current_period_start, current_period_end, next_billing_date, auto_renew)
    values (pay.restaurant_id, v_owner, pay.plan_id, 'active', pay.billing_cycle, v_start, v_end, v_end, false) returning * into sub;
  else
    update public.subscriptions set plan_id = pay.plan_id, status = 'active', billing_cycle = pay.billing_cycle,
           current_period_start = case when v_prev_plan = pay.plan_id then coalesce(current_period_start, v_start) else v_start end,
           current_period_end = v_end, next_billing_date = v_end, cancel_at_period_end = false, canceled_at = null,
           owner_id = coalesce(owner_id, v_owner), updated_at = now()
     where id = sub.id returning * into sub;
  end if;

  update public.payments set status = 'APPROVED', confirmed_at = now(), applied_at = now(), subscription_id = sub.id,
         period_start = v_start, period_end = v_end, is_renewal = v_renewal and not v_changed, updated_at = now(),
         amount_cop = case when pay.environment = 'production' then pay.amount_in_cents / 100 end where id = pay.id;

  v_ctx := jsonb_build_object('plan_id', pay.plan_id, 'plan_name', pl.name, 'billing_cycle', pay.billing_cycle, 'amount_in_cents', pay.amount_in_cents,
                              'reference', pay.reference, 'period_start', v_start, 'period_end', v_end, 'payment_method', p_payment_method);
  if v_renewal and not v_changed then
    perform private.billing_enqueue(pay.restaurant_id, sub.id, pay.id, 'renewal_success', 'renewal_ok:' || pay.id, v_ctx);
  else
    perform private.billing_enqueue(pay.restaurant_id, sub.id, pay.id, 'payment_approved', 'approved:' || pay.id, v_ctx);
    if v_changed then perform private.billing_enqueue(pay.restaurant_id, sub.id, pay.id, 'plan_updated', 'plan_updated:' || pay.id, v_ctx || jsonb_build_object('previous_plan_id', v_prev_plan));
    else perform private.billing_enqueue(pay.restaurant_id, sub.id, pay.id, 'subscription_welcome', 'welcome:' || pay.id, v_ctx); end if;
  end if;
  perform private.billing_audit('webhook', null, 'plan_activated', pay.restaurant_id, sub.id, pay.id,
    jsonb_build_object('plan', pay.plan_id, 'cycle', pay.billing_cycle, 'period_start', v_start, 'period_end', v_end, 'tx', p_wompi_tx_id, 'previous_plan', v_prev_plan));
  return jsonb_build_object('ok', true, 'result', 'applied', 'subscription_id', sub.id, 'plan_id', pay.plan_id, 'period_end', v_end);
end $$;

-- ------------------------------------------------------------------------------------
-- 10) Registro de eventos del webhook (idempotente por checksum del evento)
-- ------------------------------------------------------------------------------------
create or replace function public.billing_record_event(
  p_event_reference text, p_event_type text, p_transaction_id text, p_reference text, p_environment text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.payment_events%rowtype;
begin
  insert into public.payment_events (provider, event_reference, event_type, transaction_id, reference, environment, verification_status, payload)
  values ('wompi', p_event_reference, p_event_type, p_transaction_id, p_reference, p_environment, 'received', p_payload)
  on conflict (provider, event_reference) where event_reference is not null
  do update set attempts = public.payment_events.attempts + 1
  returning * into r;
  return jsonb_build_object('id', r.id, 'attempts', r.attempts, 'processed', r.processed_at is not null);
end $$;

create or replace function public.billing_finish_event(p_id uuid, p_verification text, p_result text)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.payment_events set verification_status = p_verification, result = p_result,
         processed_at = case when p_verification in ('verified','duplicate','mismatch','unknown_reference') then now() else processed_at end
   where id = p_id;
$$;

-- eventos con firma inválida: se registran para auditoría sin dedupe (sin payload completo)
create or replace function public.billing_log_rejected_event(p_reason text, p_environment text, p_transaction_id text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.payment_events (provider, event_type, transaction_id, environment, verification_status, result, processed_at)
  values ('wompi', 'rejected', left(p_transaction_id, 80), left(p_environment, 20), 'invalid_signature', left(p_reason, 120), now());
$$;

-- ------------------------------------------------------------------------------------
-- 11) Gestión desde el panel del restaurante (authenticated; solo owner/admin del restaurante)
-- ------------------------------------------------------------------------------------
create or replace function public.billing_save_profile(
  p_restaurant uuid, p_legal_name text, p_document_type text, p_document_number text, p_email text, p_phone text, p_city text, p_address text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not private.billing_is_manager(p_restaurant, auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.billing_profiles (restaurant_id, legal_name, document_type, document_number, billing_email, phone, city, address)
  values (p_restaurant, btrim(p_legal_name), upper(btrim(p_document_type)), btrim(p_document_number), lower(btrim(p_email)), nullif(btrim(p_phone), ''), nullif(btrim(p_city), ''), nullif(btrim(p_address), ''))
  on conflict (restaurant_id) do update set legal_name = excluded.legal_name, document_type = excluded.document_type, document_number = excluded.document_number,
    billing_email = excluded.billing_email, phone = excluded.phone, city = excluded.city, address = excluded.address, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.billing_cancel_subscription(p_restaurant uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare sub public.subscriptions%rowtype;
begin
  if auth.uid() is null or not private.billing_is_manager(p_restaurant, auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into sub from public.subscriptions where restaurant_id = p_restaurant for update;
  if not found or sub.status <> 'active' or sub.plan_id in ('free','trial') then raise exception 'nothing_to_cancel'; end if;
  update public.subscriptions set cancel_at_period_end = true, auto_renew = false, canceled_at = now(), next_billing_date = null, updated_at = now() where id = sub.id;
  perform private.billing_enqueue(p_restaurant, sub.id, null, 'subscription_canceled', 'canceled:' || sub.id || ':' || to_char(sub.current_period_end, 'YYYYMMDD'),
    jsonb_build_object('plan_id', sub.plan_id, 'period_end', sub.current_period_end));
  perform private.billing_audit('user', auth.uid(), 'renewal_canceled', p_restaurant, sub.id, null, jsonb_build_object('period_end', sub.current_period_end));
  return jsonb_build_object('ok', true, 'access_until', sub.current_period_end);
end $$;

create or replace function public.billing_resume_subscription(p_restaurant uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare sub public.subscriptions%rowtype;
begin
  if auth.uid() is null or not private.billing_is_manager(p_restaurant, auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into sub from public.subscriptions where restaurant_id = p_restaurant for update;
  if not found or sub.status <> 'active' or not sub.cancel_at_period_end or sub.current_period_end <= now() then raise exception 'nothing_to_resume'; end if;
  update public.subscriptions set cancel_at_period_end = false, canceled_at = null, next_billing_date = current_period_end, updated_at = now() where id = sub.id;
  perform private.billing_audit('user', auth.uid(), 'renewal_resumed', p_restaurant, sub.id, null, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.billing_my_overview(p_restaurant uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare sub public.subscriptions%rowtype; st public.billing_settings%rowtype; v_eff text; v_pending boolean; v_plans jsonb; v_pays jsonb; v_prof jsonb;
begin
  if auth.uid() is null or not private.billing_is_manager(p_restaurant, auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into st from public.billing_settings where id;
  select * into sub from public.subscriptions where restaurant_id = p_restaurant;
  select exists (select 1 from public.payments where restaurant_id = p_restaurant and status = 'PENDING' and created_at > now() - interval '3 days') into v_pending;
  v_eff := coalesce(sub.status, 'expired');
  if v_pending and (sub.id is null or sub.status not in ('active','trialing') or sub.current_period_end <= now()) then v_eff := 'pending_payment'; end if;
  if sub.status in ('active','trialing') and sub.current_period_end <= now() then v_eff := 'expired'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'monthly_price_cop', monthly_price_cop,
           'annual_price_cop', case when st.annual_sales_enabled then annual_price_cop end,
           'annual_available', st.annual_sales_enabled and coalesce(annual_price_cop, 0) > 0, 'rank', coalesce((limits->>'rank')::int, 0),
           'limits', limits, 'description', description) order by coalesce((limits->>'rank')::int, 0)), '[]'::jsonb)
    into v_plans from public.plans where is_active and is_purchasable;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v_pays from (
    select id, reference, wompi_transaction_id, status, amount_in_cents, currency, payment_method, plan_id, billing_cycle, environment,
           created_at, confirmed_at, period_start, period_end
      from public.payments where restaurant_id = p_restaurant and status <> 'CREATED' order by created_at desc limit 50) x;
  select to_jsonb(b) - 'restaurant_id' into v_prof from public.billing_profiles b where restaurant_id = p_restaurant;

  return jsonb_build_object('server_now', now(), 'trial_days', st.trial_days, 'annual_sales_enabled', st.annual_sales_enabled,
    'subscription', case when sub.id is null then null else jsonb_build_object(
        'id', sub.id, 'plan_id', sub.plan_id, 'plan_name', (select name from public.plans where id = sub.plan_id), 'status', sub.status, 'effective_status', v_eff,
        'billing_cycle', sub.billing_cycle, 'trial_start', sub.trial_start, 'trial_end', sub.trial_end, 'current_period_start', sub.current_period_start,
        'current_period_end', sub.current_period_end, 'next_billing_date', sub.next_billing_date, 'auto_renew', sub.auto_renew,
        'cancel_at_period_end', sub.cancel_at_period_end,
        'seconds_left', greatest(0, extract(epoch from (sub.current_period_end - now()))::bigint)) end,
    'plans', v_plans, 'payments', v_pays, 'profile', v_prof, 'has_pending_payment', v_pending);
end $$;

-- ------------------------------------------------------------------------------------
-- 12) Mantenimiento programado (service_role; lo dispara billing-cron una vez al día)
-- ------------------------------------------------------------------------------------
create or replace function public.billing_run_maintenance()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare st public.billing_settings%rowtype; r record; d int; n_trial_exp int := 0; n_past int := 0; n_exp int := 0; n_aband int := 0; n_q int := 0; v_end timestamptz; v_days int;
begin
  select * into st from public.billing_settings where id;

  update public.payments set status = 'EXPIRED', updated_at = now()
   where status = 'CREATED' and wompi_transaction_id is null and expires_at < now() - interval '24 hours';
  get diagnostics n_aband = row_count;

  -- prueba / periodo vencido
  for r in select * from public.subscriptions where status in ('trialing','active') and current_period_end is not null and current_period_end <= now() for update skip locked loop
    if r.status = 'trialing' then
      update public.subscriptions set status = 'expired', updated_at = now() where id = r.id; n_trial_exp := n_trial_exp + 1;
      perform private.billing_enqueue(r.restaurant_id, r.id, null, 'subscription_expired', 'expired:' || r.id || ':' || to_char(r.current_period_end, 'YYYYMMDD'), jsonb_build_object('plan_id', r.plan_id, 'was_trial', true));
    elsif r.cancel_at_period_end then
      update public.subscriptions set status = 'canceled', next_billing_date = null, updated_at = now() where id = r.id; n_exp := n_exp + 1;
      perform private.billing_enqueue(r.restaurant_id, r.id, null, 'subscription_expired', 'expired:' || r.id || ':' || to_char(r.current_period_end, 'YYYYMMDD'), jsonb_build_object('plan_id', r.plan_id, 'canceled', true));
    else
      update public.subscriptions set status = 'past_due', updated_at = now() where id = r.id; n_past := n_past + 1;
      perform private.billing_enqueue(r.restaurant_id, r.id, null, case when r.auto_renew then 'renewal_failed' else 'subscription_expired' end,
        'expired:' || r.id || ':' || to_char(r.current_period_end, 'YYYYMMDD'), jsonb_build_object('plan_id', r.plan_id, 'billing_cycle', r.billing_cycle));
    end if;
    perform private.billing_audit('system', null, 'subscription_period_ended', r.restaurant_id, r.id, null, jsonb_build_object('from', r.status));
  end loop;
  update public.subscriptions set status = 'expired', updated_at = now()
   where status = 'past_due' and current_period_end < now() - make_interval(days => st.expire_after_days);

  -- avisos programados (dedupe_key único => idempotente)
  foreach d in array st.trial_reminder_days loop
    for r in select s.* from public.subscriptions s where s.status = 'trialing' and s.trial_end is not null and s.trial_end > now()
                and s.trial_end <= now() + make_interval(days => d) loop
      perform private.billing_enqueue(r.restaurant_id, r.id, null, 'trial_ending', 'trial_ending:' || r.id || ':' || d || ':' || to_char(r.trial_end, 'YYYYMMDD'),
        jsonb_build_object('days', d, 'trial_end', r.trial_end));
    end loop;
  end loop;
  foreach d in array st.renewal_reminder_days loop
    for r in select s.* from public.subscriptions s where s.status = 'active' and s.plan_id not in ('free','trial') and s.current_period_end > now()
                and s.current_period_end <= now() + make_interval(days => d) loop
      perform private.billing_enqueue(r.restaurant_id, r.id, null,
        case when r.cancel_at_period_end then 'subscription_expiring' else 'renewal_upcoming' end,
        'renewal:' || r.id || ':' || d || ':' || to_char(r.current_period_end, 'YYYYMMDD'),
        jsonb_build_object('days', d, 'plan_id', r.plan_id, 'billing_cycle', r.billing_cycle, 'period_end', r.current_period_end, 'auto_renew', r.auto_renew));
    end loop;
  end loop;
  for r in select s.* from public.subscriptions s where s.status = 'trialing' and s.trial_start > now() - interval '3 days' loop
    perform private.billing_enqueue(r.restaurant_id, r.id, null, 'trial_started', 'trial_started:' || r.id, jsonb_build_object('trial_end', r.trial_end));
  end loop;
  select count(*) into n_q from public.billing_notifications where delivery_status = 'pending';

  return jsonb_build_object('abandoned_payments', n_aband, 'trials_expired', n_trial_exp, 'past_due', n_past, 'canceled_ended', n_exp, 'notifications_pending', n_q);
end $$;

-- Reserva notificaciones para enviar (FOR UPDATE SKIP LOCKED: dos ejecuciones no envían lo mismo)
create or replace function public.billing_claim_notifications(p_limit int default 25)
returns table (id uuid, notification_type text, restaurant_id uuid, restaurant_name text, owner_id uuid, context jsonb, attempts int)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with c as (
    select n.id from public.billing_notifications n
     where n.scheduled_at <= now() and n.attempts < 5
       and (n.delivery_status = 'pending' or (n.delivery_status = 'failed' and n.claimed_at < now() - interval '30 minutes')
            or (n.delivery_status = 'sending' and n.claimed_at < now() - interval '15 minutes'))
     order by n.scheduled_at limit greatest(1, least(p_limit, 100)) for update skip locked)
  update public.billing_notifications n set delivery_status = 'sending', claimed_at = now(), attempts = n.attempts + 1
    from c where n.id = c.id
  returning n.id, n.notification_type, n.restaurant_id,
            (select r.name from public.restaurants r where r.id = n.restaurant_id),
            (select m.user_id from public.restaurant_members m where m.restaurant_id = n.restaurant_id and m.role = 'owner' limit 1),
            n.context, n.attempts;
end $$;

create or replace function public.billing_mark_notification(p_id uuid, p_status text, p_error text, p_provider_id text)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.billing_notifications set delivery_status = p_status, last_error = left(p_error, 300), provider_message_id = left(p_provider_id, 120),
         sent_at = case when p_status = 'sent' then now() else sent_at end, claimed_at = now(),
         attempts = case when p_status = 'pending' then greatest(attempts - 1, 0) else attempts end   -- 'pending' = proveedor de correo sin configurar: no gasta intentos
   where id = p_id and p_status in ('sent','failed','skipped','pending');
$$;

-- Pagos sin resolver que conviene reconsultar a Wompi (webhook perdido)
create or replace function public.billing_list_reconcilable(p_environment text)
returns table (reference text, wompi_transaction_id text, status text) language sql security definer set search_path = public, pg_temp as $$
  select p.reference, p.wompi_transaction_id, p.status from public.payments p
   where p.environment = p_environment and p.status in ('CREATED','PENDING') and p.created_at < now() - interval '3 minutes'
     and p.created_at > now() - interval '3 days' order by p.created_at limit 100;
$$;

-- ------------------------------------------------------------------------------------
-- 13) Administración financiera (authenticated, pero SOLO administradores de la plataforma)
-- ------------------------------------------------------------------------------------
create or replace function private.billing_require_admin() returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  -- Dos vías legítimas: (a) administrador de la plataforma con sesión de la web; (b) Edge Function `admin-billing` (service_role), que ya
  -- validó la sesión del PANEL privado y su correo autorizado. El JWT lo fija PostgREST: un navegador no puede falsificarlo.
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role' then return; end if;
  if auth.uid() is null or not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

create or replace function public.admin_billing_overview(p_environment text default 'production')
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare tz constant text := 'America/Bogota'; v_day timestamptz; v_month timestamptz; j jsonb;
begin
  perform private.billing_require_admin();
  if p_environment not in ('sandbox','production') then raise exception 'invalid_environment'; end if;
  v_day := date_trunc('day', now() at time zone tz) at time zone tz;
  v_month := date_trunc('month', now() at time zone tz) at time zone tz;
  select jsonb_build_object(
    'environment', p_environment,
    'revenue_today_cop',   coalesce(sum(amount_in_cents) filter (where status = 'APPROVED' and confirmed_at >= v_day), 0) / 100,
    'revenue_month_cop',   coalesce(sum(amount_in_cents) filter (where status = 'APPROVED' and confirmed_at >= v_month), 0) / 100,
    'revenue_all_cop',     coalesce(sum(amount_in_cents) filter (where status = 'APPROVED'), 0) / 100,
    'approved_count',      count(*) filter (where status = 'APPROVED'),
    'pending_count',       count(*) filter (where status = 'PENDING'),
    'declined_count',      count(*) filter (where status in ('DECLINED','ERROR')),
    'voided_count',        count(*) filter (where status = 'VOIDED'),
    'fees_known_cop',      coalesce(sum(fee_in_cents) filter (where status = 'APPROVED'), 0) / 100,
    'approved_without_fee_count', count(*) filter (where status = 'APPROVED' and fee_in_cents is null)
  ) into j from public.payments where environment = p_environment;
  return j || jsonb_build_object(
    'active_subscriptions', (select count(*) from public.subscriptions where status = 'active' and plan_id in ('kartta','pro') and current_period_end > now()),
    'standard_customers',   (select count(*) from public.subscriptions where status = 'active' and plan_id = 'kartta' and current_period_end > now()),
    'pro_customers',        (select count(*) from public.subscriptions where status = 'active' and plan_id = 'pro' and current_period_end > now()),
    'active_trials',        (select count(*) from public.subscriptions where status = 'trialing' and current_period_end > now()),
    'cancellations',        (select count(*) from public.subscriptions where status = 'canceled' or (status = 'active' and cancel_at_period_end)),
    'upcoming_renewals_7d', (select count(*) from public.subscriptions where status = 'active' and not cancel_at_period_end and current_period_end between now() and now() + interval '7 days'),
    'payouts_registered_cop', (select coalesce(sum(amount_in_cents), 0) / 100 from public.billing_payouts where environment = p_environment)
  );
end $$;

create or replace function public.admin_billing_series(p_environment text, p_granularity text, p_from timestamptz, p_to timestamptz)
returns table (bucket timestamptz, revenue_cop bigint, payments bigint, new_subscriptions bigint, renewals bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare tz constant text := 'America/Bogota';
begin
  perform private.billing_require_admin();
  if p_granularity not in ('day','week','month') then raise exception 'invalid_granularity'; end if;
  if p_to - p_from > interval '800 days' then raise exception 'range_too_large'; end if;
  return query
  select date_trunc(p_granularity, g.t at time zone tz) at time zone tz as bucket,
         coalesce(sum(g.amount_in_cents) / 100, 0)::bigint,
         count(*)::bigint,
         count(*) filter (where not g.is_renewal)::bigint,
         count(*) filter (where g.is_renewal)::bigint
    from (select confirmed_at as t, amount_in_cents, is_renewal from public.payments
           where environment = p_environment and status = 'APPROVED' and confirmed_at >= p_from and confirmed_at < p_to) g
   group by 1 order by 1;
end $$;

create or replace function public.admin_billing_transactions(
  p_environment text, p_q text default null, p_status text default null, p_plan text default null, p_cycle text default null,
  p_from timestamptz default null, p_to timestamptz default null, p_limit int default 50, p_offset int default 0)
returns table (id uuid, created_at timestamptz, confirmed_at timestamptz, status text, amount_in_cents bigint, plan_id text, billing_cycle text,
               payment_method text, reference text, wompi_transaction_id text, restaurant_id uuid, restaurant_name text, owner_email text, fee_in_cents bigint, total_count bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  perform private.billing_require_admin();
  return query
  select p.id, p.created_at, p.confirmed_at, p.status, p.amount_in_cents, p.plan_id, p.billing_cycle, p.payment_method, p.reference, p.wompi_transaction_id,
         p.restaurant_id, r.name, u.email::text, p.fee_in_cents, count(*) over ()
    from public.payments p
    left join public.restaurants r on r.id = p.restaurant_id
    left join auth.users u on u.id = p.owner_id
   where p.environment = p_environment and p.status <> 'CREATED'
     and (p_status is null or p.status = p_status) and (p_plan is null or p.plan_id = p_plan) and (p_cycle is null or p.billing_cycle = p_cycle)
     and (p_from is null or p.created_at >= p_from) and (p_to is null or p.created_at < p_to)
     and (v_q is null or r.name ilike '%' || v_q || '%' or u.email ilike '%' || v_q || '%' or p.reference ilike '%' || v_q || '%' or p.wompi_transaction_id ilike '%' || v_q || '%')
   order by p.created_at desc limit greatest(1, least(p_limit, 200)) offset greatest(0, p_offset);
end $$;

create or replace function public.admin_billing_customers(p_q text default null, p_limit int default 30)
returns table (restaurant_id uuid, restaurant_name text, owner_email text, plan_id text, status text, billing_cycle text, current_period_end timestamptz,
               cancel_at_period_end boolean, trial_end timestamptz, failed_payments bigint, approved_total_cop bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  perform private.billing_require_admin();
  return query
  select r.id, r.name, (select u.email::text from public.restaurant_members m join auth.users u on u.id = m.user_id where m.restaurant_id = r.id and m.role = 'owner' limit 1),
         s.plan_id, s.status, s.billing_cycle, s.current_period_end, s.cancel_at_period_end, s.trial_end,
         (select count(*) from public.payments p where p.restaurant_id = r.id and p.status in ('DECLINED','ERROR'))::bigint,
         (select coalesce(sum(p.amount_in_cents), 0) / 100 from public.payments p where p.restaurant_id = r.id and p.status = 'APPROVED' and p.environment = 'production')::bigint
    from public.restaurants r left join public.subscriptions s on s.restaurant_id = r.id
   where v_q is null or r.name ilike '%' || v_q || '%' or r.slug ilike '%' || v_q || '%'
         or exists (select 1 from public.restaurant_members m join auth.users u on u.id = m.user_id where m.restaurant_id = r.id and m.role = 'owner' and u.email ilike '%' || v_q || '%')
   order by r.created_at desc limit greatest(1, least(p_limit, 100));
end $$;

create or replace function public.admin_billing_customer_detail(p_restaurant uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform private.billing_require_admin();
  return jsonb_build_object(
    'restaurant', (select jsonb_build_object('id', r.id, 'name', r.name, 'slug', r.slug, 'suspended', r.is_suspended) from public.restaurants r where r.id = p_restaurant),
    'owner_email', (select u.email from public.restaurant_members m join auth.users u on u.id = m.user_id where m.restaurant_id = p_restaurant and m.role = 'owner' limit 1),
    'subscription', (select to_jsonb(s) - 'payment_source_id' from public.subscriptions s where s.restaurant_id = p_restaurant),
    'billing_profile', (select to_jsonb(b) from public.billing_profiles b where b.restaurant_id = p_restaurant),
    'payments', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select id, reference, wompi_transaction_id, status, amount_in_cents, plan_id, billing_cycle, payment_method, environment, is_renewal, created_at, confirmed_at, period_start, period_end, fee_in_cents
          from public.payments where restaurant_id = p_restaurant and status <> 'CREATED' order by created_at desc limit 100) x), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select notification_type, delivery_status, scheduled_at, sent_at, attempts, last_error, created_at
          from public.billing_notifications where restaurant_id = p_restaurant order by created_at desc limit 50) x), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select created_at, actor_type, action, detail from public.billing_audit_log where restaurant_id = p_restaurant order by id desc limit 50) x), '[]'::jsonb));
end $$;

create or replace function public.admin_billing_set_fee(p_payment uuid, p_fee_cop numeric, p_actor text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare pay public.payments%rowtype;
begin
  perform private.billing_require_admin();
  if p_fee_cop is null or p_fee_cop < 0 then raise exception 'invalid_fee'; end if;
  select * into pay from public.payments where id = p_payment for update;
  if not found or pay.status <> 'APPROVED' then raise exception 'payment_not_approved'; end if;
  if p_fee_cop * 100 >= pay.amount_in_cents then raise exception 'invalid_fee'; end if;
  update public.payments set fee_in_cents = round(p_fee_cop * 100)::bigint, updated_at = now() where id = pay.id;
  perform private.billing_audit('admin', auth.uid(), 'fee_registered', pay.restaurant_id, pay.subscription_id, pay.id, jsonb_build_object('fee_cop', p_fee_cop, 'previous', pay.fee_in_cents, 'actor', p_actor));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_billing_register_payout(p_amount_cop numeric, p_paid_on date, p_environment text, p_reference text, p_note text, p_actor text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform private.billing_require_admin();
  if p_amount_cop is null or p_amount_cop <= 0 or p_paid_on is null or p_paid_on > (now() at time zone 'America/Bogota')::date then raise exception 'invalid_payout'; end if;
  insert into public.billing_payouts (amount_in_cents, paid_on, environment, reference, note, created_by)
  values (round(p_amount_cop * 100)::bigint, p_paid_on, coalesce(p_environment, 'production'), nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''), auth.uid()) returning id into v_id;
  perform private.billing_audit('admin', auth.uid(), 'payout_registered', null, null, null, jsonb_build_object('payout_id', v_id, 'amount_cop', p_amount_cop, 'paid_on', p_paid_on, 'actor', p_actor));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.admin_billing_list_payouts(p_environment text default 'production')
returns table (id uuid, amount_in_cents bigint, paid_on date, reference text, note text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform private.billing_require_admin();
  return query select p.id, p.amount_in_cents, p.paid_on, p.reference, p.note, p.created_at from public.billing_payouts p where p.environment = p_environment order by p.paid_on desc, p.created_at desc limit 200;
end $$;

create or replace function public.admin_billing_get_settings() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin perform private.billing_require_admin(); return (select to_jsonb(s) from public.billing_settings s where id); end $$;

create or replace function public.admin_billing_update_settings(p_trial_days int, p_annual_enabled boolean, p_actor text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare old jsonb;
begin
  perform private.billing_require_admin();
  if p_trial_days is null or p_trial_days not between 0 and 365 then raise exception 'invalid_trial_days'; end if;
  if p_annual_enabled and exists (select 1 from public.plans where is_purchasable and is_active and coalesce(annual_price_cop, 0) <= 0) then raise exception 'annual_price_missing'; end if;
  select to_jsonb(s) into old from public.billing_settings s where id;
  update public.billing_settings set trial_days = p_trial_days, annual_sales_enabled = p_annual_enabled, updated_at = now(), updated_by = auth.uid() where id;
  perform private.billing_audit('admin', auth.uid(), 'settings_updated', null, null, null, jsonb_build_object('before', old, 'trial_days', p_trial_days, 'annual_enabled', p_annual_enabled, 'actor', p_actor));
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------------------------------
-- 14) Privilegios de ejecución
-- ------------------------------------------------------------------------------------
do $$
declare f text;
begin
  -- solo servidor (service_role)
  foreach f in array array[
    'billing_prepare_checkout(uuid,uuid,text,text,text)', 'billing_apply_transaction(text,text,text,bigint,text,text,text)',
    'billing_record_event(text,text,text,text,text,jsonb)', 'billing_finish_event(uuid,text,text)', 'billing_log_rejected_event(text,text,text)',
    'billing_run_maintenance()', 'billing_claim_notifications(int)', 'billing_mark_notification(uuid,text,text,text)', 'billing_list_reconcilable(text)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- restaurante (la función valida membresía owner/admin con auth.uid())
  foreach f in array array['billing_save_profile(uuid,text,text,text,text,text,text,text)', 'billing_cancel_subscription(uuid)', 'billing_resume_subscription(uuid)', 'billing_my_overview(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- administración (la función valida private.is_platform_admin())
  foreach f in array array['admin_billing_overview(text)', 'admin_billing_series(text,text,timestamptz,timestamptz)',
    'admin_billing_transactions(text,text,text,text,text,timestamptz,timestamptz,int,int)', 'admin_billing_customers(text,int)', 'admin_billing_customer_detail(uuid)',
    'admin_billing_set_fee(uuid,numeric,text)', 'admin_billing_register_payout(numeric,date,text,text,text,text)', 'admin_billing_list_payouts(text)',
    'admin_billing_get_settings()', 'admin_billing_update_settings(int,boolean,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

commit;

-- =====================================================================================
-- DESPUÉS DE APLICAR (manual, con confirmación del propietario):
--   * Activar ventas anuales SOLO cuando confirmes el precio:
--       update public.plans set annual_price_cop = <importe COP> where id = 'kartta';   -- p. ej. 263400 si confirmas 50 % sobre 12 mensualidades
--       update public.plans set annual_price_cop = <importe COP> where id = 'pro';      -- p. ej. 509400
--       select public.admin_billing_update_settings(30, true);                           -- (como administrador) o: update public.billing_settings set annual_sales_enabled = true;
--   * Programar el cron diario (ver docs/KARTTA_PAYMENTS.md, sección «Cron»).
-- =====================================================================================
