-- Parte 2: aislamiento multiempresa (RLS), gestión propia, mantenimiento programado, notificaciones, eventos y auditoría.
reset role;
-- estado limpio de suscripciones para esta parte
update public.subscriptions set plan_id='kartta', status='active', current_period_start=now()-interval '20 days', current_period_end=now()+interval '2 days', cancel_at_period_end=false, canceled_at=null where restaurant_id='aaaaaaaa-0000-0000-0000-000000000001';

-- ===== RLS: aislamiento =====
set role authenticated; select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-00000000000b', false);
do $$ begin
  perform t.ok((select count(*) from public.payments) = 1 and (select bool_and(restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000002') from public.payments), 'dueño B solo ve los pagos de SU restaurante');
  perform t.raises($q$select public.billing_my_overview('aaaaaaaa-0000-0000-0000-000000000001')$q$, 'forbidden', 'B no puede consultar la facturación de A');
  perform t.raises($q$select public.billing_cancel_subscription('aaaaaaaa-0000-0000-0000-000000000001')$q$, 'forbidden', 'B no puede cancelar la renovación de A');
  perform t.raises($q$select public.billing_save_profile('aaaaaaaa-0000-0000-0000-000000000001','X Y','NIT','900123456','x@y.co',null,null,null)$q$, 'forbidden', 'B no puede cambiar datos de facturación de A');
  perform t.raises($q$update public.payments set status='APPROVED'$q$, 'permission denied', 'el navegador no puede marcar un pago como aprobado');
  perform t.raises($q$insert into public.payments (restaurant_id, reference, amount_in_cents, status, environment, plan_id, billing_cycle) values ('bbbbbbbb-0000-0000-0000-000000000002','KT-HACK',1,'APPROVED','production','pro','monthly')$q$, 'permission denied', 'el navegador no puede insertar pagos');
  perform t.raises($q$select * from public.payment_events$q$, 'permission denied', 'payment_events invisible para el navegador');
  perform t.raises($q$select * from public.billing_audit_log$q$, 'permission denied', 'auditoría invisible para el navegador');
  perform t.raises($q$select public.billing_apply_transaction('KT-X','tx','APPROVED',1,'COP','CARD','production')$q$, 'permission denied', 'el navegador no puede ejecutar billing_apply_transaction');
  perform t.raises($q$select public.billing_prepare_checkout('b0000000-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002','pro','monthly','production')$q$, 'permission denied', 'el navegador no puede crear cobros directamente');
  perform t.raises($q$select public.billing_run_maintenance()$q$, 'permission denied', 'el navegador no puede ejecutar el mantenimiento');
  perform t.raises($q$select * from public.billing_settings$q$, 'permission denied', 'configuración interna no legible desde el navegador');
end $$;

-- ===== gestión propia =====
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-00000000000a', false);
do $$ declare o jsonb; begin
  o := public.billing_my_overview('aaaaaaaa-0000-0000-0000-000000000001');
  perform t.ok(o->'subscription'->>'plan_id' = 'kartta' and o->'subscription'->>'effective_status' = 'active', 'mi facturación: plan y estado');
  perform t.ok(jsonb_array_length(o->'plans') = 2 and (o->'plans'->0->>'monthly_price_cop')::int = 43900, 'mi facturación: precios del servidor (Standard/Pro)');
  perform t.ok((o->>'annual_sales_enabled')::boolean = false and o->'plans'->0->'annual_price_cop' = 'null'::jsonb, 'anual oculto hasta confirmarlo');
  perform t.ok(jsonb_array_length(o->'payments') >= 1 and (o->'payments'->0 ? 'wompi_transaction_id'), 'mi historial de pagos con referencias');
  perform public.billing_save_profile('aaaaaaaa-0000-0000-0000-000000000001','Resto A SAS','NIT','900123456-7','Fact@Resto-A.co','+57 300 111 2233','Medellín','Calle 1 # 2-3');
  perform t.ok((select billing_email from public.billing_profiles where restaurant_id='aaaaaaaa-0000-0000-0000-000000000001') = 'fact@resto-a.co', 'datos de facturación guardados (correo normalizado)');
  perform t.raises($q$select public.billing_save_profile('aaaaaaaa-0000-0000-0000-000000000001','X','NIT','1','mal',null,null,null)$q$, 'violates check', 'datos de facturación inválidos rechazados');
  perform public.billing_cancel_subscription('aaaaaaaa-0000-0000-0000-000000000001');
  perform t.ok((public.billing_my_overview('aaaaaaaa-0000-0000-0000-000000000001')->'subscription'->>'cancel_at_period_end')::boolean, 'cancelar renovación: queda activo hasta fin de periodo');
  perform t.ok((public.billing_my_overview('aaaaaaaa-0000-0000-0000-000000000001')->'subscription'->>'effective_status') = 'active', 'tras cancelar sigue activo (beneficios hasta vencer)');
  perform public.billing_resume_subscription('aaaaaaaa-0000-0000-0000-000000000001');
  perform t.ok(not (public.billing_my_overview('aaaaaaaa-0000-0000-0000-000000000001')->'subscription'->>'cancel_at_period_end')::boolean, 'reanudar renovación');
  perform public.billing_cancel_subscription('aaaaaaaa-0000-0000-0000-000000000001');
end $$;
select set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-00000000000c', false);
select t.raises($q$select public.billing_my_overview('aaaaaaaa-0000-0000-0000-000000000001')$q$, 'forbidden', 'staff no accede a la facturación');

-- ===== mantenimiento programado =====
reset role; set role service_role;
do $$ declare m jsonb; m2 jsonb; n1 bigint; n2 bigint; ra constant uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; rb constant uuid := 'bbbbbbbb-0000-0000-0000-000000000002'; begin
  update public.subscriptions set current_period_end = now() + interval '2 days' where restaurant_id = ra;   -- cancelada, vence en 2 días
  update public.subscriptions set plan_id='trial', status='trialing', trial_end = now() + interval '2 days', current_period_end = now() + interval '2 days' where restaurant_id = rb;
  m := public.billing_run_maintenance();
  select count(*) into n1 from public.billing_notifications;
  m2 := public.billing_run_maintenance();
  select count(*) into n2 from public.billing_notifications;
  perform t.ok(n1 = n2, 'el cron dos veces NO duplica notificaciones (dedupe)');
  perform t.ok(exists (select 1 from public.billing_notifications where notification_type = 'trial_ending' and restaurant_id = rb), 'aviso de fin de prueba programado');
  perform t.ok(exists (select 1 from public.billing_notifications where notification_type = 'subscription_expiring' and restaurant_id = ra), 'plan cancelado: aviso «próximo a vencer»');
  -- vencimientos
  update public.subscriptions set current_period_end = now() - interval '1 hour' where restaurant_id = ra;   -- cancelado y vencido -> canceled
  update public.subscriptions set trial_end = now() - interval '1 hour', current_period_end = now() - interval '1 hour' where restaurant_id = rb; -- prueba vencida -> expired
  perform public.billing_run_maintenance();
  perform t.ok((select status from public.subscriptions where restaurant_id = ra) = 'canceled', 'plan cancelado vencido pasa a canceled');
  perform t.ok((select status from public.subscriptions where restaurant_id = rb) = 'expired', 'prueba vencida pasa a expired');
  -- renovación manual no pagada -> past_due -> expired
  update public.subscriptions set plan_id='pro', status='active', cancel_at_period_end=false, current_period_end = now() - interval '1 hour' where restaurant_id = ra;
  perform public.billing_run_maintenance();
  perform t.ok((select status from public.subscriptions where restaurant_id = ra) = 'past_due', 'periodo vencido sin pago pasa a past_due');
  update public.subscriptions set current_period_end = now() - interval '8 days' where restaurant_id = ra;
  perform public.billing_run_maintenance();
  perform t.ok((select status from public.subscriptions where restaurant_id = ra) = 'expired', 'past_due prolongado pasa a expired');
  -- pagos abandonados
  insert into public.payments (restaurant_id, reference, amount_in_cents, status, environment, plan_id, billing_cycle, expires_at) values (ra,'KT-ABAND',100,'CREATED','sandbox','pro','monthly', now() - interval '3 days');
  perform public.billing_run_maintenance();
  perform t.ok((select status from public.payments where reference='KT-ABAND') = 'EXPIRED', 'cobro abandonado pasa a EXPIRED (no cuenta como ingreso)');
end $$;

-- ===== notificaciones: reclamo exclusivo =====
do $$ declare c1 int; c2 int; r record; begin
  select count(*) into c1 from public.billing_claim_notifications(100);
  select count(*) into c2 from public.billing_claim_notifications(100);
  perform t.ok(c1 > 0 and c2 = 0, 'una segunda ejecución concurrente no reclama lo ya reservado ('||c1||' / '||c2||')');
  select * into r from public.billing_notifications where delivery_status = 'sending' limit 1;
  perform public.billing_mark_notification(r.id, 'sent', null, 'msg-1');
  perform t.ok((select delivery_status from public.billing_notifications where id = r.id) = 'sent' and (select sent_at from public.billing_notifications where id = r.id) is not null, 'estado de envío registrado');
  select * into r from public.billing_notifications where delivery_status = 'sending' limit 1;
  perform public.billing_mark_notification(r.id, 'pending', 'email_not_configured', null);
  perform t.ok((select attempts from public.billing_notifications where id = r.id) = 0 or (select attempts from public.billing_notifications where id = r.id) = r.attempts - 1, 'proveedor sin configurar: queda pendiente sin gastar intentos');
end $$;

-- ===== eventos y auditoría =====
do $$ declare e jsonb; e2 jsonb; begin
  e := public.billing_record_event('chk-1','transaction.updated','tx-9','KT-1','sandbox','{"a":1}');
  e2 := public.billing_record_event('chk-1','transaction.updated','tx-9','KT-1','sandbox','{"a":1}');
  perform t.ok((e->>'id') = (e2->>'id') and (e2->>'attempts')::int = 2, 'mismo evento reenviado = una sola fila de evento (attempts=2)');
  perform public.billing_finish_event((e->>'id')::uuid, 'verified', 'applied');
  perform t.ok((public.billing_record_event('chk-1','transaction.updated','tx-9','KT-1','sandbox','{}')->>'processed')::boolean, 'el evento queda marcado como procesado');
  perform public.billing_log_rejected_event('bad_checksum','sandbox','tx-x');
  perform t.ok((select count(*) from public.payment_events where verification_status = 'invalid_signature') = 1, 'evento con firma inválida registrado para auditoría');
  perform t.raises($q$update public.billing_audit_log set action = 'x'$q$, 'solo anexar', 'auditoría inmutable (update)');
  perform t.raises($q$delete from public.billing_audit_log$q$, 'solo anexar', 'auditoría inmutable (delete)');
end $$;

-- ===== puente del panel (service_role + JWT verificado) =====
reset role; set role service_role;
do $$ begin
  perform t.raises($q$select public.admin_billing_overview('production')$q$, 'forbidden', 'service_role SIN claim verificado tampoco entra');
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform t.ok((public.admin_billing_overview('production')->>'approved_count')::int >= 1, 'puente del panel: service_role con claim lee finanzas');
  perform public.admin_billing_register_payout(1000, (now() at time zone 'America/Bogota')::date, 'production', 'P-2', null, 'erick@panel');
  perform t.ok(t.cnt($q$select count(*) from public.billing_audit_log where detail->>'actor' = 'erick@panel'$q$) = 1, 'auditoría guarda quién actuó desde el panel');
  perform t.ok((select amount_cop from public.payments where wompi_transaction_id = 'tx-prod-1') = 43900, 'espejo amount_cop solo en producción');
  perform t.ok((select bool_and(amount_cop is null) from public.payments where environment = 'sandbox'), 'sandbox NO llena amount_cop (no contamina el panel antiguo)');
end $$;
