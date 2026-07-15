CREATE TABLE IF NOT EXISTS public.items (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    name text NOT NULL,
    description text,
    sku text,
    unit_of_measure text,
    category_id uuid,
    cost numeric,
    price numeric,
    stock_quantity integer,
    minimum_stock integer,
    is_active boolean DEFAULT true,
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.items
ADD CONSTRAINT items_pkey PRIMARY KEY (id);

-- Add foreign key constraint to categories table
ALTER TABLE public.items
ADD CONSTRAINT items_category_id_fkey 
FOREIGN KEY (category_id) 
REFERENCES public.categories(id) 
ON DELETE SET NULL;