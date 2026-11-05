-- KARTTA — Catálogo: Free / Standard / Pro (migración ADITIVA, NO APLICADA). Reemplaza al borrador free/pro/elite.
-- Los ids de la BD se conservan: 'kartta' = Standard ($43.900), 'pro' = Pro ($84.900). No se borra nada; 'custom' se desactiva.
-- Anual = 12 mensualidades x 50%: Standard 263.400, Pro 509.400 (el servidor recalculará siempre).
-- Salvaguarda: aborta si hubiera suscripciones en planes de pago (hoy los 12 restaurantes están en 'trial').
begin;
do $$ begin
  if exists (select 1 from public.subscriptions where plan_id in ('kartta','pro','custom')) then
    raise exception 'Hay suscripciones en planes de pago: revisar antes de cambiar límites';
  end if;
end $$;
alter table public.plans add column if not exists description text;
alter table public.plans add column if not exists annual_price_cop integer;
alter table public.plans add column if not exists currency text not null default 'COP';
alter table public.plans add column if not exists updated_at timestamptz not null default now();

update public.plans set name='Free', monthly_price_cop=0, annual_price_cop=0, is_active=true, updated_at=now(), description='Conoce KARTTA y organiza tu menú de forma básica.',
  limits=jsonb_build_object('rank',0,'max_products',20,'max_tables',5,'max_templates',2,'max_users',1,'ai_monthly_questions',20,'advanced_editor',false) where id='free';
update public.plans set name='Standard', monthly_price_cop=43900, annual_price_cop=263400, is_active=true, updated_at=now(), description='Profesionaliza tu presencia y personaliza tu menú.',
  limits=jsonb_build_object('rank',1,'max_products',500,'max_tables',30,'max_templates',-1,'max_users',5,'ai_monthly_questions',300,'advanced_editor',true) where id='kartta';
update public.plans set name='Pro', monthly_price_cop=84900, annual_price_cop=509400, is_active=true, updated_at=now(), description='La experiencia más completa de KARTTA.',
  limits=jsonb_build_object('rank',2,'max_products',2000,'max_tables',100,'max_templates',-1,'max_users',15,'ai_monthly_questions',1000,'advanced_editor',true,'analytics_advanced',true) where id='pro';
update public.plans set is_active=false, updated_at=now() where id='custom';
commit;
-- Límites de Standard/Pro: heredados de la propuesta anterior; confirmar. Pendiente: adv_min_rank=1 en validate_menu_design.
