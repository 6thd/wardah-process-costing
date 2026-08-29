#!/usr/bin/env bash
# يحلّ زوج الـBaseline: المخطط ولقطته المرجعية المقترنة به بالطابع الزمني نفسه.
#
# لماذا مُحلِّل مشترك بدل سطر في كل مستهلك
# ----------------------------------------
# الطبقتان وحدة واحدة بالعقد، فيجب أن يطبّقه كل مستهلك بالطريقة نفسها. حين كان
# الاختيار مكتوبًا مرتين، اختار Fresh DB أحدث `001_*` مستقلًا عن الـ`000_*` الذي
# اختاره، بينما تختار الحوكمة اللقطة المقترنة بالطابع. فملف `001` يتيم أحدث —
# تجربة غير مكتملة أو توليد مجهض — كان يجعل CI تختبر قاعدة غير الزوج الذي صدّقته
# الحوكمة، وتمر الاثنتان خضراوين. والمجلد يحمل أكثر من `000_*` بالفعل، فتعدد
# الملفات هو الوضع الطبيعي لا حالة نادرة.
#
# الاستعمال:
#   eval "$(scripts/ci/fresh-db/resolve_baseline_pair.sh [baseline_dir] [before_cutoff])"
#
# before_cutoff اختياري، ويختار أحدث زوج ذي cutoff أصغر منه. يُستخدم لإعادة
# إثبات الحالة الحمراء السابقة لـmigration حتى بعد أن يطويها Baseline أحدث.
#
# يطبع أسطر KEY=VALUE على stdout والتشخيص على stderr.
#
# رموز الخروج:
#   0  الزوج مُحلّ وسليم
#   1  خرق العقد: لقطة مقترنة مفقودة أو cutoff متضارب
#   3  لا baseline أصلًا (حالة مشروعة قبل أول توليد — للمستهلك أن يتخطى)

set -Eeuo pipefail

DIR=${1:-sql/baseline}
BEFORE_CUTOFF=${2:-}

read_cutoff() {
  grep -oE '^-- migration_cutoff: [0-9]+' "$1" | grep -oE '[0-9]+$' | head -1
}

if [ -n "$BEFORE_CUTOFF" ] && ! printf '%s' "$BEFORE_CUTOFF" | grep -qE '^[0-9]+$'; then
  echo "❌ before_cutoff غير قانوني: '$BEFORE_CUTOFF' — المطلوب أرقام فقط" >&2
  exit 1
fi

if [ -z "$BEFORE_CUTOFF" ]; then
  BASELINE_PATH=$(find "$DIR" -maxdepth 1 -type f \
    -name '000_schema_baseline_*.sql' | sort | tail -1)
else
  BASELINE_PATH=''
  while IFS= read -r CANDIDATE; do
    CANDIDATE_CUTOFF=$(read_cutoff "$CANDIDATE" || true)
    if printf '%s' "$CANDIDATE_CUTOFF" | grep -qE '^[0-9]+$' \
       && [ "$CANDIDATE_CUTOFF" -lt "$BEFORE_CUTOFF" ]; then
      BASELINE_PATH=$CANDIDATE
    fi
  done < <(find "$DIR" -maxdepth 1 -type f \
    -name '000_schema_baseline_*.sql' | sort)
fi

if [ -z "$BASELINE_PATH" ]; then
  if [ -n "$BEFORE_CUTOFF" ]; then
    echo "لا schema baseline في $DIR قبل cutoff $BEFORE_CUTOFF" >&2
  else
    echo "لا schema baseline في $DIR" >&2
  fi
  exit 3
fi

BASELINE_NAME=$(basename "$BASELINE_PATH")
STAMP=${BASELINE_NAME#000_schema_baseline_}
STAMP=${STAMP%.sql}

# الطابع أرقام وشرطة سفلية فقط. القيد ليس تجميليًا: مخرجات هذا السكربت أسماء
# ملفات، ولو حمل اسمٌ استبدالَ أوامر — `000_schema_baseline_$(...).sql` يضيفه أي
# PR — لصار تنفيذَ أوامر عند أي مستهلك يعيد تقييم النص. الرفض هنا يقطع الصنف
# كله عند مصدره، ولا يُغني عن امتناع المستهلكين عن eval.
if ! printf '%s' "$STAMP" | grep -qE '^[0-9]{8}(_[0-9]{6})?$'; then
  {
    echo "❌ طابع زمني غير قانوني في $BASELINE_NAME"
    echo "   وُجد: '$STAMP'"
    echo "   المطلوب: YYYYMMDD أو YYYYMMDD_HHMMSS"
  } >&2
  exit 1
fi

REFERENCE_NAME="001_system_reference_data_${STAMP}.sql"
REFERENCE_PATH="${DIR}/${REFERENCE_NAME}"

if [ ! -f "$REFERENCE_PATH" ]; then
  {
    echo "❌ لا لقطة بيانات مرجعية مقترنة بـ$BASELINE_NAME"
    echo "   المتوقع: $REFERENCE_PATH"
    echo "   الطبقتان تُولَّدان معًا في .github/workflows/generate-baseline.yml"
    find "$DIR" -maxdepth 1 -type f -name '001_system_reference_data_*.sql' \
      -printf '   موجود بلا اقتران: %f\n' | sort
  } >&2
  exit 1
fi

BASELINE_CUTOFF=$(read_cutoff "$BASELINE_PATH")
REFERENCE_CUTOFF=$(read_cutoff "$REFERENCE_PATH")

if [ -z "$BASELINE_CUTOFF" ]; then
  echo "❌ لا migration_cutoff في $BASELINE_NAME" >&2
  exit 1
fi

# الطابع المتطابق لا يكفي وحده: ملفان بالطابع نفسه قد يحملان cutoff مختلفًا إن
# حُرِّر أحدهما يدويًا. المطابقة هنا تجعل بوابة Fresh DB مستقلة دفاعيًا عن نجاح
# workflow الحوكمة بدل أن ترث تصديقه.
if [ "$REFERENCE_CUTOFF" != "$BASELINE_CUTOFF" ]; then
  {
    echo "❌ cutoff متضارب داخل الزوج المقترن بالطابع $STAMP"
    echo "   $BASELINE_NAME  → ${BASELINE_CUTOFF}"
    echo "   $REFERENCE_NAME → ${REFERENCE_CUTOFF:-(غائب)}"
  } >&2
  exit 1
fi

printf 'BASELINE_PATH=%s\n'   "$BASELINE_PATH"
printf 'BASELINE_NAME=%s\n'   "$BASELINE_NAME"
printf 'REFERENCE_PATH=%s\n'  "$REFERENCE_PATH"
printf 'REFERENCE_NAME=%s\n'  "$REFERENCE_NAME"
printf 'BASELINE_STAMP=%s\n'  "$STAMP"
printf 'BASELINE_CUTOFF=%s\n' "$BASELINE_CUTOFF"
