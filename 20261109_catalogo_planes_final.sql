-- KARTTA — Catálogo FINAL de planes (idempotente, aditivo, no borra nada).
-- Nombres comerciales: Free · KARTTA Pro · KARTTA Elite.
-- IDs internos que se CONSERVAN por compatibilidad con suscripciones, permisos y límites:  kartta = KARTTA Pro (rank 1) · pro = KARTTA Elite (rank 2).
-- Precios oficiales: Pro 43.900 /mes · 263.400 /año  |  Elite 84.900 /mes · 509.400 /año (12 mensualidades con 50 % de descuento).
-- Ejecutar DESPUÉS de 20261106_kartta_payments.sql. NO ejecutar 20261105_planes_free_pro_elite.sql ni 20261105_planes_free_standard_pro.sql (obsoletas:
-- la primera reasigna ids y podría romper suscripciones; la segunda deja los nombres "Standard/Pro"). Esta migración las reemplaza.
begin;
do $$ begin
  if to_regclass('public.plans') is null or to_regclass('public.billing_settings') is null then
    raise exception 'Primero ejecuta 20261106_kartta_payments.sql';
  end if;
end $$;

update public.plans set name = 'Free', monthly_price_cop = 0, annual_price_cop = 0, is_purchasable = false, is_active = true, updated_at = now(),
  description = 'Conoce KARTTA y organiza tu menú de forma básica.' where id = 'free';

update public.plans set name = 'KARTTA Pro', monthly_price_cop = 43900, annual_price_cop = 263400, is_purchasable = true, is_active = true, updated_at = now(),
  description = 'Profesionaliza tu presencia y personaliza tu menú.' where id = 'kartta';

update public.plans set name = 'KARTTA Elite', monthly_price_cop = 84900, annual_price_cop = 509400, is_purchasable = true, is_active = true, updated_at = now(),
  description = 'La experiencia más completa de KARTTA.' where id = 'pro';

-- 'custom' no se vende; 'trial' es solo la prueba gratuita (rank 0). Los límites (plans.limits) NO se tocan.
update public.plans set is_purchasable = false, updated_at = now() where id in ('custom', 'trial');

-- Pago anual habilitado (los dos importes ya están fijados arriba) y prueba de 7 días para NUEVOS registros.
-- (Las pruebas ya en curso no cambian. Si create_restaurant fija el fin de la prueba por su cuenta, ajústalo allí; ver LEEME_DESPLIEGUE.md.)
update public.billing_settings set annual_sales_enabled = true, trial_days = 7, updated_at = now() where id;
commit;

-- Verificación (debe devolver exactamente 3 filas vendibles/visibles):
--   select id, name, monthly_price_cop, annual_price_cop, is_purchasable, limits->>'rank' as rank from public.plans where id in ('free','kartta','pro') order by 6;
