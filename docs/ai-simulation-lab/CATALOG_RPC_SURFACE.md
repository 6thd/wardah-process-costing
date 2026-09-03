# كتالوج سطح الـRPC — ما يجوز للمحاكاة استدعاؤه

**مشتقّ من:** `sql/baseline/000_schema_baseline_20260830_083021.sql` (cutoff 185)
**تاريخ الاشتقاق:** 2026-09-02
**الإجمالي:** 70 دالة `rpc_*` — **64 ممنوحة لـ`authenticated`** · **6 داخلية**
**وسطح العميل الكامل أوسع:** 181 دالة ممنوحة لـ`authenticated`، منها 117 خارج
تسمية `rpc_` و24 منها على الأقل قادرة على الكتابة — انظر §17 قبل تصميم أي سيناريو.

> ⚠️ هذا الملف **مشتقّ**، لا مكتوب يدويًا. لا يُحدَّث بالذاكرة. عند أي baseline
> جديد أعد اشتقاقه بالأمر في §1 وقارن الفرق.

---

## 1. إعادة الاشتقاق

```bash
B=sql/baseline/000_schema_baseline_<stamp>.sql

# كل الدوال
grep -oE "^CREATE FUNCTION public\.rpc_[a-z0-9_]+\([^)]*\)" "$B" \
  | sed 's/CREATE FUNCTION public\.//' | sort -u

# الممنوحة لـauthenticated
grep -oE "GRANT ALL ON FUNCTION public\.(rpc_[a-z0-9_]+)\([^)]*\) TO authenticated" "$B" \
  | grep -oE "rpc_[a-z0-9_]+" | sort -u
```

المصدر القانوني النهائي هو **قاعدة البيانات الحية**، لا اللقطة. قبل كل تشغيلة
يُنفَّذ الفحص التالي على بيئة المحاكاة ويُقارن بالكتالوج؛ أي فرق يوقف التشغيلة:

```sql
SELECT p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS client_reachable
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname LIKE 'rpc\_%'
ORDER BY 1;
```

---

## 2. دلالة الأعمدة

| العمود | المعنى |
|---|---|
| **منح** | ✅ = ممنوحة لـ`authenticated`، أي داخل سطح المحاكاة · ❌ = داخلية، **ممنوع استدعاؤها** (ADR-SIM-002 §2.3) |
| **دور المحاكاة** | `write` كتابة تجارية · `read` قراءة/تحقق · `setup` بذرة ما قبل التشغيل · `admin` إدارة أثناء التشغيل · `probe` مِسبار ثابت |
| **ممثل** | الشخصية التي تستدعيها في طاقم مصنع البلاستيك ([`CATALOG_SCENARIOS.md`](./CATALOG_SCENARIOS.md)) |

---

## 3. المشتريات والاستلام والفواتير (Procurement / AP)

| RPC | توقيع | منح | دور | ممثل |
|---|---|:--:|---|---|
| `rpc_list_uom_purchase_order_options` | `(p_org_id uuid)` | ✅ | read | Buyer |
| `rpc_create_uom_purchase_order` | `(p_payload jsonb)` | ✅ | write | Buyer |
| `rpc_submit_purchase_order` | `(p_org_id, p_purchase_order_id)` | ✅ | write | Buyer |
| `rpc_approve_purchase_order` | `(p_org_id, p_purchase_order_id)` | ✅ | write | Purchasing Manager |
| `rpc_list_uom_receivable_purchase_orders` | `(p_org_id uuid)` | ✅ | read | Storekeeper |
| `rpc_post_goods_receipt` | `(p_payload jsonb)` | ✅ | write | Storekeeper |
| `rpc_list_supplier_invoice_candidates` | `(p_org_id, p_vendor_id?, p_purchase_order_id?)` | ✅ | read | AP Accountant |
| `rpc_create_matched_supplier_invoice` | `(p_payload jsonb)` | ✅ | write | AP Accountant |
| `rpc_create_matched_supplier_invoice_v149` | `(p_payload jsonb)` | ❌ | — | — |

**ملاحظات تشغيلية:**
- سلسلة أمر الشراء ثلاثية الحالة (`create → submit → approve`) وتحتاج ممثلين
  مختلفين ليكون اختبار الفصل الوظيفي حقيقيًا.
- `rpc_post_goods_receipt` هو موضع Migration 177 (تصادم مولّد أرقام الاستلام تحت
  الاستلام الجزئي) — فهو مرشّح أول لسيناريو سباق مصمَّم.
- `rpc_list_supplier_invoice_candidates` (Migration 181) يتطلب عضوية نشطة
  **وصلاحيتَي D4 معًا** — استخدمه لاختبار رفض متوقّع بممثل ناقص الصلاحية.

## 4. مدفوعات الموردين (AP Vouchers)

| RPC | توقيع | منح | دور | ممثل |
|---|---|:--:|---|---|
| `rpc_create_supplier_payment` | `(p_payload jsonb)` | ✅ | write | AP Accountant |
| `rpc_update_supplier_payment_draft` | `(p_payment_id, p_payload)` | ✅ | write | AP Accountant |
| `rpc_post_supplier_payment` | `(p_payment_id uuid)` | ✅ | write | CFO / Controller |
| `rpc_reset_supplier_payment_to_draft` | `(p_payment_id, p_reason)` | ✅ | write | Controller |
| `rpc_cancel_supplier_payment` | `(p_payment_id, p_reason)` | ✅ | write | Controller |

## 5. مقبوضات العملاء (AR Vouchers)

| RPC | توقيع | منح | دور | ممثل |
|---|---|:--:|---|---|
| `rpc_create_customer_receipt` | `(p_payload jsonb)` | ✅ | write | AR Accountant |
| `rpc_update_customer_receipt_draft` | `(p_receipt_id, p_payload)` | ✅ | write | AR Accountant |
| `rpc_post_customer_receipt` | `(p_receipt_id uuid)` | ✅ | write | CFO / Controller |
| `rpc_reset_customer_receipt_to_draft` | `(p_receipt_id, p_reason)` | ✅ | write | Controller |
| `rpc_cancel_customer_receipt` | `(p_receipt_id, p_reason)` | ✅ | write | Controller |

**ملاحظة:** دورة السندات (166–169) أُغلق سطح الكتابة المباشر عليها بحارس مزدوج.
أي محاولة كتابة مباشرة على رؤوس السندات أو أسطر التخصيص يجب أن تُرفض — وهذا نفسه
ثابت أمني (`INV-SEC-03`).

## 6. المبيعات والتسليم

| RPC | توقيع | منح | دور | ممثل |
|---|---|:--:|---|---|
| `rpc_post_delivery_note` | `(p_payload jsonb)` | ✅ | write | Storekeeper / Sales |

**فجوة ملحوظة:** لا توجد RPC ممنوحة لإنشاء أمر بيع أو فاتورة مبيعات. دورة
المبيعات في المحاكاة تبدأ عمليًا من التسليم. سؤال مفتوح مسجَّل في
[`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md) (`OQ-03`).

## 7. المخزون

| RPC | توقيع | منح | دور | ممثل |
|---|---|:--:|---|---|
| `rpc_create_stock_adjustment` | `(p_payload jsonb)` | ✅ | write | Warehouse Manager |
| `rpc_submit_stock_adjustment` | `(p_adjustment_id uuid)` | ✅ | write | Warehouse Manager |
| `rpc_cancel_stock_adjustment` | `(p_adjustment_id, p_reason)` | ✅ | write | Warehouse Manager |
| `rpc_manual_stock_movement_v2` | `(p_payload jsonb)` | ✅ | write | Storekeeper |
| `rpc_manual_stock_movement` | `(p_product_id, p_quantity, p_movement_type, …)` | ✅ | ⚠️ legacy | — |

**قاعدة:** تستخدم المحاكاة `_v2` حيث وُجدت. النسخة القديمة تبقى في الكتالوج لأنها
ما زالت ممنوحة، وتُستهدف بثابت يثبت أنها لا تنتج مسارًا مخالفًا — لا لأنها المسار
المفضّل.

## 8. التصنيع والتكلفة

| RPC | توقيع | منح | دور | ممثل |
|---|---|:--:|---|---|
| `rpc_create_mo_with_reservation` | `(p_order jsonb, p_materials jsonb, p_tenant?)` | ✅ | write؛ أعادت Migration 186 المطبقة توجيهها إلى bins والحجوزات القانونية | Production Planner |
| `rpc_transition_mo_status` | `(p_mo_id, p_status, p_notes?, p_tenant?)` | ✅ | write | Production Supervisor |
| `rpc_consume_reserved_materials_v2` | `(p_mo_id, p_stage_id, p_consumptions jsonb)` | ✅ | write | Operator |
| `rpc_consume_reserved_materials` | `(p_mo_id, p_consumptions jsonb)` | ✅ | ⚠️ legacy | — |
| `rpc_complete_manufacturing_order` | `(p_payload jsonb)` | ✅ | write | Production Supervisor |
| `rpc_cost_of_production_report` | `(p_mo_id, p_stage_no?, p_tenant?)` | ✅ | read/probe | Cost Accountant |
| `rpc_post_manual_work_center_oh` | `(p_work_center, p_amount, p_memo, …)` | ✅ | write | Cost Accountant |
| `rpc_post_work_center_oh` | `(p_work_center, p_amount, p_memo, …)` | ❌ | — | — |

**حقائق من الكود تُبنى عليها السيناريوهات والثوابت:**

1. حالات أمر التصنيع ثمانٍ بقيد `manufacturing_orders_status_check`:
   `draft, pending, confirmed, in_progress, on_hold, quality_check, done, cancelled`.
2. `rpc_complete_manufacturing_order` تحسب التكلفة من `material_consumption`
   **فقط**، وترفض الإتمام بتكلفة صفرية (`ZERO_COST_COMPLETION`) إلا بعلم
   `allow_zero_cost` **ولمسؤول المؤسسة حصرًا** — سيناريو رفض متوقّع ممتاز.
3. تُحدِّث متوسط تكلفة المنتج التام بالصيغة
   `(qty × cost + wip_cost) / (qty + done_qty)` مع `FOR UPDATE` على صف المنتج —
   نقطة التقاء مثالية لسباق مصمَّم بين أمرَي تصنيع لنفس المنتج.
4. ترحّل داخليًا `MATERIAL_ISSUE` ثم `FG_RECEIPT` بالمبلغ نفسه عبر
   `rpc_post_event_journal` (الداخلية) بمفتاح idempotency لكل منهما.
5. تعريف `rpc_create_mo_with_reservation` التاريخي في cutoff 185 كان يقرأ
   العلاقة الغائبة عند مواد غير فارغة. Migration 186 المطبقة استبدلته بـbins
   والحجوزات النشطة مع قفل؛ الكتالوج يبقي أصل الاكتشاف ظاهرًا ويفصل عنه overlay
   Production الحالي. تشغيل سيناريو اليوم ينتظر بيئة المختبر لا إصلاح العقد.

## 9. الدفتر العام (GL)

| RPC | توقيع | منح | دور | ممثل |
|---|---|:--:|---|---|
| `rpc_create_manual_journal_entry` | `(p_payload jsonb)` | ✅ | write | Accountant |
| `rpc_update_manual_journal_entry` | `(p_entry_id, p_payload)` | ✅ | write | Accountant |
| `rpc_post_manual_journal_entry` | `(p_entry_id uuid)` | ✅ | write | Controller |
| `rpc_batch_post_manual_journal_entries` | `(p_entry_ids uuid[])` | ✅ | write | Controller |
| `rpc_reverse_manual_journal_entry` | `(p_entry_id, p_reason?, p_date?)` | ✅ | write | Controller |
| `rpc_delete_manual_journal_entry` | `(p_entry_id uuid)` | ✅ | write | Accountant |
| `rpc_post_manual_event_journal` | `(p_event, p_amount, p_memo, …)` | ✅ | write | Accountant |
| `rpc_create_journal_entry` | `(p_payload jsonb)` | ❌ | — | — |
| `rpc_post_event_journal` | `(p_event, p_amount, …)` | ❌ | — | — |
| `rpc_upsert_event_mapping` | `(p_event_code, p_debit_account_code, …)` | ❌ | — | — |

**تنبيه:** `rpc_create_journal_entry` سُحبت عن `authenticated` في Migration 179.
مسار القيد اليدوي القانوني هو `create_manual → post_manual → reverse_manual`
(Migration 178). أي سيناريو يستدعي `rpc_create_journal_entry` مكتوب على عقد ميت.

**فجوة إعداد:** `rpc_upsert_event_mapping` داخلية، فخرائط GL للأحداث
(`MATERIAL_ISSUE`، `FG_RECEIPT`، …) لا يمكن إعدادها عبر سطح العميل. تُهيَّأ في
البذرة L2 كبيانات org-scoped قبل التشغيل — وهذا اتساق مع كون خرائط GL «خطوة
مستقلة» في `CLAUDE.md`. مسجَّل كـ`OQ-02`.

## 10. الفترات المالية

| RPC | توقيع | منح | دور | ممثل |
|---|---|:--:|---|---|
| `rpc_generate_fiscal_periods` | `(p_year int, p_tenant?)` | ✅ | setup | — |
| `rpc_list_periods` | `(p_fiscal_year?, p_tenant?)` | ✅ | read | Controller |
| `rpc_set_period_status` | `(p_period_code, p_status, p_tenant?)` | ✅ | admin | CFO |

الـtrigger `gl_entries_period_guard` يفرض حالة الفترة على القيود. إغلاق فترة
أثناء ترحيل متزامن = سيناريو سباق مرتفع القيمة.

## 11. التقارير والتسوية (مسابير جاهزة)

| RPC | توقيع | منح | دور |
|---|---|:--:|---|
| `rpc_get_trial_balance` | `(p_tenant, p_as_of_date)` | ✅ | probe — `INV-GL-05` |
| `rpc_subledger_gl_reconciliation` | `(p_as_of_date, p_tenant?, p_inventory_prefixes[], p_wip_prefixes[])` | ✅ | probe — `INV-INV-05` |
| `rpc_cost_of_production_report` | `(p_mo_id, p_stage_no?, p_tenant?)` | ✅ | probe — تكلفة الأمر |

## 12. التسويات والرواتب

| RPC | توقيع | منح | دور | ممثل |
|---|---|:--:|---|---|
| `rpc_submit_settlement_review` | `(p_payload jsonb)` | ✅ | write | Accountant |
| `rpc_post_settlement` | `(p_payload jsonb)` | ✅ | write | Controller |
| `rpc_post_payroll_run` | `(p_payload jsonb)` | ✅ | write | HR / Payroll |

## 13. وحدات القياس (UoM)

| RPC | توقيع | منح | دور |
|---|---|:--:|---|
| `rpc_create_org_uom` | `(p_org_id, p_category_id, p_code, …, p_aliases[])` | ✅ | setup |
| `rpc_assign_product_base_uom` | `(p_org_id, p_product_id, p_uom_id)` | ✅ | setup |
| `rpc_set_product_uom_conversion` | `(p_org_id, p_product_id, p_uom_id, p_factor_to_base, …)` | ✅ | setup |
| `rpc_convert_product_uom` | `(p_product_id, p_quantity, p_uom_id, p_at?)` | ✅ | read |
| `rpc_get_product_weight` | `(p_product_id, p_quantity, p_uom_id, p_at?)` | ✅ | read |
| `rpc_set_product_physical_weight` | `(p_product_id, p_net, p_gross, p_weight_uom_id)` | ✅ | setup |
| `rpc_get_purchase_product_uoms` | `(p_org_id, p_product_id)` | ✅ | read |
| `rpc_get_org_uom_engine_enabled` | `(p_org_id)` | ✅ | read |
| `rpc_resolve_uom_backfill_issue` | `(p_org_id, p_issue_id, p_resolved_uom_id?, p_note?)` | ✅ | admin |
| `rpc_ignore_uom_backfill_issue` | `(p_org_id, p_issue_id, p_note?)` | ✅ | admin |

**تنبيه بذرة حرج:** حراس UoM المحجوزة (`SYSTEM_UOM_CODE_RESERVED`،
`SYSTEM_UOM_ALIAS_RESERVED`) يقرآن الصفوف النظامية. قاعدة بلا
`001_system_reference_data_*` تجعلهما **fail-open** — فتمر المحاكاة على حراس
معطّلين دون أن تلاحظ. التحقق من الـ263 صفًا شرط قبول في Phase 0.

**علم مؤسسي:** `uom_engine_enabled` في `org_settings` يحكم مسار UoM. قيمته لمؤسسة
المحاكاة قرار صريح يُوثَّق في تعريف السيناريو، ويُقرأ عبر
`rpc_get_org_uom_engine_enabled` ويُسجَّل ضمن أدلة التشغيلة.

## 14. الأدوار والعضوية (RBAC)

| RPC | توقيع | منح | دور |
|---|---|:--:|---|
| `rpc_upsert_org_role` | `(p_payload jsonb)` | ✅ | setup |
| `rpc_delete_org_role` | `(p_payload jsonb)` | ✅ | admin |
| `rpc_replace_user_roles` | `(p_payload jsonb)` | ✅ | setup |
| `rpc_set_org_admin` | `(p_target_user_id, p_org_id, p_value)` | ✅ | admin |
| `rpc_remove_org_member` | `(p_payload jsonb)` | ✅ | admin |
| `rpc_permission_snapshot` | `(p_org_id uuid)` | ✅ | **probe إلزامي** |
| `rpc_accept_invitation` | `(p_token text)` | ✅ | setup |
| `rpc_get_invitation_preview` | `(p_token text)` | ✅ | read |

`rpc_permission_snapshot` هو **المصدر الوحيد** المعتمد لحالة صلاحيات ممثل
(ADR-SIM-002 §3.2). عدّ `role_permissions` ليس قياسًا للصلاحية.

## 15. غير مصنّف

| RPC | منح | ملاحظة |
|---|:--:|---|
| `rpc_check_and_record_ai_usage` | ❌ | عدّاد حصص داخلي |

---

## 16. الملخص العددي

| الفئة | العدد |
|---|---|
| إجمالي `rpc_*` | 70 |
| داخل سطح المحاكاة (`authenticated`) | 64 |
| داخلية — ممنوع استدعاؤها | 6 |
| مسابير جاهزة تُعاد استخدامها | 3 |
| عقود مهجورة (`legacy`) ضمن الممنوحة | 2 |

**الست الداخلية:** `rpc_check_and_record_ai_usage` · `rpc_create_journal_entry` ·
`rpc_create_matched_supplier_invoice_v149` · `rpc_post_event_journal` ·
`rpc_post_work_center_oh` · `rpc_upsert_event_mapping`

يجب أن يرفض المحرك استدعاءها **برمجيًا** (قائمة رفض في الكود)، لا بالاتفاق.

---

## 17. ⚠️ سطح العميل أوسع من الـRPCs — 117 دالة غير مسمّاة `rpc_`

**اكتشاف من اشتقاق المنح، يغيّر تقدير سطح الخطر:**

| القياس | العدد |
|---|---|
| إجمالي دوال `public` الممنوحة لـ`authenticated` | **181** |
| منها `rpc_*` (العقود القانونية) | 64 |
| منها **غير** `rpc_*` (سطح تاريخي) | **117** |
| من الـ117: قادرة على الكتابة (INSERT/UPDATE/DELETE في جسمها) | **≥ 24** |

الفرق في سطح `authenticated` عن cutoff 181 هو سحب
`check_balance_before_post()` في Migration 184؛ Migration 185 لم تغيّر أعداد
`authenticated` (`181 = 64 + 117`) ولا مجموعة الـ70 `rpc_*`. أثر 185 يقع على
منح جدولي المخزون وعلى سحب `anon/PUBLIC` من `consume_materials_for_mo` و
`update_warehouse_gl_mapping`، مع بقاء المنح الصريحة لـ`authenticated` و
`service_role`. قائمة الحد الأدنى الكاتبة أدناه لذلك لم تتغير.

### الأربع والعشرون القادرة على الكتابة

```
assign_routing_to_mo        backflush_materials        build_bom_tree
cleanup_bom_tree_cache      complete_operation         consume_materials_for_mo
copy_routing                create_bom_version         create_crud_permissions
create_default_org_roles    create_mo_with_reservation create_role_from_template
generate_work_orders_from_mo release_expired_reservations release_manufacturing_order
schedule_work_order         start_operation            update_adjustment_totals
update_bom_where_used       update_org_users_count     update_warehouse_gl_mapping
update_work_center_load     upsert_attendance_day      validate_entry_balance
```

### لماذا هذا مهم للمختبر

1. **توائم مباشرة للعقود القانونية.** `create_mo_with_reservation` موجودة
   كدالة ممنوحة **إلى جانب** `rpc_create_mo_with_reservation`. عميل يستدعي
   التوأم التاريخي قد يسلك مسارًا لا يمر بحراس النسخة القانونية. هذا **ليس
   افتراضًا** — إنه سطح ممنوح فعليًا يجب إثبات سلوكه.
2. **عمليات لا عقد `rpc_` لها.** `start_operation` و`complete_operation` تكتبان
   `labor_time_tracking`، و`consume_materials_for_mo` و`backflush_materials`
   تستهلكان المواد. أي أن تسجيل ساعات العمل واستهلاك المواد **قابلان للوصول من
   العميل**، لكن خارج مجموعة العقود القانونية.
3. **حدّ ADR-SIM-002 يبقى كما هو ويزداد أهمية:** المحاكاة **تكتب عبر `rpc_*`
   فقط**. الـ24 ليست مسارًا مسموحًا، بل **هدف اختبار**: يُثبَت أنها لا تلتف على
   حارس، ويُرصد أي نمو في عددها.

### إعادة الاشتقاق

```bash
B=sql/baseline/000_schema_baseline_<stamp>.sql
grep -oE "GRANT ALL ON FUNCTION public\.[a-z0-9_]+\([^)]*\) TO authenticated" "$B" \
  | sed -E 's/GRANT ALL ON FUNCTION public\.//; s/\(.*//' | sort -u
```

**قيد على التصنيف:** «قادرة على الكتابة» مشتقّة بمطابقة نصية على
`INSERT INTO` / `UPDATE … SET` / `DELETE FROM` داخل جسم الدالة. دالة تكتب
**بالتفويض** إلى دالة أخرى قد تُصنَّف قراءة خطأً. العدد **حدّ أدنى (≥ 24)**
ويحتاج تأكيدًا يدويًا لكل دالة قبل بناء ثابت نهائي عليه.

انظر `INV-SEC-05` في [`CATALOG_INVARIANTS.md`](./CATALOG_INVARIANTS.md)
و`OQ-08` في [`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md).
