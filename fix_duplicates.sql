-- 1. Keep only one instance of each warehouse name per user (Cleanup Duplicates)
DELETE FROM warehouses
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (partition BY user_id, name ORDER BY created_at ASC) as rnum
    FROM warehouses
  ) t
  WHERE t.rnum > 1
);

-- 2. Add a unique constraint to prevent future duplicates
-- This ensures that for a given user, a warehouse name can only appear once
ALTER TABLE warehouses 
ADD CONSTRAINT warehouses_user_id_name_key UNIQUE (user_id, name);
