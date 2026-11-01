-- =====================================================================
-- KARTTA — IA: chat con historial, memoria, cuotas mensuales atómicas y
-- métricas de administrador.   Migración: 20261031_ia_chat_cuotas
--
-- QUÉ HACE
--  1. Fija la cuota mensual de preguntas por plan en plans.limits
--     (ai_monthly_questions): Free/Prueba 20, KARTTA 200, Pro 500.
--     Personalizado queda SIN cuota fija (ai_contact_advisor = true).
--     NO toca precios.
--  2. Crea ai_conversations, ai_messages, ai_memory, ai_usage_events,
--     ai_quota_overrides y ai_model_prices (todas con RLS).
--  3. Crea las funciones atómicas que usa la Edge Function ai-assistant
--     (solo service_role): ai_reserve_question / ai_finish_question /
--     ai_fail_question / ai_log_blocked / ai_memory_add_for.
--  4. Crea RPC para el panel del restaurante (ai_usage_summary,
--     renombrar/borrar chats, memoria) y RPC solo para administradores
--     de la plataforma (admin_ai_*).
--
-- REGLA ÚNICA DE CONTEO (documentada)
--  * 1 pregunta del usuario = 1 evento en ai_usage_events, sin importar
--    cuántas llamadas internas haga al proveedor. Los tokens se SUMAN.
--  * Se descuenta (ai_usage.requests + 1) SOLO cuando el evento pasa a
--    'completed' (el proveedor devolvió respuesta, aunque el usuario la
--    detenga a medias). Un fallo antes de responder -> 'failed' y NO descuenta.
--  * Mientras se genera, el evento queda 'reserved' y ocupa un cupo
--    (para que dos solicitudes simultáneas no superen la cuota). Una
--    reserva que lleva más de 5 minutos deja de ocupar cupo.
--  * Borrar chats, recargar o abrir chats nuevos NO reinicia nada: el
--    conteo vive en ai_usage / ai_usage_events, no en las conversaciones.
--
-- PERÍODO: mes calendario en America/Bogota (private.ai_period_start()).
-- Aún no hay cobro real con ciclo de facturación; cuando exista, basta
-- con cambiar esa única función.
--
-- COMPATIBILIDAD: ai_usage y ai_call_events NO se modifican (el panel
-- de administración actual las sigue leyendo).
-- Aplicar primero en una rama de Supabase.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Cuotas por plan (fuente de verdad: plans.limits)
-- ---------------------------------------------------------------------
update public.plans set limits = limits || '{"ai_monthly_questions": 20}'::jsonb  where id in ('trial','free');
update public.plans set limits = limits || '{"ai_monthly_questions": 200}'::jsonb where id = 'kartta';
update public.plans set limits = limits || '{"ai_monthly_questions": 500}'::jsonb where id = 'pro';
update public.plans set limits = limits || '{"ai_contact_advisor": true}'::jsonb  where id = 'custom';

-- ---------------------------------------------------------------------
-- 2) Tablas
-- ---------------------------------------------------------------------
create table if not exists public.ai_conversations (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null default 'Nueva conversación' check (char_length(title) between 1 and 120),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index if not exists ai_conversations_owner_idx on public.ai_conversations (restaurant_id, user_id, last_message_at desc);

create table if not exists public.ai_usage_events (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  user_id         uuid references auth.users(id) on delete set null,
  conversation_id uuid references public.ai_conversations(id) on delete set null,  -- borrar el chat NO borra el consumo
  request_key     text not null check (char_length(request_key) between 8 and 80),
  period          date not null,
  kind            text not null default 'text' check (kind in ('text','photo')),
  status          text not null check (status in ('reserved','completed','failed','blocked')),
  plan_id         text,
  quota           integer,
  provider        text not null default 'groq',
  model           text,
  input_tokens    integer not null default 0 check (input_tokens >= 0),
  output_tokens   integer not null default 0 check (output_tokens >= 0),
  total_tokens    bigint  not null default 0 check (total_tokens >= 0),
  usage_reported  boolean not null default false,   -- false = el proveedor no devolvió tokens (no se inventan)
  error_code      text,
  latency_ms      integer,
  created_at      timestamptz not null default now(),
  finished_at     timestamptz,
  constraint ai_usage_events_key_uq unique (restaurant_id, request_key)
);
create index if not exists ai_usage_events_period_idx on public.ai_usage_events (restaurant_id, period, status);
create index if not exists ai_usage_events_created_idx on public.ai_usage_events (created_at desc);

create table if not exists public.ai_messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  role            text not null check (role in ('user','assistant')),
  content         text not null check (char_length(content) between 1 and 12000),
  has_image       boolean not null default false,
  status          text not null default 'complete' check (status in ('complete','stopped','error')),
  event_id        uuid references public.ai_usage_events(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists ai_messages_conv_idx on public.ai_messages (conversation_id, id);

create table if not exists public.ai_memory (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  content       text not null check (char_length(content) between 3 and 400),
  source        text not null default 'manual' check (source in ('manual','chat')),
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists ai_memory_restaurant_idx on public.ai_memory (restaurant_id, created_at);

-- Cuota acordada con un asesor (plan Personalizado u otros casos). Solo la escribe un administrador.
create table if not exists public.ai_quota_overrides (
  restaurant_id     uuid primary key references public.restaurants(id) on delete cascade,
  monthly_questions integer not null check (monthly_questions >= 0),
  note              text,
  set_by            uuid references auth.users(id) on delete set null,
  updated_at        timestamptz not null default now()
);

-- Precios por modelo para calcular coste real. Vacío a propósito: no se inventan precios.
create table if not exists public.ai_model_prices (
  model                   text primary key,
  input_usd_per_million   numeric(12,6) not null check (input_usd_per_million >= 0),
  output_usd_per_million  numeric(12,6) not null check (output_usd_per_million >= 0),
  updated_at              timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3) RLS y privilegios: el navegador solo LEE lo suyo; nunca escribe.
-- ---------------------------------------------------------------------
alter table public.ai_conversations   enable row level security;
alter table public.ai_messages        enable row level security;
alter table public.ai_memory          enable row level security;
alter table public.ai_usage_events    enable row level security;
alter table public.ai_quota_overrides enable row level security;
alter table public.ai_model_prices    enable row level security;

revoke all on public.ai_conversations, public.ai_messages, public.ai_memory, public.ai_usage_events,
              public.ai_quota_overrides, public.ai_model_prices from anon, authenticated;
grant select on public.ai_conversations, public.ai_messages, public.ai_memory, public.ai_usage_events,
              public.ai_quota_overrides, public.ai_model_prices to authenticated;

create or replace function private.ai_owns_conversation(cid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ai_conversations c
    where c.id = cid and c.user_id = (select auth.uid())
      and private.has_role(c.restaurant_id, array['owner','admin'])
  );
$$;

drop policy if exists ai_conversations_select on public.ai_conversations;
create policy ai_conversations_select on public.ai_conversations for select to authenticated
  using (user_id = (select auth.uid()) and private.has_role(restaurant_id, array['owner','admin']));

drop policy if exists ai_messages_select on public.ai_messages;
create policy ai_messages_select on public.ai_messages for select to authenticated
  using (private.ai_owns_conversation(conversation_id));

drop policy if exists ai_memory_select on public.ai_memory;
create policy ai_memory_select on public.ai_memory for select to authenticated
  using (private.has_role(restaurant_id, array['owner','admin']));

drop policy if exists ai_usage_events_select on public.ai_usage_events;
create policy ai_usage_events_select on public.ai_usage_events for select to authenticated
  using (private.has_role(restaurant_id, array['owner','admin']) or private.is_platform_admin());

drop policy if exists ai_quota_overrides_select on public.ai_quota_overrides;
create policy ai_quota_overrides_select on public.ai_quota_overrides for select to authenticated
  using (private.is_platform_admin());

drop policy if exists ai_model_prices_select on public.ai_model_prices;
create policy ai_model_prices_select on public.ai_model_prices for select to authenticated
  using (private.is_platform_admin());

-- ---------------------------------------------------------------------
-- 4) Funciones internas (esquema private: no expuesto por la API)
-- ---------------------------------------------------------------------
create or replace function private.ai_period_start()
returns date language sql stable set search_path = '' as $$
  select (date_trunc('month', now() at time zone 'America/Bogota'))::date;
$$;

-- Plan REAL del restaurante, calculado en la base (nunca se confía en el nombre que envía el navegador).
create or replace function private.ai_plan_info(p_rid uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s record; p record; v_plan text := 'free'; v_rank int; v_quota int; v_adv boolean; o integer;
begin
  select * into s from public.subscriptions where restaurant_id = p_rid order by created_at desc limit 1;
  if found and s.status in ('active','trialing') and (s.current_period_end is null or s.current_period_end > now()) then
    v_plan := s.plan_id;
  end if;
  select * into p from public.plans where id = v_plan and is_active;
  if not found then
    v_plan := 'free';
    select * into p from public.plans where id = 'free';
  end if;
  v_rank := coalesce((p.limits->>'rank')::int, 0);
  v_adv  := coalesce((p.limits->>'ai_contact_advisor')::boolean, false) or v_rank >= 3;
  if p.limits ? 'ai_monthly_questions' then
    v_quota := (p.limits->>'ai_monthly_questions')::int;
  elsif v_adv then
    v_quota := null;
  else
    v_quota := case v_rank when 0 then 20 when 1 then 200 else 500 end;
  end if;
  select monthly_questions into o from public.ai_quota_overrides where restaurant_id = p_rid;
  if found then v_quota := o; end if;          -- cuota acordada con asesor
  return jsonb_build_object(
    'plan_id', v_plan, 'plan_name', coalesce(p.name, 'Free'), 'rank', v_rank,
    'quota', v_quota,
    'contact_advisor', (v_quota is null),
    'advisor_plan', v_adv
  );
end $$;

create or replace function private.ai_clean_text(t text, maxlen int)
returns text language sql immutable set search_path = '' as $$
  select left(btrim(regexp_replace(regexp_replace(coalesce(t,''), '[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]', '', 'g'), '[ \t]+', ' ', 'g')), maxlen);
$$;

create or replace function private.ai_usage_core(p_rid uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_period date := private.ai_period_start();
  info jsonb := private.ai_plan_info(p_rid);
  v_used int; v_tok bigint; v_in bigint; v_out bigint; v_infl int; v_quota int; v_fail int;
begin
  select coalesce(requests,0), coalesce(tokens,0) into v_used, v_tok
    from public.ai_usage where restaurant_id = p_rid and period = v_period;
  v_used := coalesce(v_used,0); v_tok := coalesce(v_tok,0);
  select coalesce(sum(input_tokens),0), coalesce(sum(output_tokens),0),
         count(*) filter (where status = 'failed')
    into v_in, v_out, v_fail
    from public.ai_usage_events where restaurant_id = p_rid and period = v_period and status in ('completed','failed');
  select count(*) into v_infl from public.ai_usage_events
    where restaurant_id = p_rid and period = v_period and status = 'reserved' and created_at > now() - interval '5 minutes';
  v_quota := nullif(info->>'quota','')::int;
  return jsonb_build_object(
    'plan_id', info->'plan_id', 'plan_name', info->'plan_name', 'rank', info->'rank',
    'quota', v_quota, 'used', v_used,
    'remaining', case when v_quota is null then null else greatest(0, v_quota - v_used) end,
    'in_flight', v_infl,
    'tokens_in', v_in, 'tokens_out', v_out, 'tokens_total', v_tok,
    'tokens_unsplit', greatest(0, v_tok - v_in - v_out),
    'failed_requests', v_fail,
    'contact_advisor', (v_quota is null),
    'limit_reached', (v_quota is not null and v_used >= v_quota),
    'warn', (v_quota is not null and v_quota > 0 and v_used >= ceil(v_quota * 0.8) and v_used < v_quota),
    'period_start', v_period,
    'period_end', (v_period + interval '1 month')::date
  );
end $$;

-- ---------------------------------------------------------------------
-- 5) Funciones para la Edge Function (SOLO service_role)
-- ---------------------------------------------------------------------
create or replace function public.ai_reserve_question(
  p_restaurant_id uuid, p_user_id uuid, p_request_key text, p_kind text default 'text', p_model text default null
) returns jsonb language plpgsql security definer set search_path = 'public','private','pg_temp' as $$
declare
  v_period date := private.ai_period_start();
  info jsonb; v_quota int; v_used int; v_infl int; v_id uuid; v_ev record; v_susp boolean;
begin
  if p_kind not in ('text','photo') then p_kind := 'text'; end if;
  -- Serializa TODAS las reservas del mismo restaurante y período: evita que dos solicitudes
  -- simultáneas consuman el mismo cupo.
  perform pg_advisory_xact_lock(hashtextextended(p_restaurant_id::text || v_period::text, 0));

  if not exists (select 1 from public.restaurant_members m
                 where m.restaurant_id = p_restaurant_id and m.user_id = p_user_id and m.role in ('owner','admin')) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select is_suspended into v_susp from public.restaurants where id = p_restaurant_id;
  if coalesce(v_susp, true) then return jsonb_build_object('ok', false, 'error', 'suspended'); end if;

  -- Idempotencia: la misma clave nunca crea dos cargos.
  select * into v_ev from public.ai_usage_events where restaurant_id = p_restaurant_id and request_key = p_request_key;
  if found then
    return jsonb_build_object('ok', false, 'error', 'duplicate_request', 'event_status', v_ev.status);
  end if;

  info := private.ai_plan_info(p_restaurant_id);
  v_quota := nullif(info->>'quota','')::int;
  select coalesce(requests,0) into v_used from public.ai_usage where restaurant_id = p_restaurant_id and period = v_period;
  v_used := coalesce(v_used,0);
  select count(*) into v_infl from public.ai_usage_events
    where restaurant_id = p_restaurant_id and period = v_period and status = 'reserved' and created_at > now() - interval '5 minutes';

  if v_quota is null then
    return jsonb_build_object('ok', false, 'error', 'contact_advisor', 'plan_id', info->'plan_id', 'plan_name', info->'plan_name', 'used', v_used);
  end if;
  if v_used >= v_quota then
    return jsonb_build_object('ok', false, 'error', 'monthly_limit', 'plan_id', info->'plan_id', 'plan_name', info->'plan_name', 'quota', v_quota, 'used', v_used);
  end if;
  if v_used + v_infl >= v_quota then
    -- Hay solicitudes en curso que ocupan los últimos cupos.
    return jsonb_build_object('ok', false, 'error', 'busy', 'plan_id', info->'plan_id', 'quota', v_quota, 'used', v_used, 'in_flight', v_infl);
  end if;
  if v_infl >= 3 then
    return jsonb_build_object('ok', false, 'error', 'too_many_in_flight', 'quota', v_quota, 'used', v_used, 'in_flight', v_infl);
  end if;

  insert into public.ai_usage_events (restaurant_id, user_id, request_key, period, kind, status, plan_id, quota, model)
  values (p_restaurant_id, p_user_id, p_request_key, v_period, p_kind, 'reserved', info->>'plan_id', v_quota, p_model)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'event_id', v_id, 'plan_id', info->'plan_id', 'plan_name', info->'plan_name',
                            'quota', v_quota, 'used', v_used, 'in_flight', v_infl + 1);
end $$;

create or replace function public.ai_set_event_conversation(p_event_id uuid, p_conversation_id uuid)
returns void language sql security definer set search_path = 'public','pg_temp' as $$
  update public.ai_usage_events e set conversation_id = p_conversation_id
   where e.id = p_event_id
     and exists (select 1 from public.ai_conversations c where c.id = p_conversation_id and c.restaurant_id = e.restaurant_id);
$$;

create or replace function public.ai_finish_question(
  p_event_id uuid, p_input_tokens integer, p_output_tokens integer, p_total_tokens bigint,
  p_usage_reported boolean, p_model text, p_latency_ms integer, p_error_code text default null
) returns jsonb language plpgsql security definer set search_path = 'public','private','pg_temp' as $$
declare
  ev record; v_in int := greatest(0, coalesce(p_input_tokens,0)); v_out int := greatest(0, coalesce(p_output_tokens,0));
  v_tot bigint := greatest(0, coalesce(p_total_tokens, 0));
begin
  select * into ev from public.ai_usage_events where id = p_event_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended(ev.restaurant_id::text || ev.period::text, 0));
  if ev.status = 'completed' then return jsonb_build_object('ok', true, 'already', true); end if;
  if ev.status <> 'reserved' then return jsonb_build_object('ok', false, 'error', 'bad_state', 'status', ev.status); end if;
  if v_tot = 0 then v_tot := v_in + v_out; end if;

  update public.ai_usage_events
     set status = 'completed', input_tokens = v_in, output_tokens = v_out, total_tokens = v_tot,
         usage_reported = coalesce(p_usage_reported,false), model = coalesce(p_model, model),
         latency_ms = p_latency_ms, error_code = p_error_code, finished_at = now()
   where id = p_event_id;

  insert into public.ai_usage (restaurant_id, period, requests, tokens)
  values (ev.restaurant_id, ev.period, 1, v_tot)
  on conflict (restaurant_id, period)
  do update set requests = public.ai_usage.requests + 1, tokens = public.ai_usage.tokens + excluded.tokens;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ai_fail_question(
  p_event_id uuid, p_error_code text, p_input_tokens integer, p_output_tokens integer, p_total_tokens bigint,
  p_usage_reported boolean, p_model text, p_latency_ms integer
) returns jsonb language plpgsql security definer set search_path = 'public','private','pg_temp' as $$
declare
  ev record; v_in int := greatest(0, coalesce(p_input_tokens,0)); v_out int := greatest(0, coalesce(p_output_tokens,0));
  v_tot bigint := greatest(0, coalesce(p_total_tokens, 0));
begin
  select * into ev from public.ai_usage_events where id = p_event_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended(ev.restaurant_id::text || ev.period::text, 0));
  if ev.status <> 'reserved' then return jsonb_build_object('ok', true, 'already', true); end if;
  if v_tot = 0 then v_tot := v_in + v_out; end if;
  update public.ai_usage_events
     set status = 'failed', error_code = left(coalesce(p_error_code,'error'), 60),
         input_tokens = v_in, output_tokens = v_out, total_tokens = v_tot,
         usage_reported = coalesce(p_usage_reported,false), model = coalesce(p_model, model),
         latency_ms = p_latency_ms, finished_at = now()
   where id = p_event_id;
  -- Los tokens que el proveedor SÍ reportó se contabilizan (costaron), pero la pregunta NO se descuenta.
  if v_tot > 0 then
    insert into public.ai_usage (restaurant_id, period, requests, tokens) values (ev.restaurant_id, ev.period, 0, v_tot)
    on conflict (restaurant_id, period) do update set tokens = public.ai_usage.tokens + excluded.tokens;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Intentos bloqueados (límite alcanzado, petición de información interna...). No consumen cupo.
create or replace function public.ai_log_blocked(
  p_restaurant_id uuid, p_user_id uuid, p_conversation_id uuid, p_code text, p_kind text default 'text'
) returns void language plpgsql security definer set search_path = 'public','private','pg_temp' as $$
begin
  -- Antirruido: un solo registro por restaurante+motivo cada 60 s.
  if exists (select 1 from public.ai_usage_events
              where restaurant_id = p_restaurant_id and status = 'blocked' and error_code = left(p_code, 60)
                and created_at > now() - interval '60 seconds') then
    return;
  end if;
  insert into public.ai_usage_events (restaurant_id, user_id, conversation_id, request_key, period, kind, status, error_code, finished_at)
  values (p_restaurant_id, p_user_id, p_conversation_id, 'blk-' || gen_random_uuid()::text, private.ai_period_start(),
          case when p_kind = 'photo' then 'photo' else 'text' end, 'blocked', left(p_code, 60), now());
end $$;

create or replace function public.ai_memory_add_for(p_restaurant_id uuid, p_user_id uuid, p_content text, p_source text default 'chat')
returns jsonb language plpgsql security definer set search_path = 'public','private','pg_temp' as $$
declare v_text text := private.ai_clean_text(replace(replace(p_content, E'\n', ' '), E'\r', ' '), 400); v_n int; v_id uuid;
begin
  if not exists (select 1 from public.restaurant_members m where m.restaurant_id = p_restaurant_id and m.user_id = p_user_id and m.role in ('owner','admin')) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if char_length(v_text) < 3 then return jsonb_build_object('ok', false, 'error', 'too_short'); end if;
  select count(*) into v_n from public.ai_memory where restaurant_id = p_restaurant_id;
  if v_n >= 30 then return jsonb_build_object('ok', false, 'error', 'memory_full'); end if;
  if exists (select 1 from public.ai_memory where restaurant_id = p_restaurant_id and lower(content) = lower(v_text)) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  insert into public.ai_memory (restaurant_id, content, source, created_by)
  values (p_restaurant_id, v_text, case when p_source = 'chat' then 'chat' else 'manual' end, p_user_id) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ---------------------------------------------------------------------
-- 6) RPC del panel del restaurante (usuario autenticado)
-- ---------------------------------------------------------------------
create or replace function public.ai_usage_summary(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = 'public','private','pg_temp' as $$
begin
  if auth.uid() is null or not private.has_role(p_restaurant_id, array['owner','admin']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return private.ai_usage_core(p_restaurant_id);
end $$;

create or replace function public.ai_conversation_rename(p_id uuid, p_title text)
returns void language plpgsql security definer set search_path = 'public','private','pg_temp' as $$
declare v_t text := private.ai_clean_text(replace(p_title, E'\n', ' '), 120);
begin
  if char_length(v_t) < 1 then raise exception 'title_required' using errcode = '22023'; end if;
  update public.ai_conversations c set title = v_t, updated_at = now()
   where c.id = p_id and c.user_id = auth.uid() and private.has_role(c.restaurant_id, array['owner','admin']);
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

create or replace function public.ai_conversation_delete(p_id uuid)
returns void language plpgsql security definer set search_path = 'public','private','pg_temp' as $$
begin
  delete from public.ai_conversations c
   where c.id = p_id and c.user_id = auth.uid() and private.has_role(c.restaurant_id, array['owner','admin']);
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  -- ai_usage_events.conversation_id pasa a NULL: el consumo del mes NO se reinicia.
end $$;

create or replace function public.ai_memory_add(p_restaurant_id uuid, p_content text)
returns jsonb language plpgsql security definer set search_path = 'public','private','pg_temp' as $$
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  return public.ai_memory_add_for(p_restaurant_id, auth.uid(), p_content, 'manual');
end $$;

create or replace function public.ai_memory_delete(p_id uuid)
returns void language plpgsql security definer set search_path = 'public','private','pg_temp' as $$
begin
  delete from public.ai_memory m where m.id = p_id and private.has_role(m.restaurant_id, array['owner','admin']);
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 7) RPC SOLO para administradores de la plataforma (private.is_platform_admin())
-- ---------------------------------------------------------------------
create or replace function public.admin_ai_overview(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = 'public','private','pg_temp' as $$
declare
  f date := coalesce(p_from, private.ai_period_start());
  t date := coalesce(p_to, (now() at time zone 'America/Bogota')::date);
  res jsonb;
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  with ev as (
    select e.*, (e.created_at at time zone 'America/Bogota')::date as d,
           p.input_usd_per_million pi, p.output_usd_per_million po
      from public.ai_usage_events e left join public.ai_model_prices p on p.model = e.model
     where (e.created_at at time zone 'America/Bogota')::date between f and t
  ), cost as (
    select ev.*, case when pi is not null then (input_tokens::numeric * pi + output_tokens::numeric * po) / 1000000 end as usd from ev
  )
  select jsonb_build_object(
    'from', f, 'to', t,
    'totals', (select jsonb_build_object(
        'questions_completed', count(*) filter (where status='completed'),
        'failed', count(*) filter (where status='failed'),
        'blocked', count(*) filter (where status='blocked'),
        'tokens_in', coalesce(sum(input_tokens),0), 'tokens_out', coalesce(sum(output_tokens),0),
        'tokens_total', coalesce(sum(total_tokens),0),
        'restaurants_active', count(distinct restaurant_id) filter (where status='completed'),
        'cost_usd', sum(usd),
        'events_without_price', count(*) filter (where usd is null and status in ('completed','failed') and total_tokens > 0)) from cost),
    'by_day', (select coalesce(jsonb_agg(x order by x->>'day'), '[]'::jsonb) from (
        select jsonb_build_object('day', d, 'questions', count(*) filter (where status='completed'),
               'tokens', coalesce(sum(total_tokens),0), 'failed', count(*) filter (where status='failed'), 'cost_usd', sum(usd)) x
          from cost group by d) q),
    'by_model', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('model', coalesce(model,'(sin modelo)'), 'questions', count(*) filter (where status='completed'),
               'tokens', coalesce(sum(total_tokens),0), 'cost_usd', sum(usd)) x from cost group by model order by sum(total_tokens) desc) q),
    'by_plan', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('plan_id', coalesce(plan_id,'(n/d)'), 'questions', count(*) filter (where status='completed'),
               'tokens', coalesce(sum(total_tokens),0), 'restaurants', count(distinct restaurant_id)) x from cost group by plan_id order by count(*) desc) q),
    'errors', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('code', error_code, 'status', status, 'count', count(*)) x from cost
         where error_code is not null group by error_code, status order by count(*) desc limit 20) q),
    'top_restaurants', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('restaurant_id', c.restaurant_id, 'name', r.name, 'plan_id', max(c.plan_id),
               'questions', count(*) filter (where c.status='completed'), 'tokens', coalesce(sum(c.total_tokens),0),
               'failed', count(*) filter (where c.status='failed'), 'blocked', count(*) filter (where c.status='blocked'),
               'limit_hits', count(*) filter (where c.error_code = 'monthly_limit'), 'cost_usd', sum(c.usd)) x
          from cost c join public.restaurants r on r.id = c.restaurant_id
         group by c.restaurant_id, r.name order by coalesce(sum(c.total_tokens),0) desc limit 25) q),
    'possible_abuse', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('restaurant_id', c.restaurant_id, 'name', r.name,
               'blocked_confidential', count(*) filter (where c.error_code = 'confidential_request'),
               'limit_hits', count(*) filter (where c.error_code = 'monthly_limit'),
               'failed', count(*) filter (where c.status = 'failed')) x
          from cost c join public.restaurants r on r.id = c.restaurant_id
         where c.status in ('blocked','failed')
         group by c.restaurant_id, r.name
        having count(*) filter (where c.error_code = 'confidential_request') >= 3
            or count(*) filter (where c.error_code = 'monthly_limit') >= 5
            or count(*) filter (where c.status = 'failed') >= 20
         order by count(*) desc limit 25) q)
  ) into res;
  return res;
end $$;

create or replace function public.admin_ai_restaurant_usage(p_restaurant_id uuid, p_period date default null)
returns jsonb language plpgsql stable security definer set search_path = 'public','private','pg_temp' as $$
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return private.ai_usage_core(p_restaurant_id);
end $$;

create or replace function public.admin_ai_set_quota_override(p_restaurant_id uuid, p_monthly_questions integer, p_note text default null)
returns void language plpgsql security definer set search_path = 'public','private','pg_temp' as $$
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_monthly_questions is null then
    delete from public.ai_quota_overrides where restaurant_id = p_restaurant_id;
  else
    insert into public.ai_quota_overrides (restaurant_id, monthly_questions, note, set_by)
    values (p_restaurant_id, p_monthly_questions, p_note, auth.uid())
    on conflict (restaurant_id) do update set monthly_questions = excluded.monthly_questions, note = excluded.note,
      set_by = excluded.set_by, updated_at = now();
  end if;
end $$;

create or replace function public.admin_ai_set_price(p_model text, p_input_usd_per_million numeric, p_output_usd_per_million numeric)
returns void language plpgsql security definer set search_path = 'public','private','pg_temp' as $$
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.ai_model_prices (model, input_usd_per_million, output_usd_per_million)
  values (p_model, p_input_usd_per_million, p_output_usd_per_million)
  on conflict (model) do update set input_usd_per_million = excluded.input_usd_per_million,
    output_usd_per_million = excluded.output_usd_per_million, updated_at = now();
end $$;

-- ---------------------------------------------------------------------
-- 8) Permisos de ejecución
-- ---------------------------------------------------------------------
revoke all on function public.ai_reserve_question(uuid,uuid,text,text,text)                              from public, anon, authenticated;
revoke all on function public.ai_set_event_conversation(uuid,uuid)                                       from public, anon, authenticated;
revoke all on function public.ai_finish_question(uuid,integer,integer,bigint,boolean,text,integer,text)  from public, anon, authenticated;
revoke all on function public.ai_fail_question(uuid,text,integer,integer,bigint,boolean,text,integer)    from public, anon, authenticated;
revoke all on function public.ai_log_blocked(uuid,uuid,uuid,text,text)                                   from public, anon, authenticated;
revoke all on function public.ai_memory_add_for(uuid,uuid,text,text)                                     from public, anon, authenticated;
grant execute on function public.ai_reserve_question(uuid,uuid,text,text,text)                           to service_role;
grant execute on function public.ai_set_event_conversation(uuid,uuid)                                    to service_role;
grant execute on function public.ai_finish_question(uuid,integer,integer,bigint,boolean,text,integer,text) to service_role;
grant execute on function public.ai_fail_question(uuid,text,integer,integer,bigint,boolean,text,integer) to service_role;
grant execute on function public.ai_log_blocked(uuid,uuid,uuid,text,text)                                to service_role;
grant execute on function public.ai_memory_add_for(uuid,uuid,text,text)                                  to service_role;

revoke all on function public.ai_usage_summary(uuid)                  from public, anon;
revoke all on function public.ai_conversation_rename(uuid,text)       from public, anon;
revoke all on function public.ai_conversation_delete(uuid)            from public, anon;
revoke all on function public.ai_memory_add(uuid,text)                from public, anon;
revoke all on function public.ai_memory_delete(uuid)                  from public, anon;
revoke all on function public.admin_ai_overview(date,date)            from public, anon;
revoke all on function public.admin_ai_restaurant_usage(uuid,date)    from public, anon;
revoke all on function public.admin_ai_set_quota_override(uuid,integer,text) from public, anon;
revoke all on function public.admin_ai_set_price(text,numeric,numeric) from public, anon;
grant execute on function public.ai_usage_summary(uuid)                  to authenticated;
grant execute on function public.ai_conversation_rename(uuid,text)       to authenticated;
grant execute on function public.ai_conversation_delete(uuid)            to authenticated;
grant execute on function public.ai_memory_add(uuid,text)                to authenticated;
grant execute on function public.ai_memory_delete(uuid)                  to authenticated;
grant execute on function public.admin_ai_overview(date,date)            to authenticated;       -- la función exige is_platform_admin()
grant execute on function public.admin_ai_restaurant_usage(uuid,date)    to authenticated;
grant execute on function public.admin_ai_set_quota_override(uuid,integer,text) to authenticated;
grant execute on function public.admin_ai_set_price(text,numeric,numeric) to authenticated;
