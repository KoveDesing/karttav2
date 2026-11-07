do $$
declare r jsonb; n int;
begin
  insert into auth.users (id,email) values ('f0000000-0000-0000-0000-0000000000f9','own@t.co') on conflict do nothing;
  insert into public.restaurants (id,name,slug) values ('cccccccc-0000-0000-0000-000000000009','Resto C','resto-r');
  insert into public.restaurant_members values ('cccccccc-0000-0000-0000-000000000009','f0000000-0000-0000-0000-0000000000f9','owner');
  insert into public.subscriptions (restaurant_id, plan_id, status, current_period_end) values ('cccccccc-0000-0000-0000-000000000009','trial','trialing', now() + interval '2 days');
  perform set_config('request.jwt.claims','{"role":"service_role"}', true);
  r := public.admin_billing_send_reminder('cccccccc-0000-0000-0000-000000000009','trial_ending','admin@kartta');
  perform t.ok(r->>'queued' = 'trial_ending', 'recordatorio manual encolado');
  select count(*) into n from public.billing_notifications where restaurant_id='cccccccc-0000-0000-0000-000000000009' and context->>'manual'='true';
  perform t.ok(n = 1, 'una notificación manual en cola');
  perform t.raises($q$select public.admin_billing_send_reminder('cccccccc-0000-0000-0000-000000000009','trial_ending','x')$q$, 'reminder_rate_limited', 'límite anti-spam 10 min');
  perform t.raises($q$select public.admin_billing_send_reminder('cccccccc-0000-0000-0000-000000000009','otro','x')$q$, 'invalid_kind', 'tipo inválido');
  perform t.ok((public.admin_billing_customer_detail('cccccccc-0000-0000-0000-000000000009')->'contact') is not null, 'detalle incluye contacto');
  perform set_config('request.jwt.claims','{}', true);
  perform t.raises($q$select public.admin_billing_send_reminder('cccccccc-0000-0000-0000-000000000009','expired','x')$q$, 'forbidden', 'sin claim de admin se niega');
end $$;
