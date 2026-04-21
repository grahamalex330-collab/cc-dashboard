// Vercel Serverless Function — CC Dashboard data proxy
// NOW reads/writes from normalized tables (cc_positions, cc_calls, cc_watchlist, cc_events)
// BUT returns the same JSON shape the frontend expects: { data: { positions, calls, watchlist, events, nextId } }
// This means ZERO frontend changes needed for the migration.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supaHeaders = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Prefer': 'return=representation',
};

// snake_case → camelCase for frontend
const toPosition = (row) => ({
  id: row.id,
  ticker: row.ticker,
  shares: row.shares,
  costBasis: parseFloat(row.cost_basis),
  dateAcquired: row.date_acquired || '',
  removed: row.removed || false,
});

const toCall = (row) => ({
  id: row.id,
  ticker: row.ticker,
  strike: parseFloat(row.strike),
  expiry: row.expiry || '',
  expiration: row.expiry || '',
  premium: parseFloat(row.premium),
  contracts: row.contracts,
  status: row.status,
  dateOpened: row.date_opened || '',
  dateClosed: row.date_closed || '',
  closePrice: parseFloat(row.close_price || 0),
  totalPremium: row.total_premium != null ? parseFloat(row.total_premium) : null,
  totalCloseCost: row.total_close_cost != null ? parseFloat(row.total_close_cost) : null,
});

const toWatchlist = (row) => ({
  id: row.id,
  ticker: row.ticker,
  sector: row.sector || '',
  price: row.price ? parseFloat(row.price) : 0,
  volScore: row.vol_score,
  beta: row.beta ? parseFloat(row.beta) : 0,
  move30d: row.move_30d || '',
  range52w: row.range_52w || '',
  volumeVsAvg: row.volume_vs_avg || '',
  near52wHigh: row.near_52w_high || false,
  nextEarnings: row.next_earnings || '',
  marketCap: row.market_cap || '',
  why: row.why || '',
  dateScored: row.date_scored || '',
});

const toEvent = (row) => ({
  id: row.id,
  title: row.title,
  date: row.date,
  ticker: row.ticker || '',
});

// Helper: fetch rows from a table
async function fetchTable(table, household) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?household=eq.${encodeURIComponent(household)}&order=id.asc`,
    { headers: supaHeaders }
  );
  if (!resp.ok) throw new Error(`Failed to fetch ${table}: ${resp.status}`);
  return resp.json();
}

// Helper: get next available ID across all tables for a household
async function getNextId(household) {
  const tables = ['cc_positions', 'cc_calls', 'cc_watchlist', 'cc_events'];
  let maxId = 0;
  for (const table of tables) {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?household=eq.${encodeURIComponent(household)}&select=id&order=id.desc&limit=1`,
      { headers: supaHeaders }
    );
    const rows = await resp.json();
    if (rows.length > 0 && rows[0].id > maxId) maxId = rows[0].id;
  }
  return maxId + 1;
}

// Helper: upsert rows — delete all for household, then insert fresh
async function replaceTable(table, household, rows) {
  // Delete existing
  await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?household=eq.${encodeURIComponent(household)}`,
    { method: 'DELETE', headers: supaHeaders }
  );
  // Insert new rows (if any)
  if (rows.length > 0) {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}`,
      { method: 'POST', headers: supaHeaders, body: JSON.stringify(rows) }
    );
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Failed to insert into ${table}: ${resp.status} ${err}`);
    }
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    // ============================================
    // GET — load all data for a household code
    // Returns same shape: { data: { positions, calls, watchlist, events, nextId } }
    // ============================================
    if (req.method === 'GET') {
      const code = req.query.code;
      if (!code) return res.status(400).json({ error: 'Missing code parameter' });

      const [posRows, callRows, watchRows, eventRows] = await Promise.all([
        fetchTable('cc_positions', code),
        fetchTable('cc_calls', code),
        fetchTable('cc_watchlist', code),
        fetchTable('cc_events', code),
      ]);

      // If all tables empty, check if user exists in old table (first-time migration fallback)
      if (posRows.length === 0 && callRows.length === 0 && watchRows.length === 0 && eventRows.length === 0) {
        // Check old table
        const oldResp = await fetch(
          `${SUPABASE_URL}/rest/v1/cc_dashboard?profile_name=eq.${encodeURIComponent(code)}&limit=1`,
          { headers: supaHeaders }
        );
        const oldRows = await oldResp.json();
        if (oldRows.length > 0) {
          // Old data exists but hasn't been migrated — return it in old format
          // (This handles household codes other than 'coveredcalls' that weren't in the migration SQL)
          const row = oldRows[0];
          const parse = (val) => typeof val === 'string' ? JSON.parse(val) : (val || []);
          return res.status(200).json({
            data: {
              positions: parse(row.positions),
              calls: parse(row.calls),
              watchlist: parse(row.watchlist),
              events: parse(row.events),
              nextId: row.next_id || 1,
            }
          });
        }
        return res.status(200).json({ data: null });
      }

      const nextId = await getNextId(code);

      return res.status(200).json({
        data: {
          positions: posRows.map(toPosition),
          calls: callRows.map(toCall),
          watchlist: watchRows.map(toWatchlist),
          events: eventRows.map(toEvent),
          nextId,
        }
      });
    }

    // ============================================
    // POST — save all data for a household code
    // Accepts same shape: { code, data: { positions, calls, watchlist, events, nextId } }
    // Writes to normalized tables
    // ============================================
    if (req.method === 'POST') {
      const { code, data } = req.body;
      if (!code) return res.status(400).json({ error: 'Missing code' });

      const positions = (data?.positions || []).map(p => ({
        id: p.id,
        household: code,
        ticker: p.ticker,
        shares: p.shares,
        cost_basis: p.costBasis,
        date_acquired: p.dateAcquired || null,
        removed: p.removed || false,
      }));

      const calls = (data?.calls || []).map(c => ({
        id: c.id,
        household: code,
        ticker: c.ticker,
        strike: c.strike,
        expiry: c.expiry || c.expiration || null,
        premium: c.premium || 0,
        contracts: c.contracts || 1,
        status: c.status || 'open',
        date_opened: c.dateOpened || null,
        date_closed: c.dateClosed || null,
        close_price: c.closePrice || 0,
        total_premium: c.totalPremium != null ? c.totalPremium : null,
        total_close_cost: c.totalCloseCost != null ? c.totalCloseCost : null,
      }));

      const watchlist = (data?.watchlist || []).map(w => ({
        id: w.id,
        household: code,
        ticker: w.ticker,
        sector: w.sector || null,
        price: w.price || null,
        vol_score: w.volScore || null,
        beta: w.beta || null,
        move_30d: w.move30d || null,
        range_52w: w.range52w || null,
        volume_vs_avg: w.volumeVsAvg || null,
        near_52w_high: w.near52wHigh || false,
        next_earnings: w.nextEarnings || null,
        market_cap: w.marketCap || null,
        why: w.why || null,
        date_scored: w.dateScored || null,
      }));

      const events = (data?.events || []).map(e => ({
        id: e.id,
        household: code,
        title: e.title,
        date: e.date,
        ticker: e.ticker || null,
      }));

      // Replace all tables for this household
      await Promise.all([
        replaceTable('cc_positions', code, positions),
        replaceTable('cc_calls', code, calls),
        replaceTable('cc_watchlist', code, watchlist),
        replaceTable('cc_events', code, events),
      ]);

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Supabase proxy error:', error);
    return res.status(500).json({ error: error.message || 'Database request failed' });
  }
}
