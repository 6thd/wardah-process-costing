-- =====================================
-- فحص 2: التحقق من ربط الصلاحيات بالأدوار
-- =====================================

-- 2.1: عدد الصلاحيات لكل دور
SELECT 
    r.name as "اسم الدور (EN)",
    r.name_ar as "اسم الدور (AR)",
    r.org_id as "المنظمة",
    COUNT(rp.permission_id) as "عدد الصلاحيات"
FROM roles r
LEFT JOIN role_permissions rp ON r.id = rp.role_id
GROUP BY r.id, r.name, r.name_ar, r.org_id
ORDER BY r.org_id ASC, r.name ASC;

-- 2.2: تفاصيل الصلاحيات لكل دور
SELECT 
    r.name_ar as "الدور",
    m.name_ar as "الموديول",
    p.resource_ar as "المورد",
    p.action_ar as "الإجراء"
FROM role_permissions rp
JOIN roles r ON rp.role_id = r.id
JOIN permissions p ON rp.permission_id = p.id
JOIN modules m ON p.module_id = m.id
ORDER BY r.name_ar ASC, m.display_order ASC, p.resource ASC
LIMIT 100;

