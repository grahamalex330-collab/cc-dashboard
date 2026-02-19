import React, { useState, useEffect, useMemo, useCallback } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Area } from "recharts";
import { Plus, X, TrendingUp, DollarSign, Calendar, AlertTriangle, ChevronDown, ChevronRight, BarChart3, List, Eye, Shield, Clock, Target, Trash2, Check, Edit2, RefreshCw, Zap, HelpCircle, Info } from "lucide-react";

const TABS = ["Dashboard", "Positions", "Trade Log", "Watchlist", "Analytics", "Tax View"];

const GLOSSARY = {
  coveredCall: "A strategy where you own shares and sell (write) a call option against them. You collect premium upfront in exchange for agreeing to sell your shares at the strike price if the option is exercised.",
  strike: "The price at which your shares will be sold if the option is exercised (assigned). Choose a strike above the current price to stay 'out of the money.'",
  premium: "The cash you receive upfront for selling the call option. This is yours to keep no matter what happens. Quoted per share — multiply by 100 for the total per contract.",
  dte: "Days to Expiration — how many calendar days until the option expires. Weekly options typically have 5-7 DTE. Less time = faster decay in your favor.",
  ivRank: "Implied Volatility Rank — measures where current IV sits relative to the past year (0-100). Above 50 means IV is historically high, which means richer premiums for selling calls.",
  currentIV: "Implied Volatility — the market's expectation of how much the stock will move. Higher IV = higher premiums. Expressed as an annualized percentage.",
  costBasis: "Your average purchase price per share. Premium collected from covered calls effectively lowers this over time.",
  effectiveBasis: "Your cost basis minus all premium collected. This is your true break-even price after accounting for income from selling calls.",
  otm: "Out of the Money — when the stock price is below your strike price. This is where you want your call to stay so it expires worthless and you keep the shares + premium.",
  itm: "In the Money — when the stock price is above your strike price. Your call is at risk of being assigned, meaning your shares could be called away.",
  assignment: "When the option buyer exercises their right to buy your shares at the strike price. This happens when the call is ITM at expiration (or sometimes early).",
  rollForward: "Closing your current call (buying to close) and simultaneously opening a new one at a later expiration and/or different strike. Used to avoid assignment or collect more premium.",
  washSale: "An IRS rule: if you sell a security at a loss and buy a 'substantially identical' security within 30 days before or after, the loss is disallowed for tax purposes.",
  annualizedYield: "Your premium income projected over a full year. Calculated as: (premium collected / capital deployed) × (365 / days active). Helps compare returns across different holding periods.",
  contracts: "Each options contract represents 100 shares. So 1 contract on a $50 stock covers $5,000 worth of shares.",
  breakeven: "The stock price at which you neither make nor lose money on the combined position (shares + call). Equals your cost basis minus premium received.",
  assignmentRisk: "How likely your call is to be assigned. Based on how close the stock price is to your strike. ITM = very high risk. Within 2% = high. 2-5% = moderate. 5%+ = low.",
  capitalUtilization: "What percentage of your stock positions currently have calls written against them. Higher = more income generation. 100% means every position is covered.",
  concentration: "How much of your total portfolio is in a single stock. Over 40% in one name increases your risk if that stock drops significantly.",
  volumeVsAvg: "Trading volume compared to the stock's average daily volume. Values above 1.5x suggest unusual activity — often driven by news, earnings, or institutional interest — which typically means better options liquidity and premiums.",
  volScore: "Volatility Score (0-100) — a composite measure of how attractive a stock is for selling covered calls. Based on: 52-week price range (25 pts), 30-day momentum (20 pts), beta (20 pts), upcoming catalysts like earnings (20 pts), and unusual volume (15 pts). Higher = fatter premiums likely.",
  beta: "Beta measures how much a stock moves relative to the S&P 500. Beta of 1.0 = moves with the market. Above 1.5 = significantly more volatile (better CC premiums). Below 0.8 = relatively stable.",
  range52w: "The stock's 52-week price range expressed as a percentage of current price. A wider range indicates higher historical volatility. Stocks with 50%+ range tend to have richer option premiums.",
};

// ── FMP helpers ──
const computeVolScore = ({ price, yearHigh, yearLow, beta, move30dPct, volume, avgVolume, daysToEarnings }) => {
  const rangePct = price > 0 ? ((yearHigh - yearLow) / price) * 100 : 0;
  const rangeScore = Math.min(25, rangePct * 0.25);
  const absMov = Math.abs(move30dPct || 0);
  const momentumScore = Math.min(20, absMov * 0.67);
  const b = beta || 1;
  const betaScore = b >= 2 ? 20 : b >= 1.5 ? 16 : b >= 1.2 ? 12 : b >= 1.0 ? 8 : b >= 0.7 ? 4 : 2;
  let catalystScore = 0;
  if (daysToEarnings != null && daysToEarnings >= 0) {
    catalystScore = daysToEarnings <= 3 ? 20 : daysToEarnings <= 7 ? 16 : daysToEarnings <= 14 ? 12 : daysToEarnings <= 30 ? 6 : 0;
  }
  const volRatio = avgVolume > 0 ? volume / avgVolume : 1;
  const volumeScore = volRatio >= 3 ? 15 : volRatio >= 2 ? 12 : volRatio >= 1.5 ? 9 : volRatio >= 1.0 ? 5 : 2;
  return Math.round(rangeScore + momentumScore + betaScore + catalystScore + volumeScore);
};

const fmtMktCap = (mc) => {
  if (!mc) return "—";
  if (mc >= 1e12) return `${(mc / 1e12).toFixed(1)}T`;
  if (mc >= 1e9) return `${(mc / 1e9).toFixed(0)}B`;
  if (mc >= 1e6) return `${(mc / 1e6).toFixed(0)}M`;
  return String(mc);
};

const generateWhy = ({ volRatio, beta, daysToEarnings, move30dPct, rangePct }) => {
  const r = [];
  if (volRatio >= 2) r.push(`Volume ${volRatio.toFixed(1)}x avg`);
  if (beta >= 1.5) r.push(`High beta ${beta.toFixed(2)}`);
  if (daysToEarnings != null && daysToEarnings <= 14) r.push(`Earnings in ${daysToEarnings}d`);
  if (Math.abs(move30dPct) >= 10) r.push(`${move30dPct > 0 ? "Up" : "Down"} ${Math.abs(move30dPct).toFixed(0)}% in 30d`);
  if (rangePct >= 50) r.push(`Wide 52w range (${rangePct.toFixed(0)}%)`);
  return r.join(" · ") || "Active options candidate";
};

const enrichFromFMP = (q, p) => {
  const price = q.price || 0;
  const yearHigh = q.yearHigh || 0;
  const yearLow = q.yearLow || 0;
  const beta = p?.beta || 1;
  const volume = q.volume || 0;
  const avgVolume = q.avgVolume || 1;
  const priceAvg50 = q.priceAvg50 || price;
  const move30dPct = priceAvg50 > 0 ? ((price - priceAvg50) / priceAvg50) * 100 : 0;
  const rangePct = price > 0 ? ((yearHigh - yearLow) / price) * 100 : 0;
  const volRatio = avgVolume > 0 ? volume / avgVolume : 1;
  let daysToEarnings = null;
  if (q.earningsAnnouncement) {
    const d = Math.ceil((new Date(q.earningsAnnouncement) - new Date()) / 86400000);
    if (d >= 0) daysToEarnings = d;
  }
  const volScore = computeVolScore({ price, yearHigh, yearLow, beta, move30dPct, volume, avgVolume, daysToEarnings });
  return {
    sector: p?.sector || "",
    price,
    volScore,
    beta: beta ? parseFloat(beta.toFixed(2)) : 0,
    move30d: `${move30dPct >= 0 ? "+" : ""}${move30dPct.toFixed(1)}%`,
    range52w: `${rangePct.toFixed(0)}%`,
    volumeVsAvg: `${volRatio.toFixed(1)}x`,
    near52wHigh: yearHigh > 0 && price >= yearHigh * 0.9,
    nextEarnings: daysToEarnings != null && daysToEarnings <= 30 ? `${daysToEarnings}d` : "",
    marketCap: fmtMktCap(q.marketCap),
    why: generateWhy({ volRatio, beta, daysToEarnings, move30dPct, rangePct }),
  };
};

const Tip = ({ term, children }) => {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const iconRef = React.useRef(null);
  const def = GLOSSARY[term];
  if (!def) return children || null;

  const handleEnter = () => {
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      setPos({ top: rect.top - 8, left: rect.left + rect.width / 2 });
    }
    setShow(true);
  };

  return (
    <span className="inline-flex items-center gap-1 relative">
      {children}
      <span
        ref={iconRef}
        className="inline-flex cursor-help"
        onMouseEnter={handleEnter}
        onMouseLeave={() => setShow(false)}
        onClick={(e) => {
          e.stopPropagation();
          if (!show && iconRef.current) {
            const rect = iconRef.current.getBoundingClientRect();
            setPos({ top: rect.top - 8, left: rect.left + rect.width / 2 });
          }
          setShow(!show);
        }}
      >
        <HelpCircle size={13} className="text-gray-400 hover:text-gray-600 transition-colors" />
      </span>
      {show && (
        <span
          className="fixed z-[9999] w-72 p-3 bg-gray-900 text-white text-xs leading-relaxed rounded-lg shadow-lg pointer-events-none"
          style={{ top: pos.top, left: pos.left, transform: 'translate(-50%, -100%)' }}
        >
          <span className="font-semibold block mb-1">{term.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim()}</span>
          {def}
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-gray-900" />
        </span>
      )}
    </span>
  );
};

const EtradeTip = ({ children }) => (
  <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 flex items-start gap-2.5">
    <Info size={16} className="text-indigo-500 mt-0.5 shrink-0" />
    <div className="text-xs text-indigo-800 leading-relaxed">{children}</div>
  </div>
);

const formatCurrency = (n) => {
  if (n === undefined || n === null || isNaN(n)) return "$0.00";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
};
const formatPct = (n) => (n === undefined || isNaN(n) ? "0.00%" : (n * 100).toFixed(2) + "%");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const parseLocalDate = (s) => {
  if (!s) return new Date();
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const daysBetween = (a, b) => Math.round((parseLocalDate(b) - parseLocalDate(a)) / 86400000);
const isExpired = (exp) => new Date(exp) < new Date(today());
const grossPrem = (c) => c.totalPremium != null ? c.totalPremium : c.premium * c.contracts * 100;
const closeCostOf = (c) => c.totalCloseCost != null ? c.totalCloseCost : (c.status === "closed" ? (c.closePrice || 0) * c.contracts * 100 : 0);
const netPrem = (c) => grossPrem(c) - closeCostOf(c);

const EMPTY_STATE = {
  positions: [],
  calls: [],
  watchlist: [],
  events: [],
  nextId: 1,
};

const StatusBadge = ({ status }) => {
  const colors = {
    open: "bg-blue-100 text-blue-800",
    expired: "bg-green-100 text-green-800",
    closed: "bg-yellow-100 text-yellow-800",
    assigned: "bg-red-100 text-red-800",
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colors[status] || "bg-gray-100 text-gray-700"}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
};

const Card = ({ children, className = "" }) => (
  <div className={`bg-white rounded-xl border border-gray-200 shadow-sm ${className}`}>{children}</div>
);

const StatCard = ({ icon: Icon, label, value, sub, color = "text-gray-900" }) => (
  <Card className="p-5">
    <div className="flex items-start justify-between">
      <div>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
        <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      </div>
      <div className="p-2 bg-gray-50 rounded-lg">
        <Icon size={20} className="text-gray-400" />
      </div>
    </div>
  </Card>
);

const Modal = ({ open, onClose, title, children }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  );
};

const Field = ({ label, children }) => (
  <div className="space-y-1">
    <label className="text-xs font-medium text-gray-600">{label}</label>
    {children}
  </div>
);

const Input = (props) => (
  <input {...props} className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none ${props.className || ""}`} />
);

const Select = ({ options, ...props }) => (
  <select {...props} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
    {options.map((o) => (
      <option key={o.value} value={o.value}>{o.label}</option>
    ))}
  </select>
);

const Btn = ({ children, variant = "primary", size = "md", ...props }) => {
  const base = "inline-flex items-center justify-center font-medium rounded-lg transition-colors gap-1.5";
  const variants = {
    primary: "bg-gray-900 text-white hover:bg-gray-800",
    secondary: "bg-gray-100 text-gray-700 hover:bg-gray-200",
    danger: "bg-red-50 text-red-700 hover:bg-red-100",
    ghost: "text-gray-600 hover:bg-gray-100",
  };
  const sizes = { sm: "text-xs px-2.5 py-1.5", md: "text-sm px-4 py-2" };
  return <button {...props} className={`${base} ${variants[variant]} ${sizes[size]} ${props.className || ""}`}>{children}</button>;
};

export default function CoveredCallDashboard() {
  const [householdCode, setHouseholdCode] = useState(() => localStorage.getItem("cc_household_code") || "");
  const [codeInput, setCodeInput] = useState("");
  const [joined, setJoined] = useState(() => !!localStorage.getItem("cc_household_code"));

  const [data, setData] = useState(EMPTY_STATE);
  const [tab, setTab] = useState("Dashboard");
  const [loading, setLoading] = useState(true);
  const [showAddPosition, setShowAddPosition] = useState(false);
  const [showWriteCall, setShowWriteCall] = useState(false);
  const [showLogPast, setShowLogPast] = useState(false);
  const [editingCall, setEditingCall] = useState(null);
  const [showCloseCall, setShowCloseCall] = useState(null);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [showAddWatchlist, setShowAddWatchlist] = useState(false);
  const [writeCallTicker, setWriteCallTicker] = useState("");
  const [editingPosition, setEditingPosition] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [scannerData, setScannerData] = useState(null);
  const [scannerLoading, setScannerLoading] = useState(false);
  const [scannerTimestamp, setScannerTimestamp] = useState(null);
  const [scannerError, setScannerError] = useState(null);
  const [watchlistScoresLoading, setWatchlistScoresLoading] = useState(false);
  const [livePrices, setLivePrices] = useState({});
  const [pricesLoading, setPricesLoading] = useState(false);
  const [pricesTimestamp, setPricesTimestamp] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null); // "saving" | "saved" | "error"
  const [showImport, setShowImport] = useState(false);

  const fetchLivePrices = useCallback(async () => {
    const callTickers = data.calls.filter(c => c.status === "open").map(c => c.ticker);
    const posTickers = data.positions.filter(p => !p.removed).map(p => p.ticker);
    const tickers = [...new Set([...callTickers, ...posTickers])];
    if (tickers.length === 0) return;
    setPricesLoading(true);
    try {
      const promises = tickers.map(t =>
        fetch(`/api/fmp?action=quote&tickers=${t}`).then(r => r.json()).then(d => (Array.isArray(d) && d[0]) || null).catch(() => null)
      );
      const results = await Promise.all(promises);
      const prices = {};
      results.forEach(q => { if (q?.symbol && q.price) prices[q.symbol] = q.price; });
      setLivePrices(prices);
      setPricesTimestamp(new Date().toISOString());
    } catch (err) { console.error("Price fetch error:", err); }
    setPricesLoading(false);
  }, [data.calls, data.positions]);

  // Load data from API
  useEffect(() => {
    if (!joined || !householdCode) return;
    (async () => {
      try {
        const res = await fetch(`/api/data?code=${encodeURIComponent(householdCode)}`);
        const json = await res.json();
        if (json.data) setData(json.data);
      } catch (err) { console.error("Load error:", err); }
      setLoading(false);
    })();
  }, [joined, householdCode]);

  // Save data to API
  const save = useCallback(async (newData) => {
    setData(newData);
    setSyncStatus("saving");
    try {
      await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: householdCode, data: newData }),
      });
      setSyncStatus("saved");
      setTimeout(() => setSyncStatus(null), 2000);
    } catch {
      setSyncStatus("error");
    }
  }, [householdCode]);

  // Join handler
  const handleJoin = () => {
    const code = codeInput.trim().toLowerCase();
    if (code.length < 2) return;
    setHouseholdCode(code);
    localStorage.setItem("cc_household_code", code);
    setJoined(true);
  };

  // Leave household
  const handleLeave = () => {
    localStorage.removeItem("cc_household_code");
    setHouseholdCode("");
    setJoined(false);
    setData(EMPTY_STATE);
    setCodeInput("");
    setLoading(true);
  };

  // Household code entry screen
  if (!joined) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-md w-full space-y-6">
          <div className="text-center">
            <div className="w-12 h-12 bg-gray-900 rounded-xl flex items-center justify-center mx-auto mb-4">
              <TrendingUp className="text-white" size={24} />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Covered Call Dashboard</h1>
            <p className="text-sm text-gray-500 mt-2">Enter a household code to get started. Anyone with the same code shares the same data.</p>
          </div>
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">Household Code</label>
            <input
              type="text"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              placeholder="e.g. smith-family"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent text-lg"
              autoFocus
            />
            <p className="text-xs text-gray-400">Letters, numbers, and dashes only. Share this code with your partner so you see the same dashboard.</p>
          </div>
          <button
            onClick={handleJoin}
            disabled={codeInput.trim().length < 2}
            className="w-full py-3 bg-gray-900 text-white rounded-xl font-medium hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Enter Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Scanner: load cache on mount
  useEffect(() => {
    (async () => {
      try {
        const raw = localStorage.getItem("cc_scanner_cache");
        if (raw) {
          const cached = JSON.parse(raw);
          const cachedDate = cached.timestamp?.slice(0, 10);
          const todayDate = today();
          if (cachedDate === todayDate) {
            setScannerData(cached.stocks);
            setScannerTimestamp(cached.timestamp);
          }
        }
      } catch {}
    })();
  }, []);

  // Auto-fetch live prices when on Dashboard with open calls (5-min cache)
  useEffect(() => {
    const hasOpenCalls = data.calls.some(c => c.status === "open");
    const cacheAge = pricesTimestamp ? (Date.now() - new Date(pricesTimestamp).getTime()) / 60000 : 999;
    if (tab === "Dashboard" && hasOpenCalls && !pricesLoading && !loading && cacheAge > 5) {
      fetchLivePrices();
    }
  }, [tab, loading, data.calls]);

  const fetchScannerData = useCallback(async () => {
    setScannerLoading(true);
    setScannerError(null);
    try {
      const existingTickers = [
        ...data.watchlist.map(w => w.ticker.toUpperCase()),
        ...data.positions.map(p => p.ticker.toUpperCase()),
      ];
      const excludeNote = existingTickers.length > 0 ? ` Exclude: ${existingTickers.join(", ")}.` : "";
      const response = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 2000,
          system: `You are a stock screener. Search the web for 10 US stocks that are good covered call candidates right now — look for high options volume, big recent price moves, or upcoming earnings. Market cap over $2B, price over $10.

IMPORTANT: Your ENTIRE response must be a valid JSON array and nothing else. No explanation, no markdown, no text before or after. Just the JSON array.

Format: [{"ticker":"XXX","sector":"Tech","price":45.2,"marketCap":"12B","volScore":78,"volumeVsAvg":"2.3x","move30d":"+15%","near52wHigh":true,"nextEarnings":"Feb 25","why":"One sentence reason"}]

volScore should be 0-100 estimating covered call attractiveness based on volatility, options activity, and catalysts.`,
          messages: [
            { role: "user", content: `Top 10 CC candidates now.${excludeNote} Date: ${new Date().toLocaleDateString()}.` }
          ],
          tools: [{ type: "web_search_20250305", name: "web_search" }],
        }),
      });
      const result = await response.json();
      console.log("Scanner API result:", JSON.stringify(result).slice(0, 500));
      if (!response.ok) {
        setScannerError(result?.error?.message || `Error ${response.status}`);
        setScannerLoading(false);
        return;
      }
      const text = (result.content || []).map(i => i.type === "text" ? i.text : "").filter(Boolean).join("\n");
      const clean = text.replace(/```json|```/g, "").trim();
      let parsed;
      try { parsed = JSON.parse(clean); } catch {
        // Try to find JSON array in the response
        const m = clean.match(/\[[\s\S]*?\](?=[^[\]]*$)/);
        if (m) {
          try { parsed = JSON.parse(m[0]); } catch {}
        }
        // If still no luck, try finding individual JSON objects and wrapping them
        if (!parsed) {
          const objects = [...clean.matchAll(/\{[^{}]*"ticker"[^{}]*\}/g)].map(m => {
            try { return JSON.parse(m[0]); } catch { return null; }
          }).filter(Boolean);
          if (objects.length > 0) parsed = objects;
        }
        if (!parsed) throw new Error("Could not parse response");
      }
      console.log("Scanner parsed:", parsed?.length, "stocks");
      if (Array.isArray(parsed) && parsed.length > 0) {
        setScannerData(parsed);
        setScannerTimestamp(new Date().toISOString());
        try { localStorage.setItem("cc_scanner_cache", JSON.stringify({ stocks: parsed, timestamp: new Date().toISOString() })); } catch {}
      }
    } catch (err) {
      console.error("Scanner error:", err);
      setScannerError(err.message || "Failed to load");
    }
    setScannerLoading(false);
  }, [data.watchlist, data.positions]);

  const fetchWatchlistScores = useCallback(async () => {
    const tickers = data.watchlist.map(w => w.ticker.toUpperCase());
    if (tickers.length === 0) return;
    setWatchlistScoresLoading(true);
    try {
      const results = await Promise.all(tickers.map(async (t) => {
        try {
          const [qResp, pResp] = await Promise.all([
            fetch(`/api/fmp?action=quote&tickers=${t}`),
            fetch(`/api/fmp?action=profile&tickers=${t}`),
          ]);
          const q = await qResp.json().then(d => Array.isArray(d) && d[0] || null);
          const p = await pResp.json().then(d => Array.isArray(d) && d[0] || null);
          return { ticker: t, q, p };
        } catch { return { ticker: t, q: null, p: null }; }
      }));
      const updated = data.watchlist.map(w => {
        const r = results.find(r => r.ticker === w.ticker.toUpperCase());
        if (!r?.q) return w;
        const enriched = enrichFromFMP(r.q, r.p);
        return { ...w, ...enriched, dateScored: today() };
      });
      setData(prev => ({ ...prev, watchlist: updated }));
    } catch (err) { console.error("Watchlist scores error:", err); }
    setWatchlistScoresLoading(false);
  }, [data.watchlist]);

  const nextId = () => {
    const id = data.nextId;
    return id;
  };

  const addPosition = (pos) => {
    const id = data.nextId;
    save({ ...data, positions: [...data.positions, { ...pos, id }], nextId: id + 1 });
  };

  const updatePosition = (id, updates) => {
    save({ ...data, positions: data.positions.map((p) => (p.id === id ? { ...p, ...updates } : p)) });
  };

  const removePosition = (id) => {
    save({ ...data, positions: data.positions.filter((p) => p.id !== id) });
  };

  const addCall = (call) => {
    const id = data.nextId;
    save({ ...data, calls: [...data.calls, { ...call, id, status: "open" }], nextId: id + 1 });
  };

  const addPastCall = (call) => {
    const id = data.nextId;
    save({ ...data, calls: [...data.calls, { ...call, id }], nextId: id + 1 });
  };

  const updateCall = (id, updates) => {
    save({ ...data, calls: data.calls.map(c => c.id === id ? { ...c, ...updates } : c) });
  };

  const closeCall = (id, action, closePrice = 0) => {
    save({
      ...data,
      calls: data.calls.map((c) =>
        c.id === id ? { ...c, status: action, dateClosed: today(), closePrice: parseFloat(closePrice) || 0 } : c
      ),
    });
  };

  const addWatchlistItem = (item) => {
    const id = data.nextId;
    save({ ...data, watchlist: [...data.watchlist, { ...item, id }], nextId: id + 1 });
  };

  const removeWatchlistItem = (id) => {
    save({ ...data, watchlist: data.watchlist.filter((w) => w.id !== id) });
  };

  const addEvent = (event) => {
    const id = data.nextId;
    save({ ...data, events: [...data.events, { ...event, id }], nextId: id + 1 });
  };

  const removeEvent = (id) => {
    save({ ...data, events: data.events.filter((e) => e.id !== id) });
  };

  // Derived
  const activePositions = data.positions;
  const openCalls = data.calls.filter((c) => c.status === "open");
  const closedCalls = data.calls.filter((c) => c.status !== "open");
  const totalPremiumCollected = data.calls.reduce((sum, c) => {
    const prem = grossPrem(c);
    if (c.status === "closed") return sum + prem - closeCostOf(c);
    if (c.status === "open") return sum;
    return sum + prem;
  }, 0);
  const totalCapitalDeployed = activePositions.reduce((sum, p) => sum + p.costBasis * p.shares, 0);
  const activeCalls = openCalls.length;

  const upcomingEvents = data.events
    .filter((e) => new Date(e.date) >= new Date(today()))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 8);

  // Weekly premium data for charts
  const premiumByWeek = useMemo(() => {
    const weeks = {};
    data.calls.filter(c => c.status !== "open").forEach((c) => {
      const dateStr = c.dateClosed || c.dateOpened;
      const [y, m, d] = (dateStr || "").split("-").map(Number);
      if (!y) return;
      const dt = new Date(y, m - 1, d);
      const weekStart = new Date(dt);
      weekStart.setDate(dt.getDate() - dt.getDay());
      const key = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, "0")}-${String(weekStart.getDate()).padStart(2, "0")}`;
      const net = netPrem(c);
      weeks[key] = (weeks[key] || 0) + net;
    });
    const sorted = Object.entries(weeks).sort(([a], [b]) => a.localeCompare(b));
    let cum = 0;
    return sorted.map(([week, amount]) => {
      cum += amount;
      return { week: week.slice(5), amount: Math.round(amount * 100) / 100, cumulative: Math.round(cum * 100) / 100 };
    });
  }, [data.calls]);

  const premiumByMonth = useMemo(() => {
    const months = {};
    data.calls.filter(c => c.status !== "open").forEach((c) => {
      const dateStr = c.dateClosed || c.dateOpened;
      const key = (dateStr || "").slice(0, 7);
      if (!key || key.length < 7) return;
      const net = netPrem(c);
      months[key] = (months[key] || 0) + net;
    });
    const sorted = Object.entries(months).sort(([a], [b]) => a.localeCompare(b));
    let cum = 0;
    return sorted.map(([month, amount]) => {
      cum += amount;
      return { month, amount: Math.round(amount * 100) / 100, cumulative: Math.round(cum * 100) / 100 };
    });
  }, [data.calls]);

  // Tax
  const taxData = useMemo(() => {
    return data.calls.filter(c => c.status !== "open").map((c) => {
      const held = daysBetween(c.dateOpened, c.dateClosed || today());
      const net = netPrem(c);
      const treatment = held > 365 ? "Long-term" : "Short-term";
      // Simple wash sale flag: same ticker closed at a loss within 30 days of another buy
      const isLoss = net < 0;
      const nearbyTrades = data.calls.filter(
        (o) => o.id !== c.id && o.ticker === c.ticker && Math.abs(daysBetween(c.dateClosed || today(), o.dateOpened)) <= 30
      );
      const washSaleRisk = isLoss && nearbyTrades.length > 0;
      return { ...c, held, net, treatment, washSaleRisk };
    });
  }, [data.calls]);

  // Annualized yield
  const annualizedYield = useMemo(() => {
    if (totalCapitalDeployed === 0) return 0;
    const allDates = data.calls.map(c => c.dateOpened).filter(Boolean).sort();
    if (allDates.length === 0) return 0;
    const daysSinceFirst = daysBetween(allDates[0], today());
    if (daysSinceFirst <= 0) return 0;
    return (totalPremiumCollected / totalCapitalDeployed) * (365 / daysSinceFirst);
  }, [totalPremiumCollected, totalCapitalDeployed, data.calls]);

  // Weekly P&L summary
  const weeklyPL = useMemo(() => {
    const now = new Date();
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    const startKey = `${startOfWeek.getFullYear()}-${String(startOfWeek.getMonth() + 1).padStart(2, "0")}-${String(startOfWeek.getDate()).padStart(2, "0")}`;

    const thisWeekCalls = data.calls.filter(c => {
      if (c.status === "open") return false;
      const closed = c.dateClosed || c.dateOpened;
      return closed >= startKey;
    });
    const premium = thisWeekCalls.reduce((sum, c) => {
      const net = netPrem(c);
      return sum + net;
    }, 0);
    const callsWritten = data.calls.filter(c => {
      return (c.dateOpened || "") >= startKey;
    }).length;
    return { premium, trades: thisWeekCalls.length, callsWritten };
  }, [data.calls]);

  // Concentration analysis
  const concentration = useMemo(() => {
    if (activePositions.length === 0) return { positions: [], maxPct: 0, sectorConcentration: [], warning: null };
    
    // Group by ticker
    const grouped = {};
    activePositions.forEach(p => {
      const t = p.ticker.toUpperCase();
      if (!grouped[t]) grouped[t] = { ticker: p.ticker, value: 0 };
      grouped[t].value += p.costBasis * p.shares;
    });
    
    const positions = Object.values(grouped).map(g => ({
      ...g,
      pct: totalCapitalDeployed > 0 ? g.value / totalCapitalDeployed : 0,
    })).sort((a, b) => b.pct - a.pct);

    const maxPct = positions[0]?.pct || 0;
    const uniqueTickers = [...new Set(activePositions.map(p => p.ticker.toUpperCase()))];
    const coveredCount = uniqueTickers.filter(t => data.calls.some(c => c.status === "open" && c.ticker.toUpperCase() === t)).length;
    const utilizationPct = uniqueTickers.length > 0 ? coveredCount / uniqueTickers.length : 0;

    let warning = null;
    if (maxPct > 0.6) warning = { level: "high", msg: `${positions[0].ticker} is ${(maxPct * 100).toFixed(0)}% of your portfolio — heavy concentration risk.` };
    else if (maxPct > 0.4) warning = { level: "medium", msg: `${positions[0].ticker} is ${(maxPct * 100).toFixed(0)}% of portfolio — consider diversifying.` };

    return { positions, maxPct, utilizationPct, coveredCount, totalUnique: uniqueTickers.length, warning };
  }, [activePositions, totalCapitalDeployed, data.calls]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center">
                <TrendingUp size={16} className="text-white" />
              </div>
              <h1 className="text-lg font-bold text-gray-900">CoveredCall Tracker</h1>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 text-xs text-gray-400 mr-2">
                <span className="bg-gray-100 px-2 py-1 rounded-md font-mono">{householdCode}</span>
                {syncStatus === "saving" && <span className="text-yellow-600">Saving...</span>}
                {syncStatus === "saved" && <span className="text-green-600">✓ Saved</span>}
                {syncStatus === "error" && <span className="text-red-600">Save failed</span>}
                <button onClick={() => { const json = JSON.stringify(data, null, 2); navigator.clipboard.writeText(json); setSyncStatus("saved"); setTimeout(() => setSyncStatus(null), 2000); }} className="text-gray-400 hover:text-gray-600" title="Export data">↗</button>
                <button onClick={() => setShowImport(true)} className="text-gray-400 hover:text-gray-600" title="Import data">↙</button>
                <button onClick={handleLeave} className="text-gray-400 hover:text-gray-600 ml-1" title="Switch household">
                  <X size={14} />
                </button>
              </div>
              <Btn variant="secondary" size="sm" onClick={() => setShowAddPosition(true)}><Plus size={14} /> Add Stock</Btn>
              <Btn size="sm" onClick={() => { setWriteCallTicker(activePositions[0]?.ticker || ""); setShowWriteCall(true); }}><Edit2 size={14} /> Write Call</Btn>
            </div>
          </div>
          {/* Tabs */}
          <div className="flex gap-1 -mb-px overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  tab === t ? "border-gray-900 text-gray-900" : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* DASHBOARD TAB */}
        {tab === "Dashboard" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon={DollarSign} label="Total Premium" value={formatCurrency(totalPremiumCollected)} sub="Net collected" color="text-green-700" />
              <StatCard icon={Target} label="Active Calls" value={activeCalls} sub={`${activePositions.length} positions`} />
              <StatCard icon={TrendingUp} label={<Tip term="annualizedYield">Annualized Yield</Tip>} value={formatPct(annualizedYield)} sub="On deployed capital" color={annualizedYield > 0 ? "text-green-700" : "text-gray-900"} />
              <StatCard icon={DollarSign} label="Capital Deployed" value={formatCurrency(totalCapitalDeployed)} />
            </div>

            <div className="grid lg:grid-cols-3 gap-6">
              {/* Weekly P&L Summary */}
              <Card>
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="font-semibold text-gray-900">This Week</h3>
                </div>
                <div className="p-5 space-y-4">
                  <div className="text-center">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Premium Collected</p>
                    <p className={`text-3xl font-bold mt-1 ${weeklyPL.premium > 0 ? "text-green-700" : weeklyPL.premium < 0 ? "text-red-600" : "text-gray-400"}`}>
                      {weeklyPL.premium !== 0 ? formatCurrency(weeklyPL.premium) : "$0"}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-500">Calls Written</p>
                      <p className="text-lg font-bold text-gray-900">{weeklyPL.callsWritten}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-500">Calls Closed</p>
                      <p className="text-lg font-bold text-gray-900">{weeklyPL.trades}</p>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Capital Utilization & Concentration */}
              <Card className="lg:col-span-2">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="font-semibold text-gray-900">Portfolio Health</h3>
                </div>
                <div className="p-5 space-y-4">
                  {/* Utilization meter */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-gray-600"><Tip term="capitalUtilization">Capital Utilization</Tip></span>
                      <span className="text-xs text-gray-500">{concentration.coveredCount || 0} of {concentration.totalUnique || activePositions.length} positions covered</span>
                    </div>
                    <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${(concentration.utilizationPct || 0) >= 0.8 ? "bg-green-500" : (concentration.utilizationPct || 0) >= 0.5 ? "bg-blue-500" : "bg-yellow-500"}`}
                        style={{ width: `${Math.min(100, (concentration.utilizationPct || 0) * 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {(concentration.utilizationPct || 0) < 0.5 ? "Consider writing calls on uncovered positions to generate more income." :
                       (concentration.utilizationPct || 0) >= 1 ? "All positions covered — maximum income generation." :
                       "Good coverage. Look for opportunities on remaining positions."}
                    </p>
                  </div>

                  {/* Concentration breakdown */}
                  {concentration.positions.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-600 mb-2"><Tip term="concentration">Position Sizing</Tip></p>
                      <div className="space-y-2">
                        {concentration.positions.map((p) => (
                          <div key={p.ticker} className="flex items-center gap-3">
                            <span className="text-sm font-semibold w-14 text-gray-900">{p.ticker}</span>
                            <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${p.pct > 0.6 ? "bg-red-400" : p.pct > 0.4 ? "bg-yellow-400" : "bg-blue-400"}`}
                                style={{ width: `${Math.min(100, p.pct * 100)}%` }}
                              />
                            </div>
                            <span className="text-sm font-medium w-16 text-right text-gray-700">{(p.pct * 100).toFixed(1)}%</span>
                            <span className="text-xs text-gray-400 w-20 text-right">{formatCurrency(p.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Concentration warning */}
                  {concentration.warning && (
                    <div className={`rounded-lg p-3 flex items-start gap-2 ${
                      concentration.warning.level === "high" ? "bg-red-50 border border-red-200" : "bg-yellow-50 border border-yellow-200"
                    }`}>
                      <AlertTriangle size={16} className={concentration.warning.level === "high" ? "text-red-500 mt-0.5" : "text-yellow-600 mt-0.5"} />
                      <p className={`text-xs ${concentration.warning.level === "high" ? "text-red-700" : "text-yellow-700"}`}>
                        {concentration.warning.msg}
                      </p>
                    </div>
                  )}
                </div>
              </Card>
            </div>

            <div className="grid lg:grid-cols-3 gap-6">
              {/* Active Positions */}
              <Card className="lg:col-span-2">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="font-semibold text-gray-900">Active Positions</h3>
                </div>
                <div className="overflow-x-auto">
                  {activePositions.length === 0 ? (
                    <div className="p-8 text-center text-gray-400 text-sm">No positions yet. Add a stock to get started.</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-50">
                          <th className="px-5 py-3">Ticker</th>
                          <th className="px-5 py-3">Shares</th>
                          <th className="px-5 py-3">Cost Basis</th>
                          <th className="px-5 py-3">Total Cost</th>
                          <th className="px-5 py-3">Open Calls</th>
                          <th className="px-5 py-3">Premium Earned</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activePositions.map((p) => {
                          const pCalls = data.calls.filter((c) => c.ticker === p.ticker);
                          const pOpen = pCalls.filter((c) => c.status === "open").length;
                          const pEarned = pCalls.filter(c => c.status !== "open").reduce((s, c) => {
                            const net = netPrem(c);
                            return s + net;
                          }, 0);
                          return (
                            <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                              <td className="px-5 py-3 font-semibold text-gray-900">{p.ticker}</td>
                              <td className="px-5 py-3">{p.shares}</td>
                              <td className="px-5 py-3">{formatCurrency(p.costBasis)}</td>
                              <td className="px-5 py-3">{formatCurrency(p.costBasis * p.shares)}</td>
                              <td className="px-5 py-3">{pOpen > 0 ? <span className="text-blue-700 font-medium">{pOpen} open</span> : <span className="text-gray-400">—</span>}</td>
                              <td className="px-5 py-3 text-green-700 font-medium">{formatCurrency(pEarned)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </Card>

              {/* Upcoming Events */}
              <Card>
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">Upcoming Events</h3>
                  <Btn variant="ghost" size="sm" onClick={() => setShowAddEvent(true)}><Plus size={14} /></Btn>
                </div>
                <div className="divide-y divide-gray-50">
                  {upcomingEvents.length === 0 ? (
                    <div className="p-6 text-center text-gray-400 text-sm">No upcoming events.</div>
                  ) : (
                    upcomingEvents.map((e) => (
                      <div key={e.id} className="px-5 py-3 flex items-start gap-3">
                        <div className={`mt-0.5 p-1 rounded ${e.type === "earnings" ? "bg-orange-100" : e.type === "ex-div" ? "bg-purple-100" : "bg-blue-100"}`}>
                          {e.type === "earnings" ? <AlertTriangle size={14} className="text-orange-600" /> : e.type === "ex-div" ? <DollarSign size={14} className="text-purple-600" /> : <Calendar size={14} className="text-blue-600" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">{e.ticker} — {e.type === "earnings" ? "Earnings" : e.type === "ex-div" ? "Ex-Dividend" : e.type === "fed" ? "Fed Meeting" : e.description}</p>
                          <p className="text-xs text-gray-500">{e.date}</p>
                        </div>
                        <button onClick={() => removeEvent(e.id)} className="text-gray-300 hover:text-red-500"><X size={14} /></button>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </div>

            {/* Open Calls */}
            <Card>
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">Open Calls</h3>
                {openCalls.length > 0 && (
                  <div className="flex items-center gap-2">
                    {pricesTimestamp && (
                      <span className="text-xs text-gray-400">Prices: {new Date(pricesTimestamp).toLocaleTimeString()}</span>
                    )}
                    <Btn variant="secondary" size="sm" onClick={fetchLivePrices} disabled={pricesLoading}>
                      <RefreshCw size={12} className={pricesLoading ? "animate-spin" : ""} />
                      {pricesLoading ? "Updating..." : "Update Prices"}
                    </Btn>
                  </div>
                )}
              </div>
              <div className="overflow-x-auto">
                {openCalls.length === 0 ? (
                  <div className="p-8 text-center text-gray-400 text-sm">No open calls. Write a call against one of your positions.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-50">
                        <th className="px-5 py-3">Ticker</th>
                        <th className="px-5 py-3"><Tip term="strike">Strike</Tip></th>
                        <th className="px-5 py-3">Mkt Price</th>
                        <th className="px-5 py-3"><Tip term="assignmentRisk">Risk</Tip></th>
                        <th className="px-5 py-3">Expiration</th>
                        <th className="px-5 py-3"><Tip term="dte">DTE</Tip></th>
                        <th className="px-5 py-3"><Tip term="premium">Premium</Tip></th>
                        <th className="px-5 py-3"><Tip term="contracts">Contracts</Tip></th>
                        <th className="px-5 py-3">Total Premium</th>
                        <th className="px-5 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openCalls.map((c) => {
                        const dte = daysBetween(today(), c.expiration);
                        const expired = dte <= 0;
                        const mktPrice = livePrices[c.ticker] || c.currentPrice || null;
                        const distancePct = mktPrice && c.strike ? ((c.strike - mktPrice) / mktPrice) * 100 : null;

                        let riskLevel = "unknown";
                        let riskColor = "bg-gray-100 text-gray-500";
                        let riskLabel = "—";
                        if (distancePct !== null) {
                          if (distancePct < 0) { riskLevel = "itm"; riskColor = "bg-red-100 text-red-800"; riskLabel = "ITM"; }
                          else if (distancePct < 2) { riskLevel = "high"; riskColor = "bg-red-100 text-red-700"; riskLabel = "High"; }
                          else if (distancePct < 5) { riskLevel = "medium"; riskColor = "bg-yellow-100 text-yellow-800"; riskLabel = "Medium"; }
                          else { riskLevel = "low"; riskColor = "bg-green-100 text-green-800"; riskLabel = "Safe"; }
                        }

                        return (
                          <tr key={c.id} className={`border-b border-gray-50 ${riskLevel === "itm" ? "bg-red-50" : expired ? "bg-yellow-50" : "hover:bg-gray-50"}`}>
                            <td className="px-5 py-3 font-semibold">{c.ticker}</td>
                            <td className="px-5 py-3">{formatCurrency(c.strike)}</td>
                            <td className="px-5 py-3">
                              {mktPrice ? (
                                <span className={mktPrice > c.strike ? "text-red-600 font-medium" : "text-gray-700"}>
                                  {formatCurrency(mktPrice)}
                                </span>
                              ) : (
                                <span className="text-gray-400 text-xs">No data</span>
                              )}
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${riskColor}`}>{riskLabel}</span>
                                {distancePct !== null && distancePct >= 0 && (
                                  <span className="text-xs text-gray-400">{distancePct.toFixed(1)}% OTM</span>
                                )}
                                {distancePct !== null && distancePct < 0 && (
                                  <span className="text-xs text-red-500">{Math.abs(distancePct).toFixed(1)}% ITM</span>
                                )}
                              </div>
                            </td>
                            <td className="px-5 py-3">{c.expiration}</td>
                            <td className="px-5 py-3">{expired ? <span className="text-red-600 font-medium">Expired</span> : `${dte}d`}</td>
                            <td className="px-5 py-3">{formatCurrency(c.premium)}</td>
                            <td className="px-5 py-3">{c.contracts}</td>
                            <td className="px-5 py-3 text-green-700 font-medium">{formatCurrency(grossPrem(c))}</td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-1.5">
                                <button
                                  className="p-1.5 rounded-md hover:bg-gray-200 text-gray-400 hover:text-gray-700 transition-colors"
                                  onClick={() => setEditingCall(c)}
                                  title="Edit trade"
                                >
                                  <Edit2 size={13} />
                                </button>
                                <Btn variant="secondary" size="sm" onClick={() => setShowCloseCall(c)}>Close</Btn>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>
          </div>
        )}

        {/* POSITIONS TAB */}
        {tab === "Positions" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Stock Positions</h2>
              <Btn onClick={() => setShowAddPosition(true)}><Plus size={14} /> Add Stock</Btn>
            </div>
            <Card>
              <div className="overflow-x-auto">
                {activePositions.length === 0 ? (
                  <div className="p-12 text-center text-gray-400">No positions. Click "Add Stock" to begin.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                        <th className="px-5 py-3">Ticker</th>
                        <th className="px-5 py-3">Shares</th>
                        <th className="px-5 py-3"><Tip term="costBasis">Cost Basis</Tip></th>
                        <th className="px-5 py-3">Date Acquired</th>
                        <th className="px-5 py-3">Total Investment</th>
                        <th className="px-5 py-3">Total Calls</th>
                        <th className="px-5 py-3"><Tip term="premium">Premium Earned</Tip></th>
                        <th className="px-5 py-3"><Tip term="effectiveBasis">Effective Basis</Tip></th>
                        <th className="px-5 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activePositions.map((p) => {
                        const pCalls = data.calls.filter((c) => c.ticker === p.ticker);
                        const earned = pCalls.filter(c => c.status !== "open").reduce((s, c) => {
                          const net = netPrem(c);
                          return s + net;
                        }, 0);
                        const effectiveBasis = p.shares > 0 ? (p.costBasis * p.shares - earned) / p.shares : p.costBasis;
                        return (
                          <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-5 py-3 font-bold text-gray-900">{p.ticker}</td>
                            <td className="px-5 py-3">{p.shares}</td>
                            <td className="px-5 py-3">{formatCurrency(p.costBasis)}</td>
                            <td className="px-5 py-3 text-gray-500">{p.dateAcquired}</td>
                            <td className="px-5 py-3">{formatCurrency(p.costBasis * p.shares)}</td>
                            <td className="px-5 py-3">{pCalls.length}</td>
                            <td className="px-5 py-3 text-green-700 font-medium">{formatCurrency(earned)}</td>
                            <td className="px-5 py-3 font-medium">{formatCurrency(effectiveBasis)}</td>
                            <td className="px-5 py-3">
                              <div className="flex gap-1">
                                <Btn variant="secondary" size="sm" onClick={() => { setWriteCallTicker(p.ticker); setShowWriteCall(true); }}>Write Call</Btn>
                                <Btn variant="ghost" size="sm" onClick={() => setEditingPosition(p)}><Edit2 size={14} /></Btn>
                                {confirmDeleteId === p.id ? (
                                  <span className="inline-flex items-center gap-1">
                                    <Btn variant="danger" size="sm" onClick={() => { removePosition(p.id); setConfirmDeleteId(null); }}>Yes</Btn>
                                    <Btn variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)}>No</Btn>
                                  </span>
                                ) : (
                                  <Btn variant="ghost" size="sm" onClick={() => setConfirmDeleteId(p.id)}><Trash2 size={14} className="text-red-400" /></Btn>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>
          </div>
        )}

        {/* TRADE LOG TAB */}
        {tab === "Trade Log" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Trade History</h2>
              <Btn size="sm" onClick={() => setShowLogPast(true)}><Plus size={14} /> Log Past Trade</Btn>
            </div>
            <Card>
              <div className="overflow-x-auto">
                {data.calls.length === 0 ? (
                  <div className="p-12 text-center text-gray-400">No trades logged yet.</div>
                ) : (
                  <TradeLogTable calls={data.calls} positions={data.positions} onEdit={(c) => setEditingCall(c)} />
                )}
              </div>
            </Card>
          </div>
        )}

        {/* WATCHLIST TAB */}
        {tab === "Watchlist" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Volatility Watchlist</h2>
              <div className="flex items-center gap-2">
                {data.watchlist.length > 0 && (
                  <Btn variant="secondary" size="sm" onClick={fetchWatchlistScores} disabled={watchlistScoresLoading}>
                    <RefreshCw size={14} className={watchlistScoresLoading ? "animate-spin" : ""} />
                    {watchlistScoresLoading ? "Scoring..." : "Refresh Scores"}
                  </Btn>
                )}
                <Btn onClick={() => setShowAddWatchlist(true)}><Plus size={14} /> Add Ticker</Btn>
              </div>
            </div>
            <Card>
              <div className="overflow-x-auto">
                {data.watchlist.length === 0 ? (
                  <div className="p-12 text-center text-gray-400">Watchlist empty. Add tickers to track.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                        <th className="px-4 py-3">Ticker</th>
                        <th className="px-4 py-3">Sector</th>
                        <th className="px-4 py-3">Price</th>
                        <th className="px-4 py-3"><Tip term="volScore">Vol Score</Tip></th>
                        <th className="px-4 py-3"><Tip term="beta">Beta</Tip></th>
                        <th className="px-4 py-3">30d Move</th>
                        <th className="px-4 py-3"><Tip term="range52w">52w Range</Tip></th>
                        <th className="px-4 py-3"><Tip term="volumeVsAvg">Vol vs Avg</Tip></th>
                        <th className="px-4 py-3">Earnings</th>
                        <th className="px-4 py-3">In Portfolio</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.watchlist.map((w) => {
                        const inPortfolio = activePositions.some((p) => p.ticker.toUpperCase() === w.ticker.toUpperCase());
                        const move = String(w.move30d || "");
                        const movePositive = move.startsWith("+");
                        const moveNegative = move.startsWith("-");
                        const vs = w.volScore || 0;
                        const vsColor = vs >= 70 ? "bg-green-500" : vs >= 45 ? "bg-yellow-500" : "bg-red-400";
                        const vsLabel = vs >= 70 ? "High" : vs >= 45 ? "Moderate" : "Low";
                        const vsLabelColor = vs >= 70 ? "text-green-700" : vs >= 45 ? "text-yellow-700" : "text-red-600";
                        return (
                          <tr key={w.id} className={`border-b border-gray-50 hover:bg-gray-50 ${watchlistScoresLoading ? "opacity-50" : ""}`}>
                            <td className="px-4 py-3 font-bold text-gray-900">{w.ticker}</td>
                            <td className="px-4 py-3 text-gray-600">{w.sector || "—"}</td>
                            <td className="px-4 py-3">{w.price ? formatCurrency(w.price) : "—"}</td>
                            <td className="px-4 py-3">
                              {vs > 0 ? (
                                <div className="flex items-center gap-2">
                                  <div className="w-14 h-2 bg-gray-100 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full ${vsColor}`} style={{ width: `${Math.min(100, vs)}%` }} />
                                  </div>
                                  <span className="font-semibold text-xs">{vs}</span>
                                  <span className={`text-xs font-medium ${vsLabelColor}`}>{vsLabel}</span>
                                </div>
                              ) : <span className="text-gray-400 text-xs">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              {w.beta ? (
                                <span className={`font-medium ${w.beta >= 1.5 ? "text-orange-600" : w.beta >= 1.0 ? "text-gray-900" : "text-blue-600"}`}>{w.beta}</span>
                              ) : "—"}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`font-medium ${movePositive ? "text-green-700" : moveNegative ? "text-red-600" : "text-gray-600"}`}>
                                {move || "—"}
                              </span>
                            </td>
                            <td className="px-4 py-3">{w.range52w || "—"}</td>
                            <td className="px-4 py-3">
                              {w.volumeVsAvg ? (
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                  String(w.volumeVsAvg).replace("x","") >= 2 ? "bg-green-100 text-green-800" :
                                  String(w.volumeVsAvg).replace("x","") >= 1.3 ? "bg-yellow-100 text-yellow-800" :
                                  "bg-gray-100 text-gray-600"
                                }`}>{w.volumeVsAvg}</span>
                              ) : "—"}
                            </td>
                            <td className="px-4 py-3">
                              {w.nextEarnings ? (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full">
                                  <AlertTriangle size={12} />
                                  {w.nextEarnings}
                                </span>
                              ) : <span className="text-gray-400 text-xs">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              {inPortfolio ? <span className="text-green-700 font-medium flex items-center gap-1"><Check size={14} /> Yes</span> : <span className="text-gray-400">No</span>}
                            </td>
                            <td className="px-4 py-3">
                              <button onClick={() => removeWatchlistItem(w.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              {data.watchlist.some(w => w.volScore > 0) && (
                <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 rounded-b-xl">
                  <p className="text-xs text-gray-400">Vol Score (0-100) based on: 52w range, beta, 30d momentum, volume activity, and earnings proximity</p>
                </div>
              )}
            </Card>

            {/* CC Opportunities Scanner */}
            <div className="mt-8">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Zap size={18} className="text-amber-500" />
                  <h2 className="text-lg font-semibold text-gray-900">CC Opportunities</h2>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Top 10 by Vol Score</span>
                </div>
                <div className="flex items-center gap-3">
                  {scannerTimestamp && (
                    <span className="text-xs text-gray-400">
                      Updated {new Date(scannerTimestamp).toLocaleString()}
                    </span>
                  )}
                  <Btn variant="secondary" size="sm" onClick={fetchScannerData} disabled={scannerLoading}>
                    <RefreshCw size={14} className={scannerLoading ? "animate-spin" : ""} />
                    {scannerLoading ? "Scanning..." : "Refresh"}
                  </Btn>
                </div>
              </div>
              <Card>
                <div className="overflow-x-auto">
                  {scannerLoading && !scannerData ? (
                    <div className="p-12 text-center">
                      <div className="inline-flex items-center gap-2 text-gray-500">
                        <RefreshCw size={16} className="animate-spin" />
                        <span>Scanning market for opportunities...</span>
                      </div>
                      <div className="mt-4 space-y-2 max-w-md mx-auto">
                        {[...Array(5)].map((_, i) => (
                          <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" style={{ animationDelay: `${i * 100}ms` }} />
                        ))}
                      </div>
                    </div>
                  ) : scannerError && !scannerData ? (
                    <div className="p-8 text-center">
                      <div className="inline-flex items-center gap-2 text-red-600 mb-2">
                        <AlertTriangle size={16} />
                        <span className="font-medium">Scanner Error</span>
                      </div>
                      <p className="text-sm text-gray-500">{scannerError}</p>
                      <Btn variant="secondary" size="sm" className="mt-3" onClick={fetchScannerData}>Try Again</Btn>
                    </div>
                  ) : !scannerData ? (
                    <div className="p-12 text-center text-gray-400">
                      <p>Click Refresh to scan for covered call opportunities.</p>
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                          <th className="px-4 py-3">Ticker</th>
                          <th className="px-4 py-3">Sector</th>
                          <th className="px-4 py-3">Price</th>
                          <th className="px-4 py-3"><Tip term="volScore">Vol Score</Tip></th>
                          <th className="px-4 py-3">Mkt Cap</th>
                          <th className="px-4 py-3"><Tip term="volumeVsAvg">Vol vs Avg</Tip></th>
                          <th className="px-4 py-3">30d Move</th>
                          <th className="px-4 py-3">Near 52w High</th>
                          <th className="px-4 py-3">Earnings</th>
                          <th className="px-4 py-3">Why</th>
                          <th className="px-4 py-3"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {scannerData.map((s, idx) => {
                          const alreadyOnWatchlist = data.watchlist.some(w => w.ticker.toUpperCase() === (s.ticker || "").toUpperCase());
                          const move = String(s.move30d || "");
                          const movePositive = move.startsWith("+");
                          const moveNegative = move.startsWith("-");
                          return (
                            <tr key={(s.ticker || "") + idx} className={`border-b border-gray-50 hover:bg-gray-50 ${scannerLoading ? "opacity-50" : ""}`}>
                              <td className="px-4 py-3 font-bold text-gray-900">{s.ticker || "—"}</td>
                              <td className="px-4 py-3 text-gray-600">{s.sector || "—"}</td>
                              <td className="px-4 py-3">{s.price ? formatCurrency(s.price) : "—"}</td>
                              <td className="px-4 py-3">
                                {(s.volScore || 0) > 0 ? (
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-10 h-2 bg-gray-100 rounded-full overflow-hidden">
                                      <div className={`h-full rounded-full ${(s.volScore||0) >= 70 ? "bg-green-500" : (s.volScore||0) >= 45 ? "bg-yellow-500" : "bg-red-400"}`} style={{ width: `${Math.min(100, s.volScore)}%` }} />
                                    </div>
                                    <span className="text-xs font-semibold">{s.volScore}</span>
                                  </div>
                                ) : "—"}
                              </td>
                              <td className="px-4 py-3 text-gray-500">{s.marketCap || "—"}</td>
                              <td className="px-4 py-3">
                                {s.volumeVsAvg ? (
                                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                    String(s.volumeVsAvg).replace("x","") >= 2 ? "bg-green-100 text-green-800" :
                                    String(s.volumeVsAvg).replace("x","") >= 1.3 ? "bg-yellow-100 text-yellow-800" :
                                    "bg-gray-100 text-gray-600"
                                  }`}>{s.volumeVsAvg}</span>
                                ) : "—"}
                              </td>
                              <td className="px-4 py-3">
                                <span className={`font-medium ${movePositive ? "text-green-700" : moveNegative ? "text-red-600" : "text-gray-600"}`}>
                                  {move || "—"}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                {s.near52wHigh ? (
                                  <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                                    <TrendingUp size={12} /> Near High
                                  </span>
                                ) : (
                                  <span className="text-gray-400 text-xs">No</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {s.nextEarnings ? (
                                  <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full">
                                    <AlertTriangle size={12} />
                                    {s.nextEarnings}
                                  </span>
                                ) : (
                                  <span className="text-gray-400 text-xs">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-xs text-gray-600 max-w-[220px]">
                                {s.why || s.catalyst || "—"}
                              </td>
                              <td className="px-4 py-3">
                                {alreadyOnWatchlist ? (
                                  <span className="text-xs text-gray-400 flex items-center gap-1"><Check size={12} /> Added</span>
                                ) : (
                                  <Btn variant="secondary" size="sm" onClick={() => {
                                    addWatchlistItem({
                                      ticker: s.ticker,
                                      sector: s.sector || "",
                                      price: s.price || 0,
                                      move30d: s.move30d || "",
                                      volumeVsAvg: s.volumeVsAvg || "",
                                      near52wHigh: s.near52wHigh || false,
                                      nextEarnings: s.nextEarnings || "",
                                      why: s.why || "",
                                      dateAdded: today(),
                                    });
                                  }}>
                                    <Plus size={12} /> Watch
                                  </Btn>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
                {scannerData && (
                  <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-xl">
                    <p className="text-xs text-gray-400">AI-powered scan · Market cap &gt; $2B · Price &gt; $10 · Sorted by Volatility Score</p>
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}
        {tab === "Analytics" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon={DollarSign} label="Total Premium" value={formatCurrency(totalPremiumCollected)} color="text-green-700" />
              <StatCard icon={TrendingUp} label="Annualized Yield" value={formatPct(annualizedYield)} color="text-green-700" />
              <StatCard icon={BarChart3} label="Total Trades" value={data.calls.length} />
              <StatCard icon={Target} label="Win Rate" value={
                closedCalls.length > 0
                  ? `${((closedCalls.filter(c => {
                      const net = netPrem(c);
                      return net > 0;
                    }).length / closedCalls.length) * 100).toFixed(0)}%`
                  : "—"
              } sub="Profitable closes" />
            </div>

            {/* Weekly Chart */}
            <Card className="p-5">
              <h3 className="font-semibold text-gray-900 mb-4">Weekly Premium (Bar) + Cumulative (Line)</h3>
              {premiumByWeek.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-gray-400 text-sm">Close some trades to see chart data.</div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={premiumByWeek}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => formatCurrency(v)} />
                    <Bar yAxisId="left" dataKey="amount" fill="#10b981" radius={[4, 4, 0, 0]} name="Weekly" />
                    <Line yAxisId="right" type="monotone" dataKey="cumulative" stroke="#1e40af" strokeWidth={2} dot={false} name="Cumulative" />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </Card>

            {/* Monthly Chart */}
            <Card className="p-5">
              <h3 className="font-semibold text-gray-900 mb-4">Monthly Premium (Bar) + Cumulative (Line)</h3>
              {premiumByMonth.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-gray-400 text-sm">Close some trades to see chart data.</div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={premiumByMonth}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => formatCurrency(v)} />
                    <Bar yAxisId="left" dataKey="amount" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Monthly" />
                    <Line yAxisId="right" type="monotone" dataKey="cumulative" stroke="#1e40af" strokeWidth={2} dot={false} name="Cumulative" />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </Card>

            {/* Per-Ticker Breakdown */}
            <Card>
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900">Premium by Ticker</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                      <th className="px-5 py-3">Ticker</th>
                      <th className="px-5 py-3">Trades</th>
                      <th className="px-5 py-3">Gross Premium</th>
                      <th className="px-5 py-3">Close Costs</th>
                      <th className="px-5 py-3">Net Premium</th>
                      <th className="px-5 py-3">Avg Premium/Trade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(
                      data.calls.reduce((acc, c) => {
                        if (!acc[c.ticker]) acc[c.ticker] = { trades: 0, gross: 0, closeCost: 0 };
                        acc[c.ticker].trades++;
                        acc[c.ticker].gross += grossPrem(c);
                        if (c.status === "closed") acc[c.ticker].closeCost += closeCostOf(c);
                        return acc;
                      }, {})
                    ).map(([ticker, d]) => (
                      <tr key={ticker} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-5 py-3 font-bold">{ticker}</td>
                        <td className="px-5 py-3">{d.trades}</td>
                        <td className="px-5 py-3">{formatCurrency(d.gross)}</td>
                        <td className="px-5 py-3 text-red-600">{d.closeCost > 0 ? formatCurrency(d.closeCost) : "—"}</td>
                        <td className="px-5 py-3 text-green-700 font-medium">{formatCurrency(d.gross - d.closeCost)}</td>
                        <td className="px-5 py-3">{formatCurrency((d.gross - d.closeCost) / d.trades)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* CC Yield vs Buy & Hold Comparison */}
            <Card>
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900"><Tip term="coveredCall">Covered Call vs. Buy & Hold</Tip></h3>
                  <p className="text-xs text-gray-500 mt-0.5">Compare your total return (stock + premium) against holding shares alone</p>
                </div>
                {Object.keys(livePrices).length === 0 && activePositions.length > 0 && (
                  <Btn variant="secondary" size="sm" onClick={fetchLivePrices} disabled={pricesLoading}>
                    <RefreshCw size={12} className={pricesLoading ? "animate-spin" : ""} />
                    {pricesLoading ? "Fetching..." : "Load Prices"}
                  </Btn>
                )}
              </div>
              {(() => {
                // Build per-ticker comparison
                const tickers = [...new Set(activePositions.map(p => p.ticker.toUpperCase()))];
                if (tickers.length === 0) return (
                  <div className="p-8 text-center text-gray-400 text-sm">Add positions to see the comparison.</div>
                );

                const comparisons = tickers.map(ticker => {
                  // Aggregate position data
                  const positions = activePositions.filter(p => p.ticker.toUpperCase() === ticker);
                  const totalShares = positions.reduce((s, p) => s + p.shares, 0);
                  const totalCost = positions.reduce((s, p) => s + p.costBasis * p.shares, 0);
                  const avgBasis = totalCost / totalShares;
                  const mktPrice = livePrices[ticker] || null;

                  // Premium collected for this ticker
                  const tickerCalls = data.calls.filter(c => c.ticker.toUpperCase() === ticker);
                  const grossPremium = tickerCalls.reduce((s, c) => s + grossPrem(c), 0);
                  const closeCosts = tickerCalls.reduce((s, c) => s + closeCostOf(c), 0);
                  const netPremium = grossPremium - closeCosts;

                  // Shares lost to assignment
                  const assignedShares = tickerCalls.filter(c => c.status === "assigned").reduce((s, c) => s + c.contracts * 100, 0);
                  const currentShares = totalShares - assignedShares;
                  const assignmentProceeds = tickerCalls.filter(c => c.status === "assigned").reduce((s, c) => s + c.strike * c.contracts * 100, 0);

                  // Buy & hold return (if you just held all original shares)
                  const buyHoldValue = mktPrice ? totalShares * mktPrice : null;
                  const buyHoldReturn = buyHoldValue ? buyHoldValue - totalCost : null;
                  const buyHoldPct = buyHoldReturn !== null ? (buyHoldReturn / totalCost) * 100 : null;

                  // CC strategy return = current shares value + assignment proceeds + net premium - total cost
                  const ccValue = mktPrice ? (currentShares * mktPrice) + assignmentProceeds + netPremium : null;
                  const ccReturn = ccValue ? ccValue - totalCost : null;
                  const ccPct = ccReturn !== null ? (ccReturn / totalCost) * 100 : null;

                  // Alpha
                  const alpha = ccReturn !== null && buyHoldReturn !== null ? ccReturn - buyHoldReturn : null;
                  const alphaPct = ccPct !== null && buyHoldPct !== null ? ccPct - buyHoldPct : null;

                  // Days held
                  const earliestDate = positions.map(p => p.dateAcquired).sort()[0];
                  const daysHeld = earliestDate ? daysBetween(earliestDate, today()) : 0;

                  // Premium-only return on cost basis (no price needed)
                  const premiumYieldPct = totalCost > 0 ? (netPremium / totalCost) * 100 : 0;
                  const premiumAnnualized = daysHeld > 0 ? premiumYieldPct * (365 / daysHeld) : 0;

                  return {
                    ticker, totalShares, currentShares, totalCost, avgBasis, mktPrice,
                    netPremium, grossPremium, assignedShares, assignmentProceeds,
                    buyHoldReturn, buyHoldPct, ccReturn, ccPct, alpha, alphaPct,
                    daysHeld, premiumYieldPct, premiumAnnualized, tickerCalls
                  };
                });

                const hasPrices = comparisons.some(c => c.mktPrice !== null);

                return (
                  <div className="divide-y divide-gray-100">
                    {comparisons.map((c) => (
                      <div key={c.ticker} className="p-5">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <span className="text-lg font-bold text-gray-900">{c.ticker}</span>
                            <span className="text-xs text-gray-400">{c.totalShares} shares · {c.daysHeld}d held · {c.tickerCalls.length} calls</span>
                          </div>
                          {c.mktPrice && (
                            <span className="text-sm text-gray-500">Mkt: {formatCurrency(c.mktPrice)}</span>
                          )}
                        </div>

                        {/* Comparison bars */}
                        <div className="space-y-3">
                          {/* Buy & Hold */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-medium text-gray-500">Buy & Hold</span>
                              {c.buyHoldReturn !== null ? (
                                <span className={`text-sm font-bold ${c.buyHoldReturn >= 0 ? "text-gray-700" : "text-red-600"}`}>
                                  {c.buyHoldReturn >= 0 ? "+" : ""}{formatCurrency(c.buyHoldReturn)} ({c.buyHoldPct >= 0 ? "+" : ""}{c.buyHoldPct.toFixed(1)}%)
                                </span>
                              ) : (
                                <span className="text-xs text-gray-400">Load prices to compare</span>
                              )}
                            </div>
                            <div className="w-full h-5 bg-gray-100 rounded-full overflow-hidden">
                              {c.buyHoldPct !== null && (
                                <div
                                  className={`h-full rounded-full ${c.buyHoldPct >= 0 ? "bg-gray-400" : "bg-red-300"}`}
                                  style={{ width: `${Math.min(100, Math.max(2, Math.abs(c.buyHoldPct)))}%` }}
                                />
                              )}
                            </div>
                          </div>

                          {/* CC Strategy */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-medium text-green-700">Covered Call Strategy</span>
                              {c.ccReturn !== null ? (
                                <span className={`text-sm font-bold ${c.ccReturn >= 0 ? "text-green-700" : "text-red-600"}`}>
                                  {c.ccReturn >= 0 ? "+" : ""}{formatCurrency(c.ccReturn)} ({c.ccPct >= 0 ? "+" : ""}{c.ccPct.toFixed(1)}%)
                                </span>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </div>
                            <div className="w-full h-5 bg-gray-100 rounded-full overflow-hidden">
                              {c.ccPct !== null && (
                                <div
                                  className={`h-full rounded-full ${c.ccPct >= 0 ? "bg-green-500" : "bg-red-400"}`}
                                  style={{ width: `${Math.min(100, Math.max(2, Math.abs(c.ccPct)))}%` }}
                                />
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Alpha + metrics */}
                        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                            <p className="text-xs text-gray-500">Net Premium</p>
                            <p className="text-sm font-bold text-green-700">{formatCurrency(c.netPremium)}</p>
                          </div>
                          <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                            <p className="text-xs text-gray-500"><Tip term="annualizedYield">Premium Yield (Ann.)</Tip></p>
                            <p className="text-sm font-bold text-green-700">{c.premiumAnnualized.toFixed(1)}%</p>
                          </div>
                          {c.alpha !== null && (
                            <div className={`rounded-lg p-2.5 text-center ${c.alpha >= 0 ? "bg-green-50" : "bg-red-50"}`}>
                              <p className="text-xs text-gray-500">CC Alpha</p>
                              <p className={`text-sm font-bold ${c.alpha >= 0 ? "text-green-700" : "text-red-600"}`}>
                                {c.alpha >= 0 ? "+" : ""}{formatCurrency(c.alpha)}
                              </p>
                            </div>
                          )}
                          {c.assignedShares > 0 && (
                            <div className="bg-orange-50 rounded-lg p-2.5 text-center">
                              <p className="text-xs text-gray-500">Shares Assigned</p>
                              <p className="text-sm font-bold text-orange-700">{c.assignedShares}</p>
                            </div>
                          )}
                        </div>

                        {/* Insight */}
                        {c.alpha !== null && (
                          <div className={`mt-3 rounded-lg p-3 text-xs leading-relaxed ${c.alpha >= 0 ? "bg-green-50 border border-green-100 text-green-800" : "bg-amber-50 border border-amber-100 text-amber-800"}`}>
                            {c.alpha >= 0 ? (
                              <>
                                <strong>Covered calls added {formatCurrency(c.alpha)} ({Math.abs(c.alphaPct).toFixed(1)}pp) to your return</strong> vs. just holding {c.ticker}. Your premium income
                                {c.buyHoldReturn < 0 ? " helped cushion the stock's decline" : " stacked on top of the stock's gains"}.
                                {c.premiumAnnualized > 20 && " That's a strong annualized premium yield — keep it up."}
                              </>
                            ) : (
                              <>
                                <strong>Buy & hold outperformed by {formatCurrency(Math.abs(c.alpha))}</strong>. This usually happens when shares get assigned during a big rally — you kept the premium but missed upside above the strike.
                                {c.assignedShares > 0 && " Some shares were called away, capping your gains."}
                                {" "}This is the core trade-off of covered calls: consistent income in exchange for capped upside.
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Aggregate summary */}
                    {comparisons.length > 1 && hasPrices && (() => {
                      const totCost = comparisons.reduce((s, c) => s + c.totalCost, 0);
                      const totBH = comparisons.reduce((s, c) => s + (c.buyHoldReturn || 0), 0);
                      const totCC = comparisons.reduce((s, c) => s + (c.ccReturn || 0), 0);
                      const totAlpha = totCC - totBH;
                      const totPremium = comparisons.reduce((s, c) => s + c.netPremium, 0);
                      return (
                        <div className="p-5 bg-gray-50">
                          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Portfolio Total</p>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="bg-white rounded-lg p-3 text-center border border-gray-200">
                              <p className="text-xs text-gray-500">Buy & Hold Return</p>
                              <p className={`text-lg font-bold ${totBH >= 0 ? "text-gray-700" : "text-red-600"}`}>{totBH >= 0 ? "+" : ""}{formatCurrency(totBH)}</p>
                              <p className="text-xs text-gray-400">{totCost > 0 ? `${((totBH / totCost) * 100).toFixed(1)}%` : ""}</p>
                            </div>
                            <div className="bg-white rounded-lg p-3 text-center border border-green-200">
                              <p className="text-xs text-gray-500">CC Strategy Return</p>
                              <p className={`text-lg font-bold ${totCC >= 0 ? "text-green-700" : "text-red-600"}`}>{totCC >= 0 ? "+" : ""}{formatCurrency(totCC)}</p>
                              <p className="text-xs text-gray-400">{totCost > 0 ? `${((totCC / totCost) * 100).toFixed(1)}%` : ""}</p>
                            </div>
                            <div className={`bg-white rounded-lg p-3 text-center border ${totAlpha >= 0 ? "border-green-200" : "border-red-200"}`}>
                              <p className="text-xs text-gray-500">Total Alpha</p>
                              <p className={`text-lg font-bold ${totAlpha >= 0 ? "text-green-700" : "text-red-600"}`}>{totAlpha >= 0 ? "+" : ""}{formatCurrency(totAlpha)}</p>
                            </div>
                            <div className="bg-white rounded-lg p-3 text-center border border-gray-200">
                              <p className="text-xs text-gray-500">Total Premium</p>
                              <p className="text-lg font-bold text-green-700">{formatCurrency(totPremium)}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}
            </Card>
          </div>
        )}

        {/* TAX VIEW TAB */}
        {tab === "Tax View" && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-gray-900">Tax Treatment</h2>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <StatCard icon={Clock} label="Short-Term Gains" value={formatCurrency(taxData.filter(t => t.treatment === "Short-term" && t.net > 0).reduce((s, t) => s + t.net, 0))} color="text-orange-700" />
              <StatCard icon={Shield} label="Long-Term Gains" value={formatCurrency(taxData.filter(t => t.treatment === "Long-term" && t.net > 0).reduce((s, t) => s + t.net, 0))} color="text-green-700" />
              <StatCard icon={AlertTriangle} label={<Tip term="washSale">Wash Sale Flags</Tip>} value={taxData.filter(t => t.washSaleRisk).length} sub="Review these" color={taxData.filter(t => t.washSaleRisk).length > 0 ? "text-red-600" : "text-gray-900"} />
            </div>
            <Card>
              <div className="overflow-x-auto">
                {taxData.length === 0 ? (
                  <div className="p-12 text-center text-gray-400">No closed trades to show tax treatment.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                        <th className="px-5 py-3">Ticker</th>
                        <th className="px-5 py-3">Opened</th>
                        <th className="px-5 py-3">Closed</th>
                        <th className="px-5 py-3">Days Held</th>
                        <th className="px-5 py-3">Treatment</th>
                        <th className="px-5 py-3">Net P/L</th>
                        <th className="px-5 py-3"><Tip term="washSale">Wash Sale Risk</Tip></th>
                      </tr>
                    </thead>
                    <tbody>
                      {taxData.sort((a, b) => (b.dateClosed || "").localeCompare(a.dateClosed || "")).map((t) => (
                        <tr key={t.id} className={`border-b border-gray-50 ${t.washSaleRisk ? "bg-red-50" : "hover:bg-gray-50"}`}>
                          <td className="px-5 py-3 font-semibold">{t.ticker}</td>
                          <td className="px-5 py-3">{t.dateOpened}</td>
                          <td className="px-5 py-3">{t.dateClosed}</td>
                          <td className="px-5 py-3">{t.held}</td>
                          <td className="px-5 py-3">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${t.treatment === "Short-term" ? "bg-orange-100 text-orange-800" : "bg-green-100 text-green-800"}`}>
                              {t.treatment}
                            </span>
                          </td>
                          <td className={`px-5 py-3 font-medium ${t.net >= 0 ? "text-green-700" : "text-red-600"}`}>{formatCurrency(t.net)}</td>
                          <td className="px-5 py-3">
                            {t.washSaleRisk ? <span className="text-red-600 font-medium flex items-center gap-1"><AlertTriangle size={14} /> Yes</span> : <span className="text-gray-400">No</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* MODALS */}

      {/* Add Position Modal */}
      <Modal open={showAddPosition} onClose={() => setShowAddPosition(false)} title="Add Stock Position">
        <AddPositionForm onSubmit={(p) => { addPosition(p); setShowAddPosition(false); }} />
      </Modal>

      {/* Edit Position Modal */}
      <Modal open={!!editingPosition} onClose={() => setEditingPosition(null)} title={`Edit ${editingPosition?.ticker || ""}`}>
        {editingPosition && (
          <EditPositionForm
            position={editingPosition}
            onSubmit={(updates) => { updatePosition(editingPosition.id, updates); setEditingPosition(null); }}
          />
        )}
      </Modal>

      {/* Write Call Modal */}
      <Modal open={showWriteCall} onClose={() => setShowWriteCall(false)} title="Write Covered Call">
        <WriteCallForm
          positions={activePositions}
          events={data.events}
          defaultTicker={writeCallTicker}
          onSubmit={(c) => { addCall(c); setShowWriteCall(false); }}
        />
      </Modal>

      {/* Log Past Trade Modal */}
      <Modal open={showLogPast} onClose={() => setShowLogPast(false)} title="Log Past Trade">
        <LogPastTradeForm
          positions={activePositions}
          onSubmit={(call) => { addPastCall(call); setShowLogPast(false); }}
        />
      </Modal>

      {/* Edit Call Modal */}
      <Modal open={!!editingCall} onClose={() => setEditingCall(null)} title={`Edit ${editingCall?.ticker || ""} Trade`}>
        {editingCall && (
          <EditCallForm
            call={editingCall}
            onSubmit={(updates) => { updateCall(editingCall.id, updates); setEditingCall(null); }}
          />
        )}
      </Modal>

      {/* Close Call Modal */}
      <Modal open={!!showCloseCall} onClose={() => setShowCloseCall(null)} title={`Close ${showCloseCall?.ticker || ""} Call`}>
        {showCloseCall && (
          <CloseCallForm
            call={showCloseCall}
            onSubmit={(action, price) => { closeCall(showCloseCall.id, action, price); setShowCloseCall(null); }}
            onRoll={(closePrice, newCall) => {
              closeCall(showCloseCall.id, "closed", closePrice);
              addCall(newCall);
              setShowCloseCall(null);
            }}
          />
        )}
      </Modal>

      {/* Add Event Modal */}
      <Modal open={showAddEvent} onClose={() => setShowAddEvent(false)} title="Add Event">
        <AddEventForm onSubmit={(e) => { addEvent(e); setShowAddEvent(false); }} />
      </Modal>

      {/* Add Watchlist Modal */}
      <Modal open={showAddWatchlist} onClose={() => setShowAddWatchlist(false)} title="Add to Watchlist — Volatility Analysis">
        <AddWatchlistForm onSubmit={(w) => { addWatchlistItem(w); setShowAddWatchlist(false); }} />
      </Modal>

      {/* Import Data Modal */}
      <Modal open={showImport} onClose={() => setShowImport(false)} title="Import Data">
        <ImportDataForm onSubmit={(imported) => { save(imported); setShowImport(false); }} />
      </Modal>
    </div>
  );
}

// === FORM COMPONENTS ===

function TradeLogTable({ calls, positions, onEdit }) {
  const [expanded, setExpanded] = useState(null);
  const sorted = [...calls].sort((a, b) => b.dateOpened.localeCompare(a.dateOpened));

  const getPostMortem = (c) => {
    const gross = grossPrem(c);
    const closeCost = closeCostOf(c);
    const net = gross - closeCost;
    const held = daysBetween(c.dateOpened, c.dateClosed || c.expiration);
    const premiumRetained = gross > 0 ? (net / gross) * 100 : 0;
    const position = positions.find(p => p.ticker.toUpperCase() === c.ticker.toUpperCase());
    const costBasis = position ? position.costBasis : null;
    const annualizedReturn = costBasis && held > 0 ? ((net / (costBasis * c.contracts * 100)) * (365 / held)) * 100 : null;

    let verdict = "";
    let verdictColor = "";
    let insight = "";

    if (c.status === "expired") {
      verdict = "Full Win";
      verdictColor = "text-green-700 bg-green-50";
      insight = "Call expired worthless — you kept 100% of the premium. This is the ideal outcome for a covered call writer.";
    } else if (c.status === "assigned") {
      verdict = "Assigned";
      verdictColor = "text-orange-700 bg-orange-50";
      if (costBasis && c.strike >= costBasis) {
        insight = `Shares were called away at $${c.strike.toFixed(2)}, above your cost basis of $${costBasis.toFixed(2)}. You profited on both the stock appreciation and the premium collected.`;
      } else if (costBasis) {
        insight = `Shares called away at $${c.strike.toFixed(2)}, below your cost basis of $${costBasis.toFixed(2)}. The premium helped offset the loss, but you sold at a loss on the shares.`;
      } else {
        insight = "Shares were called away at the strike price. You kept the full premium but gave up the shares.";
      }
    } else if (c.status === "closed") {
      if (net > 0) {
        verdict = "Partial Win";
        verdictColor = "text-blue-700 bg-blue-50";
        insight = `You bought to close early and kept ${premiumRetained.toFixed(0)}% of the original premium. Closing early can be smart when most of the profit is already captured.`;
      } else {
        verdict = "Loss";
        verdictColor = "text-red-700 bg-red-50";
        insight = `You paid more to close than you received in premium — a net loss of ${formatCurrency(Math.abs(net))}. This usually happens when the stock moves sharply toward or past the strike.`;
      }
    }

    return { gross, closeCost, net, held, premiumRetained, annualizedReturn, verdict, verdictColor, insight, costBasis };
  };

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
          <th className="px-5 py-3 w-8"></th>
          <th className="px-5 py-3">Date</th>
          <th className="px-5 py-3">Ticker</th>
          <th className="px-5 py-3">Strike</th>
          <th className="px-5 py-3">Exp</th>
          <th className="px-5 py-3">Premium</th>
          <th className="px-5 py-3">Contracts</th>
          <th className="px-5 py-3">Status</th>
          <th className="px-5 py-3">Net P/L</th>
          <th className="px-5 py-3"></th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((c) => {
          const gross = grossPrem(c);
          const closeCost = closeCostOf(c);
          const net = c.status === "open" ? null : gross - closeCost;
          const isExpanded = expanded === c.id;
          const isClosed = c.status !== "open";
          const pm = isClosed ? getPostMortem(c) : null;

          return (
            <React.Fragment key={c.id}>
              <tr
                className={`border-b border-gray-50 ${isClosed ? "cursor-pointer" : ""} ${isExpanded ? "bg-gray-50" : "hover:bg-gray-50"}`}
                onClick={() => isClosed && setExpanded(isExpanded ? null : c.id)}
              >
                <td className="px-5 py-3 text-gray-400">
                  {isClosed ? (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
                </td>
                <td className="px-5 py-3 text-gray-500">{c.dateOpened}</td>
                <td className="px-5 py-3 font-semibold">{c.ticker}</td>
                <td className="px-5 py-3">{formatCurrency(c.strike)}</td>
                <td className="px-5 py-3">{c.expiration}</td>
                <td className="px-5 py-3">{formatCurrency(c.premium)}/sh</td>
                <td className="px-5 py-3">{c.contracts}</td>
                <td className="px-5 py-3"><StatusBadge status={c.status} /></td>
                <td className={`px-5 py-3 font-medium ${net === null ? "" : net >= 0 ? "text-green-700" : "text-red-600"}`}>
                  {net === null ? "—" : formatCurrency(net)}
                </td>
                <td className="px-5 py-3">
                  <button
                    className="p-1.5 rounded-md hover:bg-gray-200 text-gray-400 hover:text-gray-700 transition-colors"
                    onClick={(e) => { e.stopPropagation(); onEdit(c); }}
                    title="Edit trade"
                  >
                    <Edit2 size={13} />
                  </button>
                </td>
              </tr>
              {isExpanded && pm && (
                <tr>
                  <td colSpan={10} className="px-5 pb-4 pt-0 bg-gray-50">
                    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                      {/* Verdict header */}
                      <div className={`px-4 py-2.5 flex items-center justify-between ${pm.verdictColor}`}>
                        <span className="text-sm font-semibold">{pm.verdict}</span>
                        <span className="text-xs">Held {pm.held} days · Closed {c.dateClosed || c.expiration}</span>
                      </div>

                      {/* Insight */}
                      <div className="px-4 py-3 border-b border-gray-100">
                        <p className="text-sm text-gray-700">{pm.insight}</p>
                      </div>

                      {/* Metrics grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-gray-100">
                        <div className="p-3 text-center">
                          <p className="text-xs text-gray-500">Gross Premium</p>
                          <p className="text-sm font-bold text-gray-900 mt-0.5">{formatCurrency(pm.gross)}</p>
                        </div>
                        <div className="p-3 text-center">
                          <p className="text-xs text-gray-500">Close Cost</p>
                          <p className="text-sm font-bold text-gray-900 mt-0.5">{pm.closeCost > 0 ? formatCurrency(pm.closeCost) : "—"}</p>
                        </div>
                        <div className="p-3 text-center">
                          <p className="text-xs text-gray-500">Premium Retained</p>
                          <p className={`text-sm font-bold mt-0.5 ${pm.premiumRetained >= 80 ? "text-green-700" : pm.premiumRetained >= 50 ? "text-yellow-700" : "text-red-600"}`}>
                            {pm.premiumRetained.toFixed(0)}%
                          </p>
                        </div>
                        <div className="p-3 text-center">
                          <p className="text-xs text-gray-500">Annualized Return</p>
                          <p className="text-sm font-bold text-gray-900 mt-0.5">
                            {pm.annualizedReturn !== null ? `${pm.annualizedReturn.toFixed(1)}%` : "—"}
                          </p>
                        </div>
                      </div>

                      {/* Takeaway for novices */}
                      {c.status === "closed" && pm.net < 0 && (
                        <div className="px-4 py-2.5 bg-amber-50 border-t border-amber-100 text-xs text-amber-800">
                          <strong>Tip:</strong> If the stock was rising toward your strike, consider rolling forward next time instead of closing at a loss — it lets you extend the trade and potentially collect more premium. In E*Trade, use <strong>Trading → Options → Roll</strong> to do this in a single order.
                        </div>
                      )}
                      {c.status === "expired" && (
                        <div className="px-4 py-2.5 bg-green-50 border-t border-green-100 text-xs text-green-800">
                          <strong>Tip:</strong> Many traders close at 50-80% profit rather than waiting for full expiration. This frees up capital and reduces the risk of a late reversal. In E*Trade, you can set a <strong>GTC (Good Til Canceled) Buy to Close</strong> limit order at your target price right after opening the trade.
                        </div>
                      )}
                      {c.status === "assigned" && pm.costBasis && c.strike < pm.costBasis && (
                        <div className="px-4 py-2.5 bg-amber-50 border-t border-amber-100 text-xs text-amber-800">
                          <strong>Tip:</strong> You were assigned below cost basis. To avoid this in the future, consider only writing calls at strikes above your cost basis, or rolling when the stock approaches your strike. In E*Trade, check your positions page — your shares have been sold and the proceeds are now in your account.
                        </div>
                      )}
                      {c.status === "assigned" && pm.costBasis && c.strike >= pm.costBasis && (
                        <div className="px-4 py-2.5 bg-green-50 border-t border-green-100 text-xs text-green-800">
                          <strong>Tip:</strong> You were assigned above cost basis — a profitable trade on both the shares and the premium. If you want to re-enter the position, you can buy shares again on E*Trade and write a new call immediately.
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function EditCallForm({ call, onSubmit }) {
  const [form, setForm] = useState({
    ticker: call.ticker || "",
    strike: String(call.strike || ""),
    premium: String(call.premium || ""),
    contracts: call.contracts || 1,
    dateOpened: call.dateOpened || "",
    expiration: call.expiration || "",
    status: call.status || "open",
    dateClosed: call.dateClosed || "",
    closePrice: String(call.closePrice || ""),
    totalPremium: call.totalPremium != null ? String(call.totalPremium) : "",
    totalCloseCost: call.totalCloseCost != null ? String(call.totalCloseCost) : "",
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const calcGross = (parseFloat(form.premium) || 0) * (parseInt(form.contracts) || 1) * 100;
  const gross = form.totalPremium !== "" ? parseFloat(form.totalPremium) || 0 : calcGross;
  const calcClose = form.status === "closed" ? (parseFloat(form.closePrice) || 0) * (parseInt(form.contracts) || 1) * 100 : 0;
  const close = form.status === "closed" && form.totalCloseCost !== "" ? parseFloat(form.totalCloseCost) || 0 : calcClose;
  const net = form.status === "open" ? null : gross - close;

  return (
    <div className="space-y-4">
      <Field label="Ticker">
        <Input value={form.ticker} onChange={(e) => set("ticker", e.target.value.toUpperCase())} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Strike Price"><Input type="number" step="0.50" value={form.strike} onChange={(e) => set("strike", e.target.value)} /></Field>
        <Field label="Premium (per share)"><Input type="number" step="0.01" value={form.premium} onChange={(e) => set("premium", e.target.value)} /></Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Contracts"><Input type="number" min="1" value={form.contracts} onChange={(e) => set("contracts", parseInt(e.target.value) || 1)} /></Field>
        <Field label={<span>Total Premium Received <span className="text-gray-400 font-normal">(override)</span></span>}>
          <Input
            type="number" step="0.01"
            value={form.totalPremium}
            onChange={(e) => set("totalPremium", e.target.value)}
            placeholder={formatCurrency(calcGross)}
          />
        </Field>
      </div>
      {form.totalPremium === "" && (
        <p className="text-xs text-gray-400 -mt-2">Calculated: {formatCurrency(calcGross)}. Enter a value to override with your actual amount from E*Trade.</p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date Opened"><Input type="date" value={form.dateOpened} onChange={(e) => set("dateOpened", e.target.value)} /></Field>
        <Field label="Expiration"><Input type="date" value={form.expiration} onChange={(e) => set("expiration", e.target.value)} /></Field>
      </div>

      <Field label="Status">
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: "open", label: "Open", desc: "Currently active" },
            { value: "expired", label: "Expired Worthless", desc: "Full premium kept" },
            { value: "closed", label: "Bought to Close", desc: "Paid to close" },
            { value: "assigned", label: "Assigned", desc: "Shares called away" },
          ].map((o) => (
            <button
              key={o.value}
              onClick={() => set("status", o.value)}
              className={`p-2.5 rounded-lg border text-left transition-all ${
                form.status === o.value ? "border-gray-900 bg-gray-50 ring-1 ring-gray-900" : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <p className="text-xs font-medium">{o.label}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{o.desc}</p>
            </button>
          ))}
        </div>
      </Field>

      {form.status !== "open" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date Closed"><Input type="date" value={form.dateClosed} onChange={(e) => set("dateClosed", e.target.value)} /></Field>
          {form.status === "closed" && (
            <Field label="Close Price (per share)"><Input type="number" step="0.01" value={form.closePrice} onChange={(e) => set("closePrice", e.target.value)} /></Field>
          )}
        </div>
      )}

      {form.status === "closed" && (
        <Field label={<span>Total Close Cost <span className="text-gray-400 font-normal">(override)</span></span>}>
          <Input
            type="number" step="0.01"
            value={form.totalCloseCost}
            onChange={(e) => set("totalCloseCost", e.target.value)}
            placeholder={formatCurrency(calcClose)}
          />
        </Field>
      )}

      {net !== null && (
        <div className={`rounded-lg p-3 text-sm border ${net >= 0 ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"}`}>
          <div className="flex justify-between">
            <span>Total Premium:</span>
            <span className="font-medium">{formatCurrency(gross)}</span>
          </div>
          {form.status === "closed" && (
            <div className="flex justify-between">
              <span>Close Cost:</span>
              <span className="font-medium">-{formatCurrency(close)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-current/10 pt-1 mt-1 font-semibold">
            <span>Net P/L:</span>
            <span>{formatCurrency(net)}</span>
          </div>
        </div>
      )}

      <Btn
        className="w-full"
        disabled={!form.ticker || !form.strike || !form.premium || !form.dateOpened || !form.expiration}
        onClick={() =>
          onSubmit({
            ticker: form.ticker.toUpperCase(),
            strike: parseFloat(form.strike),
            premium: parseFloat(form.premium),
            contracts: parseInt(form.contracts),
            dateOpened: form.dateOpened,
            expiration: form.expiration,
            status: form.status,
            dateClosed: form.status === "open" ? "" : form.dateClosed,
            closePrice: form.status === "closed" ? parseFloat(form.closePrice) || 0 : 0,
            totalPremium: form.totalPremium !== "" ? parseFloat(form.totalPremium) : undefined,
            totalCloseCost: form.status === "closed" && form.totalCloseCost !== "" ? parseFloat(form.totalCloseCost) : undefined,
          })
        }
      >
        Save Changes
      </Btn>
    </div>
  );
}

function LogPastTradeForm({ positions, onSubmit }) {
  const [form, setForm] = useState({
    ticker: positions[0]?.ticker || "",
    strike: "",
    premium: "",
    contracts: 1,
    dateOpened: "",
    expiration: "",
    status: "expired",
    dateClosed: "",
    closePrice: "",
    totalPremium: "",
    totalCloseCost: "",
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const tickers = [...new Set(positions.map(p => p.ticker))];
  const calcGross = (parseFloat(form.premium) || 0) * (parseInt(form.contracts) || 1) * 100;
  const gross = form.totalPremium !== "" ? parseFloat(form.totalPremium) || 0 : calcGross;
  const calcClose = form.status === "closed" ? (parseFloat(form.closePrice) || 0) * (parseInt(form.contracts) || 1) * 100 : 0;
  const close = form.status === "closed" && form.totalCloseCost !== "" ? parseFloat(form.totalCloseCost) || 0 : calcClose;
  const net = gross - close;

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
        Use this form to log calls you've already written and closed. Enter per-share amounts, or use the total override to match your E*Trade statement exactly.
      </div>

      <Field label="Ticker">
        {tickers.length > 0 ? (
          <Select value={form.ticker} onChange={(e) => set("ticker", e.target.value)} options={tickers.map(t => ({ value: t, label: t }))} />
        ) : (
          <Input value={form.ticker} onChange={(e) => set("ticker", e.target.value.toUpperCase())} placeholder="e.g. HOOD" />
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Strike Price"><Input type="number" step="0.50" value={form.strike} onChange={(e) => set("strike", e.target.value)} placeholder="0.00" /></Field>
        <Field label="Premium (per share)"><Input type="number" step="0.01" value={form.premium} onChange={(e) => set("premium", e.target.value)} placeholder="0.00" /></Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Contracts"><Input type="number" min="1" value={form.contracts} onChange={(e) => set("contracts", parseInt(e.target.value) || 1)} /></Field>
        <Field label={<span>Total Premium Received <span className="text-gray-400 font-normal">(override)</span></span>}>
          <Input
            type="number" step="0.01"
            value={form.totalPremium}
            onChange={(e) => set("totalPremium", e.target.value)}
            placeholder={calcGross > 0 ? formatCurrency(calcGross) : "Exact $ from E*Trade"}
          />
        </Field>
      </div>
      {form.totalPremium === "" && calcGross > 0 && (
        <p className="text-xs text-gray-400 -mt-2">Calculated: {formatCurrency(calcGross)}. Override with the exact amount from your E*Trade statement.</p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date Opened"><Input type="date" value={form.dateOpened} onChange={(e) => set("dateOpened", e.target.value)} /></Field>
        <Field label="Expiration"><Input type="date" value={form.expiration} onChange={(e) => set("expiration", e.target.value)} /></Field>
      </div>

      <Field label="Outcome">
        <div className="grid grid-cols-3 gap-2">
          {[
            { value: "expired", label: "Expired Worthless", desc: "Full premium kept" },
            { value: "closed", label: "Bought to Close", desc: "Paid to close early" },
            { value: "assigned", label: "Assigned", desc: "Shares called away" },
          ].map((o) => (
            <button
              key={o.value}
              onClick={() => set("status", o.value)}
              className={`p-2.5 rounded-lg border text-left transition-all ${
                form.status === o.value ? "border-gray-900 bg-gray-50 ring-1 ring-gray-900" : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <p className="text-xs font-medium">{o.label}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{o.desc}</p>
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date Closed"><Input type="date" value={form.dateClosed} onChange={(e) => set("dateClosed", e.target.value)} /></Field>
        {form.status === "closed" && (
          <Field label="Close Price (per share)"><Input type="number" step="0.01" value={form.closePrice} onChange={(e) => set("closePrice", e.target.value)} placeholder="0.00" /></Field>
        )}
      </div>

      {form.status === "closed" && (
        <Field label={<span>Total Close Cost <span className="text-gray-400 font-normal">(override)</span></span>}>
          <Input
            type="number" step="0.01"
            value={form.totalCloseCost}
            onChange={(e) => set("totalCloseCost", e.target.value)}
            placeholder={calcClose > 0 ? formatCurrency(calcClose) : "Exact $ from E*Trade"}
          />
        </Field>
      )}

      {/* Summary */}
      {(form.premium || form.totalPremium) && (
        <div className={`rounded-lg p-3 text-sm border ${net >= 0 ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"}`}>
          <div className="flex justify-between">
            <span>Total Premium:</span>
            <span className="font-medium">{formatCurrency(gross)}{form.totalPremium !== "" ? " ✓" : ""}</span>
          </div>
          {form.status === "closed" && close > 0 && (
            <div className="flex justify-between">
              <span>Close Cost:</span>
              <span className="font-medium">-{formatCurrency(close)}{form.totalCloseCost !== "" ? " ✓" : ""}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-current/10 pt-1 mt-1 font-semibold">
            <span>Net P/L:</span>
            <span>{formatCurrency(net)}</span>
          </div>
        </div>
      )}

      <Btn
        className="w-full"
        disabled={!form.ticker || !form.strike || !form.premium || !form.dateOpened || !form.expiration || !form.dateClosed}
        onClick={() =>
          onSubmit({
            ticker: form.ticker.toUpperCase(),
            strike: parseFloat(form.strike),
            premium: parseFloat(form.premium),
            contracts: parseInt(form.contracts),
            dateOpened: form.dateOpened,
            expiration: form.expiration,
            status: form.status,
            dateClosed: form.dateClosed,
            closePrice: form.status === "closed" ? parseFloat(form.closePrice) || 0 : 0,
            totalPremium: form.totalPremium !== "" ? parseFloat(form.totalPremium) : undefined,
            totalCloseCost: form.status === "closed" && form.totalCloseCost !== "" ? parseFloat(form.totalCloseCost) : undefined,
          })
        }
      >
        Log Trade
      </Btn>
    </div>
  );
}

function AddPositionForm({ onSubmit }) {
  const [form, setForm] = useState({ ticker: "", shares: 100, costBasis: "", dateAcquired: today() });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="space-y-4">
      <Field label="Ticker"><Input value={form.ticker} onChange={(e) => set("ticker", e.target.value.toUpperCase())} placeholder="e.g. HOOD" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Shares"><Input type="number" value={form.shares} onChange={(e) => set("shares", parseInt(e.target.value) || 0)} /></Field>
        <Field label="Cost Basis (per share)"><Input type="number" step="0.01" value={form.costBasis} onChange={(e) => set("costBasis", e.target.value)} placeholder="0.00" /></Field>
      </div>
      <Field label="Date Acquired"><Input type="date" value={form.dateAcquired} onChange={(e) => set("dateAcquired", e.target.value)} /></Field>
      <Btn
        className="w-full"
        disabled={!form.ticker || !form.costBasis}
        onClick={() => onSubmit({ ...form, costBasis: parseFloat(form.costBasis), shares: parseInt(form.shares) })}
      >
        Add Position
      </Btn>
    </div>
  );
}

function EditPositionForm({ position, onSubmit }) {
  const [form, setForm] = useState({ shares: position.shares, costBasis: position.costBasis });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">Update cost basis or share count for <strong>{position.ticker}</strong>.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Shares"><Input type="number" value={form.shares} onChange={(e) => set("shares", parseInt(e.target.value) || 0)} /></Field>
        <Field label="Cost Basis (per share)"><Input type="number" step="0.01" value={form.costBasis} onChange={(e) => set("costBasis", e.target.value)} /></Field>
      </div>
      <Btn className="w-full" onClick={() => onSubmit({ shares: parseInt(form.shares), costBasis: parseFloat(form.costBasis) })}>
        Update Position
      </Btn>
    </div>
  );
}

function WriteCallForm({ positions, events, defaultTicker, onSubmit }) {
  const [form, setForm] = useState({
    ticker: defaultTicker || "",
    strike: "",
    expiration: "",
    premium: "",
    contracts: 1,
    dateOpened: today(),
    currentPrice: "",
  });
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceSource, setPriceSource] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const fetchPrice = useCallback(async (ticker) => {
    if (!ticker) return;
    setPriceLoading(true);
    setPriceSource("");
    try {
      const resp = await fetch(`/api/fmp?action=quote&tickers=${ticker.toUpperCase()}`);
      const quotes = await resp.json();
      if (Array.isArray(quotes) && quotes.length > 0 && quotes[0].price > 0) {
        const q = quotes[0];
        setForm((f) => ({ ...f, currentPrice: String(q.price) }));
        const chg = q.change || 0;
        setPriceSource(chg >= 0 ? `↑ $${chg.toFixed(2)} today` : `↓ $${Math.abs(chg).toFixed(2)} today`);
      }
    } catch (err) { console.error("Price fetch error:", err); }
    setPriceLoading(false);
  }, []);

  // Auto-fetch price when ticker changes (debounced 500ms)
  useEffect(() => {
    if (!form.ticker || form.ticker.length < 1) return;
    const timer = setTimeout(() => fetchPrice(form.ticker), 500);
    return () => clearTimeout(timer);
  }, [form.ticker]);

  const currentPrice = parseFloat(form.currentPrice) || 0;
  const strike = parseFloat(form.strike) || 0;
  const premium = parseFloat(form.premium) || 0;
  const contracts = parseInt(form.contracts) || 1;
  const position = positions.find((p) => p.ticker === form.ticker);
  const costBasis = position ? position.costBasis : 0;

  // Suggested strikes based on current price
  const suggestedStrikes = currentPrice > 0 ? [
    { label: "Conservative", desc: "~8% OTM · Lower premium, lower assignment risk", strike: Math.ceil((currentPrice * 1.08) * 2) / 2 },
    { label: "Moderate", desc: "~4% OTM · Balanced premium & risk", strike: Math.ceil((currentPrice * 1.04) * 2) / 2 },
    { label: "Aggressive", desc: "~1% OTM · Higher premium, higher assignment risk", strike: Math.ceil((currentPrice * 1.01) * 2) / 2 },
  ] : [];

  // Max gain / max loss calculations
  const hasCalcData = strike > 0 && premium > 0 && contracts > 0;
  const totalPremium = premium * contracts * 100;
  const maxGainPerShare = costBasis > 0 ? (strike - costBasis) + premium : premium;
  const maxGainTotal = costBasis > 0 ? maxGainPerShare * contracts * 100 : totalPremium;
  const maxLossPerShare = costBasis > 0 ? costBasis - premium : currentPrice > 0 ? currentPrice - premium : 0;
  const maxLossTotal = maxLossPerShare * contracts * 100;
  const breakeven = costBasis > 0 ? costBasis - premium : currentPrice > 0 ? currentPrice - premium : 0;

  // Earnings proximity check
  const earningsWarning = useMemo(() => {
    if (!form.ticker || !form.expiration) return null;
    const matchingEvents = events.filter(
      (e) => e.ticker?.toUpperCase() === form.ticker.toUpperCase() && (e.type === "earnings")
    );
    const expDate = new Date(form.expiration);
    const openDate = new Date(form.dateOpened || today());
    const dangerousEvent = matchingEvents.find((e) => {
      const eDate = new Date(e.date);
      return eDate >= openDate && eDate <= expDate;
    });
    return dangerousEvent || null;
  }, [form.ticker, form.expiration, form.dateOpened, events]);

  return (
    <div className="space-y-4">
      {/* Earnings Warning Banner */}
      {earningsWarning && (
        <div className="bg-orange-50 border border-orange-300 rounded-lg p-3 flex items-start gap-2.5">
          <AlertTriangle size={18} className="text-orange-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-orange-800">Earnings Date Within This Expiration</p>
            <p className="text-xs text-orange-700 mt-0.5">
              {form.ticker} has earnings on <strong>{earningsWarning.date}</strong>. The stock could gap significantly on the report. 
              IV typically drops sharply after earnings (IV crush), which helps if the call expires worthless — but a big move up could mean assignment.
            </p>
          </div>
        </div>
      )}

      <Field label="Ticker">
        {positions.length > 0 ? (
          <Select
            value={form.ticker}
            onChange={(e) => set("ticker", e.target.value)}
            options={[{ value: "", label: "Select..." }, ...positions.map((p) => ({ value: p.ticker, label: `${p.ticker} (${p.shares} shares · basis ${formatCurrency(p.costBasis)})` }))]}
          />
        ) : (
          <Input value={form.ticker} onChange={(e) => set("ticker", e.target.value.toUpperCase())} placeholder="e.g. PLTR" />
        )}
      </Field>

      <Field label="Current Stock Price">
        <div className="relative">
          <Input
            type="number"
            step="0.01"
            value={form.currentPrice}
            onChange={(e) => { set("currentPrice", e.target.value); setPriceSource("Manual"); }}
            placeholder={priceLoading ? "Fetching price..." : "Enter current market price"}
            disabled={priceLoading}
            className={priceLoading ? "bg-gray-50 animate-pulse" : ""}
          />
          {priceLoading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <svg className="animate-spin h-4 w-4 text-gray-400" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            </div>
          )}
        </div>
        {priceSource && !priceLoading && form.currentPrice && (
          <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
            <Check size={10} className="text-green-500" /> {priceSource} · {formatCurrency(parseFloat(form.currentPrice))}
          </p>
        )}
      </Field>

      {/* Strike Picker */}
      {suggestedStrikes.length > 0 && (
        <div>
          <label className="text-xs font-medium text-gray-600 mb-2 block"><Tip term="otm">Suggested Strikes</Tip></label>
          <div className="grid grid-cols-3 gap-2">
            {suggestedStrikes.map((s) => {
              const isSelected = form.strike === String(s.strike);
              const otmPct = ((s.strike - currentPrice) / currentPrice * 100).toFixed(1);
              return (
                <button
                  key={s.label}
                  onClick={() => set("strike", String(s.strike))}
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    isSelected ? "border-gray-900 bg-gray-50 ring-1 ring-gray-900" : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <p className="text-xs font-semibold text-gray-900">{s.label}</p>
                  <p className="text-lg font-bold text-gray-900 mt-0.5">${s.strike.toFixed(1)}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{otmPct}% OTM</p>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-gray-400 mt-1.5">Click to auto-fill, or enter a custom strike below</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={<Tip term="strike">Strike Price</Tip>}><Input type="number" step="0.50" value={form.strike} onChange={(e) => set("strike", e.target.value)} placeholder="0.00" /></Field>
        <Field label={<Tip term="premium">Premium (per share)</Tip>}><Input type="number" step="0.01" value={form.premium} onChange={(e) => set("premium", e.target.value)} placeholder="0.00" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Expiration Date"><Input type="date" value={form.expiration} onChange={(e) => set("expiration", e.target.value)} /></Field>
        <Field label={<Tip term="contracts">Contracts</Tip>}><Input type="number" min="1" value={form.contracts} onChange={(e) => set("contracts", parseInt(e.target.value) || 1)} /></Field>
      </div>
      <Field label="Date Opened"><Input type="date" value={form.dateOpened} onChange={(e) => set("dateOpened", e.target.value)} /></Field>

      {/* Max Gain / Max Loss Calculator */}
      {hasCalcData && (
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-200">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Trade Outlook</p>
          </div>
          <div className="grid grid-cols-3 divide-x divide-gray-100">
            <div className="p-3 text-center">
              <p className="text-xs text-gray-500">Total Premium</p>
              <p className="text-base font-bold text-green-700 mt-0.5">{formatCurrency(totalPremium)}</p>
              <p className="text-xs text-gray-400">{formatCurrency(premium)}/share</p>
            </div>
            <div className="p-3 text-center">
              <p className="text-xs text-gray-500">Max Gain</p>
              <p className="text-base font-bold text-green-700 mt-0.5">{formatCurrency(maxGainTotal)}</p>
              <p className="text-xs text-gray-400">
                {costBasis > 0 ? `Stock to $${strike} + premium` : "Premium kept"}
              </p>
            </div>
            <div className="p-3 text-center">
              <p className="text-xs text-gray-500">Max Loss</p>
              <p className="text-base font-bold text-red-600 mt-0.5">{formatCurrency(maxLossTotal)}</p>
              <p className="text-xs text-gray-400">If stock → $0</p>
            </div>
          </div>
          <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
            <span className="text-xs text-gray-500"><Tip term="breakeven">Breakeven</Tip></span>
            <span className="text-xs font-semibold text-gray-700">{breakeven > 0 ? formatCurrency(breakeven) : "—"}</span>
          </div>
          {costBasis > 0 && strike > 0 && currentPrice > 0 && (
            <div className="px-3 py-2 border-t border-gray-100">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>$0</span>
                <div className="flex-1 relative h-6">
                  <div className="absolute inset-x-0 top-1/2 h-1 bg-gray-200 rounded -translate-y-1/2" />
                  {/* Breakeven marker */}
                  <div className="absolute top-0 h-full flex flex-col items-center" style={{ left: `${Math.min(95, Math.max(5, (breakeven / (strike * 1.2)) * 100))}%` }}>
                    <div className="w-0.5 h-3 bg-yellow-500" />
                    <span className="text-xs text-yellow-600 font-medium mt-0.5" style={{fontSize: '9px'}}>BE</span>
                  </div>
                  {/* Current price marker */}
                  <div className="absolute top-0 h-full flex flex-col items-center" style={{ left: `${Math.min(95, Math.max(5, (currentPrice / (strike * 1.2)) * 100))}%` }}>
                    <div className="w-0.5 h-3 bg-blue-500" />
                    <span className="text-xs text-blue-600 font-medium mt-0.5" style={{fontSize: '9px'}}>Now</span>
                  </div>
                  {/* Strike marker */}
                  <div className="absolute top-0 h-full flex flex-col items-center" style={{ left: `${Math.min(95, (strike / (strike * 1.2)) * 100)}%` }}>
                    <div className="w-0.5 h-3 bg-red-400" />
                    <span className="text-xs text-red-500 font-medium mt-0.5" style={{fontSize: '9px'}}>Strike</span>
                  </div>
                  {/* Profit zone */}
                  <div
                    className="absolute top-1/2 h-1.5 bg-green-200 rounded -translate-y-1/2 opacity-60"
                    style={{
                      left: `${Math.min(95, Math.max(5, (breakeven / (strike * 1.2)) * 100))}%`,
                      width: `${Math.max(0, (strike / (strike * 1.2)) * 100 - (breakeven / (strike * 1.2)) * 100)}%`
                    }}
                  />
                </div>
                <span>${(strike * 1.2).toFixed(0)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      <EtradeTip>
        <strong>E*Trade — How to Sell a Covered Call:</strong> Go to <strong>Trading → Options</strong>. Select your stock and the expiration date. Find your strike price in the chain and click <strong>"Sell"</strong> on the Call side. The order type should be <strong>"Sell to Open."</strong> Use a <strong>limit order</strong> at or slightly below the ask price. Make sure the account shows you hold enough shares (100 per contract) — E*Trade will automatically recognize it as covered.
      </EtradeTip>

      <Btn
        className="w-full"
        disabled={!form.ticker || !form.strike || !form.expiration || !form.premium}
        onClick={() =>
          onSubmit({
            ...form,
            strike: parseFloat(form.strike),
            premium: parseFloat(form.premium),
            contracts: parseInt(form.contracts),
            currentPrice: parseFloat(form.currentPrice) || undefined,
          })
        }
      >
        Log Call
      </Btn>
    </div>
  );
}

function CloseCallForm({ call, onSubmit, onRoll }) {
  const [action, setAction] = useState("expired");
  const [closePrice, setClosePrice] = useState("");
  // Roll fields
  const [rollStrike, setRollStrike] = useState(String(call.strike));
  const [rollExpiration, setRollExpiration] = useState("");
  const [rollPremium, setRollPremium] = useState("");

  const closePriceNum = parseFloat(closePrice) || 0;
  const rollPremiumNum = parseFloat(rollPremium) || 0;
  const rollNetCredit = action === "roll" ? (rollPremiumNum - closePriceNum) * call.contracts * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
        <p><strong>{call.ticker}</strong> ${call.strike} Call — Exp {call.expiration}</p>
        <p className="text-gray-500">Premium received: {formatCurrency(grossPrem(call))}</p>
      </div>
      <Field label="What happened?">
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: "expired", label: "Expired Worthless", desc: "Full premium kept" },
            { value: "closed", label: "Bought to Close", desc: "Paid to close early" },
            { value: "assigned", label: "Assigned", desc: "Shares called away" },
            { value: "roll", label: "Roll Forward", desc: "Close & open new call" },
          ].map((o) => (
            <button
              key={o.value}
              onClick={() => setAction(o.value)}
              className={`p-3 rounded-lg border text-left transition-all ${
                action === o.value ? "border-gray-900 bg-gray-50 ring-1 ring-gray-900" : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <p className="text-sm font-medium">{o.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{o.desc}</p>
            </button>
          ))}
        </div>
      </Field>

      {/* E*Trade execution guidance */}
      {action === "expired" && (
        <EtradeTip>
          <strong>E*Trade:</strong> Options that expire worthless are automatically removed from your positions. Check your account the morning after expiration to confirm. Go to <strong>Accounts → Positions</strong> and verify the call no longer appears.
        </EtradeTip>
      )}

      {action === "assigned" && (
        <EtradeTip>
          <strong>E*Trade:</strong> When assigned, your shares are automatically sold at the strike price. You'll see a "Sale" transaction in <strong>Accounts → Transaction History</strong>. The proceeds (strike × 100 × contracts) will settle in your account within 1 business day. If you want to re-enter the position, you'll need to buy the shares again.
        </EtradeTip>
      )}

      {action === "closed" && (
        <>
          <EtradeTip>
            <strong>E*Trade — How to Buy to Close:</strong> Go to <strong>Trading → Options</strong>. Select your stock, find your open call position, and click <strong>"Close"</strong>. The order type should be <strong>"Buy to Close."</strong> Set your limit price and submit. Use a limit order (not market) to control your cost. Check the bid/ask spread — the midpoint is usually a fair price.
          </EtradeTip>
          <Field label="Close Price (per share, what you paid to buy back)">
            <Input type="number" step="0.01" value={closePrice} onChange={(e) => setClosePrice(e.target.value)} placeholder="0.00" />
          </Field>
          {closePrice && (
            <div className={`rounded-lg p-3 text-sm border ${
              closePriceNum < call.premium ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"
            }`}>
              Net P/L: {formatCurrency(grossPrem(call) - closePriceNum * call.contracts * 100)}
            </div>
          )}
        </>
      )}

      {action === "roll" && (
        <>
          <EtradeTip>
            <strong>E*Trade — How to Roll a Call:</strong> You can do this in one order. Go to <strong>Trading → Options</strong>, select your stock, then choose <strong>"Roll"</strong> from the strategy dropdown (or your existing position). This creates a single spread order that buys to close your current call and sells to open the new one simultaneously. Set it as a <strong>net credit</strong> limit order. This is better than two separate orders because you avoid legging risk (getting filled on one side but not the other).
          </EtradeTip>
          <div className="border-t border-gray-200 pt-4">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Step 1: Buy to Close Current Call</p>
            <Field label="Close Price (per share)">
              <Input type="number" step="0.01" value={closePrice} onChange={(e) => setClosePrice(e.target.value)} placeholder="What you'll pay to buy back" />
            </Field>
          </div>

          <div className="border-t border-gray-200 pt-4">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Step 2: Open New Call</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="New Strike">
                <Input type="number" step="0.50" value={rollStrike} onChange={(e) => setRollStrike(e.target.value)} />
              </Field>
              <Field label="New Premium (per share)">
                <Input type="number" step="0.01" value={rollPremium} onChange={(e) => setRollPremium(e.target.value)} placeholder="0.00" />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="New Expiration">
                <Input type="date" value={rollExpiration} onChange={(e) => setRollExpiration(e.target.value)} />
              </Field>
            </div>
          </div>

          {closePrice && rollPremium && (
            <div className={`rounded-xl border overflow-hidden ${rollNetCredit >= 0 ? "border-green-200" : "border-red-200"}`}>
              <div className={`px-4 py-2 text-xs font-semibold uppercase tracking-wide ${rollNetCredit >= 0 ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
                Roll Summary
              </div>
              <div className="p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Buy to close ({call.contracts}x)</span>
                  <span className="text-red-600">-{formatCurrency(closePriceNum * call.contracts * 100)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">New premium ({call.contracts}x)</span>
                  <span className="text-green-700">+{formatCurrency(rollPremiumNum * call.contracts * 100)}</span>
                </div>
                <div className="flex justify-between border-t border-gray-100 pt-2 font-semibold">
                  <span>{rollNetCredit >= 0 ? "Net Credit" : "Net Debit"}</span>
                  <span className={rollNetCredit >= 0 ? "text-green-700" : "text-red-600"}>{formatCurrency(Math.abs(rollNetCredit))}</span>
                </div>
                <div className="flex justify-between text-xs text-gray-400">
                  <span>New strike</span>
                  <span>${parseFloat(rollStrike).toFixed(2)} (was ${call.strike.toFixed(2)})</span>
                </div>
                {rollNetCredit < 0 && (
                  <p className="text-xs text-red-600 mt-1">⚠ This roll costs you money. Consider whether a wider strike or later expiration would produce a credit.</p>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {action !== "roll" ? (
        <Btn className="w-full" onClick={() => onSubmit(action, action === "closed" ? closePrice : 0)}>
          Confirm: {action.charAt(0).toUpperCase() + action.slice(1)}
        </Btn>
      ) : (
        <Btn
          className="w-full"
          disabled={!closePrice || !rollStrike || !rollExpiration || !rollPremium}
          onClick={() => onRoll(closePrice, {
            ticker: call.ticker,
            strike: parseFloat(rollStrike),
            expiration: rollExpiration,
            premium: parseFloat(rollPremium),
            contracts: call.contracts,
            dateOpened: today(),
          })}
        >
          Confirm Roll Forward
        </Btn>
      )}
    </div>
  );
}

function AddEventForm({ onSubmit }) {
  const [form, setForm] = useState({ ticker: "", type: "earnings", date: "", description: "" });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="space-y-4">
      <Field label="Ticker"><Input value={form.ticker} onChange={(e) => set("ticker", e.target.value.toUpperCase())} placeholder="e.g. HOOD" /></Field>
      <Field label="Event Type">
        <Select value={form.type} onChange={(e) => set("type", e.target.value)} options={[
          { value: "earnings", label: "Earnings" },
          { value: "ex-div", label: "Ex-Dividend" },
          { value: "fed", label: "Fed Meeting" },
          { value: "other", label: "Other" },
        ]} />
      </Field>
      <Field label="Date"><Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} /></Field>
      {form.type === "other" && (
        <Field label="Description"><Input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Describe the event" /></Field>
      )}
      <Btn className="w-full" disabled={!form.ticker || !form.date} onClick={() => onSubmit(form)}>Add Event</Btn>
    </div>
  );
}

function ImportDataForm({ onSubmit }) {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);

  const handleParse = (text) => {
    setRaw(text);
    setError(null);
    setPreview(null);
    if (!text.trim()) return;
    try {
      const parsed = JSON.parse(text.trim());
      if (!parsed.positions && !parsed.calls) {
        setError("Doesn't look like dashboard data — missing positions or calls.");
        return;
      }
      setPreview({
        positions: (parsed.positions || []).length,
        calls: (parsed.calls || []).length,
        watchlist: (parsed.watchlist || []).length,
        events: (parsed.events || []).length,
      });
    } catch {
      setError("Invalid JSON. Make sure you copied the full export.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
        Paste your exported dashboard data below. This will replace all current data.
      </div>
      <textarea
        value={raw}
        onChange={(e) => handleParse(e.target.value)}
        placeholder='Paste exported JSON here...'
        className="w-full h-40 px-3 py-2 text-xs font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      {preview && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800">
          Found: {preview.positions} positions, {preview.calls} trades, {preview.watchlist} watchlist items, {preview.events} events
        </div>
      )}
      <Btn
        className="w-full"
        disabled={!preview}
        onClick={() => {
          try {
            const parsed = JSON.parse(raw.trim());
            onSubmit(parsed);
          } catch {}
        }}
      >
        Import & Replace Data
      </Btn>
    </div>
  );
}

function AddWatchlistForm({ onSubmit }) {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);

  const fetchVolData = async () => {
    if (!ticker.trim()) return;
    setLoading(true);
    setError("");
    setPreview(null);
    try {
      const t = ticker.toUpperCase();
      const [qResp, pResp] = await Promise.all([
        fetch(`/api/fmp?action=quote&tickers=${t}`),
        fetch(`/api/fmp?action=profile&tickers=${t}`),
      ]);
      const q = await qResp.json().then(d => Array.isArray(d) && d[0] || null);
      const p = await pResp.json().then(d => Array.isArray(d) && d[0] || null);
      if (!q || !q.price) throw new Error("Ticker not found");
      const enriched = enrichFromFMP(q, p);
      setPreview({ ticker: t, ...enriched, dateAdded: today(), dateScored: today() });
    } catch (err) {
      console.error("Fetch vol error:", err);
      setError(err.message === "Ticker not found" ? "Ticker not found — check the symbol." : "Couldn't fetch data. You can add manually below.");
      setPreview({
        ticker: ticker.toUpperCase(), sector: "", price: 0, volScore: 0, beta: 0,
        move30d: "", range52w: "", volumeVsAvg: "", nextEarnings: "", why: "",
        marketCap: "", near52wHigh: false, dateAdded: today(), dateScored: "",
      });
    }
    setLoading(false);
  };

  const vs = preview?.volScore || 0;
  const vsColor = vs >= 70 ? "bg-green-500" : vs >= 45 ? "bg-yellow-500" : "bg-red-400";
  const vsLabel = vs >= 70 ? "High" : vs >= 45 ? "Moderate" : "Low";
  const vsLabelColor = vs >= 70 ? "text-green-700" : vs >= 45 ? "text-yellow-700" : "text-red-600";

  return (
    <div className="space-y-4">
      <Field label="Ticker">
        <div className="flex gap-2">
          <Input
            value={ticker}
            onChange={(e) => { setTicker(e.target.value.toUpperCase()); setPreview(null); setError(""); }}
            placeholder="e.g. MARA"
            onKeyDown={(e) => { if (e.key === "Enter") fetchVolData(); }}
          />
          <Btn onClick={fetchVolData} disabled={!ticker.trim() || loading}>
            {loading ? (
              <span className="flex items-center gap-1.5">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                Scoring...
              </span>
            ) : "Analyze"}
          </Btn>
        </div>
      </Field>

      {error && <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{error}</p>}

      {loading && (
        <div className="bg-gray-50 rounded-lg p-4 space-y-3 animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-3/4" />
          <div className="h-4 bg-gray-200 rounded w-1/2" />
          <div className="h-4 bg-gray-200 rounded w-2/3" />
        </div>
      )}

      {preview && !loading && (
        <div className="bg-gray-50 rounded-xl p-4 space-y-3 border border-gray-200">
          <div className="flex items-center justify-between">
            <span className="text-lg font-bold text-gray-900">{preview.ticker}</span>
            <span className="text-xs text-gray-400">{preview.sector}</span>
          </div>

          {/* Vol Score bar */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-gray-500">Volatility Score</p>
              <span className={`text-xs font-semibold ${vsLabelColor}`}>{vs}/100 — {vsLabel}</span>
            </div>
            <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${vsColor}`} style={{ width: `${Math.min(100, vs)}%` }} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-500">Price</p>
              <p className="font-semibold">{preview.price ? formatCurrency(preview.price) : "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Beta</p>
              <p className="font-semibold">{preview.beta || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">30d Move</p>
              <p className={`font-semibold ${String(preview.move30d).startsWith("+") ? "text-green-700" : String(preview.move30d).startsWith("-") ? "text-red-600" : ""}`}>{preview.move30d || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">52w Range</p>
              <p className="font-semibold">{preview.range52w || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Vol vs Avg</p>
              <p className="font-semibold">{preview.volumeVsAvg || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Next Earnings</p>
              <p className="font-semibold">{preview.nextEarnings || "—"}</p>
            </div>
          </div>

          {preview.why && (
            <p className="text-xs text-gray-600 bg-white rounded-lg p-2 border border-gray-100">{preview.why}</p>
          )}

          {/* Manual overrides */}
          <details className="text-xs">
            <summary className="text-gray-400 cursor-pointer hover:text-gray-600">Edit values manually</summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Vol Score (0-100)">
                <Input type="number" min="0" max="100" value={preview.volScore} onChange={(e) => setPreview(p => ({ ...p, volScore: parseInt(e.target.value) || 0 }))} />
              </Field>
              <Field label="Beta">
                <Input type="number" step="0.01" value={preview.beta} onChange={(e) => setPreview(p => ({ ...p, beta: parseFloat(e.target.value) || 0 }))} />
              </Field>
              <Field label="Sector">
                <Input value={preview.sector} onChange={(e) => setPreview(p => ({ ...p, sector: e.target.value }))} />
              </Field>
              <Field label="Next Earnings">
                <Input value={preview.nextEarnings} onChange={(e) => setPreview(p => ({ ...p, nextEarnings: e.target.value }))} />
              </Field>
            </div>
          </details>
        </div>
      )}

      <Btn
        className="w-full"
        disabled={!preview || loading}
        onClick={() => onSubmit(preview)}
      >
        {preview ? `Add ${preview.ticker} to Watchlist` : "Enter ticker and click Analyze"}
      </Btn>
    </div>
  );
}
