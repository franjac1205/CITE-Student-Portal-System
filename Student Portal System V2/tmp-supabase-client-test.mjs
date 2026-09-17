import { supabase } from './src/supabaseClient.js';

const res = await supabase
  .from('announcements')
  .select('id,title,content,created_by,created_at,updated_at,deleted_at,type,priority,is_pinned,publish_date,expiry_date')
  .order('publish_date', { ascending: false });

console.log(JSON.stringify(res, null, 2));
