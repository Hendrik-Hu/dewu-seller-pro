-- Add platform column to activities table if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'activities' AND column_name = 'platform') THEN
        ALTER TABLE activities ADD COLUMN platform TEXT DEFAULT '得物';
    END IF;
END $$;
