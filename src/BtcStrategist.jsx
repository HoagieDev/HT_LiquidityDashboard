import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea, Legend
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

const usdShort = (v) => {
  if (!isFinite(v)) return "—";
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(v >= 100e3 ? 0 : 1)}K`;
  return `$${v.toFixed(v < 10 ? 2 : 0)}`;
};

const usdExact = (v) => {
  if (!isFinite(v)) return "—";
  return "$" + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  if (!isFinite(price) || price <= 0 || !q || q.length < 7) return NaN;
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

const BtcStrategist = () => {
  const [rawRecords, setRawRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [liveStatus, setLiveStatus] = useState('');
  const [activeTab, setActiveTab] = useState('rainbow'); // 'rainbow' | 'composite' | 'curve'
  const [rangeStart, setRangeStart] = useState('2017-01-01');
  const [showInfo, setShowInfo] = useState(false);

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

  // 1. Load public/btc_data.json (or public/btc_seed.json fallback) + live spot refresh
  const loadBtcData = async () => {
    setLoading(true);
    setLiveStatus('Loading historical BTC dataset...');
    let records = [];

    try {
      const res = await fetch('./btc_data.json', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        records = json.records || [];
      }
    } catch (_) {}

    // Fallback: if btc_data.json hasn't been generated by Python yet, parse btc_seed.json directly in browser
    if (!records.length) {
      try {
        const res = await fetch('./btc_seed.json');
        if (res.ok) {
          const seed = await res.json();
          const getZ = (ind, ms) => {
            if (!ind || !ind.values) return null;
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

    // Best-effort live BTC spot refresh from Coinbase public ticker
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
            records[records.length - 1] = updatedRow;
          } else if (todayMs > prev.ms) {
            records = [...records, updatedRow];
          }
          setLiveStatus(`Live BTC spot synced: $${livePrice.toLocaleString('en-US', { maximumFractionDigits: 0 })} (${todayStr})`);
        }
      }
    } catch (_) {
      if (records.length) {
        setLiveStatus(`Loaded ${records.length.toLocaleString()} daily candles through ${records[records.length - 1].d}`);
      }
    }

    setRawRecords(records);
    setLoading(false);
  };

  useEffect(() => {
    loadBtcData();
  }, []);

  // 2. Compute Composite Z-score and Composite Risk across all records
  const series = useMemo(() => {
    return rawRecords.map(r => {
      const votes = [];
      if (indicators.price) votes.push(r.zp);
      if (indicators.cbpl) votes.push(r.zc);
      if (indicators.onchain) votes.push(r.zo);
      if (indicators.sharpe) votes.push(r.zs);
      if (indicators.liquidity) votes.push(r.zl);

      let compZ = NaN;
      if (votes.length > 0 && votes.every(v => v !== null && v !== undefined && isFinite(v))) {
        compZ = clamp(votes.reduce((a, b) => a + b, 0) / votes.length, -3, 3);
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
        compZ,
        compRisk,
        eqmRisk,
        buyZoneRisk: compRisk < 25 ? compRisk : null,
        accZoneRisk: compRisk >= 25 && compRisk < 50 ? compRisk : null,
        trimZoneRisk: compRisk >= 50 && compRisk < 75 ? compRisk : null,
        sellZoneRisk: compRisk >= 75 ? compRisk : null
      };
    });
  }, [rawRecords, indicators]);

  // Latest valid composite index
  const latestRow = useMemo(() => {
    for (let i = series.length - 1; i >= 0; i--) {
      if (isFinite(series[i].compRisk)) return series[i];
    }
    return series[series.length - 1] || null;
  }, [series]);

  // Filtered chart data for Rainbow & Composite Risk tabs
  const chartData = useMemo(() => {
    const startMs = Date.parse(rangeStart + "T00:00:00Z") || 0;
    const sliced = series.filter(r => r.ms >= startMs);
    // Downsample slightly if > 2000 points for smooth Recharts rendering
    const step = sliced.length > 2200 ? 2 : 1;
    return sliced.filter((_, idx) => idx % step === 0 || idx === sliced.length - 1);
  }, [series, rangeStart]);

  // 3. Run Curve Backtest
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

    const history = rows.map(row => {
      const risk = row.compRisk;
      const rate = isFinite(risk) ? evaluateCurveAtRisk(risk, curveNodes) : 0;
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

      if (isFinite(risk)) {
        riskSum += risk; rateSum += rate; riskCount++;
      }

      const portfolio = cash + btc * row.p;
      const buyHold = lumpBtc * row.p;
      if (portfolio > peakDca) peakDca = portfolio;
      if (peakDca > 0) mddDca = Math.max(mddDca, ((peakDca - portfolio) / peakDca) * 100);
      if (buyHold > peakBh) peakBh = buyHold;
      if (peakBh > 0) mddBh = Math.max(mddBh, ((peakBh - buyHold) / peakBh) * 100);

      return {
        d: row.d,
        price: row.p,
        risk,
        rate,
        trade,
        cash: Math.round(cash * 100) / 100,
        btc,
        portfolio: Math.round(portfolio * 100) / 100,
        buyHold: Math.round(buyHold * 100) / 100
      };
    });

    const last = history[history.length - 1];
    const pnl = last.portfolio - btStartingCash;
    const retPct = (pnl / btStartingCash) * 100;
    const lumpPnl = last.buyHold - btStartingCash;
    const lumpRet = (lumpPnl / btStartingCash) * 100;
    const vsLump = last.portfolio - last.buyHold;
    const vsLumpPct = (vsLump / last.buyHold) * 100;

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
      history
    };
  }, [series, btStartDate, btStartingCash, curveNodes]);

  // CSV Export
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

  if (loading) {
    return <div style={{ padding: '40px', color: '#8b949e' }}>Loading BTC Strategic DCA Model...</div>;
  }

  const todayRisk = latestRow?.compRisk ?? NaN;
  const todayRate = isFinite(todayRisk) ? evaluateCurveAtRisk(todayRisk, curveNodes) : 0;
  const todaySpend = todayRate > 0.0001 ? todayCash * (todayRate / 100) : 0;
  const todayBtcBuy = latestRow?.p > 0 ? todaySpend / latestRow.p : 0;

  const cardStyle = {
    backgroundColor: '#161b22',
    border: '1px solid #30363d',
    borderRadius: '8px',
    padding: '16px'
  };

  const btnStyle = (active) => ({
    padding: '7px 14px',
    backgroundColor: active ? '#1f6feb' : '#21262d',
    color: active ? '#ffffff' : '#c9d1d9',
    border: '1px solid #30363d',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '12px'
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '350px 1fr', gap: '20px', alignItems: 'start' }}>
      
      {/* LEFT SIDEBAR: Today's Action, Live Stats, Indicator Toggles, Band Levels */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        
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
              fontFamily: 'monospace', fontSize: '13px'
            }}
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #21262d', fontSize: '13px', marginTop: '8px' }}>
            <span style={{ color: '#8b949e' }}>Composite Risk Today</span>
            <b>{isFinite(todayRisk) ? `${todayRisk.toFixed(1)}%` : '—'}</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #21262d', fontSize: '13px' }}>
            <span style={{ color: '#8b949e' }}>Curve Rate Today</span>
            <b>{`${todayRate >= 0 ? '+' : ''}${todayRate.toFixed(2)}%/day`}</b>
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
            ['BTC Price', usdExact(latestRow?.p)],
            ['Q50% Fair Value Median', usdExact(latestRow?.q50)],
            ['Q1% Lower Rail (Fire Sale)', usdExact(latestRow?.q01)],
            ['Q99% Upper Rail (Bubble)', usdExact(latestRow?.q99)],
            ['Price Valuation Risk', isFinite(latestRow?.eqmRisk) ? `${latestRow.eqmRisk.toFixed(1)}%` : '—'],
            ['Composite Risk', isFinite(todayRisk) ? `${todayRisk.toFixed(1)}%` : '—'],
            ['Composite Z-Score', isFinite(latestRow?.compZ) ? `${latestRow.compZ > 0 ? '+' : ''}${latestRow.compZ.toFixed(2)}` : '—'],
            ['Current Rainbow Band', bandForRisk(latestRow?.eqmRisk)]
          ].map(([k, v], i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < 7 ? '1px solid #21262d' : 'none', fontSize: '13px' }}>
              <span style={{ color: '#8b949e' }}>{k}</span>
              <b style={{ fontFamily: 'monospace' }}>{v}</b>
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
                  disabled={key === 'liquidity' && zVal === null}
                  onChange={(e) => setIndicators(prev => ({ ...prev, [key]: e.target.checked }))}
                />
                {label}
              </span>
              <span style={{ fontFamily: 'monospace', color: '#8b949e', fontSize: '11px' }}>
                {isFinite(zVal) ? `Z: ${zVal > 0 ? '+' : ''}${zVal.toFixed(2)}` : 'N/A'}
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
      <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: '16px' }}>
        
        {/* Top Tab Bar + Quick Time Range */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', borderBottom: '1px solid #30363d', paddingBottom: '12px' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={() => setActiveTab('rainbow')} style={btnStyle(activeTab === 'rainbow')}>
              🌈 Asymmetric Tail Rainbow
            </button>
            <button onClick={() => setActiveTab('composite')} style={btnStyle(activeTab === 'composite')}>
              📊 Composite Risk & Z-Score
            </button>
            <button onClick={() => setActiveTab('curve')} style={btnStyle(activeTab === 'curve')}>
              ⚙️ Accum/Dist Curve & Backtester
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {activeTab !== 'curve' && [
              ['2011', '2011-01-01'],
              ['2015', '2015-01-01'],
              ['2018', '2018-01-01'],
              ['2020', '2020-01-01'],
              ['2023', '2023-01-01']
            ].map(([lbl, dt]) => (
              <button key={lbl} onClick={() => setRangeStart(dt)} style={btnStyle(rangeStart === dt)}>
                {lbl}+
              </button>
            ))}
            <button onClick={() => setShowInfo(!showInfo)} style={{ ...btnStyle(showInfo), marginLeft: '6px' }}>
              ⓘ {showInfo ? 'Hide Math' : 'How It’s Calculated'}
            </button>
          </div>
        </div>

        {/* Collapsible Math Explainer */}
        {showInfo && (
          <div style={{
            backgroundColor: '#0d1117', border: '1px solid #58a6ff55', borderLeft: '3px solid #58a6ff',
            borderRadius: '6px', padding: '12px 14px', fontSize: '12.5px', lineHeight: 1.55, color: '#c9d1d9'
          }}>
            <strong>Rearranged Asymmetric Quadratic Quantile Regression (RAQQR):</strong> Models conditional quantiles of <code>log10(BTC Price)</code> as a quadratic function of log-time <code>Q_τ(log10 P) = c_τ + a_τ·x + b_τ·x²</code> where <code>x = ln(days since Jan 1, 2009) - 7.9914</code>. Lower rails (Q1%–Q25%) share curvature <code>b = -0.0241</code>, the median (Q50%) uses <code>b = -0.1126</code>, and upper bubble rails (Q75%–Q99%) bend down faster with <code>b = -0.3259</code> to capture diminishing cycle returns.
          </div>
        )}

        {/* TAB 1: ASYMMETRIC TAIL RAINBOW */}
        {activeTab === 'rainbow' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', color: '#e6edf3' }}>
                Bitcoin Asymmetric Tail Curvature Rainbow (Log Scale)
              </h3>
              <span style={{ fontSize: '11px', color: '#8b949e', fontFamily: 'monospace' }}>{liveStatus}</span>
            </div>
            <div style={{ height: '560px', width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
                  <XAxis dataKey="d" stroke="#8b949e" tick={{ fill: '#8b949e', fontSize: 11 }} minTickGap={60} />
                  <YAxis
                    scale="log"
                    domain={['auto', 'auto']}
                    stroke="#8b949e"
                    tick={{ fill: '#8b949e', fontSize: 11 }}
                    tickFormatter={usdShort}
                    width={65}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0d1117', borderColor: '#30363d', color: '#e6edf3', fontSize: '12px' }}
                    formatter={(val, name) => [usdExact(Number(val)), name]}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                  <Line type="monotone" dataKey="q99" name="Q99% Bubble Rail" stroke="#f85149" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="q95" name="Q95% Hot" stroke="#f0883e" strokeWidth={1.2} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="q75" name="Q75% Above Mid" stroke="#d29922" strokeWidth={1.2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="q50" name="Q50% Median Fair Value" stroke="#ffffff" strokeWidth={2.2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="q25" name="Q25% Value" stroke="#3fb950" strokeWidth={1.2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="q10" name="Q10% Accumulate" stroke="#2ea043" strokeWidth={1.2} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="q01" name="Q1% Fire Sale Rail" stroke="#58a6ff" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="p" name="BTC Price" stroke="#f3cd7a" strokeWidth={2.8} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* TAB 2: COMPOSITE RISK & Z-SCORE */}
        {activeTab === 'composite' && (
          <div>
            <div style={{ marginBottom: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', color: '#e6edf3' }}>
                Composite Valuation Risk (0% = Maximum Buy Zone, 100% = Maximum Sell Zone)
              </h3>
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap', fontSize: '11px', fontFamily: 'monospace' }}>
                <span style={{ padding: '3px 8px', border: '1px solid #22c55e', color: '#22c55e', borderRadius: '4px' }}>0–25% Buy Zone</span>
                <span style={{ padding: '3px 8px', border: '1px solid #95d81d', color: '#95d81d', borderRadius: '4px' }}>25–50% Accumulate</span>
                <span style={{ padding: '3px 8px', border: '1px solid #f59e0b', color: '#f59e0b', borderRadius: '4px' }}>50–75% Trim</span>
                <span style={{ padding: '3px 8px', border: '1px solid #ff4444', color: '#ff4444', borderRadius: '4px' }}>75–100% Sell Zone</span>
              </div>
            </div>
            <div style={{ height: '560px', width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
                  <XAxis dataKey="d" stroke="#8b949e" tick={{ fill: '#8b949e', fontSize: 11 }} minTickGap={60} />
                  <YAxis
                    yAxisId="price"
                    scale="log"
                    domain={['auto', 'auto']}
                    stroke="#8b949e"
                    tick={{ fill: '#8b949e', fontSize: 11 }}
                    tickFormatter={usdShort}
                    width={60}
                  />
                  <YAxis
                    yAxisId="risk"
                    orientation="right"
                    domain={[0, 100]}
                    ticks={[0, 25, 50, 75, 100]}
                    stroke="#8b949e"
                    tick={{ fill: '#8b949e', fontSize: 11 }}
                    tickFormatter={(v) => `${v}%`}
                    width={48}
                  />
                  <ReferenceArea yAxisId="risk" y1={0} y2={25} fill="#22c55e" fillOpacity={0.12} />
                  <ReferenceArea yAxisId="risk" y1={25} y2={50} fill="#95d81d" fillOpacity={0.08} />
                  <ReferenceArea yAxisId="risk" y1={50} y2={75} fill="#f59e0b" fillOpacity={0.08} />
                  <ReferenceArea yAxisId="risk" y1={75} y2={100} fill="#ff4444" fillOpacity={0.12} />
                  <ReferenceLine yAxisId="risk" y={50} stroke="#8b949e" strokeDasharray="4 4" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0d1117', borderColor: '#30363d', color: '#e6edf3', fontSize: '12px' }}
                    formatter={(val, name) => [
                      name === 'BTC Price' ? usdExact(Number(val)) : `${Number(val).toFixed(1)}%`,
                      name
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                  <Line yAxisId="price" type="monotone" dataKey="p" name="BTC Price" stroke="rgba(230,237,243,0.65)" strokeWidth={1.6} dot={false} isAnimationActive={false} />
                  <Line yAxisId="risk" type="monotone" dataKey="compRisk" name="Composite Risk %" stroke="#58a6ff" strokeWidth={2.4} dot={false} isAnimationActive={false} />
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
                <h3 style={{ margin: 0, fontSize: '16px', color: '#e6edf3' }}>
                  Interactive Accumulation / Distribution Curve
                </h3>
                <span style={{ fontSize: '12px', color: '#8b949e' }}>
                  Drag any node up/down. X-axis = Composite Risk %, Y-axis = % of Cash bought (+) or % of BTC sold (–) per day.
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={exportCsv} style={btnStyle(false)}>⬇ Export CSV</button>
                <button onClick={() => setCurveNodes(CURVE_DEFAULT_VALUES.slice())} style={btnStyle(false)}>↺ Reset Default Curve</button>
              </div>
            </div>

            {/* 21-Node Interactive SVG Curve Editor */}
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', padding: '10px' }}>
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
                {CURVE_RISK_NODES.map((r, i) => {
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
                        <text x={cx} y={val >= 0 ? cy - 10 : cy + 18} fill="#ffffff" fontSize="10" fontWeight="bold" textAnchor="middle" fontFamily="monospace">
                          {val > 0 ? `+${val.toFixed(1)}%` : `${val.toFixed(1)}%`}
                        </text>
                      )}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={6}
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

            {/* Backtest Controls & 10 Performance Metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '16px' }}>
              <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', padding: '12px' }}>
                <label style={{ fontSize: '12px', color: '#8b949e', display: 'block', marginBottom: '4px' }}>Starting Date</label>
                <input
                  type="date"
                  value={btStartDate}
                  onChange={(e) => setBtStartDate(e.target.value)}
                  style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '4px', color: '#fff', colorScheme: 'dark', marginBottom: '10px' }}
                />
                <label style={{ fontSize: '12px', color: '#8b949e', display: 'block', marginBottom: '4px' }}>Starting Capital (USD)</label>
                <input
                  type="number"
                  value={btStartingCash}
                  min="100"
                  step="500"
                  onChange={(e) => setBtStartingCash(Math.max(0, Number(e.target.value) || 0))}
                  style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '4px', color: '#fff', fontFamily: 'monospace' }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#c9d1d9', marginTop: '12px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={btLogScale} onChange={(e) => setBtLogScale(e.target.checked)} />
                  Log Scale Equity Curve
                </label>
              </div>

              {backtest && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: '10px' }}>
                  {[
                    ['Backtest Days', backtest.days.toLocaleString(), `Buy ${backtest.buyDays} / Sell ${backtest.sellDays}`],
                    ['Portfolio Value', usdExact(backtest.portfolioValue), `Return: ${backtest.retPct >= 0 ? '+' : ''}${backtest.retPct.toFixed(1)}%`],
                    ['Lump Sum Value', usdExact(backtest.lumpValue), `Return: ${backtest.lumpRet >= 0 ? '+' : ''}${backtest.lumpRet.toFixed(1)}%`],
                    ['Strategy vs Lump Sum', `${backtest.vsLump >= 0 ? '+' : ''}${usdExact(backtest.vsLump)}`, `${backtest.vsLumpPct >= 0 ? '+' : ''}${backtest.vsLumpPct.toFixed(1)}%`],
                    ['Net BTC Stack', `${backtest.btc.toFixed(6)} BTC`, isFinite(backtest.avgBuy) ? `Avg Buy: ${usdExact(backtest.avgBuy)}` : 'No Buys'],
                    ['Cash Reserve', usdExact(backtest.cash), 'Includes Curve Sells'],
                    ['Max Drawdown (DCA)', `-${backtest.mddDca.toFixed(1)}%`, 'Peak-to-Trough Portfolio'],
                    ['Max Drawdown (HODL)', `-${backtest.mddBh.toFixed(1)}%`, 'Peak-to-Trough Lump Sum']
                  ].map(([k, v, sub], i) => (
                    <div key={i} style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', padding: '10px' }}>
                      <div style={{ fontSize: '10px', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{k}</div>
                      <div style={{ fontSize: '15px', fontWeight: 700, color: '#e6edf3', marginTop: '4px', fontFamily: 'monospace' }}>{v}</div>
                      <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '2px', fontFamily: 'monospace' }}>{sub}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Equity Curve Comparison Chart */}
            {backtest && (
              <div style={{ height: '380px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={backtest.history} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
                    <XAxis dataKey="d" stroke="#8b949e" tick={{ fill: '#8b949e', fontSize: 11 }} minTickGap={60} />
                    <YAxis
                      scale={btLogScale ? "log" : "auto"}
                      domain={['auto', 'auto']}
                      stroke="#8b949e"
                      tick={{ fill: '#8b949e', fontSize: 11 }}
                      tickFormatter={usdShort}
                      width={65}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0d1117', borderColor: '#30363d', color: '#e6edf3', fontSize: '12px' }}
                      formatter={(val, name) => [usdExact(Number(val)), name]}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                    <Line type="monotone" dataKey="portfolio" name="Strategic DCA Portfolio (BTC + Cash)" stroke="#f3cd7a" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="buyHold" name="Buy & Hold (Day 1 Lump Sum)" stroke="#8b949e" strokeWidth={1.6} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="cash" name="Cash Reserve" stroke="#3fb950" strokeWidth={1.3} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default BtcStrategist;
