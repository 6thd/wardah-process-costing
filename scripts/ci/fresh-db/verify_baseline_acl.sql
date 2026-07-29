-- فحص دلالي لعقد التنفيذ على قاعدة أُعيد بناؤها من Baseline مولَّد.
--
-- حارس عدد بيانات GRANT/REVOKE في ملف اللقطة يثبت أن نموذج صلاحيات موجود.
-- هذا الملف يثبت ما هو أدق: أن العقد الأمني المطلوب نفسه نجا من التوليد ومن
-- إعادة البناء — authenticated تُنفّذ، وanon لا تُنفّذ.
--
-- والشق الثاني ليس تحصيل حاصل: PostgreSQL يمنح PUBLIC صلاحية EXECUTE افتراضيًا
-- على كل دالة عند إنشائها. فبغياب بيان REVOKE في اللقطة ترث anon التنفيذ ضمنًا
-- دون أي GRANT صريح لها. و has_function_privilege يحسب الوراثة من PUBLIC، لذلك
-- يمسك هذا الفحص الحالتين معًا: المنح المباشر والوراثة الصامتة.
--
-- الدوال غير الموجودة تُتخطى لا تُفشل: لقطة عند cutoff أقدم لا يلزمها وجودها.

DO $acl$
DECLARE
  v_fn      text;
  v_checked int := 0;
  v_skipped int := 0;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.rpc_submit_purchase_order(uuid,uuid)',
    'public.rpc_approve_purchase_order(uuid,uuid)',
    'public.rpc_list_uom_receivable_purchase_orders(uuid)',
    'public.rpc_post_goods_receipt(jsonb)'
  ] LOOP
    IF to_regprocedure(v_fn) IS NULL THEN
      v_skipped := v_skipped + 1;
      RAISE NOTICE 'تخطي % — غير موجودة في هذه اللقطة', v_fn;
      CONTINUE;
    END IF;

    v_checked := v_checked + 1;

    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'BASELINE_ACL_FAIL: authenticated تفتقد EXECUTE على %', v_fn;
    END IF;

    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'BASELINE_ACL_FAIL: anon تملك EXECUTE على %', v_fn;
    END IF;
  END LOOP;

  IF v_checked = 0 THEN
    RAISE EXCEPTION 'BASELINE_ACL_FAIL: لم تُفحص أي دالة — % متخطاة', v_skipped;
  END IF;

  RAISE NOTICE 'عقد التنفيذ سليم على % دالة (% متخطاة)', v_checked, v_skipped;
END
$acl$;
