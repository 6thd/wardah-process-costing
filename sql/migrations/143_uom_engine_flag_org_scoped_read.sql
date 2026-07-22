-- 143: قراءة علم uom_engine_enabled ضمن سياق مؤسسة صريح
--
-- المشكلة: قراءة العلم عبر org_settings تعتمد سياسة RLS
--   org_id = wardah_org_id(NULL)
-- أي المؤسسة الفعلية للجلسة، لا المؤسسة المختارة في الواجهة (currentOrgId).
-- لمستخدم متعدد العضويات النشطة يفشل الاستنتاج ويبقى العلم مغلقًا، أو يُقرأ
-- علم المؤسسة الافتراضية بدل المختارة.
--
-- الحل: RPC ذرية SECURITY DEFINER تقرأ العلم لمؤسسة صريحة يكون المتصل عضوًا
-- فيها عبر الحارس wardah_assert_org_member. Fail-closed: الافتراضي false.
-- additive فقط: CREATE OR REPLACE، لا حذف ولا تعديل لأي كائن قائم.

CREATE OR REPLACE FUNCTION public.rpc_get_org_uom_engine_enabled(p_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_enabled boolean;
BEGIN
  -- حارس معروف: يرفض من ليس عضوًا نشطًا في المؤسسة المطلوبة.
  PERFORM public.wardah_assert_org_member(p_org_id);

  SELECT COALESCE((value ->> 'enabled')::boolean, false)
    INTO v_enabled
  FROM public.org_settings
  WHERE org_id = p_org_id
    AND key = 'uom_engine_enabled';

  RETURN COALESCE(v_enabled, false);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_get_org_uom_engine_enabled(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_get_org_uom_engine_enabled(uuid) TO authenticated;

COMMENT ON FUNCTION public.rpc_get_org_uom_engine_enabled(uuid) IS
  'Fail-closed read of the uom_engine_enabled rollout flag for an explicit org the caller is an active member of. Uses SECURITY DEFINER + wardah_assert_org_member so multi-org users receive the flag for the UI-selected organization, not the RLS effective org (wardah_org_id(NULL)).';
