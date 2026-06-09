DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'products'
          AND column_name = 'source'
    ) THEN
        ALTER TABLE products ADD COLUMN source TEXT;
    END IF;
END $$;
