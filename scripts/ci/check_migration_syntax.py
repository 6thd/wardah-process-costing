# -*- coding: utf-8 -*-
"""فحص صياغة كل ملفات sql/migrations بمحلل PostgreSQL الحقيقي (libpg_query).

يمسك أخطاء من نوع:
  - RAISE NOTICE عارية خارج DO/function (وجدت فعلياً في 103/110/111 قبل الإصلاح)
  - صياغة SQL Server المتسللة (SET QUOTED_IDENTIFIER / GO — وجدت في 71)
  - أي SQL لا يقبله محلل PostgreSQL

لا يتحقق من صحة التنفيذ (جداول/أعمدة موجودة) — ذلك يتطلب قاعدة فعلية.
"""
import glob
import sys

import pglast

errors = []
files = sorted(glob.glob('sql/migrations/*.sql'))
for path in files:
    with open(path, encoding='utf-8') as fh:
        sql = fh.read()
    try:
        pglast.parse_sql(sql)
    except pglast.parser.ParseError as exc:
        errors.append((path, str(exc)))

print(f'فُحص {len(files)} ملفاً')
if errors:
    print(f'❌ {len(errors)} ملفاً به خطأ صياغة:')
    for path, msg in errors:
        print(f'  {path}: {msg}')
    sys.exit(1)
print('✅ كل ملفات migrations صالحة الصياغة لمحلل PostgreSQL')
