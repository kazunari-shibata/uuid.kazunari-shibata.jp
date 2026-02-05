import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic'; // Ensure history is always fresh

export async function GET() {
    const supabaseAdmin = getSupabaseAdmin();
    try {
        const { data, error } = await supabaseAdmin
            .from('generated_uuids')
            .select('id, uuid, created_at, client_id, is_gift')
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(100);

        if (error) throw error;
        return NextResponse.json(data);
    } catch (err) {
        console.error('History error:', err);
        return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }
}
