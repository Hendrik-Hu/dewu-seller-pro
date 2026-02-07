-- 1. Ensure columns exist
ALTER TABLE activities ADD COLUMN IF NOT EXISTS count INTEGER DEFAULT 1;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS size TEXT;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- 2. Fix Data: Set default count to 1 if null
UPDATE activities SET count = 1 WHERE count IS NULL OR count = 0;

-- 3. Fix Data: Try to recover user_id from products table if missing
-- This helps if activities were created without user_id but match a product
UPDATE activities 
SET user_id = products.user_id 
FROM products 
WHERE activities.sku = products.sku 
  AND activities.user_id IS NULL;

-- 4. Fix Data: If still null, just default to the current auth user (only works if run in context, but good try)
-- Otherwise, we might need to disable RLS to see them.

-- 5. Reset RLS Policies to be fully permissive for the owner
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable all access for own activities" ON activities;

-- Allow users to do ANYTHING with their own rows
CREATE POLICY "Enable all access for own activities"
ON activities
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 6. EMERGENCY FALLBACK: If user_id is still messed up, this policy allows viewing rows with NULL user_id
-- (Optional, but helps debug)
CREATE POLICY "Allow viewing orphan activities"
ON activities
FOR SELECT
USING (user_id IS NULL);
