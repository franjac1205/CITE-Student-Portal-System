import { createClient } from '@supabase/supabase-js';

// Unified Supabase project (UnifiedSupabase.txt)
const unifiedSupabaseUrl = import.meta.env.VITE_UNIFIED_SUPABASE_URL || 'https://bddsbdumnndopaadubxf.supabase.co';
const unifiedSupabaseAnonKey = import.meta.env.VITE_UNIFIED_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkZHNiZHVtbm5kb3BhYWR1YnhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyMjIxNDEsImV4cCI6MjEwMDc5ODE0MX0.pAhJPqTP4KdYcD8gXqXQ-JfrWiAhOzBL7OVRHZkl1eg';

// Use the unified project for both app and cashflow clients so all modules
// point to the same consolidated database and tables (users, events,
// event_required_groups, liquidations, announcements, payments, etc.).
const supabaseUrl = unifiedSupabaseUrl;
const supabaseAnonKey = unifiedSupabaseAnonKey;

const cashflowSupabaseUrl = unifiedSupabaseUrl;
const cashflowSupabaseAnonKey = unifiedSupabaseAnonKey;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export const cashflowSupabase = createClient(cashflowSupabaseUrl, cashflowSupabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});