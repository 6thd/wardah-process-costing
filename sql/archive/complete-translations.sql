-- تحديث باقي الترجمات الإنجليزية للحسابات المتبقية
UPDATE gl_accounts SET name_en = 
    CASE code
        -- إيرادات إضافية
        WHEN '410100' THEN 'Domestic Sales'
        WHEN '410200' THEN 'Export Sales'
        WHEN '410300' THEN 'Service Revenue'
        WHEN '420100' THEN 'Purchase Discounts Earned'
        WHEN '420200' THEN 'Scrap Sales Revenue'
        WHEN '420300' THEN 'Inventory Count Gains'
        WHEN '420400' THEN 'Compensation Received'
        WHEN '420500' THEN 'Interest and Investment Income'
        
        -- التكاليف والمصروفات
        WHEN '500000' THEN 'Costs and Expenses'
        WHEN '510000' THEN 'Manufacturing Costs'
        WHEN '511000' THEN 'Direct Materials (Analytical)'
        WHEN '512000' THEN 'Direct Labor (Analytical)'
        WHEN '513000' THEN 'Actual Manufacturing Overhead'
        WHEN '513100' THEN 'Production Line Power and Energy'
        WHEN '513200' THEN 'Production Equipment Maintenance'
        WHEN '513300' THEN 'Production Equipment Depreciation'
        WHEN '513400' THEN 'Indirect Materials'
        WHEN '513500' THEN 'Indirect Labor'
        WHEN '513600' THEN 'Production Equipment Insurance'
        WHEN '514000' THEN 'Applied Manufacturing Overhead'
        
        -- مراكز التكلفة
        WHEN '517000' THEN 'Production Cost Centers'
        WHEN '517100' THEN 'Mixing and Preparation Cost Center'
        WHEN '517200' THEN 'Extrusion and Forming Cost Center'
        WHEN '517300' THEN 'Printing and Decoration Cost Center'
        WHEN '517400' THEN 'Cutting and Slicing Cost Center'
        WHEN '517500' THEN 'Packaging and Wrapping Cost Center'
        
        -- تكلفة البضاعة المباعة
        WHEN '540000' THEN 'Cost of Goods Sold'
        WHEN '541000' THEN 'COGS - PP Products'
        WHEN '542000' THEN 'COGS - PS Products'
        WHEN '543000' THEN 'COGS - PET Products'
        WHEN '544000' THEN 'COGS - Printed Bags'
        WHEN '545000' THEN 'COGS - Plastic Rolls'
        WHEN '546000' THEN 'COGS - Scrap and Waste'
        
        -- الفروقات والتالف
        WHEN '590000' THEN 'Manufacturing Variances and Waste'
        WHEN '591000' THEN 'Material Variances'
        WHEN '591100' THEN 'Material Price Variance (PPV)'
        WHEN '591200' THEN 'Material Usage Variance'
        WHEN '591300' THEN 'Material Efficiency Variance'
        WHEN '592000' THEN 'Labor Variances'
        WHEN '592100' THEN 'Labor Rate Variance'
        WHEN '592200' THEN 'Labor Efficiency Variance'
        WHEN '592300' THEN 'Labor Productivity Variance'
        WHEN '593000' THEN 'Overhead Variances'
        WHEN '593100' THEN 'Overhead Spending Variance'
        WHEN '593200' THEN 'Overhead Volume/Capacity Variance'
        WHEN '593300' THEN 'Variable Overhead Efficiency Variance'
        WHEN '595000' THEN 'Waste and Scrap'
        WHEN '595100' THEN 'Normal Waste (Production)'
        WHEN '595200' THEN 'Abnormal Waste'
        WHEN '595300' THEN 'Cutting Process Waste'
        WHEN '595400' THEN 'Scrap Processing Cost'
        WHEN '596000' THEN 'External Processing Costs'
        
        -- المصاريف التشغيلية
        WHEN '600000' THEN 'Operating Expenses'
        WHEN '620000' THEN 'Administrative Salaries and Wages'
        WHEN '620100' THEN 'Administrative Staff Salaries'
        WHEN '620200' THEN 'Employee Allowances'
        WHEN '620300' THEN 'Administrative Bonuses and Incentives'
        WHEN '630000' THEN 'Medical Insurance and Employee Services'
        WHEN '630100' THEN 'Social Insurance (GOSI)'
        WHEN '640000' THEN 'Marketing and Sales Expenses'
        WHEN '640100' THEN 'Advertising and Promotion'
        WHEN '640200' THEN 'Sales Representatives Commissions'
        WHEN '640300' THEN 'Shipping and Delivery Expenses'
        
        -- إيجارات ومرافق
        WHEN '650000' THEN 'Rent and Facilities'
        WHEN '650100' THEN 'Administrative Office Rent'
        WHEN '650200' THEN 'Administrative Electricity and Water'
        WHEN '650300' THEN 'Telephone and Internet'
        
        -- سفر ونقل
        WHEN '660000' THEN 'Travel and Transportation'
        WHEN '660100' THEN 'Employee Travel Tickets'
        WHEN '660200' THEN 'Accommodation and Travel Expenses'
        WHEN '660300' THEN 'Fuel and Vehicle Expenses'
        
        -- رسوم حكومية
        WHEN '670000' THEN 'Government and Legal Fees'
        WHEN '670100' THEN 'Official Documents Renewal Fees'
        WHEN '670200' THEN 'Banking Fees and Financial Services'
        WHEN '670300' THEN 'Legal and Professional Consultations'
        
        -- مصاريف مكتبية
        WHEN '680000' THEN 'Office and Miscellaneous Expenses'
        WHEN '680100' THEN 'Stationery and Printing'
        WHEN '680200' THEN 'Hospitality and Cleaning'
        WHEN '680300' THEN 'Office Equipment Maintenance'
        WHEN '680400' THEN 'Other Miscellaneous Expenses'
        
        -- الإهلاك
        WHEN '690000' THEN 'Depreciation Expense'
        WHEN '690100' THEN 'Administrative Buildings Depreciation'
        WHEN '690200' THEN 'Administrative Office Equipment Depreciation'
        WHEN '690300' THEN 'Furniture and Fixtures Depreciation'
        WHEN '690400' THEN 'Administrative Vehicles Depreciation'
        WHEN '694000' THEN 'Sales Discounts Allowed'
        
        -- مصاريف غير تشغيلية
        WHEN '700000' THEN 'Non-Operating Expenses'
        WHEN '730100' THEN 'Zakat'
        WHEN '730200' THEN 'Taxes'
        WHEN '730300' THEN 'Interest Expense'
        WHEN '730400' THEN 'Foreign Exchange Losses'
        
        ELSE name_en -- Keep existing translation if already set
    END
WHERE org_id = '00000000-0000-0000-0000-000000000001'
AND name_en IS NULL OR name_en = name;

-- عرض الحسابات التي لا تزال بحاجة إلى ترجمة
SELECT 
    code,
    name as العربي,
    name_en as الإنجليزي,
    CASE WHEN name_en IS NULL OR name_en = name THEN '❌ بحاجة ترجمة' ELSE '✅ مُترجم' END as الحالة
FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001'
AND (name_en IS NULL OR name_en = name)
ORDER BY code
LIMIT 30;
