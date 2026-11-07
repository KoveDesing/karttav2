-- KARTTA Payments — recordatorios MANUALES desde el panel de administración. Aditivo e idempotente.
-- (1) admin_billing_customer_detail ahora incluye el contacto del restaurante (para abrir WhatsApp con el mensaje listo).
-- (2) admin_billing_send_reminder encola un aviso por correo (se envía cuando billing-cron + proveedor de correo estén activos),
--     con límite anti-spam y auditoría con el correo del administrador.
create or replace function public.admin_billing_customer_detail(p_restaurant uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform private.billing_require_admin();
  return jsonb_build_object(
    'restaurant', (select jsonb_build_object('id', r.id, 'name', r.name, 'slug', r.slug, 'suspended', r.is_suspended) from public.restaurants r where r.id = p_restaurant),
    'owner_email', (select u.email from public.restaurant_members m join auth.users u on u.id = m.user_id where m.restaurant_id = p_restaurant and m.role = 'owner' limit 1),
    'contact', (select jsonb_build_object('whatsapp', coalesce(nullif(btrim(rp.contact_phone), ''), nullif(btrim(r.whatsapp), ''), nullif(btrim(r.public_phone), '')),
                  'country_code', r.whatsapp_country_code, 'owner_name', rp.owner_name)
                from public.restaurants r left join public.restaurant_private rp on rp.restaurant_id = r.id where r.id = p_restaurant),
    'subscription', (select to_jsonb(s) - 'payment_source_id' from public.subscriptions s where s.restaurant_id = p_restaurant),
    'billing_profile', (select to_jsonb(b) from public.billing_profiles b where b.restaurant_id = p_restaurant),
    'payments', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select id, reference, wompi_transaction_id, status, amount_in_cents, plan_id, billing_cycle, payment_method, environment, is_renewal, created_at, confirmed_at, period_start, period_end, fee_in_cents
          from public.payments where restaurant_id = p_restaurant and status <> 'CREATED' order by created_at desc limit 100) x), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select notification_type, delivery_status, scheduled_at, sent_at, attempts, last_error, created_at
          from public.billing_notifications where restaurant_id = p_restaurant order by created_at desc limit 50) x), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select created_at, actor_type, action, detail from public.billing_audit_log where restaurant_id = p_restaurant order by id desc limit 50) x), '[]'::jsonb));
end $$;

create or replace function public.admin_billing_send_reminder(p_restaurant uuid, p_kind text, p_actor text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare sub public.subscriptions%rowtype; v_type text; v_ctx jsonb; v_key text;
begin
  perform private.billing_require_admin();
  if p_kind not in ('trial_ending','renewal','expired') then raise exception 'invalid_kind'; end if;
  if not exists (select 1 from public.restaurants where id = p_restaurant) then raise exception 'restaurant_not_found'; end if;
  select * into sub from public.subscriptions where restaurant_id = p_restaurant;
  if sub.id is null then raise exception 'no_subscription'; end if;

  if exists (select 1 from public.billing_audit_log
              where restaurant_id = p_restaurant and action = 'manual_reminder' and created_at > now() - interval '10 minutes') then
    raise exception 'reminder_rate_limited';
  end if;

  v_type := case p_kind when 'trial_ending' then 'trial_ending' when 'expired' then 'subscription_expired'
                         else case when sub.cancel_at_period_end then 'subscription_expiring' else 'renewal_upcoming' end end;
  v_ctx := jsonb_build_object('manual', true, 'plan_id', sub.plan_id, 'billing_cycle', sub.billing_cycle,
             'period_end', sub.current_period_end, 'trial_end', sub.trial_end, 'auto_renew', sub.auto_renew,
             'days', greatest(0, ceil(extract(epoch from (coalesce(sub.trial_end, sub.current_period_end) - now())) / 86400)::int));
  v_key := 'manual:' || p_kind || ':' || p_restaurant || ':' || to_char(now() at time zone 'America/Bogota', 'YYYYMMDDHH24MISS');
  perform private.billing_enqueue(p_restaurant, sub.id, null, v_type, v_key, v_ctx);
  perform private.billing_audit('admin', auth.uid(), 'manual_reminder', p_restaurant, sub.id, null, jsonb_build_object('kind', p_kind, 'type', v_type, 'actor', p_actor));
  return jsonb_build_object('ok', true, 'queued', v_type);
end $$;

revoke all on function public.admin_billing_customer_detail(uuid) from public, anon;
grant execute on function public.admin_billing_customer_detail(uuid) to authenticated, service_role;
revoke all on function public.admin_billing_send_reminder(uuid,text,text) from public, anon, authenticated;
grant execute on function public.admin_billing_send_reminder(uuid,text,text) to service_role;
