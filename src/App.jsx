import React, { useEffect, useState } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import BtcStrategist from './BtcStrategist';

// --- UTILS ---
const formatCurrencyAxis = (value) => {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}T`; // Trillions
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}B`; // Billions
  return `$${value}M`; // Millions
};

const formatPercentAxis = (value) => `${Number(value).toFixed(1)}%`;

const formatTooltipValue = (value) => {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
};

// --- CHART COMPONENT WITH BUILT-IN EXPLAINER ---
const DashboardChart = ({ 
  title, 
  data, 
  color, 
  height = '350px', 
  isPercent = false,
  primaryName = 'Value',
  secondaryKey = null,
  secondaryColor = '#8b949e',
  secondaryName = 'Official CPI',
  formulaBadge = null,
  explanation = null,
  defaultShowInfo = false
}) => {
  const [showInfo, setShowInfo] = useState(defaultShowInfo);

  if (!data || data.length === 0) return null;
  
  const values = data.flatMap(d => {
    const v1 = parseFloat(d.value);
    const v2 = secondaryKey && d[secondaryKey] !== undefined ? parseFloat(d[secondaryKey]) : v1;
    return [v1, v2];
  }).filter(v => !isNaN(v));

  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = (max - min) * 0.05 || 1;
  const showDots = data.length < 60;

  return (
    <div style={{ 
      backgroundColor: '#161b22', 
      padding: '20px', 
      borderRadius: '8px', 
      border: '1px solid #30363d',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Chart Header + Formula Badge + Info Toggle */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'flex-start', 
        gap: '10px',
        marginBottom: showInfo || formulaBadge ? '10px' : '15px',
        flexWrap: 'wrap'
      }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '15px', color: '#e6edf3', fontWeight: 600 }}>{title}</h3>
          {formulaBadge && (
            <div style={{ 
              marginTop: '4px', 
              fontSize: '11px', 
              color: '#8b949e', 
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' 
            }}>
              {formulaBadge}
            </div>
          )}
        </div>

        {explanation && (
          <button
            onClick={() => setShowInfo(!showInfo)}
            style={{
              backgroundColor: showInfo ? '#1f6feb' : '#21262d',
              color: showInfo ? '#ffffff' : '#8b949e',
              border: '1px solid #30363d',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              transition: 'all 0.2s'
            }}
          >
            <span>ⓘ</span> {showInfo ? 'Hide Math' : 'How It’s Calculated'}
          </button>
        )}
      </div>

      {/* Collapsible Explainer Drawer */}
      {showInfo && explanation && (
        <div style={{
          backgroundColor: '#0d1117',
          border: `1px solid ${color}55`,
          borderLeft: `3px solid ${color}`,
          borderRadius: '6px',
          padding: '12px 14px',
          marginBottom: '15px',
          fontSize: '12.5px',
          lineHeight: '1.5',
          color: '#c9d1d9'
        }}>
          {explanation}
        </div>
      )}
      
      {/* Chart Canvas */}
      <div style={{ height: height, width: '100%' }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#30363d" vertical={false} />
            <XAxis 
              dataKey="date" 
              stroke="#8b949e" 
              tick={{fill: '#8b949e', fontSize: 11}}
              minTickGap={50}
              tickFormatter={(str) => {
                const date = new Date(str);
                const userTimezoneOffset = date.getTimezoneOffset() * 60000;
                const adjustedDate = new Date(date.getTime() + userTimezoneOffset);
                return `${adjustedDate.getMonth() + 1}/${adjustedDate.getDate()}`;
              }}
            />
            <YAxis 
              domain={[min - padding, max + padding]} 
              stroke="#8b949e"
              tick={{fill: '#8b949e', fontSize: 11}} 
              width={50}
              tickFormatter={isPercent ? formatPercentAxis : formatCurrencyAxis} 
            />
            <Tooltip 
              contentStyle={{ backgroundColor: '#0d1117', borderColor: '#30363d', color: '#fff' }}
              labelFormatter={(label) => {
                 const date = new Date(label);
                 const userTimezoneOffset = date.getTimezoneOffset() * 60000;
                 const adjustedDate = new Date(date.getTime() + userTimezoneOffset);
                 return adjustedDate.toLocaleDateString();
              }}
              formatter={(value, name) => {
                if (isPercent) return [`${Number(value).toFixed(2)}%`, name];
                return [`$${formatTooltipValue(value)}`, "Amount (Millions)"];
              }}
            />
            {secondaryKey && <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />}
            <Line 
              type="monotone" 
              dataKey="value" 
              name={primaryName}
              stroke={color} 
              strokeWidth={2} 
              dot={showDots ? { r: 4, fill: color, stroke: '#000000', strokeWidth: 2 } : false}
              activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }}
              isAnimationActive={false}
            />
            {secondaryKey && (
              <Line 
                type="monotone" 
                dataKey={secondaryKey} 
                name={secondaryName}
                stroke={secondaryColor} 
                strokeWidth={2} 
                strokeDasharray="4 4"
                dot={false}
                activeDot={{ r: 5, stroke: '#fff', strokeWidth: 1 }}
                isAnimationActive={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// --- MAIN APP ---
const App = () => {
  const [fullData, setFullData] = useState(null);
  const [filteredData, setFilteredData] = useState(null);
  const [meta, setMeta] = useState(null);

  // Controls
  const [dashboardTab, setDashboardTab] = useState('macro'); // 'macro' | 'btc'
  const [timeRange, setTimeRange] = useState('30d');
  const [viewMode, setViewMode] = useState('grid');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [showMethodology, setShowMethodology] = useState(false);

  // 1. Fetch
  useEffect(() => {
    fetch('./data.json')
      .then(res => res.json())
      .then(rawData => {
        const format = (arr) => arr ? arr.map(item => ({ date: item.date || item[0], value: item.value || item[1] })) : [];
        
        if (rawData[0] && rawData[0].meta) {
            setMeta(rawData[0].meta);
        } else if (rawData.meta) {
            setMeta(rawData.meta);
        }

        if (Array.isArray(rawData)) {
            setFullData({
                formula1: rawData.map(d => ({ date: d.date, value: d.Net_Liquidity })),
                compositeInflation: rawData.map(d => ({ 
                  date: d.date, 
                  value: d.Composite_Inflation,
                  officialCpi: d.Official_CPI_YoY 
                })),
                fedAssets: rawData.map(d => ({ date: d.date, value: d.Fed_Assets })),
                tga: rawData.map(d => ({ date: d.date, value: d.TGA_Daily })),
                rrp: rawData.map(d => ({ date: d.date, value: d.RRP * 1000 })), 
                loansFacilities: rawData.map(d => ({ date: d.date, value: d.Liquidity_Facilities })), 
                loansHeld: rawData.map(d => ({ date: d.date, value: d.Loans_Held })),
            });
            const lastItem = rawData[rawData.length - 1];
            if (lastItem) setMeta({ last_updated: lastItem.date });

        } else {
            // OLD LEGACY FORMAT
            setFullData({
                formula1: format(rawData.formula_1),
                compositeInflation: format(rawData.composite_inflation),
                fedAssets: format(rawData.fed_assets),
                tga: format(rawData.tga),
                rrp: format(rawData.rrp),
                loansFacilities: format(rawData.loans_facilities),
                loansHeld: format(rawData.loans_held),
            });
        }
      })
      .catch(err => console.error("Error fetching data:", err));
  }, []);

  // 2. Filter
  useEffect(() => {
    if (!fullData) return;

    const now = new Date();
    let startDate = new Date();
    let endDate = new Date(); 

    if (timeRange === 'custom' && customStart) {
       startDate = new Date(customStart);
       if (customEnd) endDate = new Date(customEnd);
    } else {
      switch (timeRange) {
        case '1w':  startDate.setDate(now.getDate() - 7); break;
        case '2w':  startDate.setDate(now.getDate() - 14); break;
        case '30d': startDate.setDate(now.getDate() - 30); break;
        case '3m':  startDate.setMonth(now.getMonth() - 3); break;
        case '6m':  startDate.setMonth(now.getMonth() - 6); break;
        case '1y':  startDate.setFullYear(now.getFullYear() - 1); break;
        case 'all': startDate = new Date('2000-01-01'); break;
        default:    startDate.setDate(now.getDate() - 30);
      }
    }

    const filter = (arr) => arr ? arr.filter(item => {
      const d = new Date(item.date);
      return d >= startDate && d <= endDate;
    }) : [];

    setFilteredData({
      formula1: filter(fullData.formula1),
      compositeInflation: filter(fullData.compositeInflation),
      fedAssets: filter(fullData.fedAssets),
      tga: filter(fullData.tga),
      rrp: filter(fullData.rrp),
      loansFacilities: filter(fullData.loansFacilities),
      loansHeld: filter(fullData.loansHeld),
    });

  }, [fullData, timeRange, customStart, customEnd]);

  if (!filteredData) return <div style={{padding: 50, color: 'white'}}>Loading Dashboard...</div>;

  const buttonStyle = (isActive) => ({
    padding: '6px 12px',
    backgroundColor: isActive ? '#1f6feb' : '#21262d',
    color: isActive ? '#ffffff' : '#c9d1d9',
    border: '1px solid #30363d',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '12px',
    transition: 'all 0.2s'
  });

  const inputStyle = {
    backgroundColor: '#0d1117',
    border: '1px solid #30363d',
    color: 'white',
    padding: '5px',
    borderRadius: '4px',
    colorScheme: 'dark' 
  };

  return (
    <div style={{ 
      backgroundColor: '#0d1117',
      backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)',
      backgroundSize: '30px 30px',
      minHeight: '100vh', 
      padding: '20px', 
      color: 'white', 
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' 
    }}>
      <div style={{ maxWidth: '1600px', margin: '0 auto' }}>
        
        {/* Header Controls */}
        <div style={{ 
          marginBottom: '20px', 
          borderBottom: '1px solid #30363d', 
          paddingBottom: '20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'end',
          flexWrap: 'wrap',
          gap: '20px'
        }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '22px' }}>
              {dashboardTab === 'btc'
                ? 'BTC Strategic Dollar Cost Averaging Signal'
                : 'True Inflation & Net Fed Liquidity'}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px', flexWrap: 'wrap' }}>
              
              {/* Top-Level Suite Switcher */}
              <button
                onClick={() => setDashboardTab('macro')}
                style={buttonStyle(dashboardTab === 'macro')}
              >
                💧 Macro & Liquidity Charts
              </button>
              <button
                onClick={() => setDashboardTab('btc')}
                style={{
                  ...buttonStyle(dashboardTab === 'btc'),
                  borderColor: '#f3cd7a',
                  color: dashboardTab === 'btc' ? '#ffffff' : '#f3cd7a'
                }}
              >
                ₿ BTC Strategic DCA Signal
              </button>

              {meta?.last_updated && (
                <span style={{ 
                  backgroundColor: '#238636', 
                  color: 'white', 
                  fontSize: '11px', 
                  padding: '3px 8px', 
                  borderRadius: '12px',
                  fontWeight: 600 
                }}>
                  Last Updated: {meta.last_updated}
                </span>
              )}

              {dashboardTab === 'macro' && (
                <button
                  onClick={() => setShowMethodology(!showMethodology)}
                  style={{
                    ...buttonStyle(showMethodology),
                    backgroundColor: showMethodology ? '#1f6feb' : '#161b22',
                    borderColor: '#58a6ff',
                    color: showMethodology ? '#fff' : '#58a6ff'
                  }}
                >
                  📖 {showMethodology ? 'Hide Methodology Guide' : 'Methodology & Formula Guide'}
                </button>
              )}
            </div>
          </div>

          {dashboardTab === 'macro' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
              {/* Top Row: Quick Selects */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {['1w', '2w', '30d', '3m', '6m', '1y', 'all'].map(range => (
                  <button 
                    key={range} 
                    onClick={() => { setTimeRange(range); }} 
                    style={buttonStyle(timeRange === range)}
                  >
                    {range.toUpperCase()}
                  </button>
                ))}
                <button 
                  onClick={() => setViewMode(viewMode === 'grid' ? 'full' : 'grid')} 
                  style={{...buttonStyle(false), marginLeft: '10px'}}
                >
                  {viewMode === 'grid' ? '☰ List' : '⊞ Grid'}
                </button>
              </div>

              {/* Bottom Row: Custom Date Range */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#21262d', padding: '5px 10px', borderRadius: '6px' }}>
                <span style={{ fontSize: '12px', color: '#8b949e' }}>Custom:</span>
                <input 
                  type="date" 
                  style={inputStyle} 
                  onChange={(e) => { setCustomStart(e.target.value); setTimeRange('custom'); }} 
                />
                <span style={{ color: '#8b949e' }}>-</span>
                <input 
                  type="date" 
                  style={inputStyle} 
                  onChange={(e) => { setCustomEnd(e.target.value); setTimeRange('custom'); }} 
                />
              </div>
            </div>
          )}
        </div>

        {/* Collapsible Global Methodology Overview Box (Macro Tab) */}
        {dashboardTab === 'macro' && showMethodology && (
          <div style={{
            backgroundColor: '#161b22',
            border: '1px solid #58a6ff',
            borderRadius: '8px',
            padding: '20px',
            marginBottom: '25px',
            color: '#c9d1d9',
            fontSize: '13px',
            lineHeight: '1.6'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2 style={{ margin: 0, fontSize: '16px', color: '#58a6ff' }}>
                Dashboard Methodology: How Our Calculations Work
              </h2>
              <button 
                onClick={() => setShowMethodology(false)}
                style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '14px' }}
              >
                ✕ Close
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
              <div style={{ backgroundColor: '#0d1117', padding: '15px', borderRadius: '6px', border: '1px solid #30363d' }}>
                <strong style={{ color: '#ff7b72', display: 'block', marginBottom: '6px' }}>
                  1. Why We Built a Custom Inflation Composite
                </strong>
                Official CPI (Consumer Price Index) relies on lagging survey data like <em>Owners' Equivalent Rent (OER)</em>, which trails real-time housing prices by 6–12 months, and uses hedonic quality adjustments that mask out-of-pocket price increases. Our <strong>Hoagie Composite Inflation Rate</strong> blends 5 distinct Federal Reserve (FRED) series to capture sticky service costs, actual home price appreciation, wholesale supply-chain pressures, and daily bond-market inflation expectations.
              </div>
              <div style={{ backgroundColor: '#0d1117', padding: '15px', borderRadius: '6px', border: '1px solid #30363d' }}>
                <strong style={{ color: '#a371f7', display: 'block', marginBottom: '6px' }}>
                  2. How Net Fed Liquidity (Formula #1) Works
                </strong>
                Not all money on the Federal Reserve's balance sheet is actively circulating in financial markets. When the U.S. Treasury builds up cash in its checking account (<strong>TGA</strong>) or when money market funds park cash overnight at the Fed (<strong>RRP</strong>), that liquidity is <em>drained</em> from the banking system. Conversely, when the Fed expands its Total Assets (<strong>WALCL</strong>) or issues emergency bank loans, liquidity is <em>injected</em> into markets.
              </div>
            </div>
          </div>
        )}

        {/* Active View Content */}
        {dashboardTab === 'btc' ? (
          <BtcStrategist />
        ) : (
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: viewMode === 'grid' ? '1fr 1fr' : '1fr', 
            gap: '20px' 
          }}>
            
            {/* TOP CHART (Spans Full Width in Grid Mode): Composite Inflation */}
            <div style={{ gridColumn: viewMode === 'grid' ? '1 / -1' : 'auto' }}>
              <DashboardChart 
                title="Hoagie Composite Inflation Rate vs. Official CPI-U (YoY %)" 
                data={filteredData.compositeInflation} 
                color="#ff7b72" 
                height="380px"
                isPercent={true}
                primaryName="Hoagie Composite Inflation"
                secondaryKey="officialCpi"
                secondaryColor="#8b949e"
                secondaryName="Official CPI-U (BLS)"
                defaultShowInfo={true}
                formulaBadge="Formula: (0.10 × CPI) + (0.25 × Sticky CPI) + (0.20 × Case-Shiller Housing) + (0.25 × Wholesale PPI) + (0.20 × 5Y Breakeven)"
                explanation={
                  <div>
                    <div style={{ marginBottom: '8px', fontWeight: 600, color: '#e6edf3' }}>
                      Multi-Source Weighted Average (5 FRED Data Feeds):
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '8px' }}>
                      <div>• <strong style={{ color: '#ff7b72' }}>10% Official CPI-U (CPIAUCSL):</strong> Standard baseline Year-over-Year urban consumer price basket.</div>
                      <div>• <strong style={{ color: '#ff7b72' }}>25% Sticky-Price CPI (CORESTICKM159SFRBATL):</strong> Atlanta Fed measure tracking slow-changing, permanent service costs (insurance, medical, rent, dining).</div>
                      <div>• <strong style={{ color: '#ff7b72' }}>20% Case-Shiller Home Prices (CSUSHPINSA):</strong> Tracks actual U.S. national home price YoY appreciation instead of lagging Owners' Equivalent Rent surveys.</div>
                      <div>• <strong style={{ color: '#ff7b72' }}>25% Wholesale PPI (PPIACO):</strong> Producer Price Index for All Commodities, capturing upstream supply-chain inflation before it hits retail shelves.</div>
                      <div>• <strong style={{ color: '#ff7b72' }}>20% 5Y Breakeven Inflation (T5YIE):</strong> Real-time daily bond market inflation expectations derived from 5-Year Treasury vs. TIPS yields.</div>
                    </div>
                  </div>
                }
              />
            </div>

            {/* CHART 2: Nominal Net Liquidity */}
            <DashboardChart 
              title="Formula #1 (Net Liquidity)" 
              data={filteredData.formula1} 
              color="#a371f7" 
              formulaBadge="Formula: WALCL - TGA - RRP + Liquidity Facilities + Loans Held"
              explanation={
                <div>
                  <strong>What it measures:</strong> The directional flow of spendable liquidity available in the financial system (in Millions).<br/>
                  <strong>How it’s calculated:</strong> Starts with Total Fed Assets (<code>WALCL</code>), subtracts cash locked up in the Treasury General Account (<code>TGA</code>) and Overnight Reverse Repo facility (<code>RRP</code>), and adds back active Fed lending (<code>H41RESPPALDKNWW</code> + <code>WLCFLL</code>). Rising net liquidity generally supports risk assets.
                </div>
              }
            />

            {/* CHART 3: TGA */}
            <DashboardChart 
              title="Treasury General Account (TGA)" 
              data={filteredData.tga} 
              color="#3fb950" 
              formulaBadge="Source: Daily U.S. Treasury Operating Cash Balance API"
              explanation={
                <div>
                  <strong>What it measures:</strong> The U.S. Government’s checking account held at the Federal Reserve.<br/>
                  <strong>Liquidity Impact (Inverse):</strong> When the TGA rises (via tax collection or bond issuance), cash is pulled <em>out</em> of commercial banks, draining market liquidity. When the Treasury spends down the TGA, cash flows back into the economy, <em>adding</em> liquidity.
                </div>
              }
            />

            {/* CHART 4: Total Assets (WALCL) */}
            <DashboardChart 
              title="Fed Total Assets (WALCL)" 
              data={filteredData.fedAssets} 
              color="#f85149" 
              formulaBadge="Source: FRED Series WALCL (Updated Weekly on Thursdays)"
              explanation={
                <div>
                  <strong>What it measures:</strong> Total securities (U.S. Treasuries and Mortgage-Backed Securities) and assets held on the Federal Reserve’s balance sheet.<br/>
                  <strong>Liquidity Impact (Direct):</strong> Rising assets indicate Quantitative Easing (QE / money printing), which injects liquidity. Falling assets indicate Quantitative Tightening (QT / balance sheet runoff), which drains liquidity.
                </div>
              }
            />

            {/* CHART 5: Reverse Repo (RRP) */}
            <DashboardChart 
              title="Overnight Reverse Repo (RRP)" 
              data={filteredData.rrp} 
              color="#f0883e" 
              formulaBadge="Source: FRED Series RRPONTSYD (Converted from Billions to Millions)"
              explanation={
                <div>
                  <strong>What it measures:</strong> Excess cash parked overnight at the Federal Reserve by money market funds and eligible institutions.<br/>
                  <strong>Liquidity Impact (Inverse):</strong> Money sitting in the RRP is idle and removed from active market circulation. When RRP falls, money market funds are deploying that cash back into Treasury bills and private credit markets, <em>boosting</em> net liquidity.
                </div>
              }
            />

            {/* CHART 6: Liquidity Facilities */}
            <DashboardChart 
              title="Liquidity & Credit Facilities (H41RESPPALDKNWW)" 
              data={filteredData.loansFacilities} 
              color="#58a6ff" 
              formulaBadge="Source: FRED Series H41RESPPALDKNWW"
              explanation={
                <div>
                  <strong>What it measures:</strong> Emergency and specialized Federal Reserve lending programs.<br/>
                  <strong>Liquidity Impact (Direct):</strong> When the Fed extends credit through liquidity facilities, it creates new reserves for commercial banks, directly increasing system liquidity.
                </div>
              }
            />

            {/* CHART 7: Loans Held */}
            <DashboardChart 
              title="Loans Held by the Federal Reserve (WLCFLL)" 
              data={filteredData.loansHeld} 
              color="#d29922" 
              formulaBadge="Source: FRED Series WLCFLL"
              explanation={
                <div>
                  <strong>What it measures:</strong> Direct loans extended by the Federal Reserve to depository institutions (including Discount Window borrowing and bank term funding).<br/>
                  <strong>Liquidity Impact (Direct):</strong> Increases in loans held inject reserve balances directly into banks experiencing funding stress, adding to net liquidity.
                </div>
              }
            />
            
          </div>
        )}

        {/* Footer */}
        <div style={{ 
          marginTop: '40px', 
          paddingTop: '20px', 
          borderTop: '1px solid #30363d', 
          textAlign: 'center',
          color: '#8b949e',
          fontSize: '14px',
          fontWeight: '500'
        }}>
          Product of <span style={{ color: '#58a6ff' }}>Hoagie_Trades</span>
        </div>

      </div>
    </div>
  );
};

export default App;
