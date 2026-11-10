import React, { useEffect, useState } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

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

// --- CHART COMPONENT ---
const DashboardChart = ({ 
  title, 
  data, 
  color, 
  height = '350px', 
  isPercent = false,
  primaryName = 'Value',
  secondaryKey = null,
  secondaryColor = '#8b949e',
  secondaryName = 'Official CPI'
}) => {
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
      height: height, 
      backgroundColor: '#161b22', 
      padding: '20px', 
      borderRadius: '8px', 
      border: '1px solid #30363d',
      display: 'flex',
      flexDirection: 'column'
    }}>
      <h3 style={{ margin: '0 0 15px 0', fontSize: '14px', color: '#c9d1d9', fontWeight: 600 }}>{title}</h3>
      
      <div style={{ flex: 1, minHeight: 0 }}>
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
  const [timeRange, setTimeRange] = useState('30d');
  const [viewMode, setViewMode] = useState('grid');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

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
            // NEW SCRIPT FORMAT
            setFullData({
                formula1: rawData.map(d => ({ date: d.date, value: d.Net_Liquidity })),
                realLiquidity: rawData.map(d => ({ date: d.date, value: d.Real_Net_Liquidity })),
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
            // OLD LEGACY FORMAT (Just in case)
            setFullData({
                formula1: format(rawData.formula_1),
                realLiquidity: format(rawData.real_formula_1),
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
      realLiquidity: filter(fullData.realLiquidity),
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
            <h1 style={{ margin: 0, fontSize: '22px' }}>Net Fed Liquidity & True Inflation</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginTop: '5px' }}>
              <p style={{ color: '#8b949e', margin: 0, fontSize: '13px' }}>
                Formula #1: Assets - TGA - RRP + Loans • Composite Inflation: CPI, Sticky CPI, Case-Shiller, PPI, 5Y Breakeven
              </p>
              {meta?.last_updated && (
                <span style={{ 
                  backgroundColor: '#238636', 
                  color: 'white', 
                  fontSize: '11px', 
                  padding: '2px 8px', 
                  borderRadius: '12px',
                  fontWeight: 600 
                }}>
                  Last Updated: {meta.last_updated}
                </span>
              )}
            </div>
          </div>

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
        </div>

        {/* Charts */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: viewMode === 'grid' ? '1fr 1fr' : '1fr', 
          gap: '20px' 
        }}>
          
          <DashboardChart title="Formula #1 (Nominal Net Liquidity)" data={filteredData.formula1} color="#a371f7" />
          <DashboardChart title="Real Net Liquidity (Inflation-Adjusted to Jan 2023 $)" data={filteredData.realLiquidity} color="#39d353" />
          <DashboardChart 
            title="Hoagie Composite Inflation vs. Official CPI (YoY %)" 
            data={filteredData.compositeInflation} 
            color="#ff7b72" 
            isPercent={true}
            primaryName="Composite Inflation"
            secondaryKey="officialCpi"
            secondaryColor="#8b949e"
            secondaryName="Official CPI-U"
          />
          <DashboardChart title="Treasury General Account (TGA)" data={filteredData.tga} color="#3fb950" />
          <DashboardChart title="Total Assets (WALCL)" data={filteredData.fedAssets} color="#f85149" />
          <DashboardChart title="Reverse Repo (RRP)" data={filteredData.rrp} color="#f0883e" />
          <DashboardChart title="Liquidity Facilities" data={filteredData.loansFacilities} color="#58a6ff" />
          <DashboardChart title="Loans Held (WLCFLL)" data={filteredData.loansHeld} color="#d29922" />
          
        </div>

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
