#!/bin/bash
# اختبار بناء قاعدة فارغة: يطبق السلسلة القانونية بالترتيب على قاعدة جديدة
# الاستخدام: PGDATABASE=wardah_fresh ./run_chain.sh <migrations_dir> <order_file>
set -u
DIR="${1:-sql/migrations}"
ORDER="${2:-apply_order.txt}"
PASS=0; FAIL=0
REPORT="${REPORT:-chain_report.txt}"
> "$REPORT"
while IFS= read -r f; do
  ERR=$(psql -v ON_ERROR_STOP=1 -q -f "$DIR/$f" 2>&1 >/dev/null | grep -m1 -E 'ERROR|FATAL')
  if [ -z "$ERR" ]; then
    PASS=$((PASS+1)); echo "PASS $f" >> "$REPORT"
  else
    FAIL=$((FAIL+1)); echo "FAIL $f :: $ERR" >> "$REPORT"
  fi
done < "$ORDER"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
