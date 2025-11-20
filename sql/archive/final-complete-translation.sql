-- ترجمة كاملة لجميع الحسابات الـ 119 المتبقية
-- Complete English translation for all 119 remaining accounts

UPDATE gl_accounts SET name_en = CASE code
    -- Assets Root & Current Assets (100000-110000)
    WHEN '100000' THEN 'Assets'
    WHEN '110000' THEN 'Current Assets'
    
    -- Cash & Cash Equivalents (110100-110105)
    WHEN '110100' THEN 'Cash and Cash Equivalents'
    WHEN '110101' THEN 'Cash in Hand - Riyadh'
    WHEN '110102' THEN 'Cash in Hand - Jeddah'
    WHEN '110103' THEN 'Cash in Hand - Dammam'
    WHEN '110104' THEN 'Checks Under Collection'
    WHEN '110105' THEN 'Cash Custodies'
    
    -- Bank Accounts (110200-110203)
    WHEN '110200' THEN 'Cash at Banks'
    WHEN '110201' THEN 'Al Rajhi Bank - Current Account'
    WHEN '110202' THEN 'Alinma Bank - Current Account'
    WHEN '110203' THEN 'Al Ahli Bank - Current Account'
    
    -- Accounts Receivable & Prepaid (110300-110500)
    WHEN '110300' THEN 'Accounts Receivable'
    WHEN '110400' THEN 'Prepaid Expenses'
    WHEN '110401' THEN 'Prepaid Medical Insurance'
    WHEN '110402' THEN 'Prepaid Rent'
    WHEN '110403' THEN 'Advances to Suppliers'
    WHEN '110500' THEN 'Employee Advances'
    WHEN '110600' THEN 'VAT Input'
    
    -- Fixed Assets (120000-120300)
    WHEN '120000' THEN 'Non-Current Assets'
    WHEN '120100' THEN 'Property, Plant and Equipment'
    WHEN '120101' THEN 'Land'
    WHEN '120102' THEN 'Buildings and Facilities'
    WHEN '120103' THEN 'Production Machinery and Equipment'
    WHEN '120104' THEN 'Office Equipment and Computers'
    WHEN '120105' THEN 'Furniture and Fixtures'
    WHEN '120106' THEN 'Vehicles'
    WHEN '120107' THEN 'Tools and Equipment'
    WHEN '120200' THEN 'Intangible Assets'
    WHEN '120300' THEN 'Construction in Progress'
    
    -- Inventory (130000-137000)
    WHEN '130000' THEN 'Inventory'
    WHEN '131000' THEN 'Raw Materials'
    WHEN '131100' THEN 'Raw Materials - LDPE'
    WHEN '131110' THEN 'Raw Materials - HDPE'
    WHEN '131120' THEN 'Raw Materials - PP'
    WHEN '131130' THEN 'Raw Materials - PS'
    WHEN '131140' THEN 'Raw Materials - PET'
    WHEN '131150' THEN 'Raw Materials - Master Batch'
    WHEN '131200' THEN 'Auxiliary Materials and Packaging'
    WHEN '131300' THEN 'Spare Parts and Maintenance Materials'
    
    -- Work in Process (134000-134500)
    WHEN '134000' THEN 'Work in Process (WIP)'
    WHEN '134100' THEN 'WIP - Mixing and Preparation'
    WHEN '134200' THEN 'WIP - Extrusion and Forming'
    WHEN '134300' THEN 'WIP - Printing and Decoration'
    WHEN '134400' THEN 'WIP - Cutting and Slitting'
    WHEN '134500' THEN 'WIP - Packaging and Wrapping'
    
    -- Finished Goods (135000-135200)
    WHEN '135000' THEN 'Finished Goods'
    WHEN '135100' THEN 'FG - Printed Bags'
    WHEN '135110' THEN 'FG - Plastic Rolls'
    WHEN '135120' THEN 'FG - PP Products'
    WHEN '135130' THEN 'FG - PS Products'
    WHEN '135140' THEN 'FG - PET Products'
    WHEN '135200' THEN 'FG - Scrap for Sale'
    
    -- Other Inventory (136000-137000)
    WHEN '136000' THEN 'Materials Under External Processing'
    WHEN '137000' THEN 'Inventory Adjustments'
    
    -- Liabilities (200000-210000)
    WHEN '200000' THEN 'Liabilities'
    WHEN '210000' THEN 'Current Liabilities'
    WHEN '210100' THEN 'Accounts Payable'
    
    -- Payroll Liabilities (210200-210203)
    WHEN '210200' THEN 'Employee Payables'
    WHEN '210201' THEN 'Accrued Salaries and Wages'
    WHEN '210202' THEN 'Accrued Sales Commissions'
    WHEN '210203' THEN 'Accrued Social Insurance (GOSI)'
    
    -- Accrued Expenses (210300-210303)
    WHEN '210300' THEN 'Accrued Expenses'
    WHEN '210301' THEN 'Accrued Rent'
    WHEN '210302' THEN 'Accrued Utilities'
    WHEN '210303' THEN 'Accrued Interest'
    
    -- Taxes (210400-210404)
    WHEN '210400' THEN 'Accrued Taxes and Zakat'
    WHEN '210401' THEN 'VAT Output'
    WHEN '210402' THEN 'VAT Payable'
    WHEN '210403' THEN 'Zakat Payable'
    WHEN '210404' THEN 'Other Taxes Payable'
    
    -- Other Current Liabilities (210500-210600)
    WHEN '210500' THEN 'Unearned Revenue'
    WHEN '210600' THEN 'Short-term Loans'
    
    -- Accumulated Depreciation (211000-211005)
    WHEN '211000' THEN 'Accumulated Depreciation'
    WHEN '211001' THEN 'Accumulated Depreciation - Buildings'
    WHEN '211002' THEN 'Accumulated Depreciation - Equipment'
    WHEN '211003' THEN 'Accumulated Depreciation - Office Equipment'
    WHEN '211004' THEN 'Accumulated Depreciation - Furniture'
    WHEN '211005' THEN 'Accumulated Depreciation - Vehicles'
    
    -- Long-term Liabilities (220000-220300)
    WHEN '220000' THEN 'Non-Current Liabilities'
    WHEN '220100' THEN 'Long-term Loans'
    WHEN '220200' THEN 'End of Service Benefits Provision'
    WHEN '220300' THEN 'Inventory Obsolescence Provision'
    
    -- Equity (300000-310000)
    WHEN '300000' THEN 'Equity'
    WHEN '310000' THEN 'Capital'
    WHEN '310100' THEN 'Registered Capital'
    WHEN '310200' THEN 'Additional Paid-in Capital'
    
    -- Reserves (330000-330200)
    WHEN '330000' THEN 'Reserves'
    WHEN '330100' THEN 'Statutory Reserve'
    WHEN '330200' THEN 'Foreign Currency Translation Reserve'
    
    -- Retained Earnings (340000-340200)
    WHEN '340000' THEN 'Retained Earnings'
    WHEN '340100' THEN 'Current Year Profit/Loss'
    WHEN '340200' THEN 'Prior Years Retained Earnings'
    
    -- Partners' Current Accounts (350000-350200)
    WHEN '350000' THEN 'Partners Current Accounts'
    WHEN '350100' THEN 'Partner 1 Current Account'
    WHEN '350200' THEN 'Partner 2 Current Account'
    
    -- Revenue (400000-410000)
    WHEN '400000' THEN 'Revenue'
    WHEN '410000' THEN 'Sales Revenue'
    WHEN '410100' THEN 'Domestic Sales'
    WHEN '410200' THEN 'Export Sales'
    WHEN '410300' THEN 'Service Revenue'
    
    -- Other Income (420000-420500)
    WHEN '420000' THEN 'Other Income'
    WHEN '420100' THEN 'Purchase Discounts Earned'
    WHEN '420200' THEN 'Scrap Sales Revenue'
    WHEN '420300' THEN 'Positive Inventory Count Differences'
    WHEN '420400' THEN 'Collected Compensations'
    WHEN '420500' THEN 'Interest and Investment Income'
    
    -- Expenses (500000-510000)
    WHEN '500000' THEN 'Costs and Expenses'
    WHEN '510000' THEN 'Manufacturing Costs'
    
    -- Direct Costs Tracking (511000-512000)
    WHEN '511000' THEN 'Direct Materials (Analytical)'
    WHEN '512000' THEN 'Direct Labor (Analytical)'
    
    -- Manufacturing Overhead (513000-513600)
    WHEN '513000' THEN 'Actual Manufacturing Overhead'
    WHEN '513100' THEN 'Power and Production Line Operations'
    WHEN '513200' THEN 'Production Equipment Maintenance'
    WHEN '513300' THEN 'Production Equipment Depreciation'
    WHEN '513400' THEN 'Indirect Materials'
    WHEN '513500' THEN 'Indirect Labor'
    WHEN '513600' THEN 'Production Equipment Insurance'
    WHEN '514000' THEN 'Applied Manufacturing Overhead'
    
    -- Cost Centers (517000-517500)
    WHEN '517000' THEN 'Production Cost Centers'
    WHEN '517100' THEN 'Cost Center - Mixing and Preparation'
    WHEN '517200' THEN 'Cost Center - Extrusion and Forming'
    WHEN '517300' THEN 'Cost Center - Printing and Decoration'
    WHEN '517400' THEN 'Cost Center - Cutting and Slitting'
    WHEN '517500' THEN 'Cost Center - Packaging and Wrapping'
    
    -- COGS (540000-546000)
    WHEN '540000' THEN 'Cost of Goods Sold'
    WHEN '541000' THEN 'COGS - PP Products'
    WHEN '542000' THEN 'COGS - PS Products'
    WHEN '543000' THEN 'COGS - PET Products'
    WHEN '544000' THEN 'COGS - Printed Bags'
    WHEN '545000' THEN 'COGS - Plastic Rolls'
    WHEN '546000' THEN 'COGS - Scrap and Waste'
    
    -- Manufacturing Variances (590000-593000)
    WHEN '590000' THEN 'Manufacturing Variances and Waste'
    WHEN '591000' THEN 'Material Variances'
    WHEN '591100' THEN 'Material Price Variance (PPV)'
    WHEN '591200' THEN 'Material Usage Variance'
    WHEN '591300' THEN 'Material Efficiency Variance'
    
    -- Labor Variances (592000-592300)
    WHEN '592000' THEN 'Labor Variances'
    WHEN '592100' THEN 'Labor Rate Variance'
    WHEN '592200' THEN 'Labor Efficiency Variance'
    WHEN '592300' THEN 'Labor Productivity Variance'
    
    -- Overhead Variances (593000-593300)
    WHEN '593000' THEN 'Overhead Variances'
    WHEN '593100' THEN 'Overhead Spending Variance'
    WHEN '593200' THEN 'Overhead Volume/Capacity Variance'
    WHEN '593300' THEN 'Variable Overhead Efficiency Variance'
    
    -- Waste and Scrap (595000-596000)
    WHEN '595000' THEN 'Waste and Scrap'
    WHEN '595100' THEN 'Normal Spoilage (Production)'
    WHEN '595200' THEN 'Abnormal Spoilage'
    WHEN '595300' THEN 'Cutting Process Waste'
    WHEN '595400' THEN 'Scrap Processing Cost'
    WHEN '596000' THEN 'External Processing Costs'
    
    -- Operating Expenses (600000-620000)
    WHEN '600000' THEN 'Operating Expenses'
    WHEN '620000' THEN 'Administrative Salaries and Wages'
    WHEN '620100' THEN 'Administrative Staff Salaries'
    WHEN '620200' THEN 'Employee Allowances'
    WHEN '620300' THEN 'Administrative Bonuses and Incentives'
    WHEN '630000' THEN 'Medical Insurance and Employee Services'
    WHEN '630100' THEN 'Social Insurance (GOSI)'
    
    -- Marketing and Sales (640000-640300)
    WHEN '640000' THEN 'Marketing and Sales Expenses'
    WHEN '640100' THEN 'Advertising and Promotion'
    WHEN '640200' THEN 'Sales Commissions'
    WHEN '640300' THEN 'Shipping and Delivery Expenses'
    
    -- Facilities (650000-650300)
    WHEN '650000' THEN 'Rent and Utilities'
    WHEN '650100' THEN 'Administrative Office Rent'
    WHEN '650200' THEN 'Administrative Electricity and Water'
    WHEN '650300' THEN 'Telephone and Internet'
    
    -- Travel (660000-660300)
    WHEN '660000' THEN 'Travel and Transportation'
    WHEN '660100' THEN 'Employee Travel Tickets'
    WHEN '660200' THEN 'Accommodation and Travel Expenses'
    WHEN '660300' THEN 'Fuel and Vehicle Expenses'
    
    -- Legal and Banking (670000-670300)
    WHEN '670000' THEN 'Government and Legal Fees'
    WHEN '670100' THEN 'Official Document Renewal Fees'
    WHEN '670200' THEN 'Banking Fees and Financial Services'
    WHEN '670300' THEN 'Legal and Professional Consultations'
    
    -- Office and Miscellaneous (680000-680400)
    WHEN '680000' THEN 'Office and Miscellaneous Expenses'
    WHEN '680100' THEN 'Stationery and Printing'
    WHEN '680200' THEN 'Hospitality and Cleaning'
    WHEN '680300' THEN 'Office Equipment Maintenance'
    WHEN '680400' THEN 'Other Miscellaneous Expenses'
    
    -- Administrative Depreciation (690000-690400)
    WHEN '690000' THEN 'Depreciation Expense'
    WHEN '690100' THEN 'Administrative Buildings Depreciation'
    WHEN '690200' THEN 'Administrative Office Equipment Depreciation'
    WHEN '690300' THEN 'Furniture and Fixtures Depreciation'
    WHEN '690400' THEN 'Administrative Vehicles Depreciation'
    WHEN '694000' THEN 'Sales Discounts Allowed'
    
    -- Non-Operating Expenses (700000-730400)
    WHEN '700000' THEN 'Non-Operating Expenses'
    WHEN '730100' THEN 'Zakat'
    WHEN '730200' THEN 'Taxes'
    WHEN '730300' THEN 'Interest Expense'
    WHEN '730400' THEN 'Foreign Exchange Losses'
    
    ELSE name_en
END
WHERE org_id = '00000000-0000-0000-0000-000000000001'
AND (name_en IS NULL OR name_en = '' OR name_en = name);

-- عرض تقرير التحقق النهائي
SELECT 
    '✅ اكتمال الترجمة - Complete Translation' as "النتيجة | Result",
    COUNT(*) as "إجمالي | Total",
    COUNT(CASE WHEN name_en IS NOT NULL AND name_en != '' AND name_en != name THEN 1 END) as "مُترجمة | Translated",
    COUNT(CASE WHEN name_en IS NULL OR name_en = '' OR name_en = name THEN 1 END) as "متبقية | Remaining"
FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- عرض عينة من الحسابات المُترجمة
SELECT 
    '📊 عينة من الحسابات المُترجمة | Sample of Translated Accounts' as "العنوان | Title";

SELECT 
    code as "الكود | Code",
    name as "العربي | Arabic",
    name_en as "الإنجليزي | English",
    category as "الفئة | Category"
FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001'
AND name_en IS NOT NULL 
AND name_en != '' 
AND name_en != name
ORDER BY code
LIMIT 20;
