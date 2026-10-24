-- =====================================================================
-- KARTTA — Subdominio oficial (kartta.IDENTIFICADOR.food) + KARTTA Images AI
-- Ejecutar UNA vez en Supabase → SQL Editor (proyecto ifbvdjvukygvvgiyzgav).
-- No borra datos. Es seguro volver a ejecutarla (usa IF NOT EXISTS / OR REPLACE).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) SUBDOMINIO: identificador editable (restaurants.slug)
-- ---------------------------------------------------------------------
-- Historial: los enlaces/QR viejos siguen funcionando tras un cambio.
create table if not exists public.restaurant_slug_history (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  slug          text not null unique,
  changed_by    uuid,
  created_at    timestamptz not null default now()
);
alter table public.restaurant_slug_history enable row level security;
revoke all on public.restaurant_slug_history from anon, authenticated;
-- Sin políticas: solo se accede mediante las funciones de abajo.

create or replace function public._slug_reason(p_slug text)
returns text language plpgsql immutable as $$
declare reserved text[] := array[
  'kartta','www','app','api','admin','administrador','dashboard','panel','menu','m','mail','smtp','ftp',
  'soporte','support','ayuda','help','blog','docs','status','cdn','static','assets','login','registro',
  'signup','onboarding','terminos','privacidad','cookies','consentimiento','root','test','demo','food',
  'prime','billing','pagos','checkout','supabase','vercel','localhost'];
begin
  if p_slug is null or p_slug = '' then return 'empty'; end if;
  if char_length(p_slug) < 3 or char_length(p_slug) > 30 then return 'length'; end if;
  if p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then return 'format'; end if;
  if p_slug = any(reserved) then return 'reserved'; end if;
  return null;
end $$;

-- ¿Está disponible este identificador? (solo usuarios con sesión)
create or replace function public.check_slug_available(p_restaurant_id uuid, p_slug text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s text := lower(btrim(coalesce(p_slug,''))); r text;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not exists (select 1 from restaurant_members where restaurant_id = p_restaurant_id and user_id = auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  r := public._slug_reason(s);
  if r is not null then return jsonb_build_object('available', false, 'reason', r); end if;
  if exists (select 1 from restaurants where slug = s and id <> p_restaurant_id)
     or exists (select 1 from restaurant_slug_history where slug = s and restaurant_id <> p_restaurant_id) then
    return jsonb_build_object('available', false, 'reason', 'taken');
  end if;
  return jsonb_build_object('available', true, 'reason', null);
end $$;

-- Cambiar el identificador. Solo owner/admin del restaurante. Máx. 3 cambios por día.
create or replace function public.change_restaurant_slug(p_restaurant_id uuid, p_slug text)
returns text language plpgsql security definer set search_path = public as $$
declare s text := lower(btrim(coalesce(p_slug,''))); r text; old text; n int;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not exists (select 1 from restaurant_members
                 where restaurant_id = p_restaurant_id and user_id = auth.uid() and role in ('owner','admin')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  r := public._slug_reason(s);
  if r is not null then raise exception 'invalid_slug:%', r using errcode = 'P0001'; end if;

  perform pg_advisory_xact_lock(hashtext('slug:' || s));
  select slug into old from restaurants where id = p_restaurant_id for update;
  if old is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if old = s then return s; end if;

  if exists (select 1 from restaurants where slug = s and id <> p_restaurant_id)
     or exists (select 1 from restaurant_slug_history where slug = s and restaurant_id <> p_restaurant_id) then
    raise exception 'invalid_slug:taken' using errcode = 'P0001';
  end if;

  select count(*) into n from restaurant_slug_history
   where restaurant_id = p_restaurant_id and created_at > now() - interval '1 day';
  if n >= 3 then raise exception 'too_many_changes' using errcode = 'P0001'; end if;

  insert into restaurant_slug_history (restaurant_id, slug, changed_by)
    values (p_restaurant_id, old, auth.uid()) on conflict (slug) do nothing;
  -- si el nuevo nombre era un identificador viejo de este mismo restaurante, ya no es "viejo"
  delete from restaurant_slug_history where slug = s and restaurant_id = p_restaurant_id;

  update restaurants set slug = s where id = p_restaurant_id;
  return s;
exception when unique_violation then
  raise exception 'invalid_slug:taken' using errcode = 'P0001';
end $$;

-- Público: si un enlace viejo apunta a un identificador anterior, devuelve el actual.
create or replace function public.resolve_slug_alias(p_slug text)
returns text language sql stable security definer set search_path = public as $$
  select r.slug from restaurant_slug_history h join restaurants r on r.id = h.restaurant_id
  where h.slug = lower(btrim(p_slug)) limit 1;
$$;

revoke all on function public._slug_reason(text) from public;
revoke all on function public.check_slug_available(uuid, text) from public, anon;
revoke all on function public.change_restaurant_slug(uuid, text) from public, anon;
grant execute on function public.check_slug_available(uuid, text) to authenticated;
grant execute on function public.change_restaurant_slug(uuid, text) to authenticated;
grant execute on function public.resolve_slug_alias(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) KARTTA IMAGES AI: registro, cuota (5 éxitos/día/restaurante, hora Bogotá)
-- ---------------------------------------------------------------------
create table if not exists public.image_generations (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references public.restaurants(id) on delete cascade,
  user_id            uuid not null,
  style              text not null check (style in
                     ('estudio_blanco','ilustracion_2d','cinematografico','publicidad_premium','lujo_minimalista','editorial')),
  instructions       text check (instructions is null or char_length(instructions) <= 500),
  status             text not null default 'pending' check (status in ('pending','succeeded','failed')),
  provider           text not null default 'openai',
  model              text,
  quota_day          date not null,
  output_path        text,
  applied_product_id uuid,
  applied_at         timestamptz,
  error              text,
  created_at         timestamptz not null default now(),
  finished_at        timestamptz
);
create index if not exists image_generations_quota_idx on public.image_generations (restaurant_id, quota_day, status);
alter table public.image_generations enable row level security;
drop policy if exists image_generations_select on public.image_generations;
create policy image_generations_select on public.image_generations for select to authenticated
  using (exists (select 1 from restaurant_members m where m.restaurant_id = image_generations.restaurant_id and m.user_id = auth.uid()));
revoke all on public.image_generations from anon, authenticated;
grant select on public.image_generations to authenticated;  -- nadie escribe desde el navegador

-- Cuenta usos del día (éxitos + reservas vigentes de menos de 5 min).
create or replace function public.image_quota_internal(p_restaurant_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_day date := (now() at time zone 'America/Bogota')::date; v_used int; v_plan text;
begin
  select plan_id into v_plan from subscriptions
   where restaurant_id = p_restaurant_id and status in ('active','trialing')
     and (current_period_end is null or current_period_end > now()) limit 1;
  select count(*) into v_used from image_generations
   where restaurant_id = p_restaurant_id and quota_day = v_day
     and (status = 'succeeded' or (status = 'pending' and created_at > now() - interval '5 minutes'));
  return jsonb_build_object('plan_ok', coalesce(v_plan in ('pro','custom'), false),
                            'used', v_used, 'limit', 5, 'remaining', greatest(0, 5 - v_used));
end $$;

-- Para el navegador: solo miembros del restaurante.
create or replace function public.image_quota(p_restaurant_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from restaurant_members where restaurant_id = p_restaurant_id and user_id = auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return public.image_quota_internal(p_restaurant_id);
end $$;

-- Reserva ATÓMICA (solo la Edge Function, con service_role).
create or replace function public.reserve_image_generation(p_restaurant_id uuid, p_user_id uuid, p_style text, p_instructions text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_day date := (now() at time zone 'America/Bogota')::date; q jsonb; v_id uuid;
begin
  if not exists (select 1 from restaurant_members
                 where restaurant_id = p_restaurant_id and user_id = p_user_id and role in ('owner','admin')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('imgquota:' || p_restaurant_id::text));
  update image_generations set status = 'failed', error = 'timeout', finished_at = now()
   where restaurant_id = p_restaurant_id and status = 'pending' and created_at < now() - interval '5 minutes';
  q := public.image_quota_internal(p_restaurant_id);
  if (q->>'plan_ok')::boolean is not true then raise exception 'plan_required' using errcode = 'P0001'; end if;
  if (q->>'remaining')::int <= 0 then raise exception 'quota_exceeded' using errcode = 'P0001'; end if;
  insert into image_generations (restaurant_id, user_id, style, instructions, quota_day)
    values (p_restaurant_id, p_user_id, p_style, p_instructions, v_day) returning id into v_id;
  return v_id;
end $$;

-- Cierra la reserva (idempotente: solo actúa si sigue pendiente).
create or replace function public.finish_image_generation(p_id uuid, p_ok boolean, p_path text, p_model text, p_error text)
returns void language sql security definer set search_path = public as $$
  update image_generations
     set status = case when p_ok then 'succeeded' else 'failed' end,
         output_path = case when p_ok then p_path else null end,
         model = p_model, error = left(p_error, 200), finished_at = now()
   where id = p_id and status = 'pending';
$$;

revoke all on function public.image_quota_internal(uuid) from public, anon, authenticated;
revoke all on function public.reserve_image_generation(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.finish_image_generation(uuid, boolean, text, text, text) from public, anon, authenticated;
revoke all on function public.image_quota(uuid) from public, anon;
grant execute on function public.image_quota_internal(uuid) to service_role;
grant execute on function public.reserve_image_generation(uuid, uuid, text, text) to service_role;
grant execute on function public.finish_image_generation(uuid, boolean, text, text, text) to service_role;
grant execute on function public.image_quota(uuid) to authenticated;

-- Bucket PRIVADO para resultados (ruta: {restaurant_id}/{generation_id}.png)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kartta-ai-images', 'kartta-ai-images', false, 8388608, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = false;

drop policy if exists kartta_ai_images_select on storage.objects;
create policy kartta_ai_images_select on storage.objects for select to authenticated
  using (bucket_id = 'kartta-ai-images' and exists (
    select 1 from public.restaurant_members m
     where m.user_id = auth.uid() and m.restaurant_id::text = (storage.foldername(name))[1]));
-- Sin políticas de INSERT/UPDATE/DELETE: solo la Edge Function (service_role) escribe.

-- ---------------------------------------------------------------------
-- 3) KARTTA AI con imágenes: registro mínimo de uso (límite diario por restaurante)
-- ---------------------------------------------------------------------
create table if not exists public.ai_vision_log (
  id            bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id       uuid not null,
  created_at    timestamptz not null default now()
);
create index if not exists ai_vision_log_idx on public.ai_vision_log (restaurant_id, created_at);
alter table public.ai_vision_log enable row level security;
revoke all on public.ai_vision_log from anon, authenticated;
