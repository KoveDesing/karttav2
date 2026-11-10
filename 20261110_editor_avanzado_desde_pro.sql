-- KARTTA — Alinea las opciones avanzadas del editor (tipografías, anuncio, pie y orden de secciones) con la matriz publicada:
-- disponibles desde KARTTA Pro (rank 1). Antes exigían rank 3 (plan 'custom', no vendible). Ya aplicada en el proyecto Kartta.
-- Reversible: volver a 'adv_min_rank constant int := 3' en public.validate_menu_design().
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='validate_menu_design' and n.nspname='public';
  if d is null or position('adv_min_rank constant int := 3' in d) = 0 then raise exception 'función inesperada o ya actualizada'; end if;
  execute replace(d, 'adv_min_rank constant int := 3', 'adv_min_rank constant int := 1');
end $$;
