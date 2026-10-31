-- APLICADA el 30-oct-2026 como «mercadopago_conexion_vault». Probada con un token falso en una transacción revertida.
-- El token de Mercado Pago se guarda en Supabase Vault (cifrado); solo la Edge Function mp-connect (service_role) puede escribirlo/borrarlo.
alter table public.payment_accounts add column if not exists vault_secret_id uuid;
revoke select on public.payment_accounts from authenticated;
grant select (id, restaurant_id, provider, status, external_id, display_name, enabled, last_error, connected_at, created_at, updated_at) on public.payment_accounts to authenticated;
-- funciones: payments_can_manage(uuid) [authenticated], mp_save_token / mp_clear_token / mp_record_error [solo service_role]
-- (definiciones completas en la migración aplicada; ver list_migrations en Supabase)
