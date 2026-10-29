-- ============================================================================
-- KARTTA · Editor de menús v3  (migración ADITIVA: no borra ni cambia nada existente)
-- ----------------------------------------------------------------------------
-- 1) products: ingredientes, alérgenos, porción e información extra (los escribe el restaurante).
-- 2) Permisos por columna para esos campos (el proyecto usa GRANT por columna).
-- 3) private.validate_product_extras: valida longitudes y el vocabulario cerrado de alérgenos.
-- 4) validate_menu_design: acepta las claves nuevas del diseño v3 (superset del validador anterior;
--    las reglas del plan Personalizado para fuentes/anuncio/pie/orden de secciones NO cambian).
-- 5) get_public_menu: devuelve los 4 campos nuevos de cada producto (todo lo demás idéntico).
--
-- Para revertir: restaurar las definiciones anteriores de validate_menu_design y get_public_menu
-- (están en el historial de migraciones) y, si se desea, `alter table public.products drop column ...`.
-- ============================================================================

-- 1) Campos nuevos de producto ------------------------------------------------
alter table public.products
  add column if not exists ingredients text[] not null default '{}',
  add column if not exists allergens   text[] not null default '{}',
  add column if not exists serving     text,
  add column if not exists extra_info  text;

-- 2) Privilegios por columna (igual que name/description/price) ----------------
grant insert (ingredients, allergens, serving, extra_info) on public.products to authenticated;
grant update (ingredients, allergens, serving, extra_info) on public.products to authenticated;

-- 3) Validación de los campos de producto --------------------------------------
create or replace function private.validate_product_extras()
returns trigger language plpgsql set search_path to '' as $f$
declare
  a text;
  vocab constant text[] := array['gluten','lacteos','huevo','frutos_secos','mani','soya','pescado','mariscos','sesamo'];
begin
  if new.ingredients is null then new.ingredients := '{}'; end if;
  if new.allergens   is null then new.allergens   := '{}'; end if;

  if coalesce(array_length(new.ingredients, 1), 0) > 30 then
    raise exception 'invalid product: ingredients' using errcode = '22023';
  end if;
  foreach a in array new.ingredients loop
    if a is null or char_length(btrim(a)) not between 1 and 40 then
      raise exception 'invalid product: ingredients' using errcode = '22023';
    end if;
  end loop;

  foreach a in array new.allergens loop
    if a is null or not (a = any(vocab)) then
      raise exception 'invalid product: allergens' using errcode = '22023';
    end if;
  end loop;
  new.allergens := coalesce((select array_agg(distinct x order by x) from unnest(new.allergens) x), '{}');

  new.serving    := nullif(btrim(coalesce(new.serving, '')), '');
  new.extra_info := nullif(btrim(coalesce(new.extra_info, '')), '');
  if char_length(coalesce(new.serving, '')) > 60 then
    raise exception 'invalid product: serving' using errcode = '22023';
  end if;
  if char_length(coalesce(new.extra_info, '')) > 300 then
    raise exception 'invalid product: extra_info' using errcode = '22023';
  end if;
  return new;
end $f$;

drop trigger if exists trg_products_extras on public.products;
create trigger trg_products_extras
  before insert or update on public.products
  for each row execute function private.validate_product_extras();

-- 4) Validador del diseño del menú (superset del anterior) ----------------------
create or replace function public.validate_menu_design()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
declare
  k text; v jsonb; t text; s text; rank_ int := 0; adv_min_rank constant int := 3;
  hex constant text := '^#[0-9a-fA-F]{6}$';
  fonts constant text[] := array['Inter','Poppins','DM Sans','Playfair Display','Lora','Space Grotesk'];
  blk constant text[] := array['header','announcement','categories','items','footer'];
  -- v3: colores opcionales ('' = automático)
  hexopt constant text[] := array['nameColor','bTitleColor','bSubColor','titleColor','descColor','priceColor','cardBorder','navBg','navIcon','navActive','socialColor','socialBg'];
  -- v3: pesos tipográficos (400..900, múltiplos de 100)
  wts constant text[] := array['nameWeight','titleWeight','catWeight','prodNameWeight','priceWeight'];
  -- v3: enteros con rango [min,max]
  ints constant jsonb := '{"nameSize":[18,56],"titleSize":[20,64],"subSize":[11,22],"hGap":[0,24],"bannerOverlay":[0,80],"catSize":[12,28],"prodNameSize":[13,22],"prodDescSize":[11,16],"priceSize":[12,24],"navH":[52,84],"navIconSize":[18,30],"navRadius":[0,32],"socialSize":[28,52],"socialGap":[4,24],"cardGap":[6,24],"thumb":[48,96],"imgH":[80,180]}'::jsonb;
  stypes constant text[] := array['instagram','facebook','whatsapp','tiktok','youtube','maps','web'];
  elem jsonb; seen text[] := '{}'; ok boolean; rng jsonb; ek text; st text;
begin
  select coalesce((p.limits->>'rank')::int, 0) into rank_ from public.subscriptions s join public.plans p on p.id = s.plan_id
   where s.restaurant_id = new.restaurant_id and s.status in ('active','trialing') and (s.current_period_end is null or s.current_period_end > now()) limit 1;
  rank_ := coalesce(rank_, 0);
  for k, v in select key, value from jsonb_each(new.config) loop
    t := jsonb_typeof(v); s := v #>> '{}';
    ok := case k
      when 'v' then t = 'number' and (v #>> '{}') in ('1','2')
      when 'primary' then t = 'string' and (v #>> '{}') ~ hex when 'secondary' then t = 'string' and (v #>> '{}') ~ hex
      when 'background' then t = 'string' and (v #>> '{}') ~ hex when 'textColor' then t = 'string' and (v #>> '{}') ~ hex
      when 'surface' then t = 'string' and (v #>> '{}') ~ hex
      when 'tagline' then t = 'string' and char_length(v #>> '{}') <= 140
      when 'announcement' then t = 'string' and char_length(v #>> '{}') <= 160
      when 'footerText' then t = 'string' and char_length(v #>> '{}') <= 160
      when 'template' then t = 'string' and char_length(v #>> '{}') <= 30
      when 'showImages' then t = 'boolean' when 'showDescriptions' then t = 'boolean' when 'showPrices' then t = 'boolean'
      when 'showCategoriesNav' then t = 'boolean' when 'showAddress' then t = 'boolean' when 'showTags' then t = 'boolean' when 'showSearch' then t = 'boolean' when 'showNav' then t = 'boolean' when 'showHighlights' then t = 'boolean'
      when 'cardStyle' then t = 'string' and (v #>> '{}') in ('round','soft','square')
      when 'buttonStyle' then t = 'string' and (v #>> '{}') in ('solid','outline')
      when 'size' then t = 'string' and (v #>> '{}') in ('s','m','l')
      when 'headerStyle' then t = 'string' and (v #>> '{}') in ('banner','compact','centered','minimal')
      when 'navStyle' then t = 'string' and (v #>> '{}') in ('pills','underline')
      when 'itemLayout' then t = 'string' and (v #>> '{}') in ('list','cards','grid')
      when 'imageShape' then t = 'string' and (v #>> '{}') in ('square','rounded','circle')
      when 'imagePosition' then t = 'string' and (v #>> '{}') in ('left','right')
      when 'tagPosition' then t = 'string' and (v #>> '{}') in ('inline','overlay')
      when 'density' then t = 'string' and (v #>> '{}') in ('compact','normal','airy')
      when 'radius' then t = 'number' and (v #>> '{}') ~ '^[0-9]{1,2}$' and (v #>> '{}')::int between 0 and 28
      when 'fontHeading' then t = 'string' and (v #>> '{}') = any(fonts) when 'fontBody' then t = 'string' and (v #>> '{}') = any(fonts)
      when 'blocks' then t = 'array' and jsonb_array_length(v) between 2 and 5
      -- v3: listas cerradas
      when 'style' then t = 'string' and s in ('flat','minimal','soft','neo','glass','editorial','food')
      when 'anim' then t = 'string' and s in ('none','subtle','dynamic')
      when 'hAlign' then t = 'string' and s in ('auto','left','center','right')
      when 'hVert' then t = 'string' and s in ('top','center','bottom')
      when 'bannerH' then t = 'string' and s in ('auto','s','m','l')
      when 'imgRatio' then t = 'string' and s in ('auto','square','portrait','landscape')
      when 'imgFit' then t = 'string' and s in ('cover','contain')
      when 'imgPos' then t = 'string' and s in ('center','top','bottom')
      when 'shadow' then t = 'string' and s in ('auto','none','soft','medium')
      when 'navBar' then t = 'string' and s in ('solid','translucent','glass')
      when 'socialPlace' then t = 'string' and s in ('header','footer')
      when 'socialShape' then t = 'string' and s in ('circle','rounded','none')
      when 'socialDir' then t = 'string' and s in ('row','column')
      when 'bannerTitle' then t = 'string' and char_length(s) <= 60
      when 'showAbout' then t = 'boolean' when 'navFloating' then t = 'boolean' when 'navLabels' then t = 'boolean'
      else null end;
    if ok is null then
      if k = any(hexopt) then
        ok := t = 'string' and (s = '' or s ~ hex);
      elsif ints ? k then
        rng := ints -> k;
        ok := case when t = 'number' and s ~ '^[0-9]{1,3}$' then s::int between (rng->>0)::int and (rng->>1)::int else false end;
      elsif k = any(wts) then
        ok := case when t = 'number' and s ~ '^[0-9]{3}$' then s::int between 400 and 900 and s::int % 100 = 0 else false end;
      elsif k = 'social' then
        ok := t = 'array' and jsonb_array_length(v) <= 8;
      else
        ok := false;
      end if;
    end if;
    if not coalesce(ok, false) then raise exception 'invalid design: %', k using errcode = '22023'; end if;

    if k = 'blocks' then
      for elem in select * from jsonb_array_elements(v) loop
        if jsonb_typeof(elem) <> 'string' or not ((elem #>> '{}') = any(blk)) or ((elem #>> '{}') = any(seen)) then raise exception 'invalid design: blocks' using errcode = '22023'; end if;
        seen := seen || (elem #>> '{}');
      end loop;
      if not ('header' = any(seen) and 'items' = any(seen)) then raise exception 'invalid design: blocks' using errcode = '22023'; end if;
    end if;

    -- v3: redes sociales [{t, u, m?, on?}] — solo https (o dígitos para WhatsApp), sin repetir red
    if k = 'social' then
      seen := '{}';
      for elem in select * from jsonb_array_elements(v) loop
        if jsonb_typeof(elem) <> 'object' then raise exception 'invalid design: social' using errcode = '22023'; end if;
        for ek in select jsonb_object_keys(elem) loop
          if not (ek = any(array['t','u','m','on'])) then raise exception 'invalid design: social' using errcode = '22023'; end if;
        end loop;
        st := elem->>'t';
        if st is null or not (st = any(stypes)) or st = any(seen) then raise exception 'invalid design: social' using errcode = '22023'; end if;
        seen := seen || st;
        if coalesce(jsonb_typeof(elem->'u'), '') <> 'string' then raise exception 'invalid design: social' using errcode = '22023'; end if;
        if st = 'whatsapp' then
          if (elem->>'u') !~ '^[0-9]{7,15}$' then raise exception 'invalid design: social' using errcode = '22023'; end if;
        elsif (elem->>'u') !~ '^https://[^[:space:]"''<>\\]{4,255}$' then
          raise exception 'invalid design: social' using errcode = '22023';
        end if;
        if elem ? 'm' and (jsonb_typeof(elem->'m') <> 'string' or char_length(elem->>'m') > 200) then raise exception 'invalid design: social' using errcode = '22023'; end if;
        if elem ? 'on' and jsonb_typeof(elem->'on') <> 'boolean' then raise exception 'invalid design: social' using errcode = '22023'; end if;
      end loop;
    end if;

    if rank_ < adv_min_rank and ((k in ('fontHeading','fontBody') and (v #>> '{}') <> 'Inter') or (k in ('announcement','footerText') and (v #>> '{}') <> '')
       or (k = 'blocks' and v <> '["header","announcement","categories","items","footer"]'::jsonb)) then
      raise exception 'Premium plan required: %', k using errcode = '42501';
    end if;
  end loop;
  return new;
end $function$;

-- 5) Menú público: añade los campos nuevos de producto (el resto, idéntico) ------
create or replace function public.get_public_menu(p_slug text)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  select jsonb_build_object(
    'restaurant', jsonb_build_object('id', r.id, 'slug', r.slug, 'name', r.name, 'description', r.description,
      'address', r.address, 'city', r.city, 'currency', r.currency, 'public_phone', r.public_phone, 'whatsapp', r.whatsapp,
      'logo_path', r.logo_path, 'cover_path', r.cover_path),
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
