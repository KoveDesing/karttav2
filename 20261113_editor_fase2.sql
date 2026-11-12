-- KARTTA — Editor fase 2: fondos con degradado (bgx, hbgx), estilo por texto (tx), elementos (els) y texto por palabras (rt).
-- Todo opcional, validado en el servidor, con borrador/publicado como el resto del diseño.
-- Pro (rank 1): degradado lineal de 2 colores, cursiva/mayúsculas/espaciado/alineación por texto, hasta 6 elementos simples.
-- Elite (rank 2): degradado radial o de 3 colores, sombra/tipografía por texto, hasta 20 elementos, tarjeta promo, edición palabra por palabra, desplazamiento libre.
create or replace function private.design_runs_ok(v jsonb) returns boolean
language plpgsql immutable set search_path to '' as $f$
declare e jsonb; k text; x jsonb; s text;
begin
  if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 40 then return false; end if;
  for e in select * from jsonb_array_elements(v) loop
    if jsonb_typeof(e) <> 'object' or not (e ? 't') then return false; end if;
    for k, x in select key, value from jsonb_each(e) loop
      s := x #>> '{}';
      if not coalesce(case k
        when 't' then jsonb_typeof(x) = 'string' and char_length(s) between 1 and 40 and s !~ '[[:cntrl:]]'
        when 'c' then jsonb_typeof(x) = 'string' and s ~ '^#[0-9a-fA-F]{6}$'
        when 'b' then jsonb_typeof(x) = 'boolean'
        when 'i' then jsonb_typeof(x) = 'boolean'
        when 's' then jsonb_typeof(x) = 'number' and s ~ '^[0-9]{2,3}$' and s::int between 70 and 220
        else false end, false) then return false; end if;
    end loop;
  end loop;
  return true;
end $f$;

create or replace function private.design_check(k text, v jsonb) returns void
language plpgsql immutable set search_path to '' as $f$
declare e text; x jsonb; s text; slot text; p text; y jsonb; el jsonb; ids text[] := '{}'; hx constant text := '^#[0-9a-fA-F]{6}$';
  fonts constant text[] := array['Inter','Poppins','DM Sans','Playfair Display','Lora','Space Grotesk'];
  slots constant text[] := array['name','tag','btitle','cat','pname','pdesc','price','ann','foot'];
  bad constant text := 'invalid design: ';
begin
  if k in ('wa', 'btn') then perform private.design_obj_check(k, v); return; end if;
  if k in ('bgx', 'hbgx') then
    if jsonb_typeof(v) <> 'object' then raise exception '%', bad || k using errcode = '22023'; end if;
    for e, x in select key, value from jsonb_each(v) loop
      s := x #>> '{}';
      if not coalesce(case e
        when 't' then jsonb_typeof(x) = 'string' and s in ('linear', 'radial')
        when 'a' then jsonb_typeof(x) = 'number' and s ~ '^[0-9]{1,3}$' and s::int between 0 and 360
        when 'c1' then jsonb_typeof(x) = 'string' and s ~ hx
        when 'c2' then jsonb_typeof(x) = 'string' and s ~ hx
        when 'c3' then jsonb_typeof(x) = 'string' and s ~ hx
        else false end, false) then raise exception '%', bad || k || '.' || e using errcode = '22023'; end if;
    end loop;
  elsif k = 'tx' then
    if jsonb_typeof(v) <> 'object' then raise exception '%', bad || k using errcode = '22023'; end if;
    for slot, y in select key, value from jsonb_each(v) loop
      if not (slot = any(slots)) or jsonb_typeof(y) <> 'object' then raise exception '%', bad || 'tx.' || slot using errcode = '22023'; end if;
      for p, x in select key, value from jsonb_each(y) loop
        s := x #>> '{}';
        if not coalesce(case p
          when 'it' then jsonb_typeof(x) = 'boolean'
          when 'up' then jsonb_typeof(x) = 'boolean'
          when 'ls' then jsonb_typeof(x) = 'number' and s ~ '^[0-8]$'
          when 'al' then jsonb_typeof(x) = 'string' and s in ('left', 'center', 'right')
          when 'ts' then jsonb_typeof(x) = 'string' and s in ('none', 'soft', 'strong')
          when 'ff' then jsonb_typeof(x) = 'string' and s = any(fonts)
          else false end, false) then raise exception '%', bad || 'tx.' || slot || '.' || p using errcode = '22023'; end if;
      end loop;
    end loop;
  elsif k = 'rt' then
    if jsonb_typeof(v) <> 'object' then raise exception '%', bad || k using errcode = '22023'; end if;
    for p, x in select key, value from jsonb_each(v) loop
      if p not in ('tag', 'bt') or not private.design_runs_ok(x) then raise exception '%', bad || 'rt.' || p using errcode = '22023'; end if;
    end loop;
  elsif k = 'els' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 20 then raise exception '%', bad || k using errcode = '22023'; end if;
    for el in select * from jsonb_array_elements(v) loop
      if jsonb_typeof(el) <> 'object' or not (el ? 'id') or not (el ? 'k') then raise exception '%', bad || 'els' using errcode = '22023'; end if;
      for p, x in select key, value from jsonb_each(el) loop
        s := x #>> '{}';
        if not coalesce(case p
          when 'id' then jsonb_typeof(x) = 'string' and s ~ '^[a-z0-9]{3,8}$' and not (s = any(ids))
          when 'k' then jsonb_typeof(x) = 'string' and s in ('h', 'p', 'btn', 'div', 'sp', 'promo', 'quote')
          when 't' then jsonb_typeof(x) = 'string' and char_length(s) <= 200 and s !~ '[[:cntrl:]]'
          when 'x' then jsonb_typeof(x) = 'string' and char_length(s) <= 300 and s !~ '[[:cntrl:]]'
          when 'u' then jsonb_typeof(x) = 'string' and (s ~ '^https://[^[:space:]"''<>\\]{4,255}$' or s ~ '^wa:[0-9]{7,15}$')
          when 'c' then jsonb_typeof(x) = 'string' and s ~ hx
          when 'bg' then jsonb_typeof(x) = 'string' and s ~ hx
          when 'bg2' then jsonb_typeof(x) = 'string' and s ~ hx
          when 'al' then jsonb_typeof(x) = 'string' and s in ('l', 'c', 'r')
          when 'sz' then jsonb_typeof(x) = 'number' and s ~ '^[0-9]{2}$' and s::int between 12 and 40
          when 'h' then jsonb_typeof(x) = 'number' and s ~ '^[0-9]{1,2}$' and s::int between 8 and 80
          when 'dx' then jsonb_typeof(x) = 'number' and s ~ '^-?[0-9]{1,2}$' and s::int between -40 and 40
          when 'dy' then jsonb_typeof(x) = 'number' and s ~ '^-?[0-9]{1,2}$' and s::int between -80 and 80
          when 'af' then jsonb_typeof(x) = 'string' and s in ('header', 'announcement', 'categories', 'items', 'footer')
          when 'n' then jsonb_typeof(x) = 'number' and s ~ '^[0-9]{1,2}$' and s::int between 0 and 30
          when 'r' then private.design_runs_ok(x)
          else false end, false) then raise exception '%', bad || 'els.' || p using errcode = '22023'; end if;
      end loop;
      ids := ids || (el->>'id');
    end loop;
  else
    raise exception '%', bad || k using errcode = '22023';
  end if;
end $f$;

create or replace function private.design_rank(k text, v jsonb) returns int
language sql immutable set search_path to '' as $f$
  select case
    when k in ('wa', 'btn') then private.design_obj_rank(k, v)
    when v is null or v = '{}'::jsonb or v = '[]'::jsonb then 0
    when k in ('bgx', 'hbgx') and (v->>'t' = 'radial' or v ? 'c3') then 2
    when k = 'tx' and exists (select 1 from jsonb_each(v) s, jsonb_each(s.value) p where p.key in ('ts', 'ff')) then 2
    when k = 'rt' then 2
    when k = 'els' and (jsonb_array_length(v) > 6 or exists (select 1 from jsonb_array_elements(v) e where e->>'k' = 'promo' or e ? 'r' or coalesce((e->>'dx')::int, 0) <> 0 or coalesce((e->>'dy')::int, 0) <> 0)) then 2
    else 1 end
$f$;

do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.validate_menu_design'::regproc);
  if d like '%design_check%' then return; end if;
  d := replace(d, E'      when ''btn'' then t = ''object''', E'      when ''btn'' then t = ''object''\n      when ''bgx'' then t = ''object''\n      when ''hbgx'' then t = ''object''\n      when ''tx'' then t = ''object''\n      when ''rt'' then t = ''object''\n      when ''els'' then t = ''array''');
  d := replace(d, 'if k in (''wa'',''btn'') then', 'if k in (''wa'',''btn'',''bgx'',''hbgx'',''tx'',''rt'',''els'') then');
  d := replace(d, 'perform private.design_obj_check(k, v);', 'perform private.design_check(k, v);');
  d := replace(d, 'private.design_obj_rank(k, v)', 'private.design_rank(k, v)');
  if d not like '%design_check%' or d not like '%when ''els''%' or d not like '%design_rank%' then raise exception 'anchor not found'; end if;
  execute d;
end $mig$;

-- Elementos ocultables desde Capas: `off` (boolean) dentro de cada elemento de `els`.
do $mig$
declare d text;
begin
  d := pg_get_functiondef('private.design_check(text,jsonb)'::regprocedure);
  if d like '%when ''off''%' then return; end if;
  d := replace(d, E'          when ''r'' then private.design_runs_ok(x)', E'          when ''off'' then jsonb_typeof(x) = ''boolean''\n          when ''r'' then private.design_runs_ok(x)');
  execute d;
end $mig$;
