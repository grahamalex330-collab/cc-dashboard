// Vercel Serverless Function — /api/prices
//
// Server-side price cache for CC Dashboard. Batched, market-aware, graceful on failure.
//
// Request:
//   GET /api/prices?tickers=HOOD,PLTR,AAPL
//
// Response:
//   {
//     prices: {
//       HOOD: { price: 52.30, change: 0.85, changePct: 1.65, fetchedAt: "2026-04-20T14:32:00Z", stale: false },
//       PLTR: { ... },
//       AAPL: null   // no data available anywhere
//     },
//     marketStatus: "open" | "closed",
//     anyStale: false,
//     serverTime: "2026-04-20T14:32:05Z"
//   }
//
// Cache TTL:
//   - 5 min during US market hours (9:30am–4:00pm ET, Mon–Fri)
//   - 60 min outside market hours (prices don't change, no point refreshing)
//
// Graceful degradation:
//   - If FMP call fails, returns last-known cached prices flagged stale: true
//   - Frontend can show "as of HH:MM" so user knows data is old
//   - Returns null for tickers with NO cached data AND failed FMP call

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const FMP_API_KEY = process.env.FMP_API_KEY;
const TABLE = "cc_price_cache";
const FMP_BASE = "https://financialmodelingprep.com/stable";

const CACHE_TTL_OPEN_MS = 5 * 60 * 1000;       // 5 min during market hours
const CACHE_TTL_CLOSED_MS = 60 * 60 * 1000;    // 60 min after hours

const supaHeaders = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
};

// Check if US stock market is currently open
// (Does not account for holidays — worst case we refresh 5-min instead of 60-min on Thanksgiving. Negligible.)
function isMarketOpen(now = new Date()) {
  const etStr = now.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const match = etStr.match(/^(\w+),?\s*(\d{2}):(\d{2})/);
  if (!match) return false;
  const [, weekday, hStr, mStr] = match;
  if (weekday === "Sat" || weekday === "Sun") return false;
  const minutes = parseInt(hStr, 10) * 60 + parseInt(mStr, 10);
  return minutes >= 570 && minutes < 960; // 9:30am (570) to 4:00pm (960)
}
// Yahoo Finance fallback. Used when FMP returns no data (e.g., recent spinoffs like GEV).
// Uses the v8/chart endpoint which is publicly accessible without auth/crumb.
async function fetchFromYahoo(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=2d`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cc-dashboard/1.0)' } });
    if (!resp.ok) return null;
    const data = await resp.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta || typeof meta.regularMarketPrice !== 'number') return null;
    const price = meta.regularMarketPrice;
    const prevClose = typeof meta.chartPreviousClose === 'number' ? meta.chartPreviousClose : meta.previousClose;
    const change = typeof prevClose === 'number' ? price - prevClose : 0;
    const changePct = typeof prevClose === 'number' && prevClose !== 0 ? (change / prevClose) * 100 : 0;
    return { price, change, changePct };
  } catch (e) {
    return null;
  }
}
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: "Supabase not configured" });
  }
  if (!FMP_API_KEY) {
    return res.status(500).json({ error: "FMP_API_KEY not configured" });
  }

  const tickersParam = req.query.tickers;
  if (!tickersParam) return res.status(400).json({ error: "Missing tickers param" });

  const tickers = [...new Set(
    String(tickersParam).split(",").map(t => t.trim().toUpperCase()).filter(Boolean)
  )];
  if (tickers.length === 0) return res.status(400).json({ error: "No valid tickers" });

  const now = new Date();
  const marketOpen = isMarketOpen(now);
  const ttl = marketOpen ? CACHE_TTL_OPEN_MS : CACHE_TTL_CLOSED_MS;
  const cutoffIso = new Date(now.getTime() - ttl).toISOString();

  // 1. Read cache for all requested tickers
  const inClause = tickers.map(t => `"${t}"`).join(",");
  const cacheUrl = `${SUPABASE_URL}/rest/v1/${TABLE}?ticker=in.(${inClause})&select=*`;
  const cacheMap = {};
  try {
    const cacheResp = await fetch(cacheUrl, { headers: supaHeaders });
    if (cacheResp.ok) {
      const rows = await cacheResp.json();
      rows.forEach(r => { cacheMap[r.ticker] = r; });
    }
  } catch (e) {
    console.error("Cache read failed:", e);
    // Continue — we'll just hit FMP for everything
  }

  // 2. Partition: which tickers need a refresh?
  const stale = [];
  tickers.forEach(t => {
    const cached = cacheMap[t];
    if (!cached || !cached.fetched_at || cached.fetched_at < cutoffIso) {
      stale.push(t);
    }
  });

  // 3. Refetch stale tickers from FMP — free tier requires ONE call per ticker.
  //    Fan out in parallel. Cache-miss storm avoidance isn't a concern at current scale.
  const fmpResults = {};
  let fmpFailed = false;
  if (stale.length > 0) {
    const fmpCalls = await Promise.all(stale.map(async (ticker) => {
      try {
        const url = `${FMP_BASE}/quote?symbol=${ticker}&apikey=${FMP_API_KEY}`;
        const resp = await fetch(url);
        if (!resp.ok) return { ticker, ok: false };
        const data = await resp.json();
        if (!Array.isArray(data) || !data[0] || typeof data[0].price !== "number") {
          return { ticker, ok: false };
        }
        const q = data[0];
        // FMP free tier returns price + change only; compute changePct ourselves.
        const change = typeof q.change === "number" ? q.change : 0;
        const prevClose = q.price - change;
        const changePct = prevClose !== 0 ? (change / prevClose) * 100 : 0;
        return { ticker, ok: true, price: q.price, change, changePct };
      } catch (e) {
        return { ticker, ok: false };
      }
    }));
    fmpCalls.forEach(r => {
      if (r.ok) {
        fmpResults[r.ticker] = { price: r.price, change: r.change, changePct: r.changePct };
      } else {
        fmpFailed = true; // at least one call failed — surface to frontend
      }
    });

    // Yahoo Finance fallback for any tickers FMP couldn't return
    const yahooFailures = stale.filter(t => !fmpResults[t]);
    if (yahooFailures.length > 0) {
      const yahooCalls = await Promise.all(yahooFailures.map(async (ticker) => ({
        ticker,
        result: await fetchFromYahoo(ticker)
      })));
      yahooCalls.forEach(({ ticker, result }) => {
        if (result) {
          fmpResults[ticker] = result;
        }
      });
    }
  }

  // 4. Upsert fresh FMP results into cache
  const upsertRows = Object.entries(fmpResults).map(([ticker, d]) => ({
    ticker,
    price: d.price,
    day_change: d.change,
    day_change_pct: d.changePct,
    fetched_at: now.toISOString(),
  }));
  if (upsertRows.length > 0) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
        method: "POST",
        headers: {
          ...supaHeaders,
          "Prefer": "resolution=merge-duplicates",
        },
        body: JSON.stringify(upsertRows),
      });
    } catch (e) {
      console.error("Cache upsert failed:", e);
      // Non-fatal: we still return the fresh prices even if cache write fails
    }
  }

  // 5. Build response — prefer fresh FMP results, fall back to cached, null if neither
  const prices = {};
  let anyStale = false;
  tickers.forEach(t => {
    if (fmpResults[t]) {
      prices[t] = {
        price: fmpResults[t].price,
        change: fmpResults[t].change,
        changePct: fmpResults[t].changePct,
        fetchedAt: now.toISOString(),
        stale: false,
      };
    } else if (cacheMap[t] && cacheMap[t].price != null) {
      const cacheIsStale = !cacheMap[t].fetched_at || cacheMap[t].fetched_at < cutoffIso;
      prices[t] = {
        price: parseFloat(cacheMap[t].price),
        change: cacheMap[t].day_change != null ? parseFloat(cacheMap[t].day_change) : 0,
        changePct: cacheMap[t].day_change_pct != null ? parseFloat(cacheMap[t].day_change_pct) : 0,
        fetchedAt: cacheMap[t].fetched_at,
        stale: cacheIsStale,
      };
      if (cacheIsStale) anyStale = true;
    } else {
      prices[t] = null;
    }
  });

  return res.status(200).json({
    prices,
    marketStatus: marketOpen ? "open" : "closed",
    anyStale,
    fmpFailed,
    serverTime: now.toISOString(),
  });
}
