-- KARTTA · Editor tipo Canva: nuevas propiedades opcionales por elemento (`els`).
-- lk bloqueado · b/i/ul negrita/cursiva/subrayado · rot rotación (-180..180) · op opacidad (10..100)
-- w ancho % (20..100) · ls espaciado de letras (0..10 px) · lh interlineado (10..25 = 1.0..2.5) · g id de grupo
-- Seguro e idempotente. No borra datos. Rango: lk/b/i/ul = Pro; rot/op/w/ls/lh/g = Elite.
set check_function_bodies = off;
do $mig$
declare d text;
begin
  d := pg_get_functiondef('private.design_check(text,jsonb)'::regprocedure);
  if d not like '%when ''rot''%' then
    d := replace(d, E'          when ''r'' then private.design_runs_ok(x)',
      E'          when ''lk'' then jsonb_typeof(x) = ''boolean''\n          when ''b'' then jsonb_typeof(x) = ''boolean''\n          when ''i'' then jsonb_typeof(x) = ''boolean''\n          when ''ul'' then jsonb_typeof(x) = ''boolean''\n          when ''rot'' then jsonb_typeof(x) = ''number'' and s ~ ''^-?[0-9]{1,3}$'' and s::int between -180 and 180\n          when ''op'' then jsonb_typeof(x) = ''number'' and s ~ ''^[0-9]{2,3}$'' and s::int between 10 and 100\n          when ''w'' then jsonb_typeof(x) = ''number'' and s ~ ''^[0-9]{2,3}$'' and s::int between 20 and 100\n          when ''ls'' then jsonb_typeof(x) = ''number'' and s ~ ''^[0-9]{1,2}$'' and s::int between 0 and 10\n          when ''lh'' then jsonb_typeof(x) = ''number'' and s ~ ''^[0-9]{2}$'' and s::int between 10 and 25\n          when ''g'' then jsonb_typeof(x) = ''string'' and s ~ ''^[a-z0-9]{3,8}$''\n          when ''r'' then private.design_runs_ok(x)');
    if d not like '%when ''rot''%' then raise exception 'anchor design_check not found'; end if;
    execute d;
  end if;
  d := pg_get_functiondef('private.design_rank(text,jsonb)'::regprocedure);
  if d not like '%''rot''%' then
    d := replace(d, '''promo'' or e ? ''r'' or', '''promo'' or e ? ''r'' or e ?| array[''rot'',''op'',''w'',''ls'',''lh'',''g''] or');
    if d not like '%''rot''%' then raise exception 'anchor design_rank not found'; end if;
    execute d;
  end if;
end $mig$;
