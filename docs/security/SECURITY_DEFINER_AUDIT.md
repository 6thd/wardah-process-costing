# سجل تدقيق دوال SECURITY DEFINER

**القاعدة:** Supabase `uutfztmqvajmsxnrqeiv` (Manufacturing Process) — فحص مباشر بتاريخ 2026-07-16
**الإجمالي:** 80 دالة SECURITY DEFINER في مخطط public

| الفئة | العدد | الوصف |
|---|---|---|
| A — مفتوحة لـ anon | 1 | تتطلب مبررًا موثقًا |
| B — authenticated مع تحقق مؤسسة | 28 | جسم الدالة يفرض حدود المؤسسة |
| C — authenticated **بلا تحقق مؤسسة** | 28 | ⚠️ الأولوية P1 — تتجاوز RLS بلا حارس |
| D — داخلية (بلا EXECUTE للعملاء) | 23 | Triggers ودوال مساعدة — آمنة بالعزل |

> **معيار "تحقق مؤسسة":** ظهور `user_organizations` / `wardah_is_org_admin` / `wardah_org_id` /
> `is_org_admin` / `is_super_admin` في جسم الدالة. الفحص نمطي (regex) — الفئة B تحتاج تأكيدًا
> يدويًا أن التحقق فعليًا يقيّد الاستعلام، والفئة C قد تضم دوالًا تقيّد عبر جداول محمية بـRLS
> بشكل غير مباشر، لكن SECURITY DEFINER يتجاوز RLS فيجب اعتبارها مكشوفة حتى يثبت العكس.

## الفئة A — قابلة للاستدعاء من anon

| الدالة | ترجع | مبرر البقاء |
|---|---|---|
| `rpc_get_invitation_preview(p_token text)` | record | معاينة الدعوة قبل التسجيل — التوكن bearer secret؛ ترجع email/org_name/status فقط. مقبولة بشرط بقاء الإخراج محدودًا |

## الفئة C — ⚠️ authenticated بلا تحقق مؤسسة (P1)

هذه الدوال تعمل بصلاحيات المالك وتتجاوز RLS، وأي مستخدم مسجَّل في **أي** مؤسسة يستطيع استدعاءها.

| الدالة | ترجع | auth.uid | org_id في الجسم | خطورة |
|---|---|---|---|---|
| `approve_journal_entry(p_entry_id uuid, p_approval_level integer, p_comments text)` | json | — | — | 🔴 عالية |
| `backflush_materials(p_work_order_id uuid, p_quantity_produced numeric)` | material_consumption | ✅ | ✅ | 🔴 عالية |
| `batch_post_journal_entries(p_entry_ids uuid[])` | json | — | — | 🔴 عالية |
| `complete_operation(p_work_order_id uuid, p_quantity_produced numeric, p_quantity_scrapped numeric, p_notes text)` | work_orders | — | ✅ | 🔴 عالية |
| `create_role_from_template(p_org_id uuid, p_template_id uuid, p_custom_name character varying, p_created_by uuid)` | uuid | ✅ | ✅ | 🔴 عالية |
| `get_account_statement(p_account_code text, p_from_date date, p_to_date date)` | record | — | ✅ | 🔴 عالية |
| `release_manufacturing_order(p_mo_id uuid)` | manufacturing_orders | — | — | 🔴 عالية |
| `reverse_journal_entry_enhanced(p_entry_id uuid, p_reversal_reason text, p_reversal_date date)` | json | — | — | 🔴 عالية |
| `rpc_get_trial_balance(p_tenant uuid, p_as_of_date date)` | record | — | ✅ | 🔴 عالية |
| `start_operation(p_work_order_id uuid, p_operator_id uuid, p_is_setup boolean)` | work_orders | ✅ | ✅ | 🔴 عالية |
| `upsert_stage_cost(p_tenant uuid, p_mo uuid, p_stage integer, p_wc uuid, p_good_qty numeric, p_dm numeric, p_mode text, p_scrap_qty numeric, p_rework_qty numeric, p_input_qty numeric, p_notes text, p_wip_end_qty numeric, p_wip_end_dm_completion_pct numeric, p_wip_end_cc_completion_pct numeric, p_regrind_cost numeric, p_waste_credit numeric, p_wip_beginning_qty numeric, p_wip_beginning_dm_completion_pct numeric, p_wip_beginning_cc_completion_pct numeric, p_wip_beginning_cost numeric)` | record | — | ✅ | 🔴 عالية |
| `calculate_available_capacity(p_work_center_id uuid, p_start_date date, p_end_date date)` | record | — | — | 🟠 متوسطة |
| `calculate_labor_variances(p_mo_id uuid, p_start_date date, p_end_date date)` | record | — | — | 🟠 متوسطة |
| `calculate_material_variances(p_mo_id uuid, p_start_date date, p_end_date date)` | record | — | — | 🟠 متوسطة |
| `calculate_planned_load(p_work_center_id uuid, p_start_date date, p_end_date date)` | record | — | — | 🟠 متوسطة |
| `calculate_routing_standard_cost(p_routing_id uuid, p_quantity numeric)` | record | — | — | 🟠 متوسطة |
| `calculate_routing_total_time(p_routing_id uuid, p_quantity numeric)` | record | — | — | 🟠 متوسطة |
| `get_labor_efficiency_summary(p_org_id uuid, p_start_date date, p_end_date date, p_work_center_id uuid)` | record | — | ✅ | 🟠 متوسطة |
| `get_oee_summary(p_org_id uuid, p_start_date date, p_end_date date, p_work_center_id uuid)` | record | — | ✅ | 🟠 متوسطة |
| `identify_bottlenecks(p_org_id uuid, p_start_date date, p_end_date date)` | record | — | ✅ | 🟠 متوسطة |
| `assign_routing_to_mo(p_mo_id uuid, p_routing_id uuid)` | manufacturing_orders | — | — | 🟡 منخفضة |
| `auto_schedule_work_orders(p_work_center_id uuid, p_start_date timestamp with time zone, p_schedule_id uuid)` | integer | — | — | 🟡 منخفضة |
| `check_entry_approval_required(p_entry_id uuid)` | boolean | — | ✅ | 🟡 منخفضة |
| `copy_routing(p_routing_id uuid, p_new_code character varying, p_new_version integer)` | uuid | ✅ | ✅ | 🟡 منخفضة |
| `generate_entry_number(p_journal_id uuid)` | text | — | ✅ | 🟡 منخفضة |
| `generate_work_orders_from_mo(p_mo_id uuid)` | work_orders | ✅ | ✅ | 🟡 منخفضة |
| `schedule_work_order(p_work_order_id uuid, p_scheduled_start timestamp with time zone, p_schedule_id uuid)` | schedule_details | — | ✅ | 🟡 منخفضة |
| `update_work_center_load(p_work_center_id uuid, p_start_date date, p_end_date date)` | work_center_load | — | ✅ | 🟡 منخفضة |

### أخطر الحالات (تحتاج معالجة فورية)

1. **`rpc_get_trial_balance(p_tenant, p_as_of_date)`** — تأخذ معرف المؤسسة **من العميل** وترجع
   ميزان مراجعة كاملًا بلا التحقق من أن المستدعي عضو في `p_tenant`. قراءة مالية عابرة للمؤسسات.
2. **`get_account_statement(p_account_code, ...)`** — كشف حساب بلا حارس مؤسسة.
3. **`approve_journal_entry` / `batch_post_journal_entries` / `reverse_journal_entry_enhanced`** —
   عمليات ترحيل/عكس قيود بلا بوابة إدارية ولا تحقق عضوية.
4. **`create_role_from_template(p_org_id, ..., p_created_by)`** — تنشئ أدوارًا في مؤسسة يحددها
   العميل وتقبل `p_created_by` من العميل — مسار تصعيد صلاحيات محتمل.
5. **`upsert_stage_cost(p_tenant, ...)`** — كتابة تكاليف مراحل بمعرف مؤسسة من العميل.

### الوصفة المعيارية للتحصين

```sql
-- داخل كل دالة من الفئة C قبل أي قراءة/كتابة:
IF NOT EXISTS (
    SELECT 1 FROM user_organizations
    WHERE user_id = auth.uid() AND org_id = v_org AND is_active = true
) THEN
    RAISE EXCEPTION 'NOT_ORG_MEMBER';
END IF;
-- ولا يُشتق v_org من معامل عميل إلا عبر wardah_org_id() الذي يتحقق من العضوية
```

## الفئة B — authenticated مع تحقق مؤسسة في الجسم

| الدالة | ترجع | auth.uid |
|---|---|---|
| `auth_org_id()` | uuid | ✅ |
| `get_current_tenant_id()` | uuid | ✅ |
| `get_user_org_ids()` | uuid[] | ✅ |
| `get_user_permissions(p_user_id uuid, p_org_id uuid)` | record | — |
| `has_permission(p_user_id uuid, p_org_id uuid, p_permission_key character varying)` | boolean | — |
| `is_org_admin(p_org_id uuid)` | boolean | ✅ |
| `is_super_admin()` | boolean | ✅ |
| `rpc_accept_invitation(p_token text)` | jsonb | ✅ |
| `rpc_complete_manufacturing_order(p_payload jsonb)` | jsonb | ✅ |
| `rpc_cost_of_production_report(p_mo_id uuid, p_stage_no integer, p_tenant uuid)` | jsonb | — |
| `rpc_create_journal_entry(p_payload jsonb)` | jsonb | — |
| `rpc_create_mo_with_reservation(p_order jsonb, p_materials jsonb, p_tenant uuid)` | jsonb | — |
| `rpc_generate_fiscal_periods(p_year integer, p_tenant uuid)` | jsonb | — |
| `rpc_list_periods(p_fiscal_year integer, p_tenant uuid)` | jsonb | — |
| `rpc_post_delivery_note(p_payload jsonb)` | jsonb | ✅ |
| `rpc_post_event_journal(p_event text, p_amount numeric, p_memo text, p_ref_type text, p_ref_id uuid, p_tenant uuid, p_idempotency_key text, p_jv_date date)` | uuid | — |
| `rpc_post_goods_receipt(p_payload jsonb)` | jsonb | ✅ |
| `rpc_post_payroll_run(p_payload jsonb)` | jsonb | ✅ |
| `rpc_post_settlement(p_payload jsonb)` | jsonb | ✅ |
| `rpc_post_work_center_oh(p_work_center text, p_amount numeric, p_memo text, p_ref_type text, p_ref_id uuid, p_tenant uuid, p_idempotency_key text, p_jv_date date)` | uuid | — |
| `rpc_set_org_admin(p_target_user_id uuid, p_org_id uuid, p_value boolean)` | jsonb | ✅ |
| `rpc_set_period_status(p_period_code text, p_status text, p_tenant uuid)` | jsonb | — |
| `rpc_subledger_gl_reconciliation(p_as_of_date date, p_tenant uuid, p_inventory_prefixes text[], p_wip_prefixes text[])` | jsonb | — |
| `rpc_submit_settlement_review(p_payload jsonb)` | jsonb | ✅ |
| `rpc_transition_mo_status(p_mo_id uuid, p_status text, p_notes text, p_tenant uuid)` | jsonb | ✅ |
| `upsert_attendance_day(p_org_id uuid, p_employee_id uuid, p_year smallint, p_month smallint, p_day text, p_payload jsonb)` | hr_attendance_monthly | ✅ |
| `wardah_is_org_admin(p_org uuid)` | boolean | ✅ |
| `wardah_org_id(p_explicit uuid)` | uuid | — |

## الفئة D — داخلية (لا EXECUTE لـ anon/authenticated)

| الدالة | ترجع |
|---|---|
| `assert_period_open(p_org uuid, p_date date)` | void |
| `auto_backflush_materials()` | trigger |
| `auto_generate_work_orders()` | trigger |
| `calculate_bom_total_cost()` | trigger |
| `calculate_risk_score()` | trigger |
| `fn_invitations_set_token_hash()` | trigger |
| `generate_entry_number_enhanced(p_journal_id uuid, p_entry_date date)` | text |
| `generate_voucher_number(p_voucher_type text, p_org_id uuid)` | text |
| `get_account_statement_by_code(p_account_code text, p_from_date date, p_to_date date, p_include_unposted boolean)` | record |
| `get_exchange_rate(p_from_currency text, p_to_currency text, p_rate_date date)` | numeric |
| `get_organization_profile(p_org_id uuid)` | jsonb |
| `get_segment_report(p_segment_type text, p_segment_id uuid, p_from_date date, p_to_date date, p_account_type text)` | record |
| `handle_new_user()` | trigger |
| `is_org_admin_for(check_org_id uuid)` | boolean |
| `log_activity()` | trigger |
| `log_custom_activity(p_org_id uuid, p_action character varying, p_entity_type character varying, p_entity_id text, p_details jsonb)` | uuid |
| `reconcile_account(p_account_id uuid, p_reconciliation_date date, p_statement_items jsonb)` | json |
| `rpc_upsert_event_mapping(p_event_code text, p_debit_account_code text, p_credit_account_code text, p_work_center_code text, p_description text, p_tenant uuid)` | uuid |
| `translate_amount(p_amount numeric, p_from_currency text, p_to_currency text, p_rate_date date)` | numeric |
| `update_mo_status_from_work_orders()` | trigger |
| `update_organization_profile(p_org_id uuid, p_name character varying, p_name_ar character varying, p_name_en character varying, p_tax_number character varying, p_commercial_registration character varying, p_license_number character varying, p_phone character varying, p_mobile character varying, p_email character varying, p_website character varying, p_fax character varying, p_address text, p_city character varying, p_state character varying, p_country character varying, p_postal_code character varying, p_logo_url text, p_primary_color character varying, p_secondary_color character varying, p_currency character varying, p_timezone character varying)` | jsonb |
| `wardah_apply_stock_incoming(p_org uuid, p_product uuid, p_warehouse uuid, p_qty numeric, p_rate numeric, p_voucher_type text, p_voucher_id uuid, p_voucher_number text, p_posting_date date)` | jsonb |
| `wardah_settlement_snapshot(p_settlement_id uuid)` | jsonb |

---

## خطة المعالجة المقترحة (Migration 120)

1. الدوال 🔴: إضافة حارس عضوية صريح + بوابة `wardah_is_org_admin` للعمليات الإدارية،
   أو `REVOKE EXECUTE FROM authenticated` إن لم تكن مستدعاة من الواجهة (راجع `src/` أولًا).
2. الدوال 🟠/🟡 الحسابية البحتة (`calculate_*`, `get_*_summary`): إما تحويلها إلى
   `SECURITY INVOKER` (فتعمل تحت RLS المستدعي) أو إضافة الحارس.
3. أي دالة بلا سبب موثق لـ SECURITY DEFINER → `SECURITY INVOKER`.
4. إضافة اختبار CI يمنع ظهور دالة DEFINER جديدة قابلة للتنفيذ من anon،
   ودالة DEFINER جديدة لـ authenticated بلا سطر تحقق عضوية في جسمها.
