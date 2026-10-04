-- FROZEN REFERENCE (test only, never applied by a migration): the rpc_list_quality_inspections body
-- exactly as it stood in sql/migrations/202_qc_privileged_write_closure.sql at commit
-- 8babdd6f8de45d023dde722b01e24fc4383d6f21 (md5(prosrc) = bb2432f528a97ebb7f4d75a3e5b2f585), installed under another
-- name inside the acceptance transaction so the optimized listing can be compared to it
-- byte-for-byte on identical data. Do not edit: the acceptance asserts the md5 above.
CREATE FUNCTION public.zz_list_ref_8babdd6f(
  p_org_id uuid, p_mo_id uuid DEFAULT NULL, p_limit integer DEFAULT 100
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  IF NOT COALESCE(public.has_permission(auth.uid(), p_org_id,
       'manufacturing.quality_inspections.read'), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'QUALITY_READ_PERMISSION_DENIED';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(page.row_data ORDER BY page.head_seq DESC NULLS LAST, page.head_id DESC, page.rn)
    FROM (
      SELECT w.row_data, w.head_seq, w.head_id, w.rn
      FROM (
        SELECT
          row_number() OVER part AS rn,
          first_value(b.seq) OVER part AS head_seq,
          first_value(b.id) OVER part AS head_id,
          jsonb_build_object(
            'id', b.id, 'inspection_number', b.inspection_number,
            'inspection_type', b.inspection_type, 'result', b.result,
            'mo_id', b.mo_id, 'order_number', b.order_number,
            'work_order_id', b.work_order_id,
            'stage_id', b.stage_id, 'stage_name', b.stage_name, 'stage_name_ar', b.stage_name_ar,
            'qc_cycle', b.qc_cycle, 'sample_size', b.sample_size,
            'passed_quantity', b.passed_quantity, 'failed_quantity', b.failed_quantity,
            'disposition', b.disposition, 'findings', b.findings,
            'corrective_action', b.corrective_action, 'specifications', b.specifications,
            'inspector_id', b.inspector_id,
            'inspector_name', b.inspector_name,
            'inspection_date', b.inspection_date,
            'authority_revision', COALESCE(b.rev, 0),
            'superseded', COALESCE(b.rev, 0) < b.part_rev,
            'partition_revision', b.part_rev,
            'awaiting_replacement', b.awaiting,
            'authority_status', CASE
              WHEN b.awaiting THEN 'SUPERSEDED_AWAITING_REPLACEMENT'
              WHEN COALESCE(b.rev, 0) < b.part_rev THEN 'SUPERSEDED'
              ELSE 'CURRENT' END) AS row_data
        FROM (
          SELECT qi.id, qi.mo_id, qi.inspection_type, qi.qc_cycle, qi.stage_id,
            qi.inspection_seq AS seq, qi.inspection_number, qi.result, qi.work_order_id,
            qi.sample_size, qi.passed_quantity, qi.failed_quantity, qi.disposition,
            qi.findings, qi.corrective_action, qi.specifications, qi.inspector_id,
            qi.inspection_date, mo.order_number, st.name AS stage_name,
            st.name_ar AS stage_name_ar,
            COALESCE(up.full_name_ar, up.full_name) AS inspector_name,
            au.authority_revision AS rev,
            ps.part_rev,
            (ps.part_rev > 0 AND NOT EXISTS (
               SELECT 1 FROM public.quality_inspections q2
               LEFT JOIN wardah_internal.quality_inspection_authority_202 a2
                 ON a2.inspection_id = q2.id
               WHERE q2.org_id = qi.org_id AND q2.mo_id = qi.mo_id
                 AND q2.inspection_type = qi.inspection_type
                 AND ((qi.inspection_type = 'FINAL' AND q2.qc_cycle = qi.qc_cycle)
                   OR (qi.inspection_type = 'IN_PROCESS' AND q2.stage_id = qi.stage_id))
                 AND COALESCE(a2.authority_revision, 0) = ps.part_rev)) AS awaiting
          FROM public.quality_inspections qi
          LEFT JOIN wardah_internal.quality_inspection_authority_202 au ON au.inspection_id = qi.id
          LEFT JOIN public.manufacturing_orders mo ON mo.id = qi.mo_id
          LEFT JOIN public.manufacturing_stages st ON st.id = qi.stage_id
          LEFT JOIN LATERAL (
            SELECT u.full_name, u.full_name_ar FROM public.user_profiles u
            WHERE u.user_id = qi.inspector_id LIMIT 1) up ON true
          CROSS JOIN LATERAL (
            SELECT COALESCE(max(s.revision), 0) AS part_rev
            FROM wardah_internal.quality_supersessions_202 s
            WHERE s.org_id = qi.org_id AND s.mo_id = qi.mo_id
              AND s.inspection_type = qi.inspection_type
              AND ((qi.inspection_type = 'FINAL' AND s.qc_cycle = qi.qc_cycle)
                OR (qi.inspection_type = 'IN_PROCESS' AND s.stage_id = qi.stage_id))) ps
          WHERE qi.org_id = p_org_id
            AND (p_mo_id IS NULL OR qi.mo_id = p_mo_id)
        ) b
        WINDOW part AS (
          PARTITION BY b.mo_id, b.inspection_type,
            CASE WHEN b.inspection_type = 'FINAL' THEN b.qc_cycle END,
            CASE WHEN b.inspection_type = 'IN_PROCESS' THEN b.stage_id END
          ORDER BY COALESCE(b.rev, 0) DESC, b.seq DESC NULLS LAST, b.id DESC)
      ) w
      ORDER BY w.head_seq DESC NULLS LAST, w.head_id DESC, w.rn
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
    ) page), '[]'::jsonb);
END
$fn$;
