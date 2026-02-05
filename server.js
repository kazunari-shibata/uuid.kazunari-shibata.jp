require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase environment variables! Please check .env file.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

app.use(express.static(path.join(__dirname)));
app.use(express.json());

// API: Get Supabase config for client
app.get('/api/config', (req, res) => {
    res.json({
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY
    });
});

// API: Get current stats
app.get('/api/stats', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('counters')
            .select('name, count');

        if (error) throw error;

        const stats = {
            total_generated: data.find(c => c.name === 'total_generated')?.count || 0,
            collisions: data.find(c => c.name === 'collisions')?.count || 0
        };
        res.json(stats);
    } catch (err) {
        console.error('Stats error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Get history
app.get('/api/history', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('generated_uuids')
            .select('id, uuid, created_at, client_id, is_gift')
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('History error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Generate new UUID and check for collisions
app.post('/api/generate', async (req, res) => {
    try {
        const { clientId, isGift } = req.body;
        const newUUID = uuidv4();

        // Attempt to insert the new UUID
        // PostgreSQL will handle the collision check via the UNIQUE constraint on the 'uuid' column
        const { data, error } = await supabase
            .from('generated_uuids')
            .insert([
                {
                    uuid: newUUID,
                    client_id: clientId,
                    is_gift: !!isGift
                }
            ])
            .select();

        if (error) {
            // Check if it's a unique constraint violation (collision)
            if (error.code === '23505') {
                await supabase.rpc('increment_collision_counter'); // We'll need this function in SQL
                return res.status(409).json({ error: 'Collision detected', uuid: newUUID });
            }
            throw error;
        }

        res.json({ uuid: newUUID, data: data[0] });
    } catch (err) {
        console.error('Generate error:', err);
        res.status(500).json({ error: 'Failed to generate UUID' });
    }
});

// Start the server
// Note: In Vercel, this server.listen isn't used (Vercel uses its own entry point/functions)
// but it's kept here for local development.
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server is running at http://localhost:${PORT}`);
    });
}

module.exports = app; // Required for Vercel
