-- Fix categories table to add name_ar column

-- Add name_ar column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'categories' AND column_name = 'name_ar'
    ) THEN
        ALTER TABLE categories ADD COLUMN name_ar VARCHAR(100);
    END IF;
END $$;

-- Update existing categories to have name_ar
UPDATE categories SET name_ar = 
    CASE 
        WHEN name = 'Raw Materials' THEN 'مواد خام'
        WHEN name = 'Finished Goods' THEN 'منتجات تامة'
        WHEN name = 'Semi-Finished' THEN 'منتجات نصف مصنعة'
        WHEN name = 'Packaging' THEN 'مواد تعبئة'
        ELSE name
    END
WHERE name_ar IS NULL;

-- Success message
SELECT 'Categories table fixed successfully!' AS result;
