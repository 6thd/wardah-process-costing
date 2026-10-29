#!/bin/bash
# اختبار بناء قاعدة فارغة: يطبق السلسلة القانونية بالترتيب على قاعدة جديدة
# الاستخدام: PGDATABASE=wardah_fresh ./run_chain.sh <migrations_dir> <order_file>
#
# التقرير: كل ملف يحصل على سطر واحد بالضبط:
#   PASS <file>               — نجح
#   FAIL <file> :: <error>    — فشل
#   NOT_RUN <file>            — لم يُشغَّل (توقف مبكر أو انقطاع)
# السطر الأخير: PASS=N FAIL=N NOT_RUN=N TOTAL=N
# كود الخروج: 0 فقط إذا FAIL=0 و NOT_RUN=0
set -u

DIR="${1:-sql/migrations}"
ORDER="${2:-apply_order.txt}"
REPORT="${REPORT:-chain_report.txt}"

if [ ! -f "$ORDER" ]; then
    echo "ERROR: ملف الترتيب غير موجود: $ORDER" >&2
    exit 2
fi

# ملء مسبق: كل ملف يبدأ كـ NOT_RUN — يضمن وجوده في التقرير حتى عند الانقطاع
sed 's/^/NOT_RUN /' "$ORDER" > "$REPORT"

TOTAL=$(wc -l < "$ORDER")
PASS=0; FAIL=0

while IFS= read -r f; do
    if [ ! -f "$DIR/$f" ]; then
        # الملف نفسه غائب — سجّل خطأ ولا تترك السطر NOT_RUN
        sed -i "s|^NOT_RUN ${f}$|FAIL ${f} :: FILE_NOT_FOUND|" "$REPORT"
        FAIL=$((FAIL+1))
        continue
    fi

    # B2 files require a runner-owned transaction; older files retain theirs.
    TXN=()
    case "$f" in 19[5-9]_*.sql|20[0-5]_*.sql) TXN=(--single-transaction);; esac
    RC=0
    OUTPUT=$(psql -X -v ON_ERROR_STOP=1 "${TXN[@]}" -q -f "$DIR/$f" 2>&1) || RC=$?
    ERR=$(printf '%s\n' "$OUTPUT" | grep -m1 -E 'ERROR|FATAL|PANIC' | tr -d '|' | cut -c1-200)
    if [ "$RC" -ne 0 ] && [ -z "$ERR" ]; then
        ERR="PSQL_EXIT_${RC}"
    fi

    if [ -z "$ERR" ]; then
        PASS=$((PASS+1))
        sed -i "s|^NOT_RUN ${f}$|PASS ${f}|" "$REPORT"
    else
        FAIL=$((FAIL+1))
        sed -i "s|^NOT_RUN ${f}$|FAIL ${f} :: ${ERR}|" "$REPORT"
    fi
done < "$ORDER"

NOT_RUN=$(grep -c '^NOT_RUN ' "$REPORT" || true)
REPORTED=$(( PASS + FAIL + NOT_RUN ))

echo "PASS=$PASS FAIL=$FAIL NOT_RUN=$NOT_RUN TOTAL=$TOTAL"

# تحقق ختامي: عدد سطور التقرير == عدد ملفات الترتيب
if [ "$REPORTED" -ne "$TOTAL" ]; then
    echo "ERROR: عدد سطور التقرير ($REPORTED) ≠ ملفات الترتيب ($TOTAL)" >&2
    exit 2
fi

[ "$FAIL" -eq 0 ] && [ "$NOT_RUN" -eq 0 ]
