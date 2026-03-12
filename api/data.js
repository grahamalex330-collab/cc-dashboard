// Vercel Serverless Function — proxies CC dashboard data to/from Supabase
// Set SUPABASE_URL and SUPABASE_KEY in Vercel environment variables

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TABLE = 'cc_dashboard';

const supaHeaders = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Prefer': 'return=representation',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const baseUrl = `${SUPABASE_URL}/rest/v1/${TABLE}`;

  try {
    // GET — load by household code
    if (req.method === 'GET') {
      const code = req.query.code;
      if (!code) return res.status(400).json({ error: 'Missing code parameter' });

      const response = await fetch(
        `${baseUrl}?profile_name=eq.${encodeURIComponent(code)}&limit=1`,
        { headers: supaHeaders }
      );
      const rows = await response.json();
      if (!response.ok) return res.status(response.status).json(rows);

      if (rows.length === 0) {
        return res.status(200).json({ data: null });
      }

      const row = rows[0];
      return res.status(200).json({
        data: {
          positions: typeof row.positions === 'string' ? JSON.parse(row.positions) : (row.positions || []),
          calls: typeof row.calls === 'string' ? JSON.parse(row.calls) : (row.calls || []),
          watchlist: typeof row.watchlist === 'string' ? JSON.parse(row.watchlist) : (row.watchlist || []),
          events: typeof row.events === 'string' ? JSON.parse(row.events) : (row.events || []),
          nextId: row.next_id || 1,
        }
      });
    }

    // POST — save by household code
    if (req.method === 'POST') {
      const { code, data } = req.body;
      if (!code) return res.status(400).json({ error: 'Missing code' });

      const row = {
        profile_name: code,
        positions: JSON.stringify(data?.positions || []),
        calls: JSON.stringify(data?.calls || []),
        watchlist: JSON.stringify(data?.watchlist || []),
        events: JSON.stringify(data?.events || []),
        next_id: data?.nextId || 1,
        updated_at: new Date().toISOString(),
      };

      // Check if profile exists
      const checkResp = await fetch(
        `${baseUrl}?profile_name=eq.${encodeURIComponent(code)}&limit=1`,
        { headers: supaHeaders }
      );
      const existing = await checkResp.json();

      let response;
      if (existing.length > 0) {
        response = await fetch(
          `${baseUrl}?profile_name=eq.${encodeURIComponent(code)}`,
          { method: 'PATCH', headers: supaHeaders, body: JSON.stringify(row) }
        );
      } else {
        response = await fetch(baseUrl, {
          method: 'POST',
          headers: supaHeaders,
          body: JSON.stringify(row),
        });
      }

      const result = await response.json();
      if (!response.ok) return res.status(response.status).json(result);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Supabase proxy error:', error);
    return res.status(500).json({ error: 'Database request failed' });
  }
}
