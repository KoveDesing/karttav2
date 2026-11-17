-- KARTTA · Tipografías: 56 fuentes de Google + subida de fuentes propias (.ttf .otf .woff .woff2)
-- Seguro e idempotente. No borra datos. Requiere haber aplicado 20261113_editor_fase2.sql y 20261116_prueba_pro_y_preservacion_diseno.sql.
set check_function_bodies = off;

-- 1) Funciones auxiliares ------------------------------------------------------------------------------------------
-- Valida el arreglo `cfonts` del diseño: máx. 5 fuentes, rutas dentro de la carpeta del propio restaurante, solo Pro/Elite.
create or replace function private.cfonts_ok(rid uuid, v jsonb) returns boolean
language plpgsql stable set search_path = '' as $f$
declare e jsonb; ids text[] := '{}'; k text; x jsonb; s text;
begin
  if jsonb_typeof(v) <> 'array' then return false; end if;
  if jsonb_array_length(v) = 0 then return true; end if;
  if jsonb_array_length(v) > 5 or private.restaurant_rank(rid) < 1 then return false; end if;
  for e in select * from jsonb_array_elements(v) loop
    if jsonb_typeof(e) <> 'object' then return false; end if;
    for k, x in select key, value from jsonb_each(e) loop
      s := x #>> '{}';
      if not coalesce(case k
        when 'id' then jsonb_typeof(x) = 'string' and s ~ '^[a-z0-9]{8}$' and not (s = any(ids))
        when 'n' then jsonb_typeof(x) = 'string' and char_length(s) between 1 and 40 and s !~ '[[:cntrl:]<>"''&]'
        when 'p' then jsonb_typeof(x) = 'string' and s ~ ('^' || rid::text || '/[a-z0-9]{8}\.(ttf|otf|woff2?)$')
        when 'f' then jsonb_typeof(x) = 'string' and s in ('ttf','otf','woff','woff2')
        else false end, false) then return false; end if;
    end loop;
    if not (e ? 'id' and e ? 'n' and e ? 'p') or (e->>'p') !~ ('/' || (e->>'id') || '\.') then return false; end if;
    ids := ids || (e->>'id');
  end loop;
  return true;
end $f$;

create or replace function private.cfonts_has(cfg jsonb, code text) returns boolean
language sql immutable set search_path = '' as $f$
  select coalesce(jsonb_typeof(cfg->'cfonts') = 'array' and exists (select 1 from jsonb_array_elements(cfg->'cfonts') e where e->>'id' = code), false)
$f$;

-- 2) Lista de tipografías + fuentes propias en el validador del diseño ---------------------------------------------
do $mig$
declare d text; old_arr constant text := 'array[''Inter'',''Poppins'',''DM Sans'',''Playfair Display'',''Lora'',''Space Grotesk'']';
        new_arr constant text := 'array[''Inter'',''Poppins'',''DM Sans'',''Playfair Display'',''Lora'',''Space Grotesk'',''Montserrat'',''Roboto'',''Open Sans'',''Lato'',''Nunito'',''Raleway'',''Work Sans'',''Manrope'',''Outfit'',''Plus Jakarta Sans'',''Sora'',''Rubik'',''Karla'',''Quicksand'',''Barlow'',''Mulish'',''Figtree'',''Urbanist'',''Lexend'',''Merriweather'',''Cormorant Garamond'',''Libre Baskerville'',''DM Serif Display'',''Crimson Text'',''EB Garamond'',''Bitter'',''Source Serif 4'',''Fraunces'',''Abril Fatface'',''Bebas Neue'',''Oswald'',''Anton'',''Archivo Black'',''Righteous'',''Fredoka'',''Alfa Slab One'',''Bowlby One'',''Pacifico'',''Dancing Script'',''Great Vibes'',''Satisfy'',''Caveat'',''Shadows Into Light'',''Sacramento'',''Kaushan Script'',''Lobster'',''Permanent Marker'',''Space Mono'',''JetBrains Mono'',''IBM Plex Mono'']';
begin
  d := pg_get_functiondef('public.validate_menu_design'::regproc);
  if d not like '%cfonts%' then
    if position(old_arr in d) = 0 then raise exception 'validate_menu_design: lista de fuentes no encontrada'; end if;
    d := replace(d, old_arr, new_arr);
    d := replace(d, 'when ''fontHeading'' then t = ''string'' and (v #>> ''{}'') = any(fonts)', 'when ''cfonts'' then t = ''array'' and private.cfonts_ok(new.restaurant_id, v) when ''fontHeading'' then t = ''string'' and ((v #>> ''{}'') = any(fonts) or ((v #>> ''{}'') ~ ''^cf:[a-z0-9]{8}$'' and private.cfonts_has(new.config, substr(v #>> ''{}'', 4))))');
    d := replace(d, 'when ''fontBody'' then t = ''string'' and (v #>> ''{}'') = any(fonts)', 'when ''fontBody'' then t = ''string'' and ((v #>> ''{}'') = any(fonts) or ((v #>> ''{}'') ~ ''^cf:[a-z0-9]{8}$'' and private.cfonts_has(new.config, substr(v #>> ''{}'', 4))))');
    if d not like '%cfonts_ok%' or d not like '%Montserrat%' or d not like '%cfonts_has%' then raise exception 'validate_menu_design: fragmento no encontrado'; end if;
    execute d;
  end if;
  d := pg_get_functiondef('private.design_check(text,jsonb)'::regprocedure);
  if d not like '%Montserrat%' then
    if position(old_arr in d) = 0 or position('when ''ff'' then jsonb_typeof(x) = ''string'' and s = any(fonts)' in d) = 0 then raise exception 'design_check: fragmento no encontrado'; end if;
    d := replace(d, old_arr, new_arr);
    d := replace(d, 'when ''ff'' then jsonb_typeof(x) = ''string'' and s = any(fonts)', 'when ''ff'' then jsonb_typeof(x) = ''string'' and (s = any(fonts) or s ~ ''^cf:[a-z0-9]{8}$'')');
    execute d;
  end if;
  -- Menú público en Free: las fuentes propias no se muestran (el original sigue guardado en pro_backup)
  d := pg_get_functiondef('private.design_free_view(jsonb)'::regprocedure);
  if d not like '%cfonts%' then
    d := replace(d, 'or (e.key in (''wa'',', 'or e.key = ''cfonts'' or (e.key in (''wa'',');
    if d not like '%cfonts%' then raise exception 'design_free_view: fragmento no encontrado'; end if;
    execute d;
  end if;
end $mig$;

-- 3) Almacenamiento de fuentes: bucket público de lectura (el menú las necesita), escritura solo del dueño/admin con Pro ---
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kartta-fonts', 'kartta-fonts', true, 2097152, array['font/ttf','font/otf','font/woff','font/woff2','font/sfnt','application/font-woff','application/font-woff2','application/x-font-ttf','application/x-font-otf','application/vnd.ms-opentype','application/octet-stream'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists kfonts_insert on storage.objects;
drop policy if exists kfonts_delete on storage.objects;
create policy kfonts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'kartta-fonts'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z0-9]{8}\.(ttf|otf|woff2?)$'
    and exists (select 1 from public.restaurant_members m where m.user_id = (select auth.uid()) and m.restaurant_id::text = (storage.foldername(name))[1] and m.role in ('owner','admin'))
    and private.restaurant_rank(((storage.foldername(name))[1])::uuid) >= 1
    and (select count(*) from storage.objects o where o.bucket_id = 'kartta-fonts' and (storage.foldername(o.name))[1] = (storage.foldername(name))[1]) < 8);
create policy kfonts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'kartta-fonts'
    and exists (select 1 from public.restaurant_members m where m.user_id = (select auth.uid()) and m.restaurant_id::text = (storage.foldername(name))[1] and m.role in ('owner','admin')));
-- Lectura: bucket público (sin política select: la URL pública funciona; el listado desde el navegador no está permitido).

-- Reversión: borrar políticas kfonts_*, el bucket 'kartta-fonts' y las funciones private.cfonts_*; restaurar validate_menu_design/design_check desde 20261113.
