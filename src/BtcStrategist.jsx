import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend
} from 'recharts';

const ONE_DAY = 86400000;
const RAQQR_MU = 7.9914;
const RAQQR_GENESIS = Date.UTC(2009, 0, 1);
const RAQQR_KEYS = ["0.01", "0.1", "0.25", "0.5", "0.75", "0.95", "0.99"];
const RAQQR_RISK_MARKS = [1, 10, 25, 50, 75, 95, 99];
const RAQQR_COEF = {
  "0.01": [2.837, 2.578, -0.0241],
  "0.1":  [2.933, 2.552, -0.0241],
  "0.25": [3.004, 2.554, -0.0241],
  "0.5":  [3.214, 2.482, -0.1126],
  "0.75": [3.562, 2.283, -0.3259],
  "0.95": [3.897, 1.964, -0.3259],
  "0.99": [4.028, 1.904, -0.3259]
};

const CURVE_RISK_NODES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
const CURVE_DEFAULT_VALUES = [10, 10, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -0.5, -2, -4, -10];

const BAND_DEFS = [
  { loIdx: 0, hiIdx: 1, name: "1–10% · Fire Sale", color: "#1f6feb" },
  { loIdx: 1, hiIdx: 2, name: "10–25% · Accumulate", color: "#2ea043" },
  { loIdx: 2, hiIdx: 3, name: "25–50% · Value", color: "#3fb950" },
  { loIdx: 3, hiIdx: 4, name: "50–75% · Above Mid", color: "#d29922" },
  { loIdx: 4, hiIdx: 5, name: "75–95% · Hot", color: "#f0883e" },
  { loIdx: 5, hiIdx: 6, name: "95–99% · Bubble", color: "#f85149" }
];

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const safeLog10 = (v) => (isFinite(v) && v > 0 ? Math.log10(v) : null);

const usdShort = (v) => {
  if (!isFinite(v)) return "—";
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(v >= 100e3 ? 0 : 1)}K`;
  return `$${v.toFixed(v < 10 ? 2 : 0)}`;
};

const usdExact = (v) => {
  if (!isFinite(v)) return "—";
  return "$" + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

function raqqrPricesAtMs(ms) {
  const t = Math.max(1, Math.round((ms - RAQQR_GENESIS) / ONE_DAY));
  const x = Math.log(t) - RAQQR_MU;
  const raw = RAQQR_KEYS.map(k => {
    const [c, a, b] = RAQQR_COEF[k];
    return Math.pow(10, c + a * x + b * x * x);
  });
  return raw.slice().sort((a, b) => a - b);
}

function priceZScore(price, lowRail, mid, highRail) {
  if (!isFinite(price) || price <= 0 || !(lowRail < mid && mid < highRail)) return NaN;
  const lp = Math.log(price), ll = Math.log(lowRail), lm = Math.log(mid), lh = Math.log(highRail);
  if (lp <= lm) return clamp(3 * (lm - lp) / (lm - ll || 1e-12), 0, 3);
  return clamp(-3 * (lp - lm) / (lh - lm || 1e-12), -3, 0);
}

function eqmRiskFromPrice(price, q) {
  if (!isFinite(price) || price <= 0 || !Array.isArray(q) || q.length < 7) return NaN;
  if (price < q[0]) return 1;
  if (price > q[6]) return 99;
  const lp = Math.log(price);
  for (let i = 0; i < 6; i++) {
    if (price >= q[i] && price <= q[i + 1]) {
      const lo = Math.log(q[i]), hi = Math.log(q[i + 1]);
      const f = (lp - lo) / (hi - lo || 1e-12);
      return clamp(RAQQR_RISK_MARKS[i] + f * (RAQQR_RISK_MARKS[i + 1] - RAQQR_RISK_MARKS[i]), 1, 99);
    }
  }
  return 50;
}

function bandForRisk(r) {
  if (!isFinite(r)) return "—";
  if (r < 10) return "1–10% · Fire Sale";
  if (r < 25) return "10–25% · Accumulate";
  if (r < 50) return "25–50% · Value";
  if (r < 75) return "50–75% · Above Mid";
  if (r < 95) return "75–95% · Hot";
  return "95–99% · Bubble";
}

function riskZoneColor(r) {
  if (!isFinite(r)) return "#8b949e";
  if (r < 25) return "#22c55e";
  if (r < 50) return "#95d81d";
  if (r < 75) return "#f59e0b";
  return "#ff4444";
}

function evaluateCurveAtRisk(risk, nodeValues) {
  const r = clamp(Number(risk) || 0, 0, 100);
  for (let i = 0; i < CURVE_RISK_NODES.length - 1; i++) {
    const x0 = CURVE_RISK_NODES[i], x1 = CURVE_RISK_NODES[i + 1];
    if (r >= x0 && r <= x1) {
      const t = x1 > x0 ? (r - x0) / (x1 - x0) : 0;
      return nodeValues[i] + t * (nodeValues[i + 1] - nodeValues[i]);
    }
  }
  return nodeValues[nodeValues.length - 1];
}

// Built-in Error Boundary so the screen can never go white
class SafeErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ backgroundColor: '#161b22', border: '1px solid #f85149', borderRadius: '8px', padding: '24px', color: '#e6edf3' }}>
          <h3 style={{ color: '#f85149', marginTop: 0 }}>⚠️ BTC Strategist Render Error</h3>
          <pre style={{ backgroundColor: '#0d1117', padding: '12px', borderRadius: '6px', overflowX: 'auto', fontSize: '12px', color: '#ff7b72' }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const BtcStrategistInner = () => {
  const [rawRecords, setRawRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [liveStatus, setLiveStatus] = useState('');
  const [activeTab, setActiveTab] = useState('rainbow'); // 'rainbow' | 'composite' | 'curve'
  const [showInfo, setShowInfo] = useState(false);
  const [showZLine, setShowZLine] = useState(true);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 960 : false);

  // Fine-tuned Timeframe State (Rainbow & Composite tabs)
  const [tfPreset, setTfPreset] = useState('2017');
  const [customStart, setCustomStart] = useState('2017-01-01');
  const [customEnd, setCustomEnd] = useState('');

  // Indicator toggles
  const [indicators, setIndicators] = useState({
    price: true,
    cbpl: true,
    onchain: true,
    sharpe: false,
    liquidity: false
  });

  // Today's Action Cash Reserve
  const [todayCash, setTodayCash] = useState(10000);

  // Backtest & Curve State
  const [curveNodes, setCurveNodes] = useState(CURVE_DEFAULT_VALUES.slice());
  const [btStartDate, setBtStartDate] = useState('2018-01-01');
  const [btStartingCash, setBtStartingCash] = useState(10000);
  const [btLogScale, setBtLogScale] = useState(false);
  const [draggingIdx, setDraggingIdx] = useState(null);
  const svgRef = useRef(null);

  // Responsive listener
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 960);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 1. Load public/btc_data.json (or public/btc_seed.json fallback) + live spot refresh
  useEffect(() => {
    let cancelled = false;
    const loadBtcData = async () => {
      setLoading(true);
      setLiveStatus('Loading historical BTC dataset...');
      let records = [];

      try {
        const res = await fetch('./btc_data.json', { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json.records)) {
            records = json.records;
          }
        }
      } catch (_) {}

      if (!records.length) {
        try {
          const res = await fetch('./btc_seed.json');
          if (res.ok) {
            const seed = await res.json();
            const getZ = (ind, ms) => {
              if (!ind || !Array.isArray(ind.values)) return null;
              const idx = Math.round((ms - ind.start) / ONE_DAY);
              if (idx >= 0 && idx < ind.values.length) return ind.values[idx];
              if (idx >= ind.values.length && idx - (ind.values.length - 1) <= 7) return ind.values[ind.values.length - 1];
              return null;
            };
            const nowMs = Date.now();
            records = (seed.btc || [])
              .filter(([ms, p]) => ms <= nowMs + ONE_DAY && p > 0)
              .map(([ms, p]) => {
                const q = raqqrPricesAtMs(ms);
                return {
                  ms,
                  d: new Date(ms).toISOString().slice(0, 10),
                  p,
                  q,
                  zp: priceZScore(p, q[0], q[3], q[6]),
                  zs: getZ(seed.sharpe, ms),
                  zc: getZ(seed.cbpl, ms),
                  zo: getZ(seed.onchain, ms),
                  zl: null
                };
              });
          }
        } catch (e) {
          console.error("Failed to load btc_seed.json:", e);
        }
      }

      // Live BTC spot refresh from Coinbase public API
      try {
        const r = await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot');
        if (r.ok) {
          const j = await r.json();
          const livePrice = parseFloat(j?.data?.amount);
          if (isFinite(livePrice) && livePrice > 0 && records.length > 0) {
            const now = new Date();
            const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
            const todayStr = new Date(todayMs).toISOString().slice(0, 10);
            const q = raqqrPricesAtMs(todayMs);
            const prev = records[records.length - 1];
            const updatedRow = {
              ms: todayMs,
              d: todayStr,
              p: livePrice,
              q,
              zp: priceZScore(livePrice, q[0], q[3], q[6]),
              zs: prev.zs,
              zc: prev.zc,
              zo: prev.zo,
              zl: prev.zl
            };
            if (prev.d === todayStr) {
              records = [...records.slice(0, -1), updatedRow];
            } else if (todayMs > prev.ms) {
              records = [...records, updatedRow];
            }
            if (!cancelled) {
              setLiveStatus(`Live BTC synced: $${livePrice.toLocaleString('en-US', { maximumFractionDigits: 0 })} (${todayStr})`);
            }
          }
        }
      } catch (_) {
        if (!cancelled && records.length) {
          setLiveStatus(`Loaded ${records.length.toLocaleString()} candles through ${records[records.length - 1].d}`);
        }
      }

      if (!cancelled) {
        setRawRecords(records);
        if (records.length) {
          setCustomEnd(records[records.length - 1].d);
        }
        setLoading(false);
      }
    };

    loadBtcData();
    return () => { cancelled = true; };
  }, []);

  // Apply timeframe preset helper
  const applyTimeframePreset = (preset) => {
    setTfPreset(preset);
    if (!rawRecords.length) return;
    const lastMs = rawRecords[rawRecords.length - 1].ms;
    const lastDateStr = rawRecords[rawRecords.length - 1].d;
    const lastYear = new Date(lastMs).getUTCFullYear();
    let startStr = '2010-08-18';

    switch (preset) {
      case '1M': startStr = new Date(lastMs - 30 * ONE_DAY).toISOString().slice(0, 10); break;
      case '3M': startStr = new Date(lastMs - 90 * ONE_DAY).toISOString().slice(0, 10); break;
      case '6M': startStr = new Date(lastMs - 180 * ONE_DAY).toISOString().slice(0, 10); break;
      case 'YTD': startStr = `${lastYear}-01-01`; break;
      case '1Y': startStr = new Date(lastMs - 365 * ONE_DAY).toISOString().slice(0, 10); break;
      case '2Y': startStr = new Date(lastMs - 730 * ONE_DAY).toISOString().slice(0, 10); break;
      case '4Y': startStr = new Date(lastMs - 1461 * ONE_DAY).toISOString().slice(0, 10); break;
      case '2020': startStr = '2020-01-01'; break;
      case '2017': startStr = '2017-01-01'; break;
      case 'ALL': startStr = rawRecords[0].d; break;
      default: break;
    }
    setCustomStart(startStr);
    setCustomEnd(lastDateStr);
  };

  // 2. Compute Composite Z-score, Composite Risk, and Log10 price values
  const series = useMemo(() => {
    return rawRecords
      .filter(r => r && Array.isArray(r.q) && r.q.length === 7 && isFinite(r.p) && r.p > 0)
      .map(r => {
        const votes = [];
        if (indicators.price) votes.push(r.zp);
        if (indicators.cbpl) votes.push(r.zc);
        if (indicators.onchain) votes.push(r.zo);
        if (indicators.sharpe) votes.push(r.zs);
        if (indicators.liquidity) votes.push(r.zl);

        let compZ = NaN;
        if (votes.length > 0 && votes.every(v => v !== null && v !== undefined && isFinite(v))) {
          compZ = clamp(votes.reduce((a, b) => a + Number(b), 0) / votes.length, -3, 3);
        }
        const compRisk = isFinite(compZ) ? clamp(50 - (compZ / 3) * 50, 0, 100) : NaN;
        const eqmRisk = eqmRiskFromPrice(r.p, r.q);

        return {
          ...r,
          q01: r.q[0],
          q10: r.q[1],
          q25: r.q[2],
          q50: r.q[3],
          q75: r.q[4],
          q95: r.q[5],
          q99: r.q[6],
          logP: safeLog10(r.p),
          logQ01: safeLog10(r.q[0]),
          logQ10: safeLog10(r.q[1]),
          logQ25: safeLog10(r.q[2]),
          logQ50: safeLog10(r.q[3]),
          logQ75: safeLog10(r.q[4]),
          logQ95: safeLog10(r.q[5]),
          logQ99: safeLog10(r.q[6]),
          compZ: isFinite(compZ) ? Number(compZ.toFixed(2)) : null,
          compRisk: isFinite(compRisk) ? Number(compRisk.toFixed(2)) : null,
          // Map Z-score (-3..+3) onto 0..100 right axis so it can be toggled on the same chart cleanly
          zMappedToRiskAxis: isFinite(compZ) ? Number(((compZ + 3) / 6 * 100).toFixed(2)) : null,
          eqmRisk
        };
      });
  }, [rawRecords, indicators]);

  const latestRow = useMemo(() => {
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i].compRisk !== null && isFinite(series[i].compRisk)) return series[i];
    }
    return series[series.length - 1] || null;
  }, [series]);

  const chartData = useMemo(() => {
    const startMs = Date.parse((customStart || '2010-01-01') + "T00:00:00Z") || 0;
    const endMs = customEnd ? (Date.parse(customEnd + "T23:59:59Z") || Infinity) : Infinity;
    const sliced = series.filter(r => r.ms >= startMs && r.ms <= endMs);
    const maxPts = isMobile ? 900 : 1800;
    const step = sliced.length > maxPts ? Math.ceil(sliced.length / maxPts) : 1;
    return sliced.filter((_, idx) => idx % step === 0 || idx === sliced.length - 1);
  }, [series, customStart, customEnd, isMobile]);

  // 3. Run Curve Backtest (with Green Accumulate & Red Distribute background column flags)
  const backtest = useMemo(() => {
    if (!series.length) return null;
    const startMs = Date.parse(btStartDate + "T00:00:00Z");
    if (!isFinite(startMs) || btStartingCash <= 0) return null;
    const rows = series.filter(r => r.ms >= startMs && isFinite(r.p) && r.p > 0);
    if (!rows.length) return null;

    let cash = btStartingCash, btc = 0, netDeployed = 0, grossBought = 0, grossSold = 0, btcBoughtGross = 0;
    let buyDays = 0, sellDays = 0, noTradeDays = 0, riskSum = 0, rateSum = 0, riskCount = 0;
    let peakDca = 0, peakBh = 0, mddDca = 0, mddBh = 0;
    const lumpBtc = btStartingCash / rows[0].p;

    const fullHistory = rows.map(row => {
      const risk = row.compRisk;
      const rate = risk !== null && isFinite(risk) ? evaluateCurveAtRisk(risk, curveNodes) : 0;
      let trade = 0;

      if (rate > 0.0001) {
        const buyUsd = clamp(cash * (rate / 100), 0, cash);
        if (buyUsd > 0.005) {
          const b = buyUsd / row.p;
          cash -= buyUsd; btc += b; netDeployed += buyUsd; grossBought += buyUsd; btcBoughtGross += b;
          trade = buyUsd; buyDays++;
        } else noTradeDays++;
      } else if (rate < -0.0001) {
        const sellBtc = clamp(btc * (-rate / 100), 0, btc);
        if (sellBtc > 1e-12) {
          const sUsd = sellBtc * row.p;
          cash += sUsd; btc -= sellBtc; netDeployed -= sUsd; grossSold += sUsd;
          trade = -sUsd; sellDays++;
        } else noTradeDays++;
      } else noTradeDays++;

      if (risk !== null && isFinite(risk)) {
        riskSum += risk; rateSum += rate; riskCount++;
      }

      const portfolio = cash + btc * row.p;
      const buyHold = lumpBtc * row.p;
      if (portfolio > peakDca) peakDca = portfolio;
      if (peakDca > 0) mddDca = Math.max(mddDca, ((peakDca - portfolio) / peakDca) * 100);
      if (buyHold > peakBh) peakBh = buyHold;
      if (peakBh > 0) mddBh = Math.max(mddBh, ((peakBh - buyHold) / peakBh) * 100);

      const pfVal = Math.round(portfolio * 100) / 100;
      const bhVal = Math.round(buyHold * 100) / 100;
      const cashVal = Math.round(cash * 100) / 100;

      // Zone flags for Green (Accumulation) and Red (Distribution) background columns
      const accZoneBg = rate > 0.05 ? 1 : 0;
      const distZoneBg = rate < -0.05 ? 1 : 0;

      return {
        d: row.d,
        price: row.p,
        risk,
        rate,
        trade,
        cash: cashVal,
        btc,
        portfolio: pfVal,
        buyHold: bhVal,
        accZoneBg,
        distZoneBg,
        plotPortfolio: btLogScale ? safeLog10(Math.max(1, pfVal)) : pfVal,
        plotBuyHold: btLogScale ? safeLog10(Math.max(1, bhVal)) : bhVal,
        plotCash: btLogScale ? safeLog10(Math.max(1, cashVal)) : cashVal
      };
    });

    const last = fullHistory[fullHistory.length - 1];
    const pnl = last.portfolio - btStartingCash;
    const retPct = (pnl / btStartingCash) * 100;
    const lumpPnl = last.buyHold - btStartingCash;
    const lumpRet = (lumpPnl / btStartingCash) * 100;
    const vsLump = last.portfolio - last.buyHold;
    const vsLumpPct = (vsLump / last.buyHold) * 100;

    const maxPlotPts = isMobile ? 900 : 1800;
    const plotStep = fullHistory.length > maxPlotPts ? Math.ceil(fullHistory.length / maxPlotPts) : 1;
    const plotHistory = fullHistory.filter((_, idx) => idx % plotStep === 0 || idx === fullHistory.length - 1);

    return {
      days: rows.length,
      buyDays,
      sellDays,
      noTradeDays,
      startingCash: btStartingCash,
      cash,
      btc,
      avgBuy: btcBoughtGross > 0 ? grossBought / btcBoughtGross : NaN,
      portfolioValue: last.portfolio,
      pnl,
      retPct,
      avgRate: riskCount ? rateSum / riskCount : NaN,
      avgRisk: riskCount ? riskSum / riskCount : NaN,
      lumpValue: last.buyHold,
      lumpRet,
      vsLump,
      vsLumpPct,
      mddDca,
      mddBh,
      history: fullHistory,
      plotHistory
    };
  }, [series, btStartDate, btStartingCash, curveNodes, btLogScale, isMobile]);

  const exportCsv = () => {
    if (!backtest || !backtest.history.length) return;
    const cols = ["d", "price", "risk", "rate", "trade", "cash", "btc", "portfolio", "buyHold"];
    const header = "date,btc_price,composite_risk_pct,curve_rate_pct,daily_trade_usd,cash_usd,btc_units,portfolio_value_usd,buy_hold_value_usd";
    const lines = [header, ...backtest.history.map(r => cols.map(c => r[c] ?? "").join(","))];
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `hoagie_btc_dca_backtest_${btStartDate}.csv`;
    a.click();
  };

  // SVG Curve Drag Handlers
  const SVG_W = 760, SVG_H = 260, PAD_L = 52, PAD_R = 16, PAD_T = 16, PAD_B = 28;
  const PLOT_W = SVG_W - PAD_L - PAD_R, PLOT_H = SVG_H - PAD_T - PAD_B;
  const pxX = (risk) => PAD_L + (risk / 100) * PLOT_W;
  const pxY = (val) => PAD_T + (1 - (clamp(val, -10, 10) + 10) / 20) * PLOT_H;
  const valFromPy = (py) => {
    const t = 1 - (py - PAD_T) / PLOT_H;
    return clamp(Math.round((t * 20 - 10) * 10) / 10, -10, 10);
  };

  const handlePointerMove = (evt) => {
    if (draggingIdx === null || !svgRef.current) return;
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const loc = pt.matrixTransform(ctm.inverse());
    const nextVal = valFromPy(loc.y);
    setCurveNodes(prev => {
      const copy = prev.slice();
      copy[draggingIdx] = nextVal;
      return copy;
    });
  };

  const cardStyle = {
    backgroundColor: '#161b22',
    border: '1px solid #30363d',
    borderRadius: '8px',
    padding: isMobile ? '12px' : '16px'
  };

  const btnStyle = (active) => ({
    padding: isMobile ? '6px 10px' : '7px 12px',
    backgroundColor: active ? '#1f6feb' : '#21262d',
    color: active ? '#ffffff' : '#c9d1d9',
    border: '1px solid #30363d',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: isMobile ? '11px' : '12px',
    whiteSpace: 'nowrap'
  });

  const inputDateStyle = {
    backgroundColor: '#0d1117',
    border: '1px solid #30363d',
    color: '#e6edf3',
    padding: '4px 7px',
    borderRadius: '4px',
    fontSize: '11.5px',
    fontFamily: 'monospace',
    colorScheme: 'dark'
  };

  if (loading) {
    return <div style={{ ...cardStyle, padding: '40px', color: '#8b949e', textAlign: 'center' }}>Loading BTC Strategic DCA Model...</div>;
  }

  if (!series.length) {
    return (
      <div style={{ ...cardStyle, padding: '30px', color: '#ff7b72' }}>
        <h3 style={{ marginTop: 0 }}>BTC Dataset Not Found</h3>
        <p style={{ color: '#c9d1d9', fontSize: '13px' }}>
          Could not load <code>./btc_data.json</code> or <code>./btc_seed.json</code>. Run the GitHub Action workflow to generate <code>public/btc_data.json</code>.
        </p>
      </div>
    );
  }

  const todayRisk = latestRow?.compRisk ?? NaN;
  const todayRate = isFinite(todayRisk) ? evaluateCurveAtRisk(todayRisk, curveNodes) : 0;
  const todaySpend = todayRate > 0.0001 ? todayCash * (todayRate / 100) : 0;
  const todayBtcBuy = latestRow?.p > 0 ? todaySpend / latestRow.p : 0;
  const chartHeight = isMobile ? '380px' : '540px';

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : '340px minmax(0, 1fr)',
      gap: isMobile ? '14px' : '20px',
      alignItems: 'start'
    }}>
      
      {/* LEFT SIDEBAR (Stacks on top or below cleanly on mobile) */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        width: '100%',
        order: isMobile ? 2 : 1
      }}>
        
        {/* Today's Model Action Card */}
        <div style={{
          ...cardStyle,
          border: '1px solid #3fb950',
          boxShadow: '0 0 22px rgba(63, 185, 80, 0.14)'
        }}>
          <div style={{ fontSize: '11px', fontFamily: 'monospace', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#3fb950', fontWeight: 700 }}>
            Today's Model Action ({latestRow?.d || 'Live'})
          </div>
          <p style={{ fontSize: '12px', color: '#8b949e', margin: '6px 0 10px', lineHeight: 1.4 }}>
            Evaluates your active Accumulation/Distribution curve at today's Composite Risk.
          </p>

          <label style={{ fontSize: '12px', color: '#8b949e', display: 'block', marginBottom: '4px' }}>
            Your Cash Reserve (USD)
          </label>
          <input
            type="number"
            value={todayCash}
            min="0"
            step="100"
            onChange={(e) => setTodayCash(Math.max(0, Number(e.target.value) || 0))}
            style={{
              width: '100%', padding: '8px', backgroundColor: '#0d1117',
              border: '1px solid #30363d', borderRadius: '6px', color: '#e6edf3',
              fontFamily: 'monospace', fontSize: '13px', boxSizing: 'border-box'
            }}
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #21262d', fontSize: '13px', marginTop: '8px' }}>
            <span style={{ color: '#8b949e' }}>Composite Risk Today</span>
            <b style={{ color: riskZoneColor(todayRisk), fontFamily: 'monospace' }}>
              {isFinite(todayRisk) ? `${todayRisk.toFixed(1)}%` : '—'}
            </b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #21262d', fontSize: '13px' }}>
            <span style={{ color: '#8b949e' }}>Curve Rate Today</span>
            <b style={{ fontFamily: 'monospace' }}>{`${todayRate >= 0 ? '+' : ''}${todayRate.toFixed(2)}%/day`}</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: '15px' }}>
            <span style={{ color: '#8b949e' }}>Action</span>
            <b style={{ color: todayRate > 0.0001 ? '#3fb950' : todayRate < -0.0001 ? '#f85149' : '#e6edf3' }}>
              {todayRate > 0.0001
                ? `BUY ${todayRate.toFixed(2)}% of Cash`
                : todayRate < -0.0001
                ? `SELL ${(-todayRate).toFixed(2)}% of BTC`
                : 'HOLD — No Trade'}
            </b>
          </div>
          <div style={{ fontSize: '12px', color: '#e6edf3', fontWeight: 600 }}>
            {todayRate > 0.0001
              ? `Spend ${usdExact(todaySpend)} ≈ ${todayBtcBuy.toFixed(6)} BTC`
              : todayRate < -0.0001
              ? `Liquidate ${(-todayRate).toFixed(2)}% of current BTC stack`
              : 'Curve rate is 0% at current risk level'}
          </div>
        </div>

        {/* Live Valuation & Risk Summary */}
        <div style={cardStyle}>
          <div style={{ fontSize: '11px', fontFamily: 'monospace', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#58a6ff', marginBottom: '8px', fontWeight: 700 }}>
            Live Valuation Metrics
          </div>
          {[
            ['BTC Price', usdExact(latestRow?.p), '#e6edf3'],
            ['Q50% Fair Value Median', usdExact(latestRow?.q50), '#e6edf3'],
            ['Q1% Lower Rail (Fire Sale)', usdExact(latestRow?.q01), '#58a6ff'],
            ['Q99% Upper Rail (Bubble)', usdExact(latestRow?.q99), '#f85149'],
            ['Price Valuation Risk', isFinite(latestRow?.eqmRisk) ? `${latestRow.eqmRisk.toFixed(1)}%` : '—', riskZoneColor(latestRow?.eqmRisk)],
            ['Composite Risk', isFinite(todayRisk) ? `${todayRisk.toFixed(1)}%` : '—', riskZoneColor(todayRisk)],
            ['Composite Z-Score', isFinite(latestRow?.compZ) ? `${latestRow.compZ > 0 ? '+' : ''}${latestRow.compZ.toFixed(2)}` : '—', '#58a6ff'],
            ['Current Rainbow Band', bandForRisk(latestRow?.eqmRisk), '#e6edf3']
          ].map(([k, v, col], i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < 7 ? '1px solid #21262d' : 'none', fontSize: '13px' }}>
              <span style={{ color: '#8b949e' }}>{k}</span>
              <b style={{ fontFamily: 'monospace', color: col }}>{v}</b>
            </div>
          ))}
        </div>

        {/* Composite Indicator Toggles */}
        <div style={cardStyle}>
          <div style={{ fontSize: '11px', fontFamily: 'monospace', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#58a6ff', marginBottom: '6px', fontWeight: 700 }}>
            Composite Signal Inputs
          </div>
          <p style={{ fontSize: '12px', color: '#8b949e', margin: '0 0 10px', lineHeight: 1.4 }}>
            Toggle which Z-scores blend into Composite Risk (equal-weighted vote):
          </p>
          {[
            ['price', 'Asymmetric Tail Curvature (Price)', latestRow?.zp],
            ['cbpl', 'Cost Basis P/L Ratio (7d EMA)', latestRow?.zc],
            ['onchain', 'Onchain Risk Composite (7d EMA)', latestRow?.zo],
            ['sharpe', 'Realized P/L Sharpe (14d EMA)', latestRow?.zs],
            ['liquidity', 'Hoagie Net Fed Liquidity Impulse', latestRow?.zl]
          ].map(([key, label, zVal]) => (
            <label key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', fontSize: '12.5px', cursor: 'pointer', borderBottom: '1px solid #21262d' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={indicators[key]}
                  disabled={key === 'liquidity' && (zVal === null || zVal === undefined)}
                  onChange={(e) => setIndicators(prev => ({ ...prev, [key]: e.target.checked }))}
                />
                {label}
              </span>
              <span style={{ fontFamily: 'monospace', color: '#8b949e', fontSize: '11px' }}>
                {zVal !== null && zVal !== undefined && isFinite(zVal) ? `Z: ${zVal > 0 ? '+' : ''}${Number(zVal).toFixed(2)}` : 'N/A'}
              </span>
            </label>
          ))}
        </div>

        {/* Live Rainbow Band Price Levels */}
        <div style={cardStyle}>
          <div style={{ fontSize: '11px', fontFamily: 'monospace', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#58a6ff', marginBottom: '8px', fontWeight: 700 }}>
            Live Rainbow Band Levels
          </div>
          {BAND_DEFS.map((b, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: i < BAND_DEFS.length - 1 ? '1px solid #21262d' : 'none', fontSize: '12px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <span style={{ width: '12px', height: '8px', backgroundColor: b.color, borderRadius: '2px', display: 'inline-block' }} />
                {b.name}
              </span>
              <b style={{ fontFamily: 'monospace' }}>
                {latestRow ? `${usdShort(latestRow.q[b.loIdx])} – ${usdShort(latestRow.q[b.hiIdx])}` : '—'}
              </b>
            </div>
          ))}
        </div>
      </div>

      {/* RIGHT MAIN PANEL: Tabs + Interactive Charts */}
      <div style={{
        ...cardStyle,
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        minWidth: 0,
        width: '100%',
        order: isMobile ? 1 : 2
      }}>
        
        {/* Top Tab Bar + How It's Calculated Button */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', borderBottom: '1px solid #30363d', paddingBottom: '12px' }}>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button onClick={() => setActiveTab('rainbow')} style={btnStyle(activeTab === 'rainbow')}>
              🌈 Tail Rainbow
            </button>
            <button onClick={() => setActiveTab('composite')} style={btnStyle(activeTab === 'composite')}>
              📊 Composite Risk & Z-Score
            </button>
            <button onClick={() => setActiveTab('curve')} style={btnStyle(activeTab === 'curve')}>
              ⚙️ Accum/Dist Curve & Backtest
            </button>
          </div>

          <button onClick={() => setShowInfo(!showInfo)} style={{
            ...btnStyle(showInfo),
            borderColor: '#58a6ff',
            color: showInfo ? '#ffffff' : '#58a6ff'
          }}>
            ⓘ {showInfo ? 'Hide Math & Methodology' : 'How It’s Calculated'}
          </button>
        </div>

        {/* Fine-Tuned Timeframe Controls Bar (Shown for Rainbow & Composite Risk tabs) */}
        {activeTab !== 'curve' && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
            backgroundColor: '#0d1117',
            padding: '8px 12px',
            borderRadius: '6px',
            border: '1px solid #21262d'
          }}>
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: '#8b949e', marginRight: '4px', fontFamily: 'monospace' }}>Range:</span>
              {[
                ['1M', '1M'],
                ['3M', '3M'],
                ['6M', '6M'],
                ['YTD', 'YTD'],
                ['1Y', '1Y'],
                ['2Y', '2Y'],
                ['4Y', '4Y (Cycle)'],
                ['2020', '2020+'],
                ['2017', '2017+'],
                ['ALL', 'ALL']
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => applyTimeframePreset(key)}
                  style={{
                    ...btnStyle(tfPreset === key),
                    padding: '4px 8px',
                    fontSize: '11px'
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', color: '#8b949e', fontFamily: 'monospace' }}>Custom:</span>
              <input
                type="date"
                value={customStart}
                style={inputDateStyle}
                onChange={(e) => { setCustomStart(e.target.value); setTfPreset('CUSTOM'); }}
              />
              <span style={{ color: '#8b949e', fontSize: '11px' }}>to</span>
              <input
                type="date"
                value={customEnd}
                style={inputDateStyle}
                onChange={(e) => { setCustomEnd(e.target.value); setTfPreset('CUSTOM'); }}
              />
            </div>
          </div>
        )}

        {/* Comprehensive Collapsible Math & Methodology Drawer */}
        {showInfo && (
          <div style={{
            backgroundColor: '#0d1117',
            border: '1px solid #58a6ff66',
            borderLeft: '3px solid #58a6ff',
            borderRadius: '6px',
            padding: '14px',
            fontSize: '12.5px',
            lineHeight: 1.55,
            color: '#c9d1d9',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '14px'
          }}>
            <div style={{ backgroundColor: '#161b22', padding: '12px', borderRadius: '6px', border: '1px solid #30363d' }}>
              <strong style={{ color: '#f3cd7a', display: 'block', marginBottom: '6px', fontSize: '13px' }}>
                1. Asymmetric Tail Curvature Rainbow (RAQQR)
              </strong>
              Models conditional quantiles of <code>log10(BTC Price)</code> as a centered quadratic in log-time:<br />
              <code style={{ color: '#79c0ff', display: 'block', margin: '6px 0', fontSize: '11.5px' }}>
                Q_τ(log10 P) = c_τ + a_τ·x + b_τ·x²,  x = ln(t) - 7.9914
              </code>
              where <code>t</code> is days since Jan 1, 2009. Lower accumulation rails (Q1%–Q25%) share mild curvature (<code>b = -0.0241</code>), the Q50% median uses <code>b = -0.1126</code>, and upper bubble rails (Q75%–Q99%) curve down faster (<code>b = -0.3259</code>) to capture diminishing cycle returns.<br />
              <strong>Price Z-Score:</strong> Linearly maps <code>ln(Price)</code> between Q50% (<code>Z = 0</code>), Q1% lower rail (<code>Z = +3.0</code> buy extreme), and Q99% upper rail (<code>Z = -3.0</code> sell extreme).
            </div>

            <div style={{ backgroundColor: '#161b22', padding: '12px', borderRadius: '6px', border: '1px solid #30363d' }}>
              <strong style={{ color: '#22c55e', display: 'block', marginBottom: '6px', fontSize: '13px' }}>
                2. Composite Z-Score & Valuation Risk %
              </strong>
              Each enabled indicator in the left sidebar casts an equal-weighted vote in <code>[-3, +3]</code> (where <code>+Z</code> = undervalued/buy and <code>-Z</code> = overvalued/sell):
              <ul style={{ margin: '6px 0', paddingLeft: '18px', fontSize: '12px' }}>
                <li><strong>Price Valuation (RAQQR):</strong> Position within the Q1%–Q99% log-time rainbow.</li>
                <li><strong>Cost Basis P/L Ratio (7d EMA):</strong> Log ratio of total unrealized profit to unrealized loss across the UTXO cost-basis histogram (expanding robust Z-score).</li>
                <li><strong>Onchain Risk Composite (7d EMA):</strong> Weighted blend of 8 on-chain percentile metrics (MVRV, MVRV Z, NUPL, Puell, LTH PVR, Supply P/L).</li>
                <li><strong>Realized P/L Sharpe (14d EMA):</strong> Full-history percentile rank of rolling realized P/L Sharpe.</li>
                <li><strong>Hoagie Net Liquidity Impulse:</strong> 90-day rate-of-change of Net Fed Liquidity (WALCL − TGA − RRP + Facilities).</li>
              </ul>
              <code style={{ color: '#79c0ff', display: 'block', marginTop: '4px', fontSize: '11.5px' }}>
                Composite Risk % = clamp(50 - (Composite_Z / 3) × 50, 0, 100)
              </code>
            </div>

            <div style={{ backgroundColor: '#161b22', padding: '12px', borderRadius: '6px', border: '1px solid #30363d' }}>
              <strong style={{ color: '#58a6ff', display: 'block', marginBottom: '6px', fontSize: '13px' }}>
                3. Accum/Dist Curve & Backtester
              </strong>
              Maps each day's <strong>Composite Risk (0–100%)</strong> across 21 draggable nodes (in 5% increments) to a daily trade rate <code>r_t ∈ [-10%, +10%]</code>:
              <ul style={{ margin: '6px 0', paddingLeft: '18px', fontSize: '12px' }}>
                <li><strong style={{ color: '#3fb950' }}>Green Accumulation Zone (r_t &gt; 0%):</strong> Spends <code>r_t%</code> of your remaining USD Cash Reserve into BTC that day.</li>
                <li><strong style={{ color: '#8b949e' }}>Neutral Hold Zone (r_t = 0%):</strong> Holds existing BTC and cash without trading.</li>
                <li><strong style={{ color: '#f85149' }}>Red Distribution Zone (r_t &lt; 0%):</strong> Sells <code>|r_t|%</code> of your current BTC stack back into your USD Cash Reserve, building dry powder for the next bear cycle.</li>
              </ul>
            </div>
          </div>
        )}

        {/* TAB 1: ASYMMETRIC TAIL RAINBOW */}
        {activeTab === 'rainbow' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '6px' }}>
              <h3 style={{ margin: 0, fontSize: isMobile ? '14px' : '16px', color: '#e6edf3' }}>
                Bitcoin Asymmetric Tail Curvature Rainbow (Log10 Scale)
              </h3>
              <span style={{ fontSize: '11px', color: '#8b949e', fontFamily: 'monospace' }}>{liveStatus}</span>
            </div>
            <div style={{ height: chartHeight, width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: isMobile ? 5 : 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
                  <XAxis dataKey="d" stroke="#8b949e" tick={{ fill: '#8b949e', fontSize: 11 }} minTickGap={isMobile ? 40 : 60} />
                  <YAxis
                    domain={['auto', 'auto']}
                    stroke="#8b949e"
                    tick={{ fill: '#8b949e', fontSize: 11 }}
                    tickFormatter={(v) => usdShort(Math.pow(10, Number(v)))}
                    width={isMobile ? 54 : 68}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0d1117', borderColor: '#30363d', color: '#e6edf3', fontSize: '12px' }}
                    formatter={(val, name) => [usdExact(Math.pow(10, Number(val))), name]}
                  />
                  <Legend wrapperStyle={{ fontSize: isMobile ? '11px' : '12px', paddingTop: '8px' }} />
                  <Line type="monotone" dataKey="logQ99" name="Q99% Bubble Rail" stroke="#f85149" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="logQ95" name="Q95% Hot" stroke="#f0883e" strokeWidth={1.2} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="logQ75" name="Q75% Above Mid" stroke="#d29922" strokeWidth={1.2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="logQ50" name="Q50% Median Fair Value" stroke="#ffffff" strokeWidth={2.2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="logQ25" name="Q25% Value" stroke="#3fb950" strokeWidth={1.2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="logQ10" name="Q10% Accumulate" stroke="#2ea043" strokeWidth={1.2} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="logQ01" name="Q1% Fire Sale Rail" stroke="#58a6ff" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="logP" name="BTC Price" stroke="#f3cd7a" strokeWidth={2.6} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* TAB 2: COMPOSITE RISK & Z-SCORE (Multi-Colored by Risk Zone) */}
        {activeTab === 'composite' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: isMobile ? '14px' : '16px', color: '#e6edf3' }}>
                  Composite Valuation Risk (Multi-Zone Colored Line)
                </h3>
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap', fontSize: '11px', fontFamily: 'monospace' }}>
                  <span style={{ padding: '3px 8px', border: '1px solid #22c55e', color: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)', borderRadius: '4px' }}>
                    0–25% Buy Zone (Z: +1.5 to +3)
                  </span>
                  <span style={{ padding: '3px 8px', border: '1px solid #95d81d', color: '#95d81d', backgroundColor: 'rgba(149,216,29,0.1)', borderRadius: '4px' }}>
                    25–50% Accumulate (Z: 0 to +1.5)
                  </span>
                  <span style={{ padding: '3px 8px', border: '1px solid #f59e0b', color: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', borderRadius: '4px' }}>
                    50–75% Trim (Z: 0 to -1.5)
                  </span>
                  <span style={{ padding: '3px 8px', border: '1px solid #ff4444', color: '#ff4444', backgroundColor: 'rgba(255,68,68,0.1)', borderRadius: '4px' }}>
                    75–100% Sell Zone (Z: -1.5 to -3)
                  </span>
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#79c0ff', cursor: 'pointer', fontFamily: 'monospace', padding: '4px 8px', border: '1px solid #30363d', borderRadius: '4px', backgroundColor: '#0d1117' }}>
                <input type="checkbox" checked={showZLine} onChange={(e) => setShowZLine(e.target.checked)} />
                Show Z-Score Line
              </label>
            </div>

            <div style={{ height: chartHeight, width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: isMobile ? 5 : 20, left: 0, bottom: 5 }}>
                  <defs>
                    {/* Vertical gradient aligned with [0, 100] Risk Y-Axis:
                        Top (y=0 -> 100% Risk) = Red Sell Zone
                        25% down (75% Risk) -> 50% down (50% Risk) = Amber Trim Zone
                        50% down (50% Risk) -> 75% down (25% Risk) = Lime Accumulate Zone
                        Bottom (y=1 -> 0% Risk) = Green Buy Zone */}
                    <linearGradient id="compRiskZoneGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ff4444" />
                      <stop offset="25%" stopColor="#ff4444" />
                      <stop offset="25.1%" stopColor="#f59e0b" />
                      <stop offset="50%" stopColor="#f59e0b" />
                      <stop offset="50.1%" stopColor="#95d81d" />
                      <stop offset="75%" stopColor="#95d81d" />
                      <stop offset="75.1%" stopColor="#22c55e" />
                      <stop offset="100%" stopColor="#22c55e" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
                  <XAxis dataKey="d" stroke="#8b949e" tick={{ fill: '#8b949e', fontSize: 11 }} minTickGap={isMobile ? 40 : 60} />
                  <YAxis
                    yAxisId="left"
                    domain={['auto', 'auto']}
                    stroke="#8b949e"
                    tick={{ fill: '#8b949e', fontSize: 11 }}
                    tickFormatter={(v) => usdShort(Math.pow(10, Number(v)))}
                    width={isMobile ? 54 : 64}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, 100]}
                    ticks={[0, 25, 50, 75, 100]}
                    stroke="#8b949e"
                    tick={{ fill: '#8b949e', fontSize: 11 }}
                    tickFormatter={(v) => `${v}%`}
                    width={46}
                  />
                  <ReferenceLine yAxisId="right" y={25} stroke="#22c55e" strokeOpacity={0.55} strokeDasharray="3 3" />
                  <ReferenceLine yAxisId="right" y={50} stroke="#8b949e" strokeOpacity={0.65} strokeDasharray="4 4" />
                  <ReferenceLine yAxisId="right" y={75} stroke="#ff4444" strokeOpacity={0.55} strokeDasharray="3 3" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0d1117', borderColor: '#30363d', color: '#e6edf3', fontSize: '12px' }}
                    formatter={(val, name, props) => {
                      if (name === 'BTC Price') return [usdExact(Math.pow(10, Number(val))), name];
                      if (name === 'Composite Z-Score') {
                        const rawZ = props?.payload?.compZ;
                        return [rawZ !== null && isFinite(rawZ) ? `${rawZ > 0 ? '+' : ''}${rawZ.toFixed(2)}` : '—', name];
                      }
                      return [`${Number(val).toFixed(1)}%`, name];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: isMobile ? '11px' : '12px', paddingTop: '8px' }} />
                  <Line yAxisId="left" type="monotone" dataKey="logP" name="BTC Price" stroke="rgba(230,237,243,0.75)" strokeWidth={1.6} dot={false} isAnimationActive={false} />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="compRisk"
                    name="Composite Risk %"
                    stroke="url(#compRiskZoneGrad)"
                    strokeWidth={2.8}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                  {showZLine && (
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="zMappedToRiskAxis"
                      name="Composite Z-Score"
                      stroke="rgba(88, 166, 255, 0.55)"
                      strokeWidth={1.4}
                      strokeDasharray="3 3"
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* TAB 3: INTERACTIVE ACCUM/DIST CURVE & BACKTESTER */}
        {activeTab === 'curve' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: isMobile ? '14px' : '16px', color: '#e6edf3' }}>
                  Interactive Accumulation / Distribution Curve
                </h3>
                <span style={{ fontSize: '12px', color: '#8b949e' }}>
                  Drag any node up/down. X-axis = Composite Risk %, Y-axis = % of Cash bought (+) or % of BTC sold (–) per day.
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button onClick={exportCsv} style={btnStyle(false)}>⬇ Export CSV</button>
                <button onClick={() => setCurveNodes(CURVE_DEFAULT_VALUES.slice())} style={btnStyle(false)}>↺ Reset Default Curve</button>
              </div>
            </div>

            {/* 21-Node Interactive SVG Curve Editor */}
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', padding: isMobile ? '6px' : '10px' }}>
              <svg
                ref={svgRef}
                viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'none', userSelect: 'none' }}
                onPointerMove={handlePointerMove}
                onPointerUp={() => setDraggingIdx(null)}
                onPointerLeave={() => setDraggingIdx(null)}
              >
                <rect x={PAD_L} y={PAD_T} width={PLOT_W} height={PLOT_H / 2} fill="rgba(63,185,80,0.08)" />
                <rect x={PAD_L} y={PAD_T + PLOT_H / 2} width={PLOT_W} height={PLOT_H / 2} fill="rgba(248,81,73,0.08)" />
                {[-10, -5, 0, 5, 10].map(v => {
                  const y = pxY(v);
                  return (
                    <g key={v}>
                      <line x1={PAD_L} x2={PAD_L + PLOT_W} y1={y} y2={y} stroke={v === 0 ? "#8b949e" : "#21262d"} strokeWidth={v === 0 ? 1.5 : 1} />
                      <text x={PAD_L - 6} y={y + 4} fill="#8b949e" fontSize="10" textAnchor="end" fontFamily="monospace">
                        {v > 0 ? `+${v}%` : `${v}%`}
                      </text>
                    </g>
                  );
                })}
                {CURVE_RISK_NODES.map((r) => {
                  const x = pxX(r);
                  return (
                    <g key={r}>
                      <line x1={x} x2={x} y1={PAD_T} y2={PAD_T + PLOT_H} stroke={r % 10 === 0 ? "#21262d" : "#161b22"} />
                      {r % 10 === 0 && (
                        <text x={x} y={SVG_H - 8} fill="#8b949e" fontSize="10" textAnchor="middle" fontFamily="monospace">
                          {r}%
                        </text>
                      )}
                    </g>
                  );
                })}
                <path
                  d={CURVE_RISK_NODES.map((r, i) => `${i === 0 ? 'M' : 'L'}${pxX(r)},${pxY(curveNodes[i])}`).join(' ')}
                  fill="none"
                  stroke="#58a6ff"
                  strokeWidth="2.5"
                />
                {CURVE_RISK_NODES.map((r, i) => {
                  const cx = pxX(r), cy = pxY(curveNodes[i]);
                  const val = curveNodes[i];
                  const fill = val > 0.05 ? "#3fb950" : val < -0.05 ? "#f85149" : "#8b949e";
                  return (
                    <g key={r}>
                      {draggingIdx === i && (
                        <text x={cx} y={val >= 0 ? cy - 12 : cy + 20} fill="#ffffff" fontSize="11" fontWeight="bold" textAnchor="middle" fontFamily="monospace">
                          {val > 0 ? `+${val.toFixed(1)}%` : `${val.toFixed(1)}%`}
                        </text>
                      )}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={isMobile ? 8.5 : 6}
                        fill={fill}
                        stroke="#0d1117"
                        strokeWidth="1.5"
                        style={{ cursor: 'grab' }}
                        onPointerDown={(e) => {
                          e.target.setPointerCapture?.(e.pointerId);
                          setDraggingIdx(i);
                        }}
                      />
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Backtest Controls & Performance Metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '270px 1fr', gap: '14px' }}>
              <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', padding: '12px' }}>
                <div style={{ fontSize: '11px', color: '#8b949e', marginBottom: '6px', fontFamily: 'monospace' }}>Quick Start Presets:</div>
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  {[
                    ['2015', '2015-01-01'],
                    ['2017', '2017-01-01'],
                    ['2018', '2018-01-01'],
                    ['2020', '2020-01-01'],
                    ['2022', '2022-01-01'],
                    ['2024', '2024-01-01']
                  ].map(([lbl, dt]) => (
                    <button
                      key={lbl}
                      onClick={() => setBtStartDate(dt)}
                      style={{ ...btnStyle(btStartDate === dt), padding: '4px 8px', fontSize: '11px' }}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>

                <label style={{ fontSize: '12px', color: '#8b949e', display: 'block', marginBottom: '4px' }}>Starting Date</label>
                <input
                  type="date"
                  value={btStartDate}
                  onChange={(e) => setBtStartDate(e.target.value)}
                  style={{ width: '100%', padding: '7px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '4px', color: '#fff', colorScheme: 'dark', marginBottom: '10px', boxSizing: 'border-box' }}
                />
                <label style={{ fontSize: '12px', color: '#8b949e', display: 'block', marginBottom: '4px' }}>Starting Capital (USD)</label>
                <input
                  type="number"
                  value={btStartingCash}
                  min="100"
                  step="500"
                  onChange={(e) => setBtStartingCash(Math.max(0, Number(e.target.value) || 0))}
                  style={{ width: '100%', padding: '7px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '4px', color: '#fff', fontFamily: 'monospace', boxSizing: 'border-box' }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#c9d1d9', marginTop: '12px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={btLogScale} onChange={(e) => setBtLogScale(e.target.checked)} />
                  Log10 Scale Equity Curve
                </label>
              </div>

              {backtest && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: '10px' }}>
                  {[
                    ['Backtest Days', backtest.days.toLocaleString(), `Buy ${backtest.buyDays} / Sell ${backtest.sellDays}`, '#e6edf3'],
                    ['Portfolio Value', usdExact(backtest.portfolioValue), `Return: ${backtest.retPct >= 0 ? '+' : ''}${backtest.retPct.toFixed(1)}%`, '#3fb950'],
                    ['Lump Sum Value', usdExact(backtest.lumpValue), `Return: ${backtest.lumpRet >= 0 ? '+' : ''}${backtest.lumpRet.toFixed(1)}%`, '#e6edf3'],
                    ['Strategy vs Lump Sum', `${backtest.vsLump >= 0 ? '+' : ''}${usdExact(backtest.vsLump)}`, `${backtest.vsLumpPct >= 0 ? '+' : ''}${backtest.vsLumpPct.toFixed(1)}%`, backtest.vsLump >= 0 ? '#3fb950' : '#f85149'],
                    ['Net BTC Stack', `${backtest.btc.toFixed(6)} BTC`, isFinite(backtest.avgBuy) ? `Avg Buy: ${usdExact(backtest.avgBuy)}` : 'No Buys', '#f3cd7a'],
                    ['Cash Reserve', usdExact(backtest.cash), 'Includes Curve Sells', '#3fb950'],
                    ['Max Drawdown (DCA)', `-${backtest.mddDca.toFixed(1)}%`, 'Peak-to-Trough Portfolio', '#f85149'],
                    ['Max Drawdown (HODL)', `-${backtest.mddBh.toFixed(1)}%`, 'Peak-to-Trough Lump Sum', '#f85149']
                  ].map(([k, v, sub, col], i) => (
                    <div key={i} style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', padding: '10px' }}>
                      <div style={{ fontSize: '10px', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{k}</div>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: col, marginTop: '4px', fontFamily: 'monospace' }}>{v}</div>
                      <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '2px', fontFamily: 'monospace' }}>{sub}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Equity Curve Comparison Chart with Green (Accumulate) & Red (Distribute) Background Columns */}
            {backtest && (
              <div>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', fontSize: '11px', fontFamily: 'monospace', color: '#8b949e' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: '12px', height: '10px', backgroundColor: 'rgba(34,197,94,0.28)', border: '1px solid #22c55e', display: 'inline-block', borderRadius: '2px' }} />
                    Green Shaded Columns = Active Accumulation Zone (Buying)
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: '12px', height: '10px', backgroundColor: 'rgba(239,68,68,0.28)', border: '1px solid #ef4444', display: 'inline-block', borderRadius: '2px' }} />
                    Red Shaded Columns = Active Distribution Zone (Selling)
                  </span>
                </div>

                <div style={{ height: isMobile ? '340px' : '400px', width: '100%' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={backtest.plotHistory} margin={{ top: 10, right: isMobile ? 5 : 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
                      <XAxis dataKey="d" stroke="#8b949e" tick={{ fill: '#8b949e', fontSize: 11 }} minTickGap={isMobile ? 40 : 60} />
                      <YAxis
                        yAxisId="equity"
                        domain={['auto', 'auto']}
                        stroke="#8b949e"
                        tick={{ fill: '#8b949e', fontSize: 11 }}
                        tickFormatter={(v) => btLogScale ? usdShort(Math.pow(10, Number(v))) : usdShort(Number(v))}
                        width={isMobile ? 54 : 68}
                      />
                      {/* Hidden [0, 1] Y-Axis to render full-height Green & Red zone background columns */}
                      <YAxis yAxisId="zone" domain={[0, 1]} hide={true} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#0d1117', borderColor: '#30363d', color: '#e6edf3', fontSize: '12px' }}
                        formatter={(val, name) => {
                          if (name === 'Accumulation Zone' || name === 'Distribution Zone') return [null, null];
                          return [
                            btLogScale ? usdExact(Math.pow(10, Number(val))) : usdExact(Number(val)),
                            name
                          ];
                        }}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: isMobile ? '11px' : '12px', paddingTop: '8px' }}
                        formatter={(value) => (value === 'Accumulation Zone' || value === 'Distribution Zone' ? null : value)}
                      />
                      {/* Green Accumulation & Red Distribution Background Columns */}
                      <Area
                        yAxisId="zone"
                        type="stepAfter"
                        dataKey="accZoneBg"
                        name="Accumulation Zone"
                        legendType="none"
                        tooltipType="none"
                        stroke="none"
                        fill="#22c55e"
                        fillOpacity={0.18}
                        isAnimationActive={false}
                      />
                      <Area
                        yAxisId="zone"
                        type="stepAfter"
                        dataKey="distZoneBg"
                        name="Distribution Zone"
                        legendType="none"
                        tooltipType="none"
                        stroke="none"
                        fill="#ef4444"
                        fillOpacity={0.22}
                        isAnimationActive={false}
                      />
                      <Line yAxisId="equity" type="monotone" dataKey="plotPortfolio" name="Strategic DCA Portfolio (BTC + Cash)" stroke="#f3cd7a" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                      <Line yAxisId="equity" type="monotone" dataKey="plotBuyHold" name="Buy & Hold (Day 1 Lump Sum)" stroke="#8b949e" strokeWidth={1.6} dot={false} isAnimationActive={false} />
                      <Line yAxisId="equity" type="monotone" dataKey="plotCash" name="Cash Reserve" stroke="#3fb950" strokeWidth={1.3} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default function BtcStrategist() {
  return (
    <SafeErrorBoundary>
      <BtcStrategistInner />
    </SafeErrorBoundary>
  );
}
