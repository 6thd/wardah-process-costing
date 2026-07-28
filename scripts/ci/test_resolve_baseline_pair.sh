#!/usr/bin/env bash
# اختبارات مُحلِّل زوج الـBaseline.
#
# الحالة التي أوجدت هذا الملف: لقطة `001` يتيمة أحدث من اللقطة المقترنة. حين كان
# Fresh DB يأخذ أحدث `001_*` مستقلًا عن الـ`000_*`، كان يطبّق اليتيمة بينما تصدّق
# الحوكمة المقترنة — قاعدتان مختلفتان وبوابتان خضراوان. الاختبار الأول أدناه هو
# هذه الحالة بالضبط.

set -Eeuo pipefail

RESOLVER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/fresh-db/resolve_baseline_pair.sh"
PASS=0
FAIL=0

setup_dir() {
  local dir; dir=$(mktemp -d)
  echo "$dir"
}

make_baseline() {  # dir stamp cutoff
  printf -- '-- migration_cutoff: %s\nCREATE TABLE t ();\n' "$3" \
    > "$1/000_schema_baseline_$2.sql"
}

make_reference() { # dir stamp cutoff
  printf -- '-- migration_cutoff: %s\n-- table: modules rows=10 sha=%s\nBEGIN;\nCOMMIT;\n' \
    "$3" "$(printf '0%.0s' {1..32})" > "$1/001_system_reference_data_$2.sql"
}

check() { # label expected_exit actual_exit extra_assertion_result
  local label="$1" expected="$2" actual="$3" extra="${4:-ok}"
  if [ "$expected" = "$actual" ] && [ "$extra" = "ok" ]; then
    printf '  ✅ %s\n' "$label"; PASS=$((PASS + 1))
  else
    printf '  ❌ %s (متوقع خروج %s، جاء %s؛ التأكيد: %s)\n' \
      "$label" "$expected" "$actual" "$extra"
    FAIL=$((FAIL + 1))
  fi
}

echo "── مُحلِّل زوج الـBaseline ──"

# 1. الحالة الحاسمة: لقطة يتيمة أحدث موجودة بجانب المقترنة.
DIR=$(setup_dir)
make_baseline  "$DIR" 20260727_125744 148
make_reference "$DIR" 20260727_125744 148
make_reference "$DIR" 20260728_999999 148   # يتيمة، بلا 000 مقابل، والأحدث ترتيبًا
set +e; OUT=$(bash "$RESOLVER" "$DIR" 2>/dev/null); RC=$?; set -e
EXTRA=ok
echo "$OUT" | grep -q 'REFERENCE_NAME=001_system_reference_data_20260727_125744.sql' \
  || EXTRA="اختار غير المقترنة: $(echo "$OUT" | grep REFERENCE_NAME=)"
check "يختار اللقطة المقترنة لا الأحدث" 0 "$RC" "$EXTRA"
rm -rf "$DIR"

# 2. كذلك حين يحمل المجلد أكثر من baseline — وهو الوضع الطبيعي هنا.
DIR=$(setup_dir)
make_baseline  "$DIR" 20260717 121
make_reference "$DIR" 20260717 121
make_baseline  "$DIR" 20260727_125744 148
make_reference "$DIR" 20260727_125744 148
set +e; OUT=$(bash "$RESOLVER" "$DIR" 2>/dev/null); RC=$?; set -e
EXTRA=ok
echo "$OUT" | grep -q 'BASELINE_STAMP=20260727_125744' || EXTRA="طابع خاطئ"
echo "$OUT" | grep -q 'REFERENCE_NAME=001_system_reference_data_20260727_125744.sql' \
  || EXTRA="لقطة غير مقترنة بأحدث baseline"
check "يقترن بأحدث baseline عند تعدد الأزواج" 0 "$RC" "$EXTRA"
rm -rf "$DIR"

# 3. baseline بلا لقطة مقترنة → خرق عقد.
DIR=$(setup_dir)
make_baseline "$DIR" 20260727_125744 148
set +e; bash "$RESOLVER" "$DIR" >/dev/null 2>&1; RC=$?; set -e
check "يفشل عند غياب اللقطة المقترنة" 1 "$RC"
rm -rf "$DIR"

# 4. لقطة يتيمة وحدها لا تُقبل بديلًا عن المقترنة.
DIR=$(setup_dir)
make_baseline  "$DIR" 20260727_125744 148
make_reference "$DIR" 20260728_999999 148
set +e; bash "$RESOLVER" "$DIR" >/dev/null 2>&1; RC=$?; set -e
check "لا يقبل لقطة يتيمة بديلًا" 1 "$RC"
rm -rf "$DIR"

# 5. طابع متطابق لكن cutoff متضارب — يُكتشف بتحرير يدوي لأحد الملفين.
DIR=$(setup_dir)
make_baseline  "$DIR" 20260727_125744 148
make_reference "$DIR" 20260727_125744 147
set +e; bash "$RESOLVER" "$DIR" >/dev/null 2>&1; RC=$?; set -e
check "يفشل عند تضارب cutoff داخل الزوج" 1 "$RC"
rm -rf "$DIR"

# 6. لا baseline أصلًا: حالة مشروعة قبل أول توليد، لها رمز خروج مميّز.
DIR=$(setup_dir)
set +e; bash "$RESOLVER" "$DIR" >/dev/null 2>&1; RC=$?; set -e
check "يميّز غياب الـbaseline عن خرق العقد" 3 "$RC"
rm -rf "$DIR"

# 7. اسم ملف يحمل استبدال أوامر يُرفض عند المصدر.
#    أي PR يستطيع إضافة `000_schema_baseline_$(...).sql`. وقبل هذا الحارس كان
#    `eval` على خرج المُحلِّل ينفّذ ما بداخله على العدّاء — أُثبت عمليًا.
DIR=$(setup_dir)
printf -- '-- migration_cutoff: 148\n' > "$DIR/000_schema_baseline_\$(touch PWNED).sql"
printf -- '-- migration_cutoff: 148\n' > "$DIR/001_system_reference_data_\$(touch PWNED).sql"
set +e; bash "$RESOLVER" "$DIR" >/dev/null 2>&1; RC=$?; set -e
check "يرفض طابعًا يحمل استبدال أوامر" 1 "$RC"
rm -rf "$DIR"

# 8. ولو أعاد مستهلكٌ تقييم الخرج، لا يبقى ما يُنفَّذ: الرفض يسبق الطباعة.
# الحمولة بلا شرطة مائلة لأنها فاصل مسارات لا يصلح داخل اسم ملف؛ ولذلك يُنفَّذ
# التقييم داخل المجلد نفسه ليظهر الأثر فيه إن وقع.
DIR=$(setup_dir)
printf -- '-- migration_cutoff: 148\n' > "$DIR/000_schema_baseline_\$(touch PWNED).sql"
printf -- '-- migration_cutoff: 148\n' > "$DIR/001_system_reference_data_\$(touch PWNED).sql"
set +e; OUT=$(bash "$RESOLVER" "$DIR" 2>/dev/null); set -e
( cd "$DIR" && eval "$OUT" >/dev/null 2>&1 || true )
EXTRA=ok
if [ -f "$DIR/PWNED" ]; then
  EXTRA="نُفِّذ أمر من اسم ملف"
fi
check "لا يطبع شيئًا قابلًا للتنفيذ عند اسم مصنوع" ok "$EXTRA" "$EXTRA"
rm -rf "$DIR"

# 9. الطوابع القانونية المستعملة فعلًا تبقى مقبولة بصيغتيها.
DIR=$(setup_dir)
make_baseline  "$DIR" 20260717 121   # 8 أرقام
make_reference "$DIR" 20260717 121
set +e; bash "$RESOLVER" "$DIR" >/dev/null 2>&1; RC=$?; set -e
check "يقبل طابع YYYYMMDD" 0 "$RC"
rm -rf "$DIR"

# 10. المستودع الحقيقي يجب أن يُحَل زوجه.
set +e; OUT=$(bash "$RESOLVER" sql/baseline 2>&1); RC=$?; set -e
EXTRA=ok
[ $RC -eq 0 ] || EXTRA="$OUT"
check "زوج المستودع الحالي مُحَل وسليم" 0 "$RC" "$EXTRA"

echo "── ${PASS} ناجح، ${FAIL} فاشل ──"
[ "$FAIL" -eq 0 ]
