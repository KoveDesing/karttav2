// Adaptador de PRUEBA: imita el cliente service_role de supabase-js pero ejecuta contra el Postgres local (psql), de modo que las
// Edge Functions reales corren sobre las funciones SQL reales. Solo se usa en tests.
import { execFileSync } from 'node:child_process';
const run = (sql) => execFileSync('su', ['postgres', '-c', 'psql -qtA -v ON_ERROR_STOP=1 -d kartta_test'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
export const sqlAsSuper = (sql) => run(sql).trim();
const lit = (v) => v === null || v === undefined ? 'NULL' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : typeof v === 'object' ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb` : `'${String(v).replace(/'/g, "''")}'`;
const SCALAR = new Set(['billing_prepare_checkout', 'billing_apply_transaction', 'billing_record_event', 'billing_run_maintenance', 'admin_billing_overview', 'admin_billing_customer_detail', 'admin_billing_get_settings', 'admin_billing_set_fee', 'admin_billing_register_payout', 'admin_billing_update_settings']);
const VOID = new Set(['billing_finish_event', 'billing_mark_notification', 'billing_log_rejected_event']);
const PRE = `set role service_role; set request.jwt.claims = '{"role":"service_role"}';\n`;
const err = (e) => ({ data: null, error: { message: String(e.stderr || e.message).replace(/^.*ERROR:\s+/s, '').split('\n')[0] } });

export function makeAdmin() {
  const rpc = async (name, args = {}) => {
    const a = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(', ');
    try {
      if (VOID.has(name)) { run(PRE + `select public.${name}(${a});`); return { data: null, error: null }; }
      if (SCALAR.has(name)) return { data: JSON.parse(run(PRE + `select public.${name}(${a})::text;`).trim() || 'null'), error: null };
      return { data: JSON.parse(run(PRE + `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text from public.${name}(${a}) t;`).trim()), error: null };
    } catch (e) { return err(e); }
  };
  const from = (table) => {
    const q = { cols: '*', where: [], lim: null };
    const exec = async (single) => {
      if (!/^[a-z_*,\s]+$/.test(q.cols) || !/^[a-z_]+$/.test(table)) return { data: null, error: { message: 'bad_query' } };
      const w = q.where.length ? ' where ' + q.where.map(([c, v]) => `${c} = ${lit(v)}`).join(' and ') : '';
      try {
        const rows = JSON.parse(run(PRE + `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text from (select ${q.cols} from public.${table}${w}${q.lim ? ' limit ' + q.lim : ''}) t;`).trim());
        return { data: single ? (rows[0] || null) : rows, error: null };
      } catch (e) { return err(e); }
    };
    const b = { select: (c) => { q.cols = c; return b; }, eq: (c, v) => { q.where.push([c, v]); return b; }, limit: (n) => { q.lim = n; return b; },
      maybeSingle: () => exec(true), then: (res, rej) => exec(false).then(res, rej) };
    return b;
  };
  const auth = { admin: { getUserById: async (id) => { const e = run(`select email from auth.users where id = ${lit(id)};`).trim(); return { data: { user: e ? { id, email: e } : null } }; } } };
  return { rpc, from, auth };
}
