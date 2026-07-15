CREATE TABLE IF NOT EXISTS public.sales_order_items (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    sales_order_id uuid NOT NULL,
    item_id uuid NOT NULL,
    quantity integer NOT NULL,
    unit_price numeric NOT NULL,
    total_price numeric GENERATED ALWAYS AS ((quantity * unit_price)) STORED,
    notes text
);

ALTER TABLE public.sales_order_items
ADD CONSTRAINT sales_order_items_pkey PRIMARY KEY (id);

ALTER TABLE public.sales_order_items
ADD CONSTRAINT sales_order_items_sales_order_id_fkey
FOREIGN KEY (sales_order_id)
REFERENCES public.sales_orders(id)
ON DELETE CASCADE;

ALTER TABLE public.sales_order_items
ADD CONSTRAINT sales_order_items_item_id_fkey
FOREIGN KEY (item_id)
REFERENCES public.items(id);
