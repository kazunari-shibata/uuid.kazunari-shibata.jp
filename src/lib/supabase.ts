import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Client-side supabase instance
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-side admin instance (only initialized on the server)
export const getSupabaseAdmin = () => {
    if (typeof window !== 'undefined') {
        throw new Error('supabaseAdmin can only be used on the server');
    }
    return createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
};
