#!/usr/bin/env bash
# Concurrencia real: 8 conexiones simultáneas confirmando la MISMA referencia. Debe haber exactamente 1 activación.
cd "$(dirname "$0")/../.."
Q(){ su postgres -c "psql -qtA -d kartta_test -c \"$1\""; }
Q "reset role; insert into public.restaurants (id,name,slug) values ('cccccccc-0000-0000-0000-000000000003','Resto C','resto-c') on conflict do nothing; insert into public.restaurant_members values ('cccccccc-0000-0000-0000-000000000003','e0000000-0000-0000-0000-00000000000e','owner') on conflict do nothing;" >/dev/null
REF=$(Q "select public.billing_prepare_checkout('e0000000-0000-0000-0000-00000000000e','cccccccc-0000-0000-0000-000000000003','pro','monthly','sandbox')->>'reference'")
for i in 1 2 3 4 5 6 7 8; do Q "select public.billing_apply_transaction('$REF','tx-conc','APPROVED',8490000,'COP','CARD','sandbox')->>'result'" > /tmp/conc_$i.txt & done; wait
APPLIED=$(cat /tmp/conc_*.txt | grep -c '^applied$'); DUP=$(cat /tmp/conc_*.txt | grep -c '^duplicate$')
NSUB=$(Q "select count(*) from public.subscriptions where restaurant_id='cccccccc-0000-0000-0000-000000000003'")
NAPR=$(Q "select count(*) from public.payments where reference='$REF' and status='APPROVED'")
NOTIF=$(Q "select count(*) from public.billing_notifications where restaurant_id='cccccccc-0000-0000-0000-000000000003'")
echo "applied=$APPLIED duplicate=$DUP suscripciones=$NSUB pagos_aprobados=$NAPR notificaciones=$NOTIF"
if [ "$APPLIED" = 1 ] && [ "$DUP" = 7 ] && [ "$NSUB" = 1 ] && [ "$NAPR" = 1 ] && [ "$NOTIF" = 2 ]; then echo "ok  - concurrencia: 8 confirmaciones simultáneas => 1 sola activación"; else echo "FALLA concurrencia"; exit 1; fi
rm -f /tmp/conc_*.txt
