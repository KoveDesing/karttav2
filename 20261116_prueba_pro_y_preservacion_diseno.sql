-- KARTTA — Prueba gratuita = permisos de KARTTA Pro + conservación del diseño Pro al cambiar de plan.
--
-- PROBLEMA: el plan 'trial' tenía limits.rank = 0 (igual que Free). El panel lo trataba como Pro (PLAN_RANK.trial = 1) pero
--           la base de datos y el editor leen el rank de plans.limits, así que durante los 7 días de prueba el editor
--           bloqueaba todo lo Pro y el trigger rechazaba guardar opciones Pro.
-- CAMBIOS:
--   1) plans['trial'].limits = limits de KARTTA Pro (id 'kartta'): misma matriz de permisos que un suscriptor Pro.
--   2) menu_designs.pro_backup: copia del último diseño guardado MIENTRAS la cuenta tenía rank >= 1 (la mantiene un trigger).
--      Al volver a Free, el editor guarda la versión gratuita en `config`, pero `pro_backup` NO se toca; al volver a Pro se restaura.
--   3) get_public_menu: si el restaurante ya no tiene rank >= 1, el menú público usa una representación gratuita
--      (sin tipografías/anuncio/pie/orden/elementos/botones/WhatsApp Premium) y el botón de WhatsApp se oculta.
--      Nada se borra: la configuración original sigue en menu_designs.config / pro_backup.
-- No toca precios, pagos, RLS ni credenciales. Reversible: ver el final del archivo.

-- 1) La prueba tiene los mismos límites y permisos que KARTTA Pro --------------------------------------------------
do $$
declare v jsonb;
begin
  select limits into v from public.plans where id = 'kartta';
  if v is null or coalesce((v->>'rank')::int, 0) < 1 then raise exception 'plan kartta (Pro) no encontrado o sin rank >= 1'; end if;
  update public.plans set limits = v, updated_at = now() where id = 'trial';
end $$;

-- 2) Rank vigente de un restaurante (misma regla que validate_menu_design: active/trialing y no vencida) -------------
create or replace function private.restaurant_rank(p_restaurant uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (p.limits->>'rank')::int
      from public.subscriptions s join public.plans p on p.id = s.plan_id
     where s.restaurant_id = p_restaurant and s.status in ('active','trialing')
       and (s.current_period_end is null or s.current_period_end > now())
     limit 1), 0)
$$;
revoke all on function private.restaurant_rank(uuid) from public;
grant execute on function private.restaurant_rank(uuid) to anon, authenticated, service_role;

-- 3) Copia del diseño Pro --------------------------------------------------------------------------------------------
alter table public.menu_designs add column if not exists pro_backup jsonb;

create or replace function private.menu_design_pro_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r int;
begin
  r := private.restaurant_rank(new.restaurant_id);
  if r >= 1 then
    new.pro_backup := new.config;                                   -- con Pro/prueba: la copia siempre refleja lo guardado
  elsif tg_op = 'UPDATE' then
    new.pro_backup := coalesce(old.pro_backup, new.pro_backup);     -- en Free la copia no se sobrescribe
  end if;
  return new;
end $$;
drop trigger if exists trg_menu_design_pro_snapshot on public.menu_designs;
create trigger trg_menu_design_pro_snapshot before insert or update on public.menu_designs
  for each row execute function private.menu_design_pro_snapshot();

-- Copia inicial de los diseños de restaurantes que hoy ya tienen Pro/Elite/prueba vigente (no dispara la validación: solo cambia pro_backup)
update public.menu_designs d set pro_backup = d.config
 where d.pro_backup is null and private.restaurant_rank(d.restaurant_id) >= 1;

-- 4) Representación gratuita de un diseño (no modifica nada guardado) ------------------------------------------------
create or replace function private.design_free_view(cfg jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare e record; out jsonb := '{}'::jsonb; drop_it boolean;
begin
  if cfg is null or jsonb_typeof(cfg) <> 'object' then return cfg; end if;
  for e in select key, value from jsonb_each(cfg) loop
    drop_it :=
         (e.key in ('fontHeading','fontBody') and (e.value #>> '{}') <> 'Inter')
      or (e.key in ('announcement','footerText') and coalesce(e.value #>> '{}', '') <> '')
      or (e.key = 'blocks' and e.value <> '["header","announcement","categories","items","footer"]'::jsonb)
      or (e.key in ('wa','btn','bgx','hbgx','tx','rt','els') and private.design_rank(e.key, e.value) > 0);
    if not drop_it then out := out || jsonb_build_object(e.key, e.value); end if;
  end loop;
  return out;
end $$;

-- 5) Menú público: representación gratuita y sin botón de WhatsApp cuando ya no hay Pro -------------------------------
do $mig$
declare d text; a1 text; a2 text;
begin
  d := pg_get_functiondef('public.get_public_menu(text)'::regprocedure);
  if d like '%design_free_view%' then return; end if;
  a1 := '''design'', (select d.config from public.menu_designs d where d.restaurant_id = r.id and d.status = ''published''),';
  a2 := '''wa_button'', case when r.whatsapp_enabled then private.wa_link_number(r.whatsapp_country_code, r.whatsapp) end),';
  if position(a1 in d) = 0 or position(a2 in d) = 0 then raise exception 'get_public_menu: no se encontró el fragmento esperado'; end if;
  d := replace(d, a1, '''design'', (select case when private.restaurant_rank(r.id) >= 1 then d.config else private.design_free_view(d.config) end from public.menu_designs d where d.restaurant_id = r.id and d.status = ''published''),');
  d := replace(d, a2, '''wa_button'', case when r.whatsapp_enabled and private.restaurant_rank(r.id) >= 1 then private.wa_link_number(r.whatsapp_country_code, r.whatsapp) end),');
  execute d;
end $mig$;

-- Reversión: update public.plans set limits = limits || '{"rank":0}' where id = 'trial';
--            restaurar get_public_menu desde 20261104_whatsapp_boton.sql; drop trigger trg_menu_design_pro_snapshot ...;
--            (menu_designs.pro_backup puede quedarse: no afecta a nada).
