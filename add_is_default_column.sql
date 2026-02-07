-- Add is_default column to warehouses table
ALTER TABLE warehouses 
ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE;

-- Ensure only one default warehouse per user (Optional but recommended, though simple bool is enough for now)
-- We'll just rely on application logic to maintain single true, or use a partial unique index
-- CREATE UNIQUE INDEX IF NOT EXISTS one_default_warehouse_per_user 
-- ON warehouses (user_id) 
-- WHERE is_default = TRUE;
