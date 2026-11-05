-- KARTTA — Catálogo de planes: Free / KARTTA Pro / KARTTA Elite (migración ADITIVA, NO APLICADA)
-- Conserva datos: no borra filas ni columnas. Los ids antiguos 'kartta' y 'custom' se desactivan (no se eliminan).
-- Salvaguarda: aborta si algún restaurante ya paga un plan de pago (hoy los 12 están en 'trial').
-- Mapeo: 'pro' pasa de 84.900 (rank 2) a KARTTA Pro 43.900 (rank 1); nuevo 'elite' 84.900 (rank 2).
begin;
do $$ begin
  if exists (select 1 from public.subscriptions where plan_id in ('kartta','pro','custom')) then
    raise exception 'Hay suscripciones en planes de pago: migrar manualmente antes de reasignar ids';
  end if;
end $$;

alter table public.plans add column if not exists description text;
alter table public.plans add column if not exists annual_price_cop integer;
alter table public.plans add column if not exists features jsonb not null default '[]'::jsonb;
alter table public.plans add column if not exists currency text not null default 'COP';
alter table public.plans add column if not exists updated_at timestamptz not null default now();

-- Límites configurables (única fuente en servidor). Claves existentes: rank, max_products, ai_monthly_questions.
update public.plans set name='Free', monthly_price_cop=0, annual_price_cop=0, is_active=true, updated_at=now(),
  description='Conoce KARTTA y organiza tu menú de forma básica.',
  limits=jsonb_build_object('rank',0,'max_products',20,'max_tables',5,'max_templates',2,'max_users',1,'ai_monthly_questions',20,'advanced_editor',false,'analytics_advanced',false)
 where id='free';
update public.plans set limits=limits||'{"rank":0,"ai_monthly_questions":20}'::jsonb where id='trial';  -- prueba de 30 días: sin cambios de alcance

update public.plans set name='KARTTA Pro', monthly_price_cop=43900, annual_price_cop=384564, is_active=true, updated_at=now(),
  description='Profesionaliza tu presencia y personaliza tu menú.',
  limits=jsonb_build_object('rank',1,'max_products',500,'max_tables',30,'max_templates',-1,'max_users',5,'ai_monthly_questions',300,'advanced_editor',true,'analytics_advanced',false)
 where id='pro';

insert into public.plans (id,name,monthly_price_cop,annual_price_cop,is_active,description,limits)
values ('elite','KARTTA Elite',84900,743724,true,'La experiencia más completa de KARTTA.',
  jsonb_build_object('rank',2,'max_products',2000,'max_tables',100,'max_templates',-1,'max_users',15,'ai_monthly_questions',1000,'advanced_editor',true,'analytics_advanced',true))
on conflict (id) do update set name=excluded.name, monthly_price_cop=excluded.monthly_price_cop, annual_price_cop=excluded.annual_price_cop,
  is_active=true, description=excluded.description, limits=excluded.limits, updated_at=now();

update public.plans set is_active=false, updated_at=now() where id in ('kartta','custom');   -- retirados del catálogo público
commit;

-- PENDIENTE (siguientes etapas, no incluido aquí): validate_menu_design con adv_min_rank=1 (editor avanzado desde Pro);
-- triggers de límite de mesas/usuarios/plantillas; restaurant_subscriptions y estados; payment_transactions; notification_logs; audit_logs.
