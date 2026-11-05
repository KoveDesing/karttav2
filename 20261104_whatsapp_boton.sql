-- KARTTA — Botón flotante de WhatsApp en el menú público (04-nov-2026)
-- Reutiliza public.restaurants (ya guarda `whatsapp` y es lo que lee get_public_menu) en lugar de crear una tabla nueva.
--   whatsapp               → número NACIONAL, solo dígitos (columna que ya existía; la sigue usando Configuración)
--   whatsapp_country_code  → indicativo sin "+" (por defecto 57 = Colombia)
--   whatsapp_enabled       → interruptor del botón (por defecto false: ningún restaurante lo tiene activo sin pedirlo)
-- Seguridad:
--   * Las 2 columnas nuevas NO tienen privilegio UPDATE para `authenticated`: solo se escriben con set_whatsapp_button()
--     (valida número e indicativo en el servidor; exige owner/admin del restaurante, igual que la política restaurants_update).
--   * El menú público recibe SOLO el número ya validado (`wa_button`, dígitos) y únicamente si está activado y es válido.
-- Idempotente: se puede ejecutar más de una vez.

alter table public.restaurants
  add column if not exists whatsapp_enabled boolean not null default false,
  add column if not exists whatsapp_country_code text not null default '57';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'restaurants_whatsapp_cc_chk') then
    alter table public.restaurants add constraint restaurants_whatsapp_cc_chk check (whatsapp_country_code ~ '^[1-9][0-9]{0,2}$');
  end if;
end $$;

-- Largo del número nacional por indicativo {mínimo, máximo}. Indicativo desconocido → null (no se genera enlace).
create or replace function private.wa_rules(p_cc text)
returns int[] language sql immutable set search_path = '' as $$
  select case p_cc
    when '57' then array[10,10]   -- Colombia (móvil: empieza por 3)
    when '52' then array[10,10]   -- México
    when '1'  then array[10,10]   -- EE. UU., Canadá, Rep. Dominicana, Puerto Rico
    when '34' then array[9,9]     -- España
    when '51' then array[9,9]     -- Perú
    when '56' then array[9,9]     -- Chile
    when '593' then array[9,9]    -- Ecuador
    when '58' then array[10,10]   -- Venezuela
    when '507' then array[8,8]    -- Panamá
    when '506' then array[8,8]    -- Costa Rica
    when '502' then array[8,8]    -- Guatemala
    when '598' then array[8,8]    -- Uruguay
    when '591' then array[8,8]    -- Bolivia
    when '595' then array[9,9]    -- Paraguay
    when '55' then array[10,11]   -- Brasil
    when '44' then array[10,10]   -- Reino Unido
    when '351' then array[9,9]    -- Portugal
    else null end;
$$;

-- Número nacional limpio (solo dígitos) o null si no es válido. No duplica el indicativo si ya viene escrito.
create or replace function private.wa_national(p_cc text, p_raw text)
returns text language plpgsql immutable set search_path = '' as $$
declare r int[]; d text;
begin
  r := private.wa_rules(p_cc);
  if r is null then return null; end if;
  d := regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g');   -- fuera espacios, guiones, paréntesis, + y puntos
  d := regexp_replace(d, '^0+', '');                              -- fuera "00" internacional y ceros de marcación
  if length(d) > r[2] and left(d, length(p_cc)) = p_cc and length(d) - length(p_cc) between r[1] and r[2] then
    d := substr(d, length(p_cc) + 1);                             -- ya traía el indicativo
  end if;
  if length(d) < r[1] or length(d) > r[2] then return null; end if;
  if p_cc = '57' and left(d, 1) <> '3' then return null; end if;  -- celular colombiano
  return d;
end $$;

-- Número completo para wa.me (indicativo + nacional, sin "+") o null.
create or replace function private.wa_link_number(p_cc text, p_raw text)
returns text language sql immutable set search_path = '' as $$
  select case when private.wa_national(p_cc, p_raw) is null then null else p_cc || private.wa_national(p_cc, p_raw) end;
$$;

revoke all on function private.wa_rules(text), private.wa_national(text, text), private.wa_link_number(text, text) from public, anon, authenticated;

-- Guardar la configuración (único camino de escritura para las columnas nuevas).
create or replace function public.set_whatsapp_button(p_restaurant_id uuid, p_enabled boolean, p_country_code text, p_number text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cc text := btrim(coalesce(p_country_code, '')); raw text := btrim(coalesce(p_number, '')); nat text; link text;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_restaurant_id is null or p_enabled is null then raise exception 'invalid_value' using errcode = '22023'; end if;
  if not private.has_role(p_restaurant_id, array['owner','admin'])
     or exists (select 1 from public.restaurants where id = p_restaurant_id and is_suspended) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  cc := regexp_replace(cc, '[^0-9]', '', 'g');
  if private.wa_rules(cc) is null then raise exception 'invalid_country_code' using errcode = '22023'; end if;
  if raw <> '' then
    nat := private.wa_national(cc, raw);
    if nat is null then raise exception 'invalid_whatsapp_number' using errcode = '22023'; end if;
  end if;
  if p_enabled and nat is null then raise exception 'number_required' using errcode = '22023'; end if;
  update public.restaurants
     set whatsapp = nat, whatsapp_country_code = cc, whatsapp_enabled = p_enabled
   where id = p_restaurant_id;
  link := case when nat is null then null else cc || nat end;
  return jsonb_build_object('enabled', p_enabled, 'country_code', cc, 'number', nat, 'link_number', link);
end $$;

revoke all on function public.set_whatsapp_button(uuid, boolean, text, text) from public, anon;
grant execute on function public.set_whatsapp_button(uuid, boolean, text, text) to authenticated;

-- Consulta ligera para el menú público (refresca el botón sin recargar todo el menú).
create or replace function public.get_public_whatsapp(p_slug text)
returns text language sql stable security definer set search_path = '' as $$
  select case when r.whatsapp_enabled then private.wa_link_number(r.whatsapp_country_code, r.whatsapp) end
  from public.restaurants r
  where lower(r.slug) = lower(btrim(p_slug)) and r.is_published and not r.is_suspended
  limit 1;
$$;
revoke all on function public.get_public_whatsapp(text) from public;
grant execute on function public.get_public_whatsapp(text) to anon, authenticated;

-- get_public_menu: igual que antes + restaurant.wa_button (dígitos válidos o null). Nada más cambia.
create or replace function public.get_public_menu(p_slug text)
returns jsonb language sql stable security definer set search_path to '' as $function$
  select jsonb_build_object(
    'restaurant', jsonb_build_object('id', r.id, 'slug', r.slug, 'name', r.name, 'description', r.description,
      'address', r.address, 'city', r.city, 'currency', r.currency, 'public_phone', r.public_phone, 'whatsapp', r.whatsapp,
      'logo_path', r.logo_path, 'cover_path', r.cover_path,
      'wa_button', case when r.whatsapp_enabled then private.wa_link_number(r.whatsapp_country_code, r.whatsapp) end),
    'design', (select d.config from public.menu_designs d where d.restaurant_id = r.id and d.status = 'published'),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description,
        'image_path', c.image_path, 'sort_order', c.sort_order,
        'tags', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'bg', t.bg, 'fg', t.fg, 'style', t.style, 'icon', t.icon) order by t.sort_order, t.name)
                 from public.category_tag_links l join public.product_tags t on t.id = l.tag_id where l.category_id = c.id and t.is_active), '[]'::jsonb)
      ) order by c.sort_order, c.name) from public.categories c where c.restaurant_id = r.id and c.is_visible), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'category_id', p.category_id, 'name', p.name, 'description', p.description,
        'price', p.price, 'discount_percent', p.discount_percent, 'image_path', p.image_path, 'is_available', p.is_available, 'sort_order', p.sort_order,
        'ingredients', p.ingredients, 'allergens', p.allergens, 'serving', p.serving, 'extra_info', p.extra_info,
        'tags', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'bg', t.bg, 'fg', t.fg, 'style', t.style, 'icon', t.icon) order by t.sort_order, t.name)
                 from public.product_tag_links l join public.product_tags t on t.id = l.tag_id where l.product_id = p.id and t.is_active), '[]'::jsonb)
      ) order by p.sort_order, p.name) from public.products p where p.restaurant_id = r.id and p.is_active), '[]'::jsonb)
  )
  from public.restaurants r where lower(r.slug) = lower(p_slug) and r.is_published and not r.is_suspended;
$function$;
