import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';

export async function POST(req: Request) {
    const supabaseAdmin = getSupabaseAdmin();
    try {
        const { clientId, isGift } = await req.json();
        const newUUID = uuidv4();

        // 1. Try to insert into archive first (Collision Detection)
        const { error: archiveError } = await supabaseAdmin
            .from('uuid_archive')
            .insert([{ uuid: newUUID }]);

        if (archiveError) {
            // Collision detected in archive (even if deleted from main table)
            if (archiveError.code === '23505') {
                // Increment collisions counter
                await supabaseAdmin.rpc('increment_collision_counter');
                return NextResponse.json({ error: 'Collision detected', uuid: newUUID }, { status: 409 });
            }
            throw archiveError;
        }

        // 2. Insert into display table
        const { data, error } = await supabaseAdmin
            .from('generated_uuids')
            .insert([
                {
                    uuid: newUUID,
                    client_id: clientId,
                    is_gift: !!isGift
                }
            ])
            .select();

        if (error) throw error;

        return NextResponse.json({ uuid: newUUID, data: data[0] });
    } catch (err) {
        console.error('Generate error:', err);
        return NextResponse.json({ error: 'Failed to generate UUID' }, { status: 500 });
    }
}
