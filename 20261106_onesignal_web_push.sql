-- KARTTA — OneSignal Web Push + recordatorios de vencimiento.
-- Migración aditiva: no modifica pagos, billing_notifications ni fechas de suscripción.
-- La API Key de OneSignal nunca se almacena aquí; permanece en Edge Function Secrets.

begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Los esquemas internos de Cron/pg_net no deben ser consultables por clientes de la API.
revoke all on schema cron from public, anon, authenticated;
revoke all on all tables in schema cron from public, anon, authenticated;
revoke all on schema net from public, anon, authenticated;
revoke all on all tables in schema net from public, anon, authenticated;

create table if not exists public.onesignal_push_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  notification_type text not null check (notification_type in (
    'renewal_3d', 'renewal_2d', 'trial_ending_3d', 'trial_ending_2d'
  )),
  cycle_end timestamptz not null,
  dedupe_key text not null unique,
  scheduled_at timestamptz not null default now(),
  status text not null default 'pending' check (status in (
    'pending', 'processing', 'sent', 'failed', 'cancelled', 'skipped'
  )),
  attempts integer not null default 0 check (attempts between 0 and 5),
  claimed_at timestamptz,
  sent_at timestamptz,
  onesignal_notification_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists onesignal_push_due_idx
  on public.onesignal_push_notifications (status, scheduled_at, claimed_at);
create index if not exists onesignal_push_user_idx
  on public.onesignal_push_notifications (user_id, created_at desc);

alter table public.onesignal_push_notifications enable row level security;
revoke all on public.onesignal_push_notifications from public, anon, authenticated;
grant all on public.onesignal_push_notifications to service_role;

-- Si el ciclo cambia por una renovación confirmada o la suscripción deja de estar vigente,
-- cancela los avisos antiguos. La cola es independiente de billing_notifications.
create or replace function private.onesignal_cancel_obsolete_pushes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_end timestamptz;
  new_end timestamptz;
begin
  old_end := case when old.status = 'trialing' then coalesce(old.trial_end, old.current_period_end) else old.current_period_end end;
  new_end := case when new.status = 'trialing' then coalesce(new.trial_end, new.current_period_end) else new.current_period_end end;

  if old_end is distinct from new_end
     or old.status is distinct from new.status
     or old.owner_id is distinct from new.owner_id
     or old.plan_id is distinct from new.plan_id then
    update public.onesignal_push_notifications
       set status = 'cancelled', updated_at = now(), last_error = 'subscription_cycle_changed'
     where subscription_id = old.id
       and status in ('pending', 'processing', 'failed');
  end if;
  return new;
end;
$$;

revoke all on function private.onesignal_cancel_obsolete_pushes() from public, anon, authenticated;

drop trigger if exists trg_onesignal_cancel_obsolete_pushes on public.subscriptions;
create trigger trg_onesignal_cancel_obsolete_pushes
after update of status, owner_id, plan_id, trial_end, current_period_end
on public.subscriptions
for each row execute function private.onesignal_cancel_obsolete_pushes();

-- Encola solo eventos cuyo vencimiento local en Bogotá es exactamente dentro de 3 o 2 días.
-- Usa la fecha de cada suscripción; no existe una fecha global.
create or replace function public.onesignal_enqueue_due_reminders()
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  rec record;
  local_today date := (now() at time zone 'America/Bogota')::date;
  local_due date;
  days_left integer;
  kind text;
  key_value text;
  inserted_count integer := 0;
  total_count integer := 0;
begin
  for rec in
    select
      s.id as subscription_id,
      s.restaurant_id,
      coalesce(s.owner_id, (
        select rm.user_id from public.restaurant_members rm
         where rm.restaurant_id = s.restaurant_id and rm.role = 'owner'
         order by rm.created_at asc limit 1
      )) as user_id,
      s.status as subscription_status,
      s.plan_id,
      case when s.status = 'trialing' then coalesce(s.trial_end, s.current_period_end)
           else s.current_period_end end as cycle_end,
      r.name as restaurant_name
    from public.subscriptions s
    join public.restaurants r on r.id = s.restaurant_id
    where r.is_suspended is not true
      and not exists (
        select 1 from public.payments p
         where p.restaurant_id = s.restaurant_id
           and p.status = 'PENDING'
           and p.created_at > now() - interval '3 days'
      )
      and (
        (s.status = 'trialing' and coalesce(s.trial_end, s.current_period_end) > now())
        or
        (s.status = 'active' and s.plan_id not in ('free', 'trial') and s.current_period_end > now())
      )
  loop
    if rec.user_id is null or rec.cycle_end is null then
      continue;
    end if;

    local_due := (rec.cycle_end at time zone 'America/Bogota')::date;
    days_left := local_due - local_today;
    if days_left not in (3, 2) then
      continue;
    end if;

    if rec.subscription_status = 'trialing' then
      kind := case when days_left = 3 then 'trial_ending_3d' else 'trial_ending_2d' end;
    else
      kind := case when days_left = 3 then 'renewal_3d' else 'renewal_2d' end;
    end if;

    key_value := 'onesignal:' || rec.subscription_id::text || ':' || kind || ':' ||
      to_char(rec.cycle_end at time zone 'UTC', 'YYYYMMDDHH24MISSUS');

    insert into public.onesignal_push_notifications (
      user_id, restaurant_id, subscription_id, notification_type, cycle_end, dedupe_key, scheduled_at
    ) values (
      rec.user_id, rec.restaurant_id, rec.subscription_id, kind, rec.cycle_end, key_value, now()
    ) on conflict (dedupe_key) do nothing;

    get diagnostics inserted_count = row_count;
    total_count := total_count + inserted_count;
  end loop;

  return jsonb_build_object('queued', total_count, 'bogota_date', local_today);
end;
$$;

-- Reclama filas de forma transaccional; SKIP LOCKED impide que dos ejecuciones envíen el mismo evento.
-- Antes de reclamar, vuelve a validar el estado y el ciclo actual contra subscriptions.
create or replace function public.onesignal_claim_notifications(p_limit integer default 25)
returns table (
  id uuid,
  user_id uuid,
  restaurant_id uuid,
  subscription_id uuid,
  notification_type text,
  restaurant_name text,
  cycle_end timestamptz,
  attempts integer
)
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  update public.onesignal_push_notifications n
     set status = 'cancelled', updated_at = now(), last_error = 'subscription_no_longer_eligible'
   where n.status in ('pending', 'failed')
     and not exists (
       select 1 from public.subscriptions s
        where s.id = n.subscription_id
          and s.restaurant_id = n.restaurant_id
          and s.status in ('active', 'trialing')
          and (case when s.status = 'trialing' then coalesce(s.trial_end, s.current_period_end)
                    else s.current_period_end end) = n.cycle_end
          and coalesce(s.owner_id, (
            select rm.user_id from public.restaurant_members rm
             where rm.restaurant_id = s.restaurant_id and rm.role = 'owner'
             order by rm.created_at asc limit 1
          )) = n.user_id
          and ((s.status = 'trialing' and coalesce(s.trial_end, s.current_period_end) > now())
            or (s.status = 'active' and s.plan_id not in ('free', 'trial') and s.current_period_end > now()))
     );

  return query
  with candidates as (
    select n.id
      from public.onesignal_push_notifications n
     where n.scheduled_at <= now()
       and n.attempts < 5
       and (
         n.status = 'pending'
         or (n.status = 'failed' and n.claimed_at < now() - interval '30 minutes')
         or (n.status = 'processing' and n.claimed_at < now() - interval '15 minutes')
       )
       and exists (
         select 1 from public.subscriptions s
          where s.id = n.subscription_id
            and s.restaurant_id = n.restaurant_id
            and s.status in ('active', 'trialing')
            and (case when s.status = 'trialing' then coalesce(s.trial_end, s.current_period_end)
                      else s.current_period_end end) = n.cycle_end
            and coalesce(s.owner_id, (
              select rm.user_id from public.restaurant_members rm
               where rm.restaurant_id = s.restaurant_id and rm.role = 'owner'
               order by rm.created_at asc limit 1
            )) = n.user_id
            and ((s.status = 'trialing' and coalesce(s.trial_end, s.current_period_end) > now())
              or (s.status = 'active' and s.plan_id not in ('free', 'trial') and s.current_period_end > now()))
       )
     order by n.scheduled_at, n.created_at
     limit greatest(1, least(coalesce(p_limit, 100), 100))
     for update skip locked
  ), claimed as (
    update public.onesignal_push_notifications n
       set status = 'processing', claimed_at = now(), attempts = n.attempts + 1, updated_at = now()
      from candidates c
     where n.id = c.id
     returning n.*
  )
  select c.id, c.user_id, c.restaurant_id, c.subscription_id, c.notification_type,
         r.name, c.cycle_end, c.attempts
    from claimed c
    join public.restaurants r on r.id = c.restaurant_id;
end;
$$;

create or replace function public.onesignal_notification_is_current(p_id uuid)
returns boolean
language sql
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1
      from public.onesignal_push_notifications n
      join public.subscriptions s on s.id = n.subscription_id and s.restaurant_id = n.restaurant_id
      join public.restaurants r on r.id = n.restaurant_id
     where n.id = p_id
       and n.status = 'processing'
       and r.is_suspended is not true
       and s.status in ('active', 'trialing')
       and (case when s.status = 'trialing' then coalesce(s.trial_end, s.current_period_end)
                 else s.current_period_end end) = n.cycle_end
       and coalesce(s.owner_id, (
         select rm.user_id from public.restaurant_members rm
          where rm.restaurant_id = s.restaurant_id and rm.role = 'owner'
          order by rm.created_at asc limit 1
       )) = n.user_id
       and not exists (
         select 1 from public.payments p
          where p.restaurant_id = s.restaurant_id
            and p.status = 'PENDING'
            and p.created_at > now() - interval '3 days'
       )
       and ((s.status = 'trialing' and coalesce(s.trial_end, s.current_period_end) > now())
         or (s.status = 'active' and s.plan_id not in ('free', 'trial') and s.current_period_end > now()))
  );
$$;

create or replace function public.onesignal_mark_notification(
  p_id uuid,
  p_status text,
  p_error text default null,
  p_provider_id text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('sent', 'failed', 'skipped', 'cancelled') then
    raise exception 'invalid_notification_status';
  end if;

  update public.onesignal_push_notifications
     set status = p_status,
         last_error = left(coalesce(p_error, ''), 300),
         onesignal_notification_id = left(p_provider_id, 120),
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         updated_at = now()
   where id = p_id and status = 'processing';
end;
$$;

-- Registro mínimo de pruebas manuales y rate limit por usuario (2 minutos).
create table if not exists public.onesignal_push_test_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_attempt_at timestamptz not null,
  last_result text not null default 'processing' check (last_result in ('processing', 'sent', 'skipped', 'failed')),
  last_provider_id text,
  last_error text
);
alter table public.onesignal_push_test_limits enable row level security;
revoke all on public.onesignal_push_test_limits from public, anon, authenticated;
grant all on public.onesignal_push_test_limits to service_role;

create or replace function public.onesignal_claim_test_slot(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed_user uuid;
begin
  if p_user_id is null then return false; end if;
  insert into public.onesignal_push_test_limits (user_id, last_attempt_at, last_result, last_provider_id, last_error)
  values (p_user_id, now(), 'processing', null, null)
  on conflict (user_id) do update
    set last_attempt_at = now(), last_result = 'processing', last_provider_id = null, last_error = null
    where public.onesignal_push_test_limits.last_attempt_at <= now() - interval '2 minutes'
  returning user_id into claimed_user;
  return claimed_user is not null;
end;
$$;

create or replace function public.onesignal_finish_test_slot(
  p_user_id uuid,
  p_status text,
  p_provider_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('sent', 'skipped', 'failed') then raise exception 'invalid_test_status'; end if;
  update public.onesignal_push_test_limits
     set last_result = p_status,
         last_provider_id = left(p_provider_id, 120),
         last_error = left(coalesce(p_error, ''), 300)
   where user_id = p_user_id and last_result = 'processing';
end;
$$;

-- La clave interna se genera en Postgres y queda únicamente en Vault.
-- No se imprime, no se escribe en GitHub y no se devuelve al cliente.
do $$
declare
  generated_token text;
begin
  if not exists (select 1 from vault.secrets where name = 'kartta_onesignal_cron_token') then
    generated_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    perform vault.create_secret(generated_token, 'kartta_onesignal_cron_token', 'Token interno para el cron de OneSignal KARTTA');
  end if;
  if not exists (select 1 from vault.secrets where name = 'kartta_onesignal_project_url') then
    perform vault.create_secret('https://ifbvdjvukygvvgiyzgav.supabase.co', 'kartta_onesignal_project_url', 'URL del proyecto Supabase KARTTA para el cron de OneSignal');
  end if;
  if not exists (select 1 from vault.secrets where name = 'kartta_onesignal_publishable_key') then
    perform vault.create_secret('sb_publishable_1hE4YyQLSll7KlIQoUEACQ_QjaoAfLH', 'kartta_onesignal_publishable_key', 'Clave pública del proyecto para invocar la Edge Function desde pg_net');
  end if;
end $$;

-- El endpoint no confía en el header por sí solo: verifica el token contra Vault usando service_role.
create or replace function public.onesignal_verify_cron_token(p_token text)
returns boolean
language sql
security definer
set search_path = public, vault, pg_temp
as $$
  select coalesce(
    p_token is not null
    and length(p_token) >= 48
    and p_token = (select ds.decrypted_secret from vault.decrypted_secrets ds where ds.name = 'kartta_onesignal_cron_token'),
    false
  );
$$;

revoke all on function public.onesignal_enqueue_due_reminders() from public, anon, authenticated;
revoke all on function public.onesignal_claim_notifications(integer) from public, anon, authenticated;
revoke all on function public.onesignal_mark_notification(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.onesignal_notification_is_current(uuid) from public, anon, authenticated;
revoke all on function public.onesignal_verify_cron_token(text) from public, anon, authenticated;
revoke all on function public.onesignal_claim_test_slot(uuid) from public, anon, authenticated;
revoke all on function public.onesignal_finish_test_slot(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.onesignal_enqueue_due_reminders() to service_role;
grant execute on function public.onesignal_claim_notifications(integer) to service_role;
grant execute on function public.onesignal_mark_notification(uuid, text, text, text) to service_role;
grant execute on function public.onesignal_notification_is_current(uuid) to service_role;
grant execute on function public.onesignal_verify_cron_token(text) to service_role;
grant execute on function public.onesignal_claim_test_slot(uuid) to service_role;
grant execute on function public.onesignal_finish_test_slot(uuid, text, text, text) to service_role;

-- Ejecuta desde las 08:00 hasta las 17:00 America/Bogota (13:00-22:00 UTC).
-- La fecha de vencimiento se evalúa en Bogotá; los reintentos y lotes pendientes se drenan cada hora.
-- Requiere que la Edge Function onesignal-push esté desplegada antes de aplicar esta migración.
select cron.schedule(
  'kartta-onesignal-renewal-reminders',
  '0 13-22 * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'kartta_onesignal_project_url') || '/functions/v1/onesignal-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'kartta_onesignal_publishable_key'),
        'x-kartta-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'kartta_onesignal_cron_token')
      ),
      body := '{"action":"dispatch"}'::jsonb,
      timeout_milliseconds := 10000
    ) as request_id;
  $$
);

commit;
