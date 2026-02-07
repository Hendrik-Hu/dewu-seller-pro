import { createClient } from '@supabase/supabase-js';

// 1. 填入 Project Settings -> API -> Project URL
const supabaseUrl = 'https://vitgaeirmnbvgwrpofmf.supabase.co';

// 2. 填入 Project Settings -> API -> Project API keys -> anon public
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpdGdhZWlybW5idmd3cnBvZm1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxNzM4MjYsImV4cCI6MjA4NTc0OTgyNn0.sBjeDlSG9YqyGOp7WZIVuloqKwKPTdXm7-NST9jUuEs';

export const supabase = createClient(supabaseUrl, supabaseKey);