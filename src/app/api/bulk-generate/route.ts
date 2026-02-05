import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';

export async function POST(req: Request) {
    const supabaseAdmin = getSupabaseAdmin();
    try {
        const { clientId, count = 10 } = await req.json();

        // Limit count to prevent abuse
        const requestedCount = Math.min(Math.max(1, count), 100);

        const uuids: string[] = [];
        const archiveInserts: { uuid: string }[] = [];

        for (let i = 0; i < requestedCount; i++) {
            const newUUID = uuidv4();
            uuids.push(newUUID);
            archiveInserts.push({ uuid: newUUID });
        }

        // 1. Bulk insert into archive
        const { error: archiveError } = await supabaseAdmin
            .from('uuid_archive')
            .insert(archiveInserts);

        if (archiveError) {
            // If any collision happens in bulk, we just report one (simplified for bulk)
            if (archiveError.code === '23505') {
                await supabaseAdmin.rpc('increment_collision_counter');
                return NextResponse.json({ error: 'Collision detected during bulk generation' }, { status: 409 });
            }
            throw archiveError;
        }

        // 2. Bulk insert into display table
        const displayInserts = uuids.map(uuid => ({
            uuid,
            client_id: clientId,
            is_gift: false
        }));

        const { error } = await supabaseAdmin
            .from('generated_uuids')
            .insert(displayInserts);

        if (error) throw error;

        return NextResponse.json({ uuids });
    } catch (err) {
        console.error('Bulk generate error:', err);
        return NextResponse.json({ error: 'Failed to generate bulk UUIDs' }, { status: 500 });
    }
}
