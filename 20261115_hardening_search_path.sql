-- NO APLICADA. Requiere autorización. No destructiva y reversible (ALTER FUNCTION ... RESET search_path).
-- Fija search_path en 3 funciones internas (advisor "function_search_path_mutable").
-- Verificado: existen en schema private; ninguna es SECURITY DEFINER.
alter function private.gen_ticket_code(uuid)                 set search_path = public, pg_temp;
alter function private.billing_audit_immutable()             set search_path = pg_catalog, pg_temp;
alter function private.billing_add_period(timestamptz, text) set search_path = pg_catalog, pg_temp;
-- Rollback:
-- alter function private.gen_ticket_code(uuid) reset search_path; (idem las otras dos)
