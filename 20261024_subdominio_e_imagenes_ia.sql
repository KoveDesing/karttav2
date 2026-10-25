-- =====================================================================
-- KARTTA — Subdominio oficial (kartta.IDENTIFICADOR.food) + KARTTA Images AI
-- YA APLICADA en el proyecto Kartta (ifbvdjvukygvvgiyzgav) como migración «subdominio_oficial_y_cuota_imagenes_pro».
-- Se conserva aquí como documentación. La tabla image_generations y las funciones Edge de imágenes ya existían.
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
returns text language plpgsql immutable set search_path = public as $$
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
  where h.slug = lower(btrim(p_slug)) and r.is_published and not r.is_suspended limit 1;
$$;

revoke all on function public._slug_reason(text) from public, anon, authenticated;
revoke all on function public.check_slug_available(uuid, text) from public, anon;
revoke all on function public.change_restaurant_slug(uuid, text) from public, anon;
grant execute on function public.check_slug_available(uuid, text) to authenticated;
grant execute on function public.change_restaurant_slug(uuid, text) to authenticated;
revoke all on function public.resolve_slug_alias(text) from public;
grant execute on function public.resolve_slug_alias(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) IMÁGENES IA: regla final = solo Pro o superior (limits.rank >= 2), 5 éxitos/día por restaurante
--    (hora America/Bogota), solo owner/admin. Los fallos no consumen cupo.
--    Reemplaza la versión anterior de reserve_kartta_image_generation (que daba 2/3/5 según plan y
--    permitía a cualquier miembro). Códigos: forbidden, subscription_inactive, plan_not_found,
--    plan_required, daily_limit.
-- ---------------------------------------------------------------------
-- (ver la definición vigente con: select pg_get_functiondef('public.reserve_kartta_image_generation(uuid,uuid)'::regprocedure);)
-- También se creó public.image_quota(p_restaurant_id) -> {plan_ok, used, limit, remaining} para el panel,
-- y se fijó plans.monthly_price_cop = 84900 para el plan 'pro' (si estaba vacío).
