import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET() {
    const supabaseAdmin = getSupabaseAdmin();
    try {
        const { data, error } = await supabaseAdmin
            .from('counters')
            .select('name, count');

        if (error) throw error;

        const stats = {
            total_generated: data.find(c => c.name === 'total_generated')?.count || 0,
            collisions: data.find(c => c.name === 'collisions')?.count || 0
        };
        return NextResponse.json(stats);
    } catch (err) {
        console.error('Stats error:', err);
        return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }
}
