-- Pruebas de la migración 20261106 contra Postgres local (stub de Supabase). Cada assert aborta con ON_ERROR_STOP.
create schema if not exists t;
create or replace function t.ok(c boolean, msg text) returns void language plpgsql as $$ begin if c is not true then raise exception 'FALLA: %', msg; end if; raise notice 'ok  - %', msg; end $$;
create or replace function t.raises(q text, expect text, msg text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm like '%' || expect || '%' or sqlstate = expect then raise notice 'ok  - % (rechazado: %)', msg, sqlerrm; return; end if;
    raise exception 'FALLA: % — error inesperado: %', msg, sqlerrm;
  end;
  raise exception 'FALLA: % — debía fallar y no falló', msg;
end $$;
create or replace function t.cnt(q text) returns bigint language plpgsql security definer as $$ declare n bigint; begin execute q into n; return n; end $$;
create or replace function t.pay_id(tx text) returns uuid language sql security definer as $$ select id from public.payments where wompi_transaction_id = tx $$;
grant usage on schema t to authenticated, service_role, anon;
grant execute on all functions in schema t to authenticated, service_role, anon;

-- ---- datos ----
insert into auth.users (id, email) values
 ('a0000000-0000-0000-0000-00000000000a','owner-a@test.co'),('b0000000-0000-0000-0000-00000000000b','owner-b@test.co'),
 ('c0000000-0000-0000-0000-00000000000c','staff-a@test.co'),('d0000000-0000-0000-0000-00000000000d','admin@test.co'),('e0000000-0000-0000-0000-00000000000e','stranger@test.co');
insert into public.restaurants (id,name,slug) values ('aaaaaaaa-0000-0000-0000-000000000001','Resto A','resto-a'),('bbbbbbbb-0000-0000-0000-000000000002','Resto B','resto-b');
insert into public.restaurant_members values
 ('aaaaaaaa-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','owner'),
 ('aaaaaaaa-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000c','staff'),
 ('bbbbbbbb-0000-0000-0000-000000000002','b0000000-0000-0000-0000-00000000000b','owner');
insert into public.platform_admins values ('d0000000-0000-0000-0000-00000000000d');
insert into public.subscriptions (restaurant_id, plan_id, status, current_period_end) values
 ('aaaaaaaa-0000-0000-0000-000000000001','trial','trialing', now() + interval '10 days'),
 ('bbbbbbbb-0000-0000-0000-000000000002','trial','trialing', now() + interval '10 days');

set role service_role;
do $$ declare a constant uuid := 'a0000000-0000-0000-0000-00000000000a'; ra constant uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; r jsonb; s record; p record; n int;
begin
  -- 0) la prueba existente se respeta y se rellenan fechas
  select * into s from public.subscriptions where restaurant_id = ra;
  perform t.ok(s.trial_start is not null and s.trial_end is not null, 'trial_start/trial_end rellenados para la prueba');

  -- 1) precio sale de la BD, no del cliente
  r := public.billing_prepare_checkout(a, ra, 'kartta', 'monthly', 'sandbox');
  perform t.ok((r->>'amount_in_cents')::bigint = 4390000, 'Standard mensual = 4.390.000 centavos (43.900 COP) desde la BD');
  r := public.billing_prepare_checkout(a, ra, 'pro', 'monthly', 'sandbox');
  perform t.ok((r->>'amount_in_cents')::bigint = 8490000, 'Pro mensual = 8.490.000 centavos');
  perform t.ok((r->>'reference') ~ '^KT-[A-F0-9]{20}$', 'referencia única con formato KT-…');

  -- 2) rechazos
  perform t.raises($q$select public.billing_prepare_checkout('e0000000-0000-0000-0000-00000000000e','aaaaaaaa-0000-0000-0000-000000000001','pro','monthly','sandbox')$q$, 'forbidden', 'un extraño no puede cobrar a un restaurante ajeno');
  perform t.raises($q$select public.billing_prepare_checkout('c0000000-0000-0000-0000-00000000000c','aaaaaaaa-0000-0000-0000-000000000001','pro','monthly','sandbox')$q$, 'forbidden', 'staff no puede contratar');
  perform t.raises($q$select public.billing_prepare_checkout('a0000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','pro','annual','sandbox')$q$, 'annual_not_available', 'anual bloqueado hasta confirmar precio');
  perform t.raises($q$select public.billing_prepare_checkout('a0000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','free','monthly','sandbox')$q$, 'plan_not_available', 'plan no vendible rechazado');
  perform t.raises($q$select public.billing_prepare_checkout('a0000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','pro','weekly','sandbox')$q$, 'invalid_cycle', 'ciclo inválido');
end $$;

-- ---- 3) activación: validaciones previas ----
do $$ declare a constant uuid := 'a0000000-0000-0000-0000-00000000000a'; ra constant uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; r jsonb; ref text; s record;
begin
  r := public.billing_prepare_checkout(a, ra, 'kartta', 'monthly', 'sandbox'); ref := r->>'reference';
  perform t.ok((public.billing_apply_transaction('KT-NOEXISTE','tx-0','APPROVED',4390000,'COP','CARD','sandbox')->>'result') = 'unknown_reference', 'referencia desconocida no activa nada');
  perform t.ok((public.billing_apply_transaction(ref,'tx-1','APPROVED',100,'COP','CARD','sandbox')->>'result') = 'amount_mismatch', 'importe manipulado (1 COP) rechazado');
  perform t.ok((public.billing_apply_transaction(ref,'tx-1','APPROVED',4390000,'USD','CARD','sandbox')->>'result') = 'amount_mismatch', 'moneda distinta de COP rechazada');
  perform t.ok((public.billing_apply_transaction(ref,'tx-1','APPROVED',4390000,'COP','CARD','production')->>'result') = 'environment_mismatch', 'evento de otro ambiente rechazado');
  select * into s from public.subscriptions where restaurant_id = ra;
  perform t.ok(s.plan_id = 'trial' and s.status = 'trialing', 'tras intentos fraudulentos el plan NO cambió');
  perform t.ok((select count(*) from public.billing_audit_log where action in ('amount_mismatch','environment_mismatch')) = 3, 'los intentos quedaron auditados');
  -- 4) aprobado correcto
  r := public.billing_apply_transaction(ref,'tx-1','APPROVED',4390000,'COP','NEQUI','sandbox');
  perform t.ok(r->>'result' = 'applied', 'pago aprobado y verificado activa el plan');
  select * into s from public.subscriptions where restaurant_id = ra;
  perform t.ok(s.plan_id = 'kartta' and s.status = 'active' and s.billing_cycle = 'monthly', 'subscriptions: plan Standard, activo, mensual');
  perform t.ok(s.current_period_end > now() + interval '27 days' and s.current_period_end < now() + interval '32 days', 'periodo contratado ≈ 1 mes');
  perform t.ok(s.owner_id = a, 'propietario asociado a la suscripción');
  -- 5) duplicados (Wompi reenvía el mismo evento)
  for i in 1..5 loop r := public.billing_apply_transaction(ref,'tx-1','APPROVED',4390000,'COP','NEQUI','sandbox'); end loop;
  perform t.ok(r->>'result' = 'duplicate', 'reenvíos son duplicados');
  perform t.ok((select current_period_end from public.subscriptions where restaurant_id = ra) = s.current_period_end, '5 reenvíos NO extienden el periodo');
  perform t.ok((select count(*) from public.payments where status = 'APPROVED' and restaurant_id = ra) = 1, 'un solo ingreso registrado');
  perform t.ok((select count(*) from public.billing_notifications where notification_type in ('payment_approved','subscription_welcome') and restaurant_id = ra) = 2, 'notificaciones sin duplicar (aprobado + bienvenida)');
  -- 6) otra transacción distinta sobre una referencia ya aplicada
  perform t.ok((public.billing_apply_transaction(ref,'tx-OTRA','APPROVED',4390000,'COP','CARD','sandbox')->>'result') = 'ignored_other_transaction', 'segunda transacción sobre la misma referencia ignorada');
end $$;

-- ---- 7) pendiente → rechazado / aprobado; renovación; mejora; bajada ----
do $$ declare a constant uuid := 'a0000000-0000-0000-0000-00000000000a'; ra constant uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; r jsonb; ref text; s0 record; s1 record;
begin
  select * into s0 from public.subscriptions where restaurant_id = ra;
  ref := public.billing_prepare_checkout(a, ra, 'kartta', 'monthly', 'sandbox')->>'reference';
  perform t.ok((public.billing_apply_transaction(ref,'tx-2','PENDING',4390000,'COP','PSE','sandbox')->>'result') = 'pending', 'pago pendiente (PSE) no concede nada');
  perform t.ok((select current_period_end from public.subscriptions where restaurant_id = ra) = s0.current_period_end, 'pendiente no extiende el periodo');
  perform t.ok((public.billing_apply_transaction(ref,'tx-2','DECLINED',4390000,'COP','PSE','sandbox')->>'result') = 'declined', 'rechazado queda registrado');
  perform t.ok((select count(*) from public.billing_notifications where notification_type = 'payment_declined') = 1, 'aviso de pago rechazado en cola');
  -- renovación anticipada del mismo plan = suma al final del periodo vigente
  ref := public.billing_prepare_checkout(a, ra, 'kartta', 'monthly', 'sandbox')->>'reference';
  perform public.billing_apply_transaction(ref,'tx-3','PENDING',4390000,'COP','PSE','sandbox');
  r := public.billing_apply_transaction(ref,'tx-3','APPROVED',4390000,'COP','PSE','sandbox');
  select * into s1 from public.subscriptions where restaurant_id = ra;
  perform t.ok(r->>'result' = 'applied' and s1.current_period_end > s0.current_period_end + interval '27 days', 'renovación anticipada suma un mes al final del periodo vigente');
  perform t.ok((select is_renewal from public.payments where reference = ref), 'pago marcado como renovación');
  perform t.ok((select count(*) from public.billing_notifications where notification_type = 'renewal_success') = 1, 'aviso de renovación exitosa');
  -- mejora a Pro: empieza ahora
  ref := public.billing_prepare_checkout(a, ra, 'pro', 'monthly', 'sandbox')->>'reference';
  r := public.billing_apply_transaction(ref,'tx-4','APPROVED',8490000,'COP','CARD','sandbox');
  select * into s1 from public.subscriptions where restaurant_id = ra;
  perform t.ok(s1.plan_id = 'pro' and s1.current_period_start <= now() and s1.current_period_end < now() + interval '32 days', 'mejora a Pro: plan Pro, nuevo periodo desde ahora');
  perform t.ok((select count(*) from public.billing_notifications where notification_type = 'plan_updated') = 1, 'aviso de plan actualizado');
  perform t.raises($q$select public.billing_prepare_checkout('a0000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','kartta','monthly','sandbox')$q$, 'downgrade_not_allowed_until_period_end', 'no se permite bajar de plan con Pro vigente');
  -- anulación (VOIDED) tras activar
  r := public.billing_apply_transaction(ref,'tx-4','VOIDED',8490000,'COP','CARD','sandbox');
  select * into s1 from public.subscriptions where restaurant_id = ra;
  perform t.ok(r->>'result' = 'voided_revoked' and s1.status = 'canceled' and s1.current_period_end <= now(), 'transacción anulada revoca el plan');
end $$;

-- ---- 8) ambientes separados en el panel admin ----
reset role;
do $$ declare ra constant uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; rb constant uuid := 'bbbbbbbb-0000-0000-0000-000000000002'; ref text; begin
  set local role service_role;
  ref := public.billing_prepare_checkout('b0000000-0000-0000-0000-00000000000b', rb, 'kartta', 'monthly', 'production')->>'reference';
  perform public.billing_apply_transaction(ref,'tx-prod-1','APPROVED',4390000,'COP','CARD','production');
end $$;
set role authenticated; select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-00000000000e', false);
select t.raises($q$select public.admin_billing_overview('production')$q$, 'forbidden', 'no-administrador no ve finanzas');
select t.raises($q$select * from public.admin_billing_transactions('production')$q$, 'forbidden', 'no-administrador no lista transacciones');
select t.raises($q$select public.admin_billing_register_payout(100000, (now() at time zone 'America/Bogota')::date, 'production', 'x', null)$q$, 'forbidden', 'no-administrador no registra desembolsos');
select set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-00000000000d', false);
do $$ declare o jsonb; begin
  o := public.admin_billing_overview('production');
  perform t.ok((o->>'revenue_all_cop')::numeric = 43900 and (o->>'approved_count')::int = 1, 'producción: solo cuenta el pago real (43.900), no los de Sandbox');
  perform t.ok((public.admin_billing_overview('sandbox')->>'approved_count')::int = 2 and (public.admin_billing_overview('sandbox')->>'voided_count')::int = 1, 'sandbox: 2 aprobados + 1 anulado, aparte de producción');
  perform t.ok((o->>'revenue_today_cop')::numeric = 43900 and (o->>'fees_known_cop')::numeric = 0, 'tarifas desconocidas = 0 (no se inventan) y se informa cuántas faltan');
  perform t.ok((o->>'approved_without_fee_count')::int = 1, 'se informa que hay pagos sin tarifa registrada');
  perform t.ok((select count(*) from public.admin_billing_transactions('production')) = 1, 'tabla de transacciones filtrada por ambiente');
  perform t.ok((select owner_email from public.admin_billing_transactions('production') limit 1) = 'owner-b@test.co', 'la tabla muestra correo del cliente');
  perform t.ok((select count(*) from public.admin_billing_customers('resto')) = 2, 'búsqueda de restaurantes');
  perform t.ok(public.admin_billing_customer_detail('bbbbbbbb-0000-0000-0000-000000000002') ? 'payments', 'detalle de cliente');
  perform public.admin_billing_register_payout(40000, (now() at time zone 'America/Bogota')::date, 'production', 'DESEMB-1', 'prueba');
  perform t.ok((public.admin_billing_overview('production')->>'payouts_registered_cop')::numeric = 40000, 'desembolso registrado se muestra aparte de los ingresos');
  perform t.raises($q$select public.admin_billing_register_payout(100, (now() at time zone 'America/Bogota')::date + 5, 'production', null, null)$q$, 'invalid_payout', 'desembolso con fecha futura rechazado');
  perform public.admin_billing_set_fee(t.pay_id('tx-prod-1'), 1500);
  perform t.ok((public.admin_billing_overview('production')->>'fees_known_cop')::numeric = 1500, 'tarifa registrada por el admin');
  perform t.raises($q$select public.admin_billing_set_fee(t.pay_id('tx-prod-1'), 999999)$q$, 'invalid_fee', 'tarifa mayor que el pago rechazada');
  perform t.raises($q$select public.admin_billing_update_settings(30, true)$q$, 'annual_price_missing', 'no se puede activar anual sin precio anual');
  perform t.ok(t.cnt($q$select count(*) from public.billing_audit_log where actor_type = 'admin'$q$) = 2, 'modificaciones del admin auditadas (desembolso y tarifa)');
end $$;
