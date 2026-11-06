#!/usr/bin/env bash
# Uso: tests/sql/run.sh — recrea una BD local, aplica stub + migración (2 veces) y ejecuta las pruebas. Requiere Postgres local.
cd "$(dirname "$0")/../.."
su postgres -c "dropdb --if-exists kartta_test >/dev/null 2>&1; createdb kartta_test"
for f in tests/sql/00_stub_supabase.sql 20261106_kartta_payments.sql 20261106_kartta_payments.sql tests/sql/10_billing_tests.sql tests/sql/20_billing_tests_2.sql; do
  [ -f "$f" ] || continue
  echo "=== $f"
  out=$(su postgres -c "psql -q -v ON_ERROR_STOP=1 -d kartta_test" < "$f" 2>&1); rc=$?
  echo "$out" | sed -e 's/^psql:[^ ]* //' | grep -E "NOTICE:  ok|ERROR|FALLA|CONTEXT|DETAIL|HINT" | sed 's/^NOTICE:  //'
  if [ $rc -ne 0 ]; then echo "!!! FALLÓ ($f) rc=$rc"; exit 1; fi
done
echo "=== TODO OK"
