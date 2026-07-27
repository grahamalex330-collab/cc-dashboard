// Daily keep-alive ping — hit by Vercel Cron (see vercel.json "crons").
// Makes one trivial Supabase query so the free-tier project never hits the
// 7-day inactivity pause. Returns no household data, just a row count.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ ok: false, error: 'Supabase not configured' });
  }
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/cc_positions?select=id&limit=1`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (!resp.ok) throw new Error(`Supabase responded ${resp.status}`);
    const rows = await resp.json();
    return res.status(200).json({ ok: true, touched: rows.length, at: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
