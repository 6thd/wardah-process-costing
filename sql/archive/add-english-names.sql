-- إضافة عمود الاسم الإنجليزي للحسابات
ALTER TABLE gl_accounts 
ADD COLUMN IF NOT EXISTS name_en VARCHAR(255);

-- تحديث الحسابات بالأسماء الإنجليزية
UPDATE gl_accounts SET name_en = 
    CASE code
        -- المستوى 1: الحسابات الرئيسية
        WHEN '100000' THEN 'Assets'
        WHEN '110000' THEN 'Current Assets'
        WHEN '200000' THEN 'Liabilities'
        WHEN '300000' THEN 'Equity'
        WHEN '400000' THEN 'Revenue'
        WHEN '500000' THEN 'Cost of Goods Sold'
        WHEN '600000' THEN 'Operating Expenses'
        
        -- الأصول المتداولة
        WHEN '110100' THEN 'Cash and Cash Equivalents'
        WHEN '110101' THEN 'Cash in Hand - Riyals'
        WHEN '110102' THEN 'Cash in Hand - Jeddah'
        WHEN '110103' THEN 'Cash in Hand - Dammam'
        WHEN '110104' THEN 'Petty Cash'
        WHEN '110105' THEN 'Cash Fund'
        
        WHEN '110200' THEN 'Bank Accounts'
        WHEN '110201' THEN 'Al Rajhi Bank - Current Account'
        WHEN '110202' THEN 'Al Ahli Bank - Current Account'
        WHEN '110203' THEN 'Riyad Bank - Current Account'
        WHEN '110204' THEN 'SABB Bank - Current Account'
        
        WHEN '110300' THEN 'Accounts Receivable - Trade'
        WHEN '110301' THEN 'Customers - Local'
        WHEN '110302' THEN 'Customers - Export'
        WHEN '110303' THEN 'Accounts Receivable - Related Parties'
        WHEN '110304' THEN 'Employees Receivables'
        WHEN '110305' THEN 'Advances to Suppliers'
        
        WHEN '110400' THEN 'Allowance for Doubtful Accounts'
        WHEN '110401' THEN 'Provision for Doubtful Debts'
        
        WHEN '110500' THEN 'Inventory'
        WHEN '110501' THEN 'Raw Materials Inventory'
        WHEN '110502' THEN 'Work in Process Inventory'
        WHEN '110503' THEN 'Finished Goods Inventory'
        WHEN '110504' THEN 'Packaging Materials Inventory'
        WHEN '110505' THEN 'Spare Parts Inventory'
        WHEN '110506' THEN 'Scrap and Waste Inventory'
        
        WHEN '110600' THEN 'Prepaid Expenses'
        WHEN '110601' THEN 'Prepaid Rent'
        WHEN '110602' THEN 'Prepaid Insurance'
        WHEN '110603' THEN 'Advances to Contractors'
        WHEN '110604' THEN 'Refundable Deposits'
        
        WHEN '110700' THEN 'VAT Receivable'
        WHEN '110701' THEN 'Input VAT - Purchases'
        WHEN '110702' THEN 'Input VAT - Imports'
        WHEN '110703' THEN 'Input VAT - Assets'
        
        -- الأصول غير المتداولة
        WHEN '120000' THEN 'Non-Current Assets'
        WHEN '120100' THEN 'Property, Plant & Equipment'
        WHEN '120101' THEN 'Land'
        WHEN '120102' THEN 'Buildings'
        WHEN '120103' THEN 'Machinery and Equipment'
        WHEN '120104' THEN 'Production Lines'
        WHEN '120105' THEN 'Molds and Dies'
        WHEN '120106' THEN 'Vehicles'
        WHEN '120107' THEN 'Furniture and Fixtures'
        WHEN '120108' THEN 'Computers and IT Equipment'
        WHEN '120109' THEN 'Assets Under Construction'
        
        WHEN '120200' THEN 'Accumulated Depreciation'
        WHEN '120201' THEN 'Accumulated Depreciation - Buildings'
        WHEN '120202' THEN 'Accumulated Depreciation - Machinery'
        WHEN '120203' THEN 'Accumulated Depreciation - Production Lines'
        WHEN '120204' THEN 'Accumulated Depreciation - Molds'
        WHEN '120205' THEN 'Accumulated Depreciation - Vehicles'
        WHEN '120206' THEN 'Accumulated Depreciation - Furniture'
        WHEN '120207' THEN 'Accumulated Depreciation - IT Equipment'
        
        WHEN '120300' THEN 'Intangible Assets'
        WHEN '120301' THEN 'Software and Licenses'
        WHEN '120302' THEN 'Trademarks and Patents'
        WHEN '120303' THEN 'Goodwill'
        
        -- الخصوم المتداولة
        WHEN '210000' THEN 'Current Liabilities'
        WHEN '210100' THEN 'Accounts Payable - Trade'
        WHEN '210101' THEN 'Suppliers - Local'
        WHEN '210102' THEN 'Suppliers - Import'
        WHEN '210103' THEN 'Accounts Payable - Related Parties'
        
        WHEN '210200' THEN 'Accrued Expenses'
        WHEN '210201' THEN 'Accrued Salaries and Wages'
        WHEN '210202' THEN 'Accrued Utilities'
        WHEN '210203' THEN 'Accrued Professional Fees'
        WHEN '210204' THEN 'Accrued Interest'
        
        WHEN '210300' THEN 'Short-term Loans'
        WHEN '210301' THEN 'Bank Overdraft'
        WHEN '210302' THEN 'Short-term Bank Loans'
        
        WHEN '210400' THEN 'VAT Payable'
        WHEN '210401' THEN 'Output VAT - Sales'
        WHEN '210402' THEN 'VAT Payable to Authority'
        
        WHEN '210500' THEN 'Payroll Liabilities'
        WHEN '210501' THEN 'GOSI Payable'
        WHEN '210502' THEN 'End of Service Benefits Payable'
        WHEN '210503' THEN 'Employee Income Tax Withholding'
        
        WHEN '210600' THEN 'Other Current Liabilities'
        WHEN '210601' THEN 'Advances from Customers'
        WHEN '210602' THEN 'Dividends Payable'
        WHEN '210603' THEN 'Retention Payable'
        
        -- الخصوم طويلة الأجل
        WHEN '220000' THEN 'Non-Current Liabilities'
        WHEN '220100' THEN 'Long-term Loans'
        WHEN '220101' THEN 'Long-term Bank Loans'
        WHEN '220102' THEN 'Bonds Payable'
        
        WHEN '220200' THEN 'Provisions'
        WHEN '220201' THEN 'Provision for End of Service Benefits'
        WHEN '220202' THEN 'Provision for Warranty Claims'
        
        -- حقوق الملكية
        WHEN '310000' THEN 'Owner''s Equity'
        WHEN '310100' THEN 'Capital'
        WHEN '310101' THEN 'Paid-in Capital'
        WHEN '310102' THEN 'Additional Paid-in Capital'
        
        WHEN '310200' THEN 'Retained Earnings'
        WHEN '310201' THEN 'Retained Earnings - Prior Years'
        WHEN '310202' THEN 'Current Year Profit/Loss'
        
        WHEN '310300' THEN 'Reserves'
        WHEN '310301' THEN 'Statutory Reserve'
        WHEN '310302' THEN 'General Reserve'
        
        WHEN '310400' THEN 'Drawings'
        WHEN '310401' THEN 'Owner''s Drawings'
        
        -- الإيرادات
        WHEN '410000' THEN 'Sales Revenue'
        WHEN '410100' THEN 'Product Sales'
        WHEN '410101' THEN 'Sales - Plastic Products'
        WHEN '410102' THEN 'Sales - Custom Products'
        WHEN '410103' THEN 'Sales - Export'
        
        WHEN '410200' THEN 'Other Operating Revenue'
        WHEN '410201' THEN 'Scrap Sales'
        WHEN '410202' THEN 'Service Revenue'
        
        WHEN '420000' THEN 'Non-Operating Revenue'
        WHEN '420100' THEN 'Other Income'
        WHEN '420101' THEN 'Interest Income'
        WHEN '420102' THEN 'Gain on Asset Disposal'
        WHEN '420103' THEN 'Exchange Rate Gains'
        
        -- تكلفة البضاعة المباعة
        WHEN '510000' THEN 'Direct Material Costs'
        WHEN '510100' THEN 'Raw Materials Consumed'
        WHEN '510101' THEN 'PVC Resin'
        WHEN '510102' THEN 'PE Resin'
        WHEN '510103' THEN 'PP Resin'
        WHEN '510104' THEN 'Additives and Stabilizers'
        WHEN '510105' THEN 'Colorants and Pigments'
        WHEN '510106' THEN 'Packaging Materials'
        
        WHEN '510200' THEN 'Regrind and Recycled Material'
        WHEN '510201' THEN 'Internal Regrind Usage'
        WHEN '510202' THEN 'Purchased Regrind'
        
        WHEN '520000' THEN 'Direct Labor Costs'
        WHEN '520100' THEN 'Production Wages'
        WHEN '520101' THEN 'Extrusion Operators'
        WHEN '520102' THEN 'Mixing Operators'
        WHEN '520103' THEN 'Quality Control Staff'
        WHEN '520104' THEN 'Production Overtime'
        
        WHEN '530000' THEN 'Manufacturing Overhead'
        WHEN '530100' THEN 'Utilities - Production'
        WHEN '530101' THEN 'Electricity - Production'
        WHEN '530102' THEN 'Water - Production'
        WHEN '530103' THEN 'Cooling Systems'
        
        WHEN '530200' THEN 'Maintenance and Repairs'
        WHEN '530201' THEN 'Machinery Maintenance'
        WHEN '530202' THEN 'Mold Repairs'
        WHEN '530203' THEN 'Spare Parts Consumed'
        
        WHEN '530300' THEN 'Depreciation - Manufacturing'
        WHEN '530301' THEN 'Depreciation - Production Equipment'
        WHEN '530302' THEN 'Depreciation - Molds and Dies'
        
        -- المصاريف التشغيلية
        WHEN '610000' THEN 'Selling Expenses'
        WHEN '610100' THEN 'Sales Salaries'
        WHEN '610101' THEN 'Sales Staff Salaries'
        WHEN '610102' THEN 'Sales Commissions'
        
        WHEN '610200' THEN 'Marketing Expenses'
        WHEN '610201' THEN 'Advertising'
        WHEN '610202' THEN 'Exhibitions and Trade Shows'
        WHEN '610203' THEN 'Promotional Materials'
        
        WHEN '610300' THEN 'Distribution Costs'
        WHEN '610301' THEN 'Shipping and Freight'
        WHEN '610302' THEN 'Delivery Vehicle Expenses'
        WHEN '610303' THEN 'Packaging and Handling'
        
        WHEN '620000' THEN 'Administrative Expenses'
        WHEN '620100' THEN 'Salaries and Wages'
        WHEN '620101' THEN 'Management Salaries'
        WHEN '620102' THEN 'Administrative Staff Salaries'
        WHEN '620103' THEN 'Employee Benefits'
        
        WHEN '620200' THEN 'Office Expenses'
        WHEN '620201' THEN 'Office Supplies'
        WHEN '620202' THEN 'Postage and Courier'
        WHEN '620203' THEN 'Telephone and Internet'
        
        WHEN '620300' THEN 'Professional Fees'
        WHEN '620301' THEN 'Legal Fees'
        WHEN '620302' THEN 'Accounting and Audit Fees'
        WHEN '620303' THEN 'Consulting Fees'
        
        WHEN '620400' THEN 'Rent and Utilities'
        WHEN '620401' THEN 'Office Rent'
        WHEN '620402' THEN 'Electricity - Administrative'
        WHEN '620403' THEN 'Water - Administrative'
        
        WHEN '620500' THEN 'Insurance'
        WHEN '620501' THEN 'Property Insurance'
        WHEN '620502' THEN 'Vehicle Insurance'
        WHEN '620503' THEN 'Liability Insurance'
        
        WHEN '620600' THEN 'Depreciation and Amortization'
        WHEN '620601' THEN 'Depreciation - Office Equipment'
        WHEN '620602' THEN 'Depreciation - Vehicles'
        WHEN '620603' THEN 'Amortization - Software'
        
        WHEN '630000' THEN 'Financial Expenses'
        WHEN '630100' THEN 'Interest and Bank Charges'
        WHEN '630101' THEN 'Interest on Loans'
        WHEN '630102' THEN 'Bank Service Charges'
        WHEN '630103' THEN 'Exchange Rate Losses'
        
        WHEN '640000' THEN 'Other Expenses'
        WHEN '640100' THEN 'Miscellaneous Expenses'
        WHEN '640101' THEN 'Donations'
        WHEN '640102' THEN 'Penalties and Fines'
        WHEN '640103' THEN 'Loss on Asset Disposal'
        
        ELSE name -- Keep Arabic name if no English translation found
    END
WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- التحقق من التحديث
SELECT 'تم تحديث أسماء الحسابات الإنجليزية' as status;

-- عرض عينة من الحسابات بالعربية والإنجليزية
SELECT 
    code as الكود,
    name as العربي,
    name_en as الإنجليزي,
    category as الفئة
FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001'
ORDER BY code
LIMIT 20;
