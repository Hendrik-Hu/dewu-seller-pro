-- Ensure user_id column exists
ALTER TABLE activities ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Enable RLS for activities table
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

-- Create policy to allow users to see only their own activities
DROP POLICY IF EXISTS "Users can view their own activities" ON activities;
CREATE POLICY "Users can view their own activities"
ON activities FOR SELECT
USING (auth.uid() = user_id);

-- Create policy to allow users to insert their own activities
DROP POLICY IF EXISTS "Users can insert their own activities" ON activities;
CREATE POLICY "Users can insert their own activities"
ON activities FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Create policy to allow users to update their own activities
DROP POLICY IF EXISTS "Users can update their own activities" ON activities;
CREATE POLICY "Users can update their own activities"
ON activities FOR UPDATE
USING (auth.uid() = user_id);

-- Create policy to allow users to delete their own activities
DROP POLICY IF EXISTS "Users can delete their own activities" ON activities;
CREATE POLICY "Users can delete their own activities"
ON activities FOR DELETE
USING (auth.uid() = user_id);
