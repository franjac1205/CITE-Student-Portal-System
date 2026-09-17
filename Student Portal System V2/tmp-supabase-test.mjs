import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://bddsbdumnndopaadubxf.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkZHNiZHVtbm5kb3BhYWR1YnhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyMjIxNDEsImV4cCI6MjEwMDc5ODE0MX0.pAhJPqTP4KdYcD8gXqXQ-JfrWiAhOzBL7OVRHZkl1eg'
);

const res = await supabase
  .from('announcements')
  .select('id,title,content,created_by,created_at,updated_at,deleted_at,type,priority,is_pinned,publish_date,expiry_date')
  .order('publish_date', { ascending: false });

console.log(JSON.stringify(res, null, 2));
