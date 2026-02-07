-- Check if the count column exists in activities table
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'activities' AND column_name = 'count') THEN
        ALTER TABLE activities ADD COLUMN count INTEGER DEFAULT 1;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'activities' AND column_name = 'size') THEN
        ALTER TABLE activities ADD COLUMN size TEXT;
    END IF;
END $$;
