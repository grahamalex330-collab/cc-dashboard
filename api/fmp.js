const FMP_KEY = process.env.FMP_API_KEY;
const BASE = "https://financialmodelingprep.com/stable";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!FMP_KEY) {
    return res.status(500).json({ error: "FMP_API_KEY not configured" });
  }

  const { action, tickers } = req.query;

  try {
    let url;
    switch (action) {
      case "quote":
        if (!tickers) return res.status(400).json({ error: "tickers required" });
        url = `${BASE}/quote?symbol=${tickers}&apikey=${FMP_KEY}`;
        break;
      case "profile":
        if (!tickers) return res.status(400).json({ error: "tickers required" });
        url = `${BASE}/profile?symbol=${tickers}&apikey=${FMP_KEY}`;
        break;
      case "actives":
        url = `${BASE}/stock_market/actives?apikey=${FMP_KEY}`;
        break;
      case "gainers":
        url = `${BASE}/stock_market/gainers?apikey=${FMP_KEY}`;
        break;
      default:
        return res.status(400).json({ error: "Invalid action" });
    }

    const resp = await fetch(url);
    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).json({ error: text });
    }
    const data = await resp.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
