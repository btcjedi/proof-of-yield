import { useState, useEffect, useRef, useMemo, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG — UPDATE THIS WHEN FILINGS DROP. REDEPLOY IN 60 SECONDS.
// All figures manually verified against public SEC filings.
// ═══════════════════════════════════════════════════════════════════════════════
const CONFIG = {
  MSTR: {
    // Source: Strategy 8-K / weekly BTC update, March 2026
    btcHeld:        { val: 761_068,        src: "manual", lastVerified: "2026-03-21", asOf: "Strategy 8-K Mar 21 2026" },
    // Source: Strategy Q4 2025 earnings call — "long-term debt ended year at $8.2B"
    seniorDebt:     { val: 8_200_000_000,  src: "manual", lastVerified: "2026-02-05", asOf: "Q4 2025 Earnings" },
    // Source: 10-Q Sept 30 2025 — mezzanine equity $5.786B across 5 series. Update when Q4 10-K drops.
    preferredPar:   { val: 5_786_000_000,  src: "manual", lastVerified: "2025-11-03", asOf: "10-Q Sept 30 2025 · 5 series" },
    // STRC 11.5% + STRK 8% + STRF 10% + STRD 10% + STRE 10% on ~$5.786B par — approximate
    annualDividend: { val: 580_000_000,    src: "manual", lastVerified: "2025-11-03", asOf: "Estimated · verify on next 10-K" },
    // Strategy has a $2.25B cash reserve specifically for dividend coverage (Q4 2025 earnings)
    cashReserve:    { val: 2_250_000_000,  src: "manual", lastVerified: "2026-02-05", asOf: "Q4 2025 Earnings · 2.5yr coverage" },
    latestFiling:   { val: "10-Q Sept 30 2025", src: "manual", lastVerified: "2025-11-03", asOf: "SEC EDGAR" },
  },
  SATA: {
    // Source: Strive 8-K March 11 2026
    btcHeld:        { val: 8_205,          src: "manual", lastVerified: "2026-03-11", asOf: "Strive 8-K Mar 2026" },
    seniorDebt:     { val: 165_000_000,    src: "manual", lastVerified: "2026-03-11", asOf: "Strive filing" },
    // $100 par value — $1.0625/share monthly at 12.75% annual = $100 par
    preferredPar:   { val: 300_000_000,    src: "manual", lastVerified: "2026-03-11", asOf: "Strive filing" },
    // SATA rate increased to 12.75% effective March 16 2026 (8-K March 11 2026)
    annualDividend: { val: 38_250_000,     src: "manual", lastVerified: "2026-03-11", asOf: "12.75% × $300M par" },
    latestFiling:   { val: "8-K Mar 11 2026", src: "manual", lastVerified: "2026-03-11", asOf: "SEC EDGAR" },
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// INSTRUMENTS
// ═══════════════════════════════════════════════════════════════════════════════
const INSTRUMENTS = [
  {
    id: "strc", ticker: "STRC",
    fullName: "Variable Rate Series A Perpetual Stretch Preferred Stock",
    issuer: "Strategy", issuerTicker: "MSTR",
    coupon: 11.5,           // CURRENT RATE — variable, adjusts monthly. Verify at strategy.com/strc
    couponNote: "Variable rate · Adjusts monthly · Current as of Mar 2026",
    parValue: 100,
    frequency: "Monthly", taxNote: "Return of capital (tax-deferred)",
    color: "#F7931A", dataKey: "MSTR", hasLiveEdgar: true,
    isVariable: true,
    seniority: "Preferred equity · Junior to all debt · Pari passu with other preferred series",
    collateralNote: "NOT directly collateralized by Bitcoin holdings. Asset coverage is indirect.",
  },
  {
    id: "sata", ticker: "SATA",
    fullName: "Variable Rate Series A Perpetual Preferred Stock",
    issuer: "Strive Asset Management", issuerTicker: "STRV",
    coupon: 12.75,          // Updated March 16 2026 per Strive 8-K
    couponNote: "Variable rate · Increased to 12.75% Mar 16 2026",
    parValue: 100,
    frequency: "Monthly", taxNote: "Return of capital (tax-deferred)",
    color: "#60a5fa", dataKey: "SATA", hasLiveEdgar: false,
    isVariable: true,
    seniority: "Preferred equity · Junior to senior debt",
    collateralNote: "Strive holds Bitcoin as primary treasury asset. Preferred is not directly collateralized.",
  },
];

const YIELD_COMPS = [
  { label: "6-Mo T-Bill",  y: 4.3,  type: "trad" },
  { label: "Money Market", y: 4.6,  type: "trad" },
  { label: "IG Corp Bond", y: 5.1,  type: "trad" },
  { label: "HY Corp Bond", y: 7.2,  type: "trad" },
  { label: "STRC",         y: 11.5, type: "btc"  },
  { label: "SATA",         y: 12.75,type: "btc"  },
];

const RISK_SCENARIOS = [-0.20, -0.40, -0.60, -0.80];

const SIM_PRODUCTS = [
  { id: "strc",   label: "STRC",   name: "Strategy Preferred",  rate: 11.5,  color: "#F7931A", rateNote: "Variable · Current rate" },
  { id: "sata",   label: "SATA",   name: "Strive Bitcoin Bond", rate: 12.75, color: "#60a5fa", rateNote: "Variable · Updated Mar 2026" },
  { id: "custom", label: "CUSTOM", name: "Custom Rate",         rate: 10.0,  color: "#a78bfa", rateNote: "User defined"               },
];

const COMPARISONS = [
  { label: "High-Yield Savings", rate: 4.5 },
  { label: "10-Yr Treasury",     rate: 4.2 },
  { label: "HY Corp Bond ETF",   rate: 7.2 },
];

const BTC_SCENARIOS = [
  { label: "Bear (−20%/yr)", rate: -20 },
  { label: "Flat (0%/yr)",   rate: 0   },
  { label: "Base (+30%/yr)", rate: 30  },
  { label: "Bull (+80%/yr)", rate: 80  },
];

const TREASURY_DATA = [
  {
    name: "Strategy",         ticker: "MSTR",   btcHeld: 761_068, sharesOut: 268_000_000,
    hasPreferred: true,  preferred: ["STRC ~11.5%", "STRK 8%", "STRF 10%", "STRD 10%", "STRE 10%"],
    preferredPar: 5_786_000_000, seniorDebt: 8_200_000_000, annualDiv: 580_000_000,
    color: "#F7931A", asOf: "Mar 2026", category: "treasury",
  },
  {
    name: "Strive",           ticker: "STRV",   btcHeld: 8_205,   sharesOut: 50_000_000,
    hasPreferred: true,  preferred: ["SATA 12.75%"],
    preferredPar: 300_000_000,   seniorDebt: 165_000_000,   annualDiv: 38_250_000,
    color: "#60a5fa", asOf: "Mar 2026", category: "treasury",
  },
  {
    name: "MARA Holdings",    ticker: "MARA",   btcHeld: 44_893,  sharesOut: 380_000_000,
    hasPreferred: false, preferred: [],
    preferredPar: 0,             seniorDebt: 1_000_000_000, annualDiv: 0,
    color: "#666",    asOf: "Q4 2024",   category: "miner",
  },
  {
    name: "Riot Platforms",   ticker: "RIOT",   btcHeld: 17_429,  sharesOut: 355_000_000,
    hasPreferred: false, preferred: [],
    preferredPar: 0,             seniorDebt: 0,             annualDiv: 0,
    color: "#666",    asOf: "Q4 2024",   category: "miner",
  },
  {
    name: "Metaplanet",       ticker: "3350.T", btcHeld: 3_350,   sharesOut: 5_800_000_000,
    hasPreferred: false, preferred: [],
    preferredPar: 0,             seniorDebt: 0,             annualDiv: 0,
    color: "#666",    asOf: "Mar 2025",  category: "treasury",
  },
  {
    name: "Semler Scientific",ticker: "SMLR",   btcHeld: 3_808,   sharesOut: 6_000_000,
    hasPreferred: false, preferred: [],
    preferredPar: 0,             seniorDebt: 0,             annualDiv: 0,
    color: "#666",    asOf: "Q4 2024",  category: "treasury",
  },
  {
    name: "Tesla",            ticker: "TSLA",   btcHeld: 9_720,   sharesOut: 3_190_000_000,
    hasPreferred: false, preferred: [],
    preferredPar: 0,             seniorDebt: 0,             annualDiv: 0,
    color: "#666",    asOf: "Q4 2024",  category: "corporate",
  },
  {
    name: "Block",            ticker: "XYZ",    btcHeld: 8_027,   sharesOut: 480_000_000,
    hasPreferred: false, preferred: [],
    preferredPar: 0,             seniorDebt: 0,             annualDiv: 0,
    color: "#666",    asOf: "Q4 2024",  category: "corporate",
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// HOOKS
// ═══════════════════════════════════════════════════════════════════════════════
function useWindowWidth() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 1024);
  useEffect(() => { const h = () => setW(window.innerWidth); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, []);
  return w;
}

function useUrlState() {
  const read = () => {
    try {
      const p = new URLSearchParams(window.location.search);
      return {
        view:       p.get("view")    || "risk",
        riskInst:   p.get("inst")    || "strc",
        sliderBtc:  p.get("btc")     ? Number(p.get("btc"))   : null,
        principal:  p.get("amt")     ? Number(p.get("amt"))   : 10000,
        simProduct: p.get("product") || "strc",
        years:      p.get("years")   ? Number(p.get("years")) : 10,
        drip:       p.get("drip")    !== "false",
        customRate: p.get("rate")    ? Number(p.get("rate"))  : 10,
      };
    } catch { return {}; }
  };
  const write = useCallback((s) => {
    try {
      const p = new URLSearchParams();
      if (s.view       !== "risk")  p.set("view",    s.view);
      if (s.riskInst   !== "strc")  p.set("inst",    s.riskInst);
      if (s.sliderBtc  !== null)    p.set("btc",     s.sliderBtc);
      if (s.principal  !== 10000)   p.set("amt",     s.principal);
      if (s.simProduct !== "strc")  p.set("product", s.simProduct);
      if (s.years      !== 10)      p.set("years",   s.years);
      if (!s.drip)                  p.set("drip",    "false");
      if (s.customRate !== 10)      p.set("rate",    s.customRate);
      const qs = p.toString();
      window.history.replaceState({}, "", qs ? `?${qs}` : window.location.pathname);
    } catch {}
  }, []);
  return { read, write };
}

function useInstrumentData() {
  const init = (key) => ({ ...CONFIG[key], _edgarFetched: false });
  const [mstr, setMstr] = useState(init("MSTR"));
  const [sata]          = useState(init("SATA"));
  const [btcPrice, setBtcPrice] = useState(84000);
  const [priceAt, setPriceAt]   = useState(null);
  const [priceStatus, setPriceStatus] = useState("loading");

  useEffect(() => {
    const go = async () => {
      try {
        const res = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
        );
        const d = await res.json();
        const p = d?.bitcoin?.usd;
        if (p && p > 1000) {
          setBtcPrice(p);
          setPriceAt(Date.now());
          setPriceStatus("live");
        } else {
          setPriceStatus("error");
        }
      } catch { setPriceStatus("error"); }
    };
    go(); const id = setInterval(go, 60000); return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const go = async () => {
      try {
        const r = await fetch("https://api.coingecko.com/api/v3/companies/public_treasury/bitcoin");
        const d = await r.json();
        const co = d.companies?.find(c => c.symbol === "MSTR");
        if (co?.total_holdings) setMstr(prev => ({ ...prev, btcHeld: { val: co.total_holdings, src: "live", lastVerified: new Date().toISOString().split("T")[0], asOf: `CoinGecko · ${new Date().toLocaleTimeString()}` } }));
      } catch {}
    };
    go(); const id = setInterval(go, 300000); return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (mstr._edgarFetched) return;
    const go = async () => {
      const CIK = "0001050446";
      const concept = (c) => `https://data.sec.gov/api/xbrl/companyconcept/CIK${CIK}/us-gaap/${c}.json`;
      const pick = (data) => {
        if (!data?.units?.USD) return null;
        const byEnd = {};
        data.units.USD.filter(v => (v.form === "10-Q" || v.form === "10-K") && v.val > 0 && !v.segment)
          .forEach(v => { if (!byEnd[v.end] || new Date(v.filed) > new Date(byEnd[v.end].filed)) byEnd[v.end] = v; });
        return Object.values(byEnd).sort((a, b) => new Date(b.end) - new Date(a.end))[0] || null;
      };
      const [r0, r1, r2] = await Promise.allSettled([
        fetch(concept("LongTermDebt")).then(r => r.json()),
        fetch(concept("TemporaryEquityCarryingAmountAttributableToParent")).then(r => r.json()),
        fetch(`https://data.sec.gov/submissions/CIK${CIK}.json`).then(r => r.json()),
      ]);
      const u = { _edgarFetched: true };
      if (r0.status === "fulfilled") { const e = pick(r0.value); if (e) u.seniorDebt = { val: e.val, src: "edgar", lastVerified: e.filed, asOf: `${e.form} · ${e.end}` }; }
      if (r1.status === "fulfilled") { const e = pick(r1.value); if (e && e.val > 1e9) u.preferredPar = { val: e.val, src: "edgar", lastVerified: e.filed, asOf: `${e.form} · ${e.end} · All 5 series` }; }
      if (r2.status === "fulfilled") {
        const s = r2.value?.filings?.recent;
        if (s?.form) { const i = s.form.findIndex(f => f === "10-Q" || f === "10-K"); if (i >= 0) u.latestFiling = { val: `${s.form[i]} · Filed ${s.filingDate[i]}`, src: "edgar", lastVerified: s.filingDate[i], asOf: "SEC EDGAR" }; }
      }
      setMstr(prev => ({ ...prev, ...u }));
    };
    go();
  }, []);

  return { mstr, sata, btcPrice, priceAt, priceStatus };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MATH — equations verified against public filings
// ═══════════════════════════════════════════════════════════════════════════════
const flat = d => ({
  btcHeld:        typeof d.btcHeld        === "object" ? d.btcHeld.val        : d.btcHeld,
  seniorDebt:     typeof d.seniorDebt     === "object" ? d.seniorDebt.val     : d.seniorDebt,
  preferredPar:   typeof d.preferredPar   === "object" ? d.preferredPar.val   : d.preferredPar,
  annualDividend: typeof d.annualDividend === "object" ? d.annualDividend.val : d.annualDividend,
});

// Risk Floor: BTC price at which (BTC Treasury - Senior Debt) = Preferred Par
// i.e. (BTC Held × Price) - Senior Debt = Preferred Par → Price = (Senior Debt + Preferred Par) / BTC Held
const riskFloor = d => { const f = flat(d); return (f.seniorDebt + f.preferredPar) / f.btcHeld; };

// Asset Coverage: (BTC Treasury - Senior Debt) / Preferred Par
// Measures how many times over preferred par is covered by net BTC assets
const coverage = (d, p) => { const f = flat(d); return Math.max(0, (f.btcHeld * p - f.seniorDebt) / f.preferredPar); };

// Excess Asset Buffer: net assets above all obligations, expressed as years of dividend payments
// NOTE: This is NOT a cash dividend reserve. Dividends are paid from cash operations and new capital raises.
// Strategy maintains a separate $2.25B cash reserve for dividend coverage.
const divRunway = (d, p) => { const f = flat(d); const x = f.btcHeld * p - f.seniorDebt - f.preferredPar; return x > 0 ? x / f.annualDividend : 0; };

function buildYearly({ principal, rate, years, drip, btcApr, btcPrice }) {
  const mr = rate / 100 / 12; let bal = principal, totalDiv = 0, cash = 0;
  return Array.from({ length: years }, (_, yi) => {
    const start = bal; let yd = 0;
    for (let m = 0; m < 12; m++) { const d = bal * mr; yd += d; if (drip) bal += d; }
    if (!drip) cash += yd;
    totalDiv += yd;
    return { year: yi + 1, balance: drip ? bal : principal, totalValue: drip ? bal : principal + cash, dividends: totalDiv, monthlyIncome: start * mr, btcUsd: (principal / btcPrice) * btcPrice * Math.pow(1 + btcApr / 100, yi + 1) };
  });
}

function buildComps({ principal, rate, years, drip }) {
  return COMPARISONS.map(c => {
    let bal = principal, divs = 0;
    for (let y = 0; y < years; y++) { const d = bal * (c.rate / 100); divs += d; if (drip) bal += d; }
    return { ...c, endValue: drip ? bal : principal + divs };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORMAT
// ═══════════════════════════════════════════════════════════════════════════════
const usd  = n => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const cpt  = n => n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : usd(n);
const cmpt = n => n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : usd(n);
const ppct = n => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
const ago  = d => { if (!d) return "—"; const s = Math.floor((Date.now() - d) / 1000); if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s / 60)}m ago`; return `${Math.floor(s / 3600)}h ago`; };

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED UI
// ═══════════════════════════════════════════════════════════════════════════════
function AN({ value, fmt, dur = 700 }) {
  const [v, setV] = useState(value); const prev = useRef(value), raf = useRef();
  useEffect(() => {
    const from = prev.current, to = value, t0 = performance.now();
    const tick = now => { const p = Math.min((now - t0) / dur, 1), e = 1 - Math.pow(1 - p, 4); setV(from + (to - from) * e); if (p < 1) raf.current = requestAnimationFrame(tick); else prev.current = to; };
    raf.current = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf.current);
  }, [value]);
  return <span>{fmt(v)}</span>;
}

function Badge({ status, asOf, sm }) {
  const cfg = {
    live:    { c: "#22c55e", bg: "rgba(34,197,94,0.08)",   b: "rgba(34,197,94,0.2)",   dot: true,  t: "LIVE"   },
    edgar:   { c: "#60a5fa", bg: "rgba(96,165,250,0.08)",  b: "rgba(96,165,250,0.2)",  dot: false, t: "EDGAR"  },
    manual:  { c: "#555",    bg: "rgba(85,85,85,0.06)",    b: "rgba(85,85,85,0.15)",   dot: false, t: "MANUAL" },
    error:   { c: "#ef4444", bg: "rgba(239,68,68,0.08)",   b: "rgba(239,68,68,0.2)",   dot: false, t: "ERROR"  },
    loading: { c: "#888",    bg: "rgba(136,136,136,0.06)", b: "rgba(136,136,136,0.15)",dot: false, t: "..."    },
  };
  const x = cfg[status] || cfg.manual;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: sm ? "2px 6px" : "3px 8px", borderRadius: 100, background: x.bg, border: `1px solid ${x.b}`, fontSize: 9, fontFamily: "monospace", letterSpacing: 1, color: x.c, whiteSpace: "nowrap" }}>
      {x.dot && <span style={{ width: 5, height: 5, borderRadius: "50%", background: x.c, boxShadow: `0 0 5px ${x.c}`, animation: "glow 2s infinite", display: "inline-block" }} />}
      {x.t}{asOf ? ` · ${asOf}` : ""}
    </span>
  );
}

function Toggle({ on, onToggle, label, sub, color }) {
  return (
    <button onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", borderRadius: 8, cursor: "pointer", border: `1px solid ${on ? color + "44" : "#1a1a1a"}`, background: on ? color + "09" : "#080808", flex: 1, minWidth: 150, transition: "all 0.15s" }}>
      <div style={{ width: 32, height: 18, borderRadius: 9, background: on ? color : "#1a1a1a", border: `1px solid ${on ? color : "#333"}`, position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
        <div style={{ position: "absolute", top: 2, left: on ? 14 : 2, width: 12, height: 12, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
      </div>
      <div style={{ textAlign: "left" }}>
        <div style={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace", color: on ? color : "#333" }}>{label} {on ? "ON" : "OFF"}</div>
        <div style={{ fontSize: 9, color: "#2a2a2a", fontFamily: "monospace" }}>{sub}</div>
      </div>
    </button>
  );
}

function Card({ children, style }) { return <div style={{ background: "#080808", border: "1px solid #181818", borderRadius: 12, ...style }}>{children}</div>; }
function Label({ children }) { return <div style={{ fontSize: 10, color: "#333", textTransform: "uppercase", letterSpacing: 2, fontFamily: "monospace", marginBottom: 12 }}>{children}</div>; }

function ShareButton({ state }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try {
      const p = new URLSearchParams();
      if (state.view !== "risk")       p.set("view",    state.view);
      if (state.riskInst !== "strc")   p.set("inst",    state.riskInst);
      if (state.sliderBtc !== null)    p.set("btc",     state.sliderBtc);
      if (state.principal !== 10000)   p.set("amt",     state.principal);
      if (state.simProduct !== "strc") p.set("product", state.simProduct);
      if (state.years !== 10)          p.set("years",   state.years);
      if (!state.drip)                 p.set("drip",    "false");
      if (state.customRate !== 10)     p.set("rate",    state.customRate);
      const url = `${window.location.origin}${window.location.pathname}${p.toString() ? "?" + p.toString() : ""}`;
      navigator.clipboard.writeText(url);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  return (
    <button onClick={copy} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 6, cursor: "pointer", background: copied ? "rgba(34,197,94,0.08)" : "#080808", border: `1px solid ${copied ? "rgba(34,197,94,0.3)" : "#1e1e1e"}`, color: copied ? "#22c55e" : "#444", fontSize: 11, fontFamily: "monospace", whiteSpace: "nowrap" }}>
      {copied ? "✓ Copied!" : "⬡ Share Scenario"}
    </button>
  );
}

// Variable rate badge
function VarBadge({ note }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 4, background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)", fontSize: 9, fontFamily: "monospace", color: "#fbbf24", letterSpacing: 1 }}>
      ◈ VARIABLE RATE · {note}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// RISK DASHBOARD COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function CollateralDisclaimer({ inst }) {
  return (
    <div style={{ background: "rgba(251,191,36,0.04)", border: "1px solid rgba(251,191,36,0.15)", borderRadius: 10, padding: "12px 16px", marginBottom: 20, display: "flex", gap: 10, alignItems: "flex-start" }}>
      <span style={{ color: "#fbbf24", fontSize: 14, flexShrink: 0, marginTop: 1 }}>⚠</span>
      <div style={{ fontSize: 11, color: "#555", fontFamily: "monospace", lineHeight: 1.8 }}>
        <span style={{ color: "#fbbf24", fontWeight: 700 }}>Important: </span>
        {inst.collateralNote} The coverage ratio below measures whether total BTC assets exceed total obligations — it is an indirect asset coverage metric, not a direct collateral claim. Verify all figures independently before making investment decisions.
      </div>
    </div>
  );
}

function DataPanel({ inst, data, btcPrice, priceAt, priceStatus }) {
  const [open, setOpen] = useState(false);
  const fields = [
    { label: "BTC / USD Price",        field: null,             overrideStatus: priceStatus, overrideAsOf: ago(priceAt),   value: btcPrice ? usd(btcPrice) : "—" },
    { label: "BTC Held",               field: "btcHeld",        value: (data.btcHeld?.val || 0).toLocaleString() + " BTC"  },
    { label: "Senior Debt",            field: "seniorDebt",     value: cpt(data.seniorDebt?.val)                           },
    { label: "Total Preferred Par",    field: "preferredPar",   value: cpt(data.preferredPar?.val)                         },
    { label: "Annual Dividend Oblig.", field: "annualDividend", value: cpt(data.annualDividend?.val)                       },
    { label: "Latest Filing",          field: "latestFiling",   value: data.latestFiling?.val                              },
  ];
  if (data.cashReserve) fields.push({ label: "Cash Dividend Reserve", field: "cashReserve", value: cpt(data.cashReserve?.val) });

  return (
    <div style={{ marginBottom: 24 }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 18px", borderRadius: 10, background: "#080808", border: "1px solid #181818", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: inst.hasLiveEdgar ? "#22c55e" : "#555", boxShadow: inst.hasLiveEdgar ? "0 0 6px #22c55e" : "none", animation: "glow 2s infinite" }} />
          <span style={{ fontSize: 10, fontFamily: "monospace", letterSpacing: 2, color: "#444" }}>DATA SOURCES & FRESHNESS</span>
        </div>
        <span style={{ fontSize: 11, color: "#333", fontFamily: "monospace" }}>{open ? "▲ hide" : "▼ show"}</span>
      </button>
      {open && (
        <div style={{ background: "#060606", border: "1px solid #141414", borderTop: "none", borderRadius: "0 0 10px 10px", overflow: "hidden" }}>
          {fields.map((f, i) => {
            const d = f.field ? data[f.field] : null;
            const status = f.overrideStatus || (d?.src === "live" ? "live" : d?.src === "edgar" ? "edgar" : "manual");
            const asOf = f.overrideAsOf || d?.asOf || "—";
            const lv = d?.lastVerified;
            return (
              <div key={f.label} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", padding: "11px 18px", gap: 12, alignItems: "center", borderBottom: i < fields.length - 1 ? "1px solid #0e0e0e" : "none" }}>
                <div>
                  <div style={{ fontSize: 11, color: "#555", fontFamily: "monospace" }}>{f.label}</div>
                  <div style={{ fontSize: 9, color: "#2a2a2a", fontFamily: "monospace", marginTop: 2 }}>{asOf}{lv ? ` · Verified ${lv}` : ""}</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "monospace", color: "#888", textAlign: "right" }}>{f.value}</div>
                <Badge status={status} sm />
              </div>
            );
          })}
          <div style={{ padding: "10px 18px", fontSize: 9, color: "#222", fontFamily: "monospace", borderTop: "1px solid #0e0e0e", lineHeight: 1.8 }}>
            {inst.hasLiveEdgar ? "BTC holdings: CoinGecko treasury API · 5min refresh. Balance sheet: SEC EDGAR XBRL. Manual figures verified against public filings." : "⚠ SATA data is manually sourced from public Strive filings. Verify at SEC EDGAR before relying on these figures."}
          </div>
        </div>
      )}
    </div>
  );
}

function HeroStatement({ inst, data, btcPrice, sliderPrice }) {
  const p = sliderPrice ?? btcPrice, floor = riskFloor(data), run = divRunway(data, p), drop = (p - floor) / p * 100, safe = p > floor;
  return (
    <div style={{ background: "#040404", border: `1px solid ${inst.color}22`, borderRadius: 14, padding: "32px 28px", position: "relative", overflow: "hidden", marginBottom: 20 }}>
      <div style={{ position: "absolute", top: -100, left: "50%", transform: "translateX(-50%)", width: 500, height: 250, background: `radial-gradient(ellipse, ${inst.color}0e 0%, transparent 65%)`, pointerEvents: "none" }} />
      <div style={{ position: "relative" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 14px", borderRadius: 100, marginBottom: 20, background: safe ? "rgba(34,197,94,0.07)" : "rgba(239,68,68,0.07)", border: `1px solid ${safe ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)"}` }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: safe ? "#22c55e" : "#ef4444", boxShadow: `0 0 6px ${safe ? "#22c55e" : "#ef4444"}`, animation: "glow 2s infinite" }} />
          <span style={{ fontSize: 10, fontFamily: "monospace", letterSpacing: 1.5, color: safe ? "#22c55e" : "#ef4444" }}>{safe ? `$${inst.ticker} ASSET COVERAGE POSITIVE` : `$${inst.ticker} ASSET COVERAGE NEGATIVE AT THIS PRICE`}</span>
        </div>

        <div style={{ fontSize: 14, color: "#4a4a4a", fontFamily: "monospace", marginBottom: 10, lineHeight: 1.6 }}>
          For <span style={{ color: inst.color, fontWeight: 700 }}>${inst.ticker}</span> preferred par to exceed net BTC assets, Bitcoin must fall from <span style={{ color: "#777" }}>{usd(p)}</span> to:
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 6, flexWrap: "wrap" }}>
          <div style={{ fontSize: 56, fontWeight: 900, letterSpacing: "-3px", lineHeight: 1, fontFamily: "monospace", color: "#ef4444" }}><AN value={floor} fmt={n => usd(n)} /></div>
          <div style={{ padding: "6px 14px", borderRadius: 8, background: "rgba(239,68,68,0.09)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 13, fontFamily: "monospace", color: "#ef4444", fontWeight: 700 }}><AN value={drop} fmt={n => `−${n.toFixed(1)}%`} /></div>
        </div>
        <div style={{ fontSize: 11, color: "#2e2e2e", fontFamily: "monospace", marginBottom: 24 }}>
          BTC price at which (BTC Treasury − Senior Debt) = Total Preferred Par · <span style={{ color: "#333" }}>Formula: (Senior Debt + Preferred Par) ÷ BTC Held</span>
        </div>

        <div style={{ height: 1, background: "#111", marginBottom: 24 }} />

        <div style={{ fontSize: 14, color: "#4a4a4a", fontFamily: "monospace", marginBottom: 10 }}>
          At today's price, net assets above all obligations represent:
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <div style={{ fontSize: 56, fontWeight: 900, letterSpacing: "-3px", lineHeight: 1, fontFamily: "monospace", color: inst.color }}><AN value={run} fmt={n => `${n.toFixed(1)} yrs`} /></div>
          <div style={{ padding: "6px 14px", borderRadius: 8, background: `${inst.color}12`, border: `1px solid ${inst.color}28`, fontSize: 13, fontFamily: "monospace", color: inst.color, fontWeight: 700 }}><AN value={run * 12} fmt={n => `${n.toFixed(0)} months`} /></div>
        </div>
        <div style={{ fontSize: 11, color: "#2e2e2e", fontFamily: "monospace", marginTop: 8 }}>
          of dividend payments as an asset buffer above total obligations. Note: dividends are paid from cash operations and capital raises — not BTC liquidation. Strategy maintains a separate $2.25B cash reserve for dividend coverage.
        </div>
      </div>
    </div>
  );
}

function PriceSlider({ inst, data, livePrice, sliderPrice, setSliderPrice }) {
  const floor = riskFloor(data), min = Math.floor(floor * 0.4 / 1000) * 1000, max = Math.ceil(livePrice * 2.2 / 10000) * 10000;
  const p = sliderPrice ?? livePrice, cov = coverage(data, p), run = divRunway(data, p), safe = p > floor;
  const floorPct = Math.max(0, Math.min(100, ((floor - min) / (max - min)) * 100));
  return (
    <Card style={{ padding: "20px 22px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: 2, fontFamily: "monospace" }}>Test Any BTC Price</div>
          <div style={{ fontSize: 11, color: "#2a2a2a", fontFamily: "monospace", marginTop: 2 }}>Coverage and asset buffer update in real time</div>
        </div>
        {sliderPrice !== null && <button onClick={() => setSliderPrice(null)} style={{ fontSize: 10, color: "#444", fontFamily: "monospace", background: "none", border: "1px solid #1e1e1e", borderRadius: 4, padding: "3px 8px", cursor: "pointer" }}>↺ Reset</button>}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 30, fontWeight: 900, fontFamily: "monospace", color: safe ? "#e5e5e5" : "#ef4444" }}>{usd(p)}</div>
        <div style={{ fontSize: 11, color: "#333" }}>{sliderPrice ? "custom scenario" : "live price"}</div>
      </div>
      <div style={{ position: "relative", marginBottom: 6, paddingTop: 22 }}>
        <div style={{ position: "absolute", left: `${floorPct}%`, top: 0, transform: "translateX(-50%)", fontSize: 8, color: "#ef4444", fontFamily: "monospace", whiteSpace: "nowrap", textAlign: "center" }}>▼ ASSET FLOOR<br />{usd(floor)}</div>
        <div style={{ position: "absolute", left: `${floorPct}%`, top: 22, bottom: -4, width: 1, background: "rgba(239,68,68,0.3)", zIndex: 2, pointerEvents: "none" }} />
        <input type="range" min={min} max={max} step={500} value={p} onChange={e => setSliderPrice(Number(e.target.value))} style={{ width: "100%", accentColor: inst.color, cursor: "pointer", position: "relative", zIndex: 3 }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#2a2a2a", fontFamily: "monospace", marginBottom: 14 }}><span>{usd(min)}</span><span>{usd(max)}</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        {[
          { label: "Asset Coverage", val: cov, fmt: n => `${n.toFixed(2)}×`, color: cov >= 1 ? "#22c55e" : "#ef4444" },
          { label: "Asset Buffer",   val: run, fmt: n => `${n.toFixed(1)} yrs`, color: run > 0 ? inst.color : "#555" },
          { label: "BTC Treasury",   val: flat(data).btcHeld * p, fmt: cpt, color: "#888" },
        ].map(m => (
          <div key={m.label} style={{ background: "#0d0d0d", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: 1, fontFamily: "monospace", marginBottom: 4 }}>{m.label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "monospace", color: m.color }}><AN value={m.val} fmt={m.fmt} /></div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function StatsGrid({ inst, data, btcPrice, isMobile }) {
  const floor = riskFloor(data), cov = coverage(data, btcPrice), run = divRunway(data, btcPrice), drop = (btcPrice - floor) / btcPrice * 100;
  const stats = [
    { label: "Current Rate",         value: `${inst.coupon}%`,              sub: inst.couponNote,                              color: inst.color  },
    { label: "Asset Coverage",       value: `${cov.toFixed(2)}×`,           sub: "(BTC Treasury − Debt) ÷ Preferred Par",      color: "#22c55e"   },
    { label: "Asset Floor",          value: usd(floor),                     sub: "(Senior Debt + Preferred Par) ÷ BTC Held",   color: "#ef4444"   },
    { label: "Drop to Floor",        value: `−${drop.toFixed(1)}%`,         sub: "from live BTC price to asset floor",         color: "#ef4444"   },
    { label: "Asset Buffer",         value: `${run.toFixed(1)} yrs`,        sub: "excess assets ÷ annual div (not cash rsrv)", color: inst.color  },
    { label: "Annual Dividend Total",value: cpt(flat(data).annualDividend), sub: "all preferred series combined",              color: "#888"      },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
      {stats.map(s => (
        <div key={s.label} style={{ background: "#080808", border: "1px solid #151515", borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontSize: 9, color: "#333", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "monospace", marginBottom: 6 }}>{s.label}</div>
          <div style={{ fontSize: isMobile ? 16 : 20, fontWeight: 900, fontFamily: "monospace", color: s.color, lineHeight: 1 }}>{s.value}</div>
          <div style={{ fontSize: 9, color: "#2a2a2a", marginTop: 5, fontFamily: "monospace" }}>{s.sub}</div>
        </div>
      ))}
    </div>
  );
}

function StressTable({ inst, data, livePrice, isMobile }) {
  const floor = riskFloor(data);
  const rows = [{ label: "NOW", p: livePrice, isNow: true }, ...RISK_SCENARIOS.map(s => ({ label: `${s * 100}%`, p: livePrice * (1 + s), isNow: false }))];
  if (isMobile) {
    return (
      <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
        {rows.map(({ label, p, isNow }) => {
          const cov = coverage(data, p), run = divRunway(data, p), safe = p > floor;
          return (
            <div key={label} style={{ background: isNow ? "#0c0c0c" : "#080808", border: "1px solid #111", borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "monospace", color: isNow ? "#666" : "#333" }}>{isNow ? "NOW" : label}</span>
                <span style={{ fontSize: 13, fontFamily: "monospace", color: isNow ? "#888" : "#444" }}>{usd(p)}</span>
                {safe ? <span style={{ fontSize: 9, fontFamily: "monospace", color: "#22c55e" }}>✓ COVERED</span> : <span style={{ fontSize: 9, fontFamily: "monospace", color: "#ef4444", background: "rgba(239,68,68,0.08)", padding: "2px 6px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.2)" }}>⚠ AT RISK</span>}
              </div>
              <div style={{ display: "flex", gap: 16 }}>
                <div><div style={{ fontSize: 9, color: "#333", fontFamily: "monospace" }}>COVERAGE</div><div style={{ fontSize: 15, fontWeight: 700, fontFamily: "monospace", color: safe ? "#22c55e" : "#ef4444" }}>{cov.toFixed(2)}×</div></div>
                <div><div style={{ fontSize: 9, color: "#333", fontFamily: "monospace" }}>ASSET BUFFER</div><div style={{ fontSize: 15, fontFamily: "monospace", color: run > 0 ? inst.color : "#2a2a2a" }}>{run > 0 ? `${run.toFixed(1)} yrs` : "—"}</div></div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <Card style={{ overflow: "hidden", marginBottom: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 90px 90px 90px", padding: "11px 20px", background: "#060606", borderBottom: "1px solid #111" }}>
        {["", "BTC Price", "Coverage", "Asset Buffer", "Status"].map((h, i) => <div key={h} style={{ fontSize: 9, color: "#2e2e2e", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "monospace", textAlign: i > 1 ? "right" : "left" }}>{h}</div>)}
      </div>
      {rows.map(({ label, p, isNow }) => {
        const cov = coverage(data, p), run = divRunway(data, p), safe = p > floor;
        return (
          <div key={label} style={{ display: "grid", gridTemplateColumns: "70px 1fr 90px 90px 90px", padding: "13px 20px", alignItems: "center", borderBottom: "1px solid #0c0c0c", background: isNow ? "#0c0c0c" : "transparent" }}>
            <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "monospace", color: isNow ? "#666" : "#333" }}>{label}</div>
            <div style={{ fontSize: 13, fontFamily: "monospace", color: isNow ? "#888" : "#444" }}>{usd(p)}</div>
            <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "monospace", color: safe ? (isNow ? "#22c55e" : "#22c55e66") : "#ef4444", textAlign: "right" }}>{cov.toFixed(2)}×</div>
            <div style={{ fontSize: 13, fontFamily: "monospace", color: run > 0 ? (isNow ? inst.color : `${inst.color}55`) : "#2a2a2a", textAlign: "right" }}>{run > 0 ? `${run.toFixed(1)} yrs` : "—"}</div>
            <div style={{ textAlign: "right" }}>{safe ? <span style={{ fontSize: 9, fontFamily: "monospace", color: isNow ? "#22c55e" : "#22c55e44" }}>✓ COVERED</span> : <span style={{ fontSize: 9, fontFamily: "monospace", color: "#ef4444", background: "rgba(239,68,68,0.08)", padding: "2px 6px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.2)" }}>⚠ AT RISK</span>}</div>
          </div>
        );
      })}
    </Card>
  );
}

function Waterfall({ inst, data, btcPrice }) {
  const f = flat(data), treasury = f.btcHeld * btcPrice, afterSenior = treasury - f.seniorDebt, excess = afterSenior - f.preferredPar;
  const rows = [
    { label: "Bitcoin Treasury",       val: treasury,        sub: `${f.btcHeld.toLocaleString()} BTC × ${usd(btcPrice)}`,             color: "#e5e5e5", src: data.btcHeld?.src,     signed: false },
    { label: "Less: Senior Debt",      val: -f.seniorDebt,   sub: "Convertible notes — senior to all preferred",                       color: "#ef4444", src: data.seniorDebt?.src,  signed: true  },
    { label: "Net Assets After Debt",  val: afterSenior,     sub: "Available to cover preferred obligations",                           color: "#e5e5e5", src: null, signed: false, separator: true  },
    { label: "Less: Total Preferred",  val: -f.preferredPar, sub: `All 5 preferred series — STRC, STRK, STRF, STRD, STRE`,            color: "#ef4444", src: data.preferredPar?.src,signed: true, indent: true },
    { label: "Excess Asset Buffer",    val: excess,          sub: `${(excess / f.annualDividend).toFixed(1)} yrs of dividends as buffer · Not a cash reserve`, color: inst.color, src: null, signed: false, separator: true },
  ];
  return (
    <Card style={{ overflow: "hidden", marginBottom: 20 }}>
      <div style={{ padding: "13px 20px", borderBottom: "1px solid #111", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: 2, fontFamily: "monospace" }}>Asset Coverage Waterfall</span>
        <span style={{ fontSize: 10, color: "#2a2a2a", fontFamily: "monospace" }}>Indirect coverage · Not direct collateral</span>
      </div>
      {rows.map((r, i) => (
        <div key={r.label} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", padding: `${r.separator ? "15px" : "10px"} 20px`, paddingLeft: r.indent ? 38 : 20, borderBottom: i < rows.length - 1 ? `1px solid ${r.separator ? "#1c1c1c" : "#0c0c0c"}` : "none", background: r.separator ? "#0a0a0a" : "transparent" }}>
          <div><div style={{ fontSize: 12, color: "#666", fontFamily: "monospace" }}>{r.label}</div><div style={{ fontSize: 9, color: "#2a2a2a", fontFamily: "monospace", marginTop: 2 }}>{r.sub}</div></div>
          <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: r.color, textAlign: "right", paddingRight: 12 }}>{r.signed && r.val < 0 ? `(${cpt(Math.abs(r.val))})` : cpt(Math.abs(r.val))}</div>
          {r.src ? <Badge status={r.src === "live" ? "live" : r.src === "edgar" ? "edgar" : "manual"} sm /> : <div />}
        </div>
      ))}
    </Card>
  );
}

function YieldChart({ inst }) {
  const max = 14;
  return (
    <Card style={{ padding: "20px 22px", marginBottom: 20 }}>
      <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: 2, fontFamily: "monospace", marginBottom: 16 }}>Yield Comparison · Current Rates</div>
      {YIELD_COMPS.map(item => {
        const isActive = item.label === inst.ticker, isBtc = item.type === "btc";
        const color = item.label === "STRC" ? INSTRUMENTS[0].color : item.label === "SATA" ? INSTRUMENTS[1].color : "#242424";
        return (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <div style={{ width: 76, fontSize: 11, fontFamily: "monospace", textAlign: "right", color: isActive ? inst.color : isBtc ? "#555" : "#2e2e2e", fontWeight: isActive ? 700 : 400 }}>{item.label}</div>
            <div style={{ flex: 1, height: isActive ? 10 : 5, background: "#0e0e0e", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(item.y / max) * 100}%`, background: isActive ? inst.color : color, borderRadius: 2, transition: "width 1s ease", boxShadow: isActive ? `0 0 10px ${inst.color}44` : "none" }} />
            </div>
            <div style={{ width: 40, fontSize: isActive ? 13 : 11, fontFamily: "monospace", color: isActive ? inst.color : isBtc ? "#555" : "#2e2e2e", fontWeight: isActive ? 700 : 400, textAlign: "right" }}>{item.y}%</div>
          </div>
        );
      })}
      <div style={{ fontSize: 9, color: "#1e1e1e", fontFamily: "monospace", marginTop: 12 }}>STRC and SATA are variable rate — current rates as of March 2026. Rates adjust monthly.</div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TREASURY TRACKER
// ═══════════════════════════════════════════════════════════════════════════════
function TreasuryTracker({ btcPrice, isMobile }) {
  const [sortBy, setSortBy] = useState("btcHeld");
  const [sortDir, setSortDir] = useState("desc");
  const [filter, setFilter] = useState("all");

  const getCoverage = (co) => co.hasPreferred && co.preferredPar > 0
    ? coverage({ btcHeld: { val: co.btcHeld }, seniorDebt: { val: co.seniorDebt }, preferredPar: { val: co.preferredPar }, annualDividend: { val: co.annualDiv } }, btcPrice)
    : null;

  const sorted = useMemo(() => {
    let list = [...TREASURY_DATA];
    if (filter !== "all") list = list.filter(c => filter === "preferred" ? c.hasPreferred : c.category === filter);
    return list.sort((a, b) => {
      let av, bv;
      if (sortBy === "btcHeld")      { av = a.btcHeld; bv = b.btcHeld; }
      else if (sortBy === "treasury") { av = a.btcHeld * btcPrice; bv = b.btcHeld * btcPrice; }
      else if (sortBy === "btcShare") { av = a.btcHeld / a.sharesOut; bv = b.btcHeld / b.sharesOut; }
      else if (sortBy === "coverage") { av = getCoverage(a) ?? -1; bv = getCoverage(b) ?? -1; }
      else                           { av = a[sortBy]; bv = b[sortBy]; }
      return sortDir === "desc" ? bv - av : av - bv;
    });
  }, [sortBy, sortDir, filter, btcPrice]);

  const totalBtc = TREASURY_DATA.reduce((s, c) => s + c.btcHeld, 0);
  const SH = ({ col, children }) => (
    <button onClick={() => { if (sortBy === col) setSortDir(d => d === "desc" ? "asc" : "desc"); else { setSortBy(col); setSortDir("desc"); } }}
      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 9, color: sortBy === col ? "#888" : "#2e2e2e", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "monospace", display: "flex", alignItems: "center", gap: 3, padding: 0 }}>
      {children} <span>{sortBy === col ? (sortDir === "desc" ? "↓" : "↑") : ""}</span>
    </button>
  );

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 10, marginBottom: 20 }}>
        {[
          { label: "Total BTC Tracked",   value: totalBtc.toLocaleString() + " BTC",                                              sub: "Across all listed companies",      color: "#F7931A" },
          { label: "USD Value",           value: cpt(totalBtc * btcPrice),                                                         sub: "At live BTC price",                color: "#e5e5e5" },
          { label: "With Preferred",      value: `${TREASURY_DATA.filter(c => c.hasPreferred).length} companies`,                  sub: "Active digital credit products",   color: "#22c55e" },
          { label: "Total Preferred Par", value: cpt(TREASURY_DATA.filter(c => c.hasPreferred).reduce((s, c) => s + c.preferredPar, 0)), sub: "Outstanding preferred obligations", color: "#60a5fa" },
        ].map(s => (
          <div key={s.label} style={{ background: "#080808", border: "1px solid #151515", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 9, color: "#333", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "monospace", marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: isMobile ? 14 : 18, fontWeight: 900, fontFamily: "monospace", color: s.color, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 9, color: "#2a2a2a", marginTop: 5, fontFamily: "monospace" }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {[["all", "All"], ["preferred", "Has Preferred"], ["treasury", "Treasury Co."], ["miner", "Miners"]].map(([val, lbl]) => (
          <button key={val} onClick={() => setFilter(val)} style={{ padding: "6px 14px", borderRadius: 6, cursor: "pointer", border: `1px solid ${filter === val ? "#F7931A55" : "#1a1a1a"}`, background: filter === val ? "rgba(247,147,26,0.06)" : "#080808", color: filter === val ? "#F7931A" : "#333", fontSize: 11, fontFamily: "monospace" }}>{lbl}</button>
        ))}
      </div>

      {!isMobile ? (
        <Card style={{ overflow: "hidden", marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "130px 90px 100px 100px 100px 1fr 70px", padding: "11px 20px", background: "#060606", borderBottom: "1px solid #111", gap: 8 }}>
            <SH col="name">Company</SH>
            <SH col="btcHeld">BTC Held</SH>
            <SH col="treasury">Treasury $</SH>
            <SH col="btcShare">BTC/Share</SH>
            <SH col="coverage">Coverage</SH>
            <div style={{ fontSize: 9, color: "#2e2e2e", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "monospace" }}>Preferred Products</div>
            <div style={{ fontSize: 9, color: "#2e2e2e", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "monospace" }}>As Of</div>
          </div>
          {sorted.map((co, i) => {
            const cov = getCoverage(co);
            return (
              <div key={co.ticker} style={{ display: "grid", gridTemplateColumns: "130px 90px 100px 100px 100px 1fr 70px", padding: "13px 20px", alignItems: "center", borderBottom: i < sorted.length - 1 ? "1px solid #0c0c0c" : "none", gap: 8, background: co.hasPreferred ? "#080808" : "transparent" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace", color: co.hasPreferred ? co.color : "#555" }}>{co.ticker}</div>
                  <div style={{ fontSize: 9, color: "#2a2a2a", fontFamily: "monospace", marginTop: 2 }}>{co.name}</div>
                </div>
                <div style={{ fontSize: 13, fontFamily: "monospace", color: "#666" }}>{co.btcHeld.toLocaleString()}</div>
                <div style={{ fontSize: 13, fontFamily: "monospace", color: "#555" }}>{cpt(co.btcHeld * btcPrice)}</div>
                <div style={{ fontSize: 12, fontFamily: "monospace", color: "#444" }}>{(co.btcHeld / co.sharesOut) < 0.001 ? (co.btcHeld / co.sharesOut).toFixed(6) : (co.btcHeld / co.sharesOut).toFixed(4)}</div>
                <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "monospace", color: cov === null ? "#2a2a2a" : cov >= 1 ? "#22c55e" : "#ef4444" }}>{cov === null ? "—" : `${cov.toFixed(2)}×`}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {co.hasPreferred ? co.preferred.map(p => <span key={p} style={{ fontSize: 9, fontFamily: "monospace", color: "#22c55e", background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)", padding: "2px 8px", borderRadius: 4 }}>{p}</span>) : <span style={{ fontSize: 9, fontFamily: "monospace", color: "#1e1e1e" }}>—</span>}
                </div>
                <div style={{ fontSize: 9, color: "#2a2a2a", fontFamily: "monospace" }}>{co.asOf}</div>
              </div>
            );
          })}
        </Card>
      ) : (
        <div style={{ display: "grid", gap: 10, marginBottom: 20 }}>
          {sorted.map(co => {
            const cov = getCoverage(co);
            return (
              <div key={co.ticker} style={{ background: "#080808", border: "1px solid #111", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: co.hasPreferred ? co.color : "#555" }}>{co.ticker}</div>
                    <div style={{ fontSize: 10, color: "#2a2a2a", fontFamily: "monospace" }}>{co.name} · {co.asOf}</div>
                  </div>
                  {cov !== null && <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "monospace", color: cov >= 1 ? "#22c55e" : "#ef4444" }}>{cov.toFixed(2)}×</div>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: co.hasPreferred ? 10 : 0 }}>
                  <div><div style={{ fontSize: 9, color: "#333", fontFamily: "monospace" }}>BTC HELD</div><div style={{ fontSize: 13, fontFamily: "monospace", color: "#666" }}>{co.btcHeld.toLocaleString()}</div></div>
                  <div><div style={{ fontSize: 9, color: "#333", fontFamily: "monospace" }}>TREASURY</div><div style={{ fontSize: 13, fontFamily: "monospace", color: "#555" }}>{cpt(co.btcHeld * btcPrice)}</div></div>
                </div>
                {co.hasPreferred && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{co.preferred.map(p => <span key={p} style={{ fontSize: 9, fontFamily: "monospace", color: "#22c55e", background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)", padding: "2px 8px", borderRadius: 4 }}>{p}</span>)}</div>}
              </div>
            );
          })}
        </div>
      )}

      <Card style={{ padding: "20px 22px", marginBottom: 20 }}>
        <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: 2, fontFamily: "monospace", marginBottom: 16 }}>BTC Distribution · Tracked Universe</div>
        {[...TREASURY_DATA].sort((a, b) => b.btcHeld - a.btcHeld).map(co => {
          const p = (co.btcHeld / totalBtc) * 100;
          return (
            <div key={co.ticker} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <div style={{ width: 60, fontSize: 11, fontFamily: "monospace", textAlign: "right", color: co.hasPreferred ? co.color : "#2e2e2e", fontWeight: co.hasPreferred ? 700 : 400 }}>{co.ticker}</div>
              <div style={{ flex: 1, height: co.hasPreferred ? 10 : 5, background: "#0e0e0e", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${p}%`, background: co.hasPreferred ? co.color : "#1e1e1e", borderRadius: 2, boxShadow: co.hasPreferred ? `0 0 8px ${co.color}44` : "none", transition: "width 1s ease" }} />
              </div>
              <div style={{ width: 48, fontSize: 10, fontFamily: "monospace", color: co.hasPreferred ? co.color : "#2a2a2a", textAlign: "right" }}>{p.toFixed(1)}%</div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMULATOR
// ═══════════════════════════════════════════════════════════════════════════════
function AmountInput({ value, onChange }) {
  const [raw, setRaw] = useState(value.toLocaleString()), [focused, setFocused] = useState(false);
  const presets = [500, 1000, 5000, 10000, 25000, 50000, 100000, 1000000];
  return (
    <div>
      <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: 2, fontFamily: "monospace", marginBottom: 10 }}>Investment Amount</div>
      <div style={{ display: "flex", alignItems: "center", background: "#080808", border: `1px solid ${focused ? "#333" : "#181818"}`, borderRadius: 10, padding: "0 16px" }}>
        <span style={{ fontSize: 22, color: "#444", fontFamily: "monospace", paddingRight: 8 }}>$</span>
        <input type="text" value={focused ? raw : value.toLocaleString()}
          onChange={e => { const s = e.target.value.replace(/[^0-9]/g, ""); setRaw(s ? Number(s).toLocaleString() : ""); const n = parseInt(s || "0"); if (!isNaN(n)) onChange(n); }}
          onFocus={() => { setFocused(true); setRaw(value.toLocaleString()); }}
          onBlur={() => setFocused(false)}
          style={{ flex: 1, background: "none", border: "none", outline: "none", fontSize: 28, fontWeight: 900, fontFamily: "monospace", color: "#e5e5e5", padding: "16px 0" }} placeholder="10,000" />
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {presets.map(p => <button key={p} onClick={() => { onChange(p); setRaw(p.toLocaleString()); }} style={{ padding: "4px 12px", borderRadius: 6, cursor: "pointer", background: value === p ? "#181818" : "none", border: `1px solid ${value === p ? "#2a2a2a" : "#141414"}`, color: value === p ? "#888" : "#2a2a2a", fontSize: 11, fontFamily: "monospace" }}>{cmpt(p)}</button>)}
      </div>
    </div>
  );
}

function GrowthChart({ yearlyData, compData, principal, product, showBtc, btcSce, years }) {
  const all = [...yearlyData.map(d => d.totalValue), ...(showBtc ? yearlyData.map(d => d.btcUsd) : []), ...compData.map(c => c.endValue), principal].filter(Boolean);
  const maxVal = Math.max(...all) * 1.08, H = 200, W = 100;
  const pts = arr => arr.map((d, i) => `${(i / Math.max(years - 1, 1)) * W},${H - (d / maxVal) * H}`).join(" ");
  const mainPts = yearlyData.map(d => d.totalValue), btcPts = yearlyData.map(d => d.btcUsd);
  return (
    <Card style={{ padding: "20px 22px", marginBottom: 20 }}>
      <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: 2, fontFamily: "monospace", marginBottom: 16 }}>Growth Over Time · {drip => drip ? "DRIP On" : "DRIP Off"}</div>
      <svg viewBox={`-4 -4 108 ${H + 20}`} style={{ width: "100%", height: H + 20, overflow: "visible" }}>
        {[0.25, 0.5, 0.75, 1].map(f => <line key={f} x1={0} y1={H * (1 - f)} x2={W} y2={H * (1 - f)} stroke="#111" strokeWidth={0.5} />)}
        {yearlyData.filter((_, i) => years <= 10 || i % Math.floor(years / 5) === 0 || i === years - 1).map(d => <text key={d.year} x={((d.year - 1) / Math.max(years - 1, 1)) * W} y={H + 14} textAnchor="middle" fill="#222" fontSize={5} fontFamily="monospace">Y{d.year}</text>)}
        {compData.map((c, ci) => { const cy = Array.from({ length: years }, (_, i) => { let b = principal; for (let y = 0; y <= i; y++) b += b * (c.rate / 100); return b; }); return <polyline key={ci} points={pts(cy)} fill="none" stroke="#1e293b" strokeWidth={0.8} strokeDasharray="2,2" opacity={0.6} />; })}
        {showBtc && <polyline points={pts(btcPts)} fill="none" stroke="#F7931A" strokeWidth={1} strokeDasharray="3,1.5" opacity={0.5} />}
        <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={product.color} stopOpacity={0.4} /><stop offset="100%" stopColor={product.color} stopOpacity={0} /></linearGradient></defs>
        <polygon points={`0,${H} ${pts(mainPts)} ${W},${H}`} fill="url(#ag)" opacity={0.25} />
        <polyline points={pts(mainPts)} fill="none" stroke={product.color} strokeWidth={4} opacity={0.12} />
        <polyline points={pts(mainPts)} fill="none" stroke={product.color} strokeWidth={1.5} />
        {yearlyData.length > 0 && (() => { const l = yearlyData[yearlyData.length - 1]; return <circle cx={W} cy={H - (l.totalValue / maxVal) * H} r={2.5} fill={product.color} />; })()}
      </svg>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 16, height: 2, background: product.color, borderRadius: 1 }} /><span style={{ fontSize: 9, color: "#555", fontFamily: "monospace" }}>{product.label} ({product.rate}%)</span></div>
        {showBtc && <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 16, height: 2, background: "#F7931A", opacity: 0.5, borderRadius: 1 }} /><span style={{ fontSize: 9, color: "#555", fontFamily: "monospace" }}>BTC {ppct(btcSce.rate)}/yr</span></div>}
        {COMPARISONS.map(c => <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 16, height: 1, background: "#444", borderRadius: 1 }} /><span style={{ fontSize: 9, color: "#333", fontFamily: "monospace" }}>{c.label} ({c.rate}%)</span></div>)}
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT APP
// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const { mstr, sata, btcPrice, priceAt, priceStatus } = useInstrumentData();
  const isMobile = useWindowWidth() < 640;
  const { read, write } = useUrlState();
  const init = read();

  const [view,       setView]       = useState(init.view        || "risk");
  const [riskInst,   setRiskInst]   = useState(init.riskInst    || "strc");
  const [slider,     setSlider]     = useState(init.sliderBtc   || null);
  const [principal,  setPrincipal]  = useState(init.principal   || 10000);
  const [simProdId,  setSimProdId]  = useState(init.simProduct  || "strc");
  const [customRate, setCustomRate] = useState(init.customRate  || 10);
  const [years,      setYears]      = useState(init.years       || 10);
  const [drip,       setDrip]       = useState(init.drip        !== false);
  const [showBtc,    setShowBtc]    = useState(false);
  const [btcSceIdx,  setBtcSceIdx]  = useState(2);

  useEffect(() => setSlider(null), [riskInst]);
  useEffect(() => { write({ view, riskInst, sliderBtc: slider, principal, simProduct: simProdId, years, drip, customRate }); }, [view, riskInst, slider, principal, simProdId, years, drip, customRate]);

  const inst     = INSTRUMENTS.find(i => i.id === riskInst);
  const riskData = riskInst === "strc" ? mstr : sata;
  const displayPx = slider ?? btcPrice;

  const simProduct = useMemo(() => { const p = SIM_PRODUCTS.find(p => p.id === simProdId); return simProdId === "custom" ? { ...p, rate: customRate } : p; }, [simProdId, customRate]);
  const btcSce     = BTC_SCENARIOS[btcSceIdx];
  const yearlyData = useMemo(() => buildYearly({ principal, rate: simProduct.rate, years, drip, btcApr: btcSce.rate, btcPrice }), [principal, simProduct.rate, years, drip, btcSce.rate, btcPrice]);
  const compData   = useMemo(() => buildComps({ principal, rate: simProduct.rate, years, drip }), [principal, simProduct.rate, years, drip]);
  const lastYear   = yearlyData[yearlyData.length - 1];
  const endValue   = lastYear?.totalValue ?? principal;
  const monthlyIncome = (principal * (simProduct.rate / 100)) / 12;

  const VIEWS = [
    { id: "risk",      label: "Risk Dashboard",  sub: "Coverage · Stress · Waterfall" },
    { id: "simulator", label: "Growth Simulator", sub: "Yield · DRIP · Compounding"    },
    { id: "treasury",  label: "Treasury Tracker", sub: "All Bitcoin treasury companies" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#050505", color: "#e5e5e5", fontFamily: "'DM Sans','Helvetica Neue',sans-serif", padding: isMobile ? "24px 16px 80px" : "36px 22px 80px", maxWidth: 840, margin: "0 auto" }}>

      {/* HEADER */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 7px #22c55e", animation: "glow 2s infinite" }} />
            <span style={{ fontSize: 10, color: "#2e2e2e", fontFamily: "monospace", letterSpacing: 2 }}>LIVE</span>
          </div>
          <Badge status={priceStatus} asOf={priceStatus === "live" ? ago(priceAt) : priceStatus === "loading" ? "Fetching…" : "Fetch failed"} />
          <Badge status="live"  asOf="MSTR Holdings · CoinGecko" />
          <Badge status="edgar" asOf="SEC EDGAR XBRL" />
          <div style={{ marginLeft: "auto" }}><ShareButton state={{ view, riskInst, sliderBtc: slider, principal, simProduct: simProdId, years, drip, customRate }} /></div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: "#2a2a2a", fontFamily: "monospace", letterSpacing: 3, marginBottom: 6 }}>PROOF OF YIELD</div>
            <h1 style={{ fontSize: isMobile ? 20 : 26, fontWeight: 900, margin: "0 0 6px", letterSpacing: "-0.5px", lineHeight: 1.2 }}>
              <span style={{ color: "#F7931A", fontFamily: "monospace" }}>Bitcoin</span> Digital Credit Intelligence
            </h1>
            <p style={{ color: "#333", fontSize: 12, margin: 0, lineHeight: 1.7, maxWidth: 500 }}>
              Live risk analysis, growth simulation, and treasury tracking for STRC, SATA, and the Bitcoin preferred yield category. All figures sourced from public filings.
            </p>
          </div>
          <div style={{ textAlign: isMobile ? "left" : "right" }}>
            <div style={{ fontSize: isMobile ? 30 : 38, fontWeight: 900, fontFamily: "monospace", color: "#F7931A", letterSpacing: "-2px", lineHeight: 1 }}>
              <AN value={btcPrice} fmt={usd} />
            </div>
            <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>BTC / USD · <Badge status={priceStatus} asOf={ago(priceAt)} sm /></div>
          </div>
        </div>
      </div>

      {/* NAV */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3,1fr)", gap: 8, marginBottom: 28 }}>
        {VIEWS.map(v => (
          <button key={v.id} onClick={() => setView(v.id)} style={{ padding: isMobile ? "12px 16px" : "14px 20px", borderRadius: 10, cursor: "pointer", textAlign: "left", border: `1px solid ${view === v.id ? "#F7931A55" : "#181818"}`, background: view === v.id ? "rgba(247,147,26,0.06)" : "#080808", transition: "all 0.15s" }}>
            <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "monospace", color: view === v.id ? "#F7931A" : "#444", marginBottom: 3 }}>{v.label}</div>
            <div style={{ fontSize: 9, color: view === v.id ? "#555" : "#1e1e1e", fontFamily: "monospace" }}>{v.sub}</div>
          </button>
        ))}
      </div>

      {/* ══════════ RISK DASHBOARD */}
      {view === "risk" && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            {INSTRUMENTS.map(i => (
              <button key={i.id} onClick={() => setRiskInst(i.id)} style={{ padding: "11px 24px", borderRadius: 8, cursor: "pointer", border: `1px solid ${riskInst === i.id ? i.color : "#1a1a1a"}`, background: riskInst === i.id ? `${i.color}10` : "#080808", color: riskInst === i.id ? i.color : "#444", fontFamily: "monospace", fontWeight: 700, fontSize: 14, transition: "all 0.15s" }}>
                ${i.ticker} <span style={{ fontSize: 11, marginLeft: 6, opacity: 0.7 }}>{i.coupon}%</span>
                {i.isVariable && <span style={{ fontSize: 9, marginLeft: 6, opacity: 0.5 }}>VAR</span>}
              </button>
            ))}
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: "#2a2a2a", fontFamily: "monospace", marginBottom: 8 }}>{inst.fullName} · {inst.issuer} · {inst.frequency} dividend · {inst.taxNote}</div>
            <VarBadge note={inst.couponNote} />
          </div>

          <CollateralDisclaimer inst={inst} />
          <HeroStatement inst={inst} data={riskData} btcPrice={btcPrice} sliderPrice={slider} />
          <DataPanel inst={inst} data={riskData} btcPrice={btcPrice} priceAt={priceAt} priceStatus={priceStatus} />

          <Label>Test Any Price Scenario</Label>
          <PriceSlider inst={inst} data={riskData} livePrice={btcPrice} sliderPrice={slider} setSliderPrice={setSlider} />

          <Label>At a Glance</Label>
          <StatsGrid inst={inst} data={riskData} btcPrice={displayPx} isMobile={isMobile} />

          <Label>Stress Scenarios</Label>
          <StressTable inst={inst} data={riskData} livePrice={btcPrice} isMobile={isMobile} />

          <Label>Asset Coverage Waterfall</Label>
          <Waterfall inst={inst} data={riskData} btcPrice={btcPrice} />

          <Label>Yield Comparison</Label>
          <YieldChart inst={inst} />

          <div style={{ borderTop: "1px solid #0d0d0d", paddingTop: 20, fontSize: 10, color: "#1e1e1e", fontFamily: "monospace", lineHeight: 2.2 }}>
            <div style={{ color: "#2e2e2e", marginBottom: 6, letterSpacing: 2 }}>METHODOLOGY — EQUATIONS</div>
            <div>ASSET FLOOR    = (Senior Debt + Total Preferred Par) ÷ BTC Held</div>
            <div>COVERAGE       = (BTC Held × BTC Price − Senior Debt) ÷ Total Preferred Par</div>
            <div>ASSET BUFFER   = (BTC Treasury − Senior Debt − Preferred Par) ÷ Annual Dividend Obligation</div>
            <div style={{ marginTop: 4, color: "#181818" }}>
              IMPORTANT: Preferred securities are NOT directly collateralized by Bitcoin holdings per Strategy's own disclosure.
              Coverage metrics reflect indirect asset coverage only. Dividends are paid from cash operations and capital raises.
              Strategy maintains a $2.25B cash reserve providing ~2.5 years of dividend coverage (Q4 2025).
              All figures sourced from public SEC filings and verified manually. Not financial advice.
            </div>
          </div>
        </>
      )}

      {/* ══════════ SIMULATOR */}
      {view === "simulator" && (
        <>
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 900, margin: "0 0 6px", letterSpacing: "-0.3px" }}>
              What Does Your Money <span style={{ color: simProduct.color, fontFamily: "monospace" }}>Actually Do</span> at {simProduct.rate}%?
            </h2>
            <p style={{ color: "#333", fontSize: 12, margin: 0, lineHeight: 1.7 }}>Model returns in {simProduct.name} — compared to every major TradFi alternative.</p>
            <div style={{ marginTop: 8 }}><VarBadge note={simProduct.rateNote} /></div>
          </div>

          <Card style={{ padding: "24px 22px", marginBottom: 24 }}>
            <div style={{ display: "grid", gap: 22 }}>
              <AmountInput value={principal} onChange={setPrincipal} />
              <div style={{ height: 1, background: "#111" }} />
              <div>
                <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: 2, fontFamily: "monospace", marginBottom: 10 }}>Product</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  {SIM_PRODUCTS.map(p => (
                    <button key={p.id} onClick={() => setSimProdId(p.id)} style={{ padding: "10px 18px", borderRadius: 8, cursor: "pointer", border: `1px solid ${simProdId === p.id ? p.color : "#1a1a1a"}`, background: simProdId === p.id ? `${p.color}12` : "#080808", color: simProdId === p.id ? p.color : "#333", fontFamily: "monospace", fontWeight: 700, fontSize: 13, transition: "all 0.15s" }}>
                      {p.label}{p.id !== "custom" && <span style={{ fontSize: 10, marginLeft: 6, opacity: 0.6 }}>{p.rate}%</span>}
                    </button>
                  ))}
                </div>
                {simProdId === "custom" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 12, background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 8, padding: "12px 16px" }}>
                    <span style={{ fontSize: 11, color: "#444", fontFamily: "monospace" }}>Annual Rate</span>
                    <input type="range" min={1} max={25} step={0.25} value={customRate} onChange={e => setCustomRate(Number(e.target.value))} style={{ flex: 1, accentColor: "#a78bfa" }} />
                    <span style={{ fontSize: 18, fontWeight: 900, color: "#a78bfa", fontFamily: "monospace", minWidth: 52, textAlign: "right" }}>{customRate.toFixed(2)}%</span>
                  </div>
                )}
              </div>
              <div style={{ height: 1, background: "#111" }} />
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: 2, fontFamily: "monospace" }}>Time Horizon</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: "#e5e5e5", fontFamily: "monospace" }}>{years} yr{years !== 1 ? "s" : ""}</div>
                </div>
                <input type="range" min={1} max={30} step={1} value={years} onChange={e => setYears(Number(e.target.value))} style={{ width: "100%", accentColor: simProduct.color }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#222", fontFamily: "monospace", marginTop: 4 }}><span>1 yr</span><span>10</span><span>20</span><span>30 yrs</span></div>
              </div>
              <div style={{ height: 1, background: "#111" }} />
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <Toggle on={drip} onToggle={() => setDrip(d => !d)} label="DRIP" sub={drip ? "Dividends reinvested" : "Dividends as cash"} color="#22c55e" />
                <Toggle on={showBtc} onToggle={() => setShowBtc(b => !b)} label="BTC Layer" sub="BTC appreciation overlay" color="#F7931A" />
              </div>
              {showBtc && (
                <div>
                  <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: 2, fontFamily: "monospace", marginBottom: 10 }}>BTC Price Scenario</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {BTC_SCENARIOS.map((s, i) => <button key={s.label} onClick={() => setBtcSceIdx(i)} style={{ padding: "8px 14px", borderRadius: 6, cursor: "pointer", border: `1px solid ${btcSceIdx === i ? "#F7931A66" : "#1a1a1a"}`, background: btcSceIdx === i ? "rgba(247,147,26,0.08)" : "#080808", color: btcSceIdx === i ? "#F7931A" : "#333", fontSize: 11, fontFamily: "monospace" }}>{s.label}</button>)}
                  </div>
                </div>
              )}
            </div>
          </Card>

          <div style={{ background: "#040404", border: `1px solid ${simProduct.color}22`, borderRadius: 14, padding: "28px 28px", position: "relative", overflow: "hidden", marginBottom: 20 }}>
            <div style={{ position: "absolute", top: -80, right: -80, width: 300, height: 300, background: `radial-gradient(ellipse, ${simProduct.color}0a 0%, transparent 65%)`, pointerEvents: "none" }} />
            <div style={{ position: "relative" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 14px", borderRadius: 100, marginBottom: 20, background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.18)" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 6px #22c55e", animation: "glow 2s infinite" }} />
                <span style={{ fontSize: 10, fontFamily: "monospace", letterSpacing: 1.5, color: "#22c55e" }}>{drip ? "PROJECTED MONTHLY DIVIDEND (YEAR 1)" : "FIXED MONTHLY CASH INCOME"}</span>
              </div>
              <div style={{ fontSize: 13, color: "#4a4a4a", fontFamily: "monospace", marginBottom: 10 }}>At <span style={{ color: simProduct.color, fontWeight: 700 }}>{simProduct.rate}% annualized</span> this investment generates:</div>
              <div style={{ fontSize: isMobile ? 44 : 60, fontWeight: 900, letterSpacing: "-3px", lineHeight: 1, fontFamily: "monospace", color: "#e5e5e5" }}>
                <AN value={monthlyIncome} fmt={usd} /><span style={{ fontSize: 18, color: "#333", marginLeft: 8 }}>/mo</span>
              </div>
              <div style={{ fontSize: 11, color: "#2a2a2a", fontFamily: "monospace", marginTop: 10 }}>
                {drip ? "Reinvested — compounding principal monthly." : "Paid as cash monthly. Toggle DRIP to compound."}
                {" "}Rate is variable and may change monthly.
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
            {[
              { label: "End Value",      value: endValue,          fmt: cmpt, color: simProduct.color, sub: `After ${years} years` },
              { label: "Total Gained",   value: endValue - principal, fmt: cmpt, color: "#22c55e",     sub: `${(endValue / principal).toFixed(2)}× your money` },
              { label: "Monthly Income", value: monthlyIncome,     fmt: usd,  color: "#888",           sub: `${drip ? "Reinvested" : "Cash"} · Yr 1 · Variable` },
            ].map(s => (
              <div key={s.label} style={{ background: "#080808", border: "1px solid #151515", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 9, color: "#333", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "monospace", marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: isMobile ? 16 : 20, fontWeight: 900, fontFamily: "monospace", color: s.color, lineHeight: 1 }}><AN value={s.value} fmt={s.fmt} /></div>
                <div style={{ fontSize: 9, color: "#2a2a2a", marginTop: 5, fontFamily: "monospace" }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {showBtc && lastYear && (
            <div style={{ background: "#080808", border: "1px solid #F7931A22", borderRadius: 12, padding: "16px 20px", marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ fontSize: 9, color: "#444", fontFamily: "monospace", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>Same Money in Pure BTC · {btcSce.label}</div>
                <div style={{ fontSize: 11, color: "#2a2a2a", fontFamily: "monospace" }}>{(principal / btcPrice).toFixed(4)} BTC · {years} yrs at {ppct(btcSce.rate)}/yr</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 24, fontWeight: 900, fontFamily: "monospace", color: "#F7931A" }}><AN value={lastYear.btcUsd} fmt={cmpt} /></div>
                <div style={{ fontSize: 10, color: "#444", fontFamily: "monospace" }}>vs {cmpt(endValue)} with {simProduct.label}</div>
              </div>
            </div>
          )}

          <Label>Growth Curve</Label>
          <GrowthChart yearlyData={yearlyData} compData={compData} principal={principal} product={simProduct} showBtc={showBtc} btcSce={btcSce} years={years} />

          <Label>vs. TradFi Alternatives · After {years} Year{years !== 1 ? "s" : ""}</Label>
          <Card style={{ overflow: "hidden", marginBottom: 20 }}>
            <div style={{ padding: "13px 20px", borderBottom: "1px solid #111", display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: 2, fontFamily: "monospace" }}>Returns Comparison</span>
              <span style={{ fontSize: 10, color: "#2a2a2a", fontFamily: "monospace" }}>DRIP {drip ? "on" : "off"}</span>
            </div>
            {[{ label: simProduct.label, rate: simProduct.rate, end: endValue, color: simProduct.color, hi: true }, ...compData.map(c => ({ label: c.label, rate: c.rate, end: c.endValue, color: "#555", hi: false }))].sort((a, b) => b.end - a.end).map((r, i, arr) => (
              <div key={r.label} style={{ padding: "14px 20px", borderBottom: i < arr.length - 1 ? "1px solid #0c0c0c" : "none", background: r.hi ? "#0a0a0a" : "transparent" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: r.hi ? 700 : 400, fontFamily: "monospace", color: r.hi ? r.color : "#444" }}>{r.label}</span>
                    <span style={{ fontSize: 10, color: "#2a2a2a", fontFamily: "monospace" }}>{r.rate}%</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 16, fontWeight: 900, fontFamily: "monospace", color: r.hi ? r.color : "#555" }}>{cmpt(r.end)}</div>
                    <div style={{ fontSize: 9, color: "#2a2a2a", fontFamily: "monospace" }}>+{cmpt(r.end - principal)}</div>
                  </div>
                </div>
                <div style={{ height: 3, background: "#0e0e0e", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(r.end / endValue) * 100}%`, background: r.hi ? r.color : "#1e1e1e", borderRadius: 2, boxShadow: r.hi ? `0 0 8px ${r.color}44` : "none", transition: "width 0.8s ease" }} />
                </div>
              </div>
            ))}
          </Card>

          <Label>Year by Year</Label>
          <Card style={{ overflow: "hidden", marginBottom: 20 }}>
            <div style={{ padding: "13px 20px", borderBottom: "1px solid #111", display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: 2, fontFamily: "monospace" }}>Year by Year</span>
              <span style={{ fontSize: 10, color: "#2a2a2a", fontFamily: "monospace" }}>DRIP {drip ? "enabled" : "disabled"}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "36px 1fr 1fr" : "48px 1fr 1fr 1fr", padding: "10px 20px", borderBottom: "1px solid #111", background: "#060606" }}>
              {(isMobile ? ["Yr", "Balance", "Mo. Income"] : ["Yr", "Balance", "Dividends Earned", "Monthly Income"]).map((h, i) => <div key={h} style={{ fontSize: 9, color: "#2a2a2a", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "monospace", textAlign: i > 0 ? "right" : "left" }}>{h}</div>)}
            </div>
            {yearlyData.map((d, i) => (
              <div key={d.year} style={{ display: "grid", gridTemplateColumns: isMobile ? "36px 1fr 1fr" : "48px 1fr 1fr 1fr", padding: "11px 20px", alignItems: "center", borderBottom: i < yearlyData.length - 1 ? "1px solid #0c0c0c" : "none", background: i === yearlyData.length - 1 ? "#0a0a0a" : "transparent" }}>
                <div style={{ fontSize: 11, fontFamily: "monospace", color: "#2a2a2a" }}>{d.year}</div>
                <div style={{ fontSize: 13, fontWeight: i === yearlyData.length - 1 ? 700 : 400, fontFamily: "monospace", color: i === yearlyData.length - 1 ? simProduct.color : "#555", textAlign: "right" }}>{cmpt(d.totalValue)}</div>
                {!isMobile && <div style={{ fontSize: 13, fontFamily: "monospace", color: "#3a3a3a", textAlign: "right" }}>{cmpt(d.dividends)}</div>}
                <div style={{ fontSize: 13, fontFamily: "monospace", color: "#2a2a2a", textAlign: "right" }}>{usd(d.monthlyIncome)}</div>
              </div>
            ))}
          </Card>

          <div style={{ borderTop: "1px solid #0d0d0d", paddingTop: 20, fontSize: 10, color: "#1e1e1e", fontFamily: "monospace", lineHeight: 2.2 }}>
            <div style={{ color: "#2e2e2e", marginBottom: 6, letterSpacing: 2 }}>METHODOLOGY</div>
            <div>DRIP ON  → Monthly compounding: balance × (rate/12) added to principal each month</div>
            <div>DRIP OFF → Fixed monthly income: principal × (rate/12), paid out, not reinvested</div>
            <div>BTC LAYER → Same dollar amount in pure BTC, no yield, at stated annual appreciation rate</div>
            <div style={{ marginTop: 8, color: "#181818" }}>
              Not financial advice. STRC and SATA are variable rate instruments — future rates are not guaranteed and will differ from rates used in these projections. Consult a licensed financial advisor before investing.
            </div>
          </div>
        </>
      )}

      {/* ══════════ TREASURY TRACKER */}
      {view === "treasury" && (
        <>
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 900, margin: "0 0 6px", letterSpacing: "-0.3px" }}>
              Bitcoin Treasury <span style={{ color: "#F7931A", fontFamily: "monospace" }}>Scoreboard</span>
            </h2>
            <p style={{ color: "#333", fontSize: 12, margin: 0, lineHeight: 1.7 }}>Every tracked public company holding Bitcoin — sortable, filterable, with live asset coverage ratios for companies with preferred products.</p>
          </div>
          <TreasuryTracker btcPrice={btcPrice} isMobile={isMobile} />
        </>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700;900&display=swap');
        @keyframes glow { 0%,100%{opacity:1} 50%{opacity:0.25} }
        * { box-sizing:border-box; margin:0; }
        input[type=range] { height:4px; cursor:pointer; }
        button { font-family:inherit; transition:opacity 0.15s; }
        button:hover { opacity:0.8; }
      `}</style>
    </div>import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

  );
}
