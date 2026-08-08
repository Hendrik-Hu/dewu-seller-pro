-- Data-layer hardening for the inventory app.
-- Run this in Supabase SQL Editor after reviewing it against your current schema.

-- 1. Basic integrity and query indexes for the current name-based schema.
ALTER TABLE products ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE activities ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE activities ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT '得物';
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS products_user_warehouse_status_created_idx
  ON products (user_id, warehouse, status, created_at DESC);

CREATE INDEX IF NOT EXISTS products_user_sku_size_idx
  ON products (user_id, sku, size);

CREATE INDEX IF NOT EXISTS activities_user_type_created_idx
  ON activities (user_id, type, created_at DESC);

CREATE INDEX IF NOT EXISTS warehouses_user_default_idx
  ON warehouses (user_id, is_default);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'warehouses_user_id_name_key'
  ) THEN
    ALTER TABLE warehouses ADD CONSTRAINT warehouses_user_id_name_key UNIQUE (user_id, name);
  END IF;
END $$;

-- 2. Keep only one default warehouse per user.
CREATE UNIQUE INDEX IF NOT EXISTS warehouses_one_default_per_user_idx
  ON warehouses (user_id)
  WHERE is_default = true;

-- 3. Transaction-safe outbound operation for the existing schema.
-- The frontend can switch to this RPC after the script is deployed.
CREATE OR REPLACE FUNCTION outbound_product(
  p_product_id TEXT,
  p_user_id UUID,
  p_sale_price NUMERIC,
  p_quantity INTEGER DEFAULT 1,
  p_platform TEXT DEFAULT '得物'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_product products%ROWTYPE;
  v_new_stock INTEGER;
  v_activity_id TEXT;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than 0';
  END IF;

  IF p_sale_price IS NULL OR p_sale_price < 0 THEN
    RAISE EXCEPTION 'Sale price must be greater than or equal to 0';
  END IF;

  SELECT *
  INTO v_product
  FROM products
  WHERE id = p_product_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  IF v_product.stock < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock';
  END IF;

  v_new_stock := v_product.stock - p_quantity;

  UPDATE products
  SET stock = v_new_stock,
      status = CASE WHEN v_new_stock <= 0 THEN 'sold' ELSE status END
  WHERE id = p_product_id
    AND user_id = p_user_id;

  v_activity_id := 'act-' || floor(extract(epoch from clock_timestamp()) * 1000)::TEXT;

  INSERT INTO activities (
    id,
    type,
    product_name,
    time,
    sku,
    size,
    price,
    cost,
    image_url,
    created_at,
    warehouse,
    count,
    user_id,
    platform
  )
  VALUES (
    v_activity_id,
    'outbound',
    v_product.name,
    '刚刚',
    v_product.sku,
    v_product.size,
    p_sale_price,
    v_product.price,
    v_product.image_url,
    now(),
    v_product.warehouse,
    p_quantity,
    p_user_id,
    p_platform
  );

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'activity_id', v_activity_id,
    'stock', v_new_stock
  );
END;
$$;

-- 4. Next normalization step.
-- Add these columns first, backfill by matching warehouse names, then update frontend queries
-- to use warehouse_id. Do not drop the legacy warehouse text column until all clients are migrated.
ALTER TABLE products ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id);
ALTER TABLE activities ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id);

UPDATE products p
SET warehouse_id = w.id
FROM warehouses w
WHERE p.warehouse_id IS NULL
  AND p.user_id = w.user_id
  AND p.warehouse = w.name;

UPDATE activities a
SET warehouse_id = w.id
FROM warehouses w
WHERE a.warehouse_id IS NULL
  AND a.user_id = w.user_id
  AND a.warehouse = w.name;

CREATE INDEX IF NOT EXISTS products_user_warehouse_id_status_created_idx
  ON products (user_id, warehouse_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS activities_user_warehouse_id_created_idx
  ON activities (user_id, warehouse_id, created_at DESC);
