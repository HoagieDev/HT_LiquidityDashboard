import os
import sys
import json
import math
import datetime
import requests
import numpy as np
import pandas as pd
import pandas_datareader.data as web

# --- CONFIGURATION ---
START_DATE = '2023-01-01'
FRED_START_DATE = '2022-01-01'  # 1-year lookback so YoY % is ready on 2023-01-01
TODAY = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')

# --- RAQQR (Asymmetric Tail Curvature) CONSTANTS ---
ONE_DAY_MS = 86400000
RAQQR_MU = 7.9914
RAQQR_GENESIS_MS = int(datetime.datetime(2009, 1, 1, tzinfo=datetime.timezone.utc).timestamp() * 1000)
RAQQR_KEYS = ["0.01", "0.1", "0.25", "0.5", "0.75", "0.95", "0.99"]
RAQQR_COEF = {
    "0.01": (2.837, 2.578, -0.0241),
    "0.1":  (2.933, 2.552, -0.0241),
    "0.25": (3.004, 2.554, -0.0241),
    "0.5":  (3.214, 2.482, -0.1126),
    "0.75": (3.562, 2.283, -0.3259),
    "0.95": (3.897, 1.964, -0.3259),
    "0.99": (4.028, 1.904, -0.3259),
}


def fetch_treasury_tga():
    """
    Fetches Daily TGA from US Treasury.
    SMART LOGIC: Fetches both 'Open' and 'Close'.
    If 'Close' is null, falls back to 'Open'.
    """
    base_url = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance"
    params = {
        'fields': 'record_date,account_type,open_today_bal,close_today_bal',
        'filter': f'record_date:gte:{START_DATE}',
        'page[size]': 5000,
        'sort': '-record_date'
    }
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json'
    }

    print(f"Fetching TGA from: {base_url} ...")
    try:
        response = requests.get(base_url, params=params, headers=headers, timeout=20)
        data = response.json()

        if 'data' not in data:
            return pd.DataFrame()
        df = pd.DataFrame(data['data'])
        if df.empty:
            return pd.DataFrame()

        mask = df['account_type'].str.contains("Treasury General Account", case=False)
        df = df[mask].copy()

        df['close_clean'] = pd.to_numeric(df['close_today_bal'].astype(str).str.replace(',', ''), errors='coerce')
        df['open_clean'] = pd.to_numeric(df['open_today_bal'].astype(str).str.replace(',', ''), errors='coerce')
        df['TGA_Daily'] = df['close_clean'].fillna(df['open_clean'])
        df = df.dropna(subset=['TGA_Daily'])

        df['date'] = pd.to_datetime(df['record_date'])
        df = df.groupby('date')['TGA_Daily'].first().reset_index()
        df = df.set_index('date').sort_index()

        print(f"Successfully loaded {len(df)} daily TGA records.")
        return df[['TGA_Daily']]

    except Exception as e:
        print(f"Error fetching Treasury API: {e}")
        return pd.DataFrame()


def fetch_fred_data():
    """Fetches Liquidity and Inflation series from FRED ONE BY ONE to prevent crashes."""
    print("Fetching FRED Data (Liquidity + Composite Inflation)...")

    series_dict = {
        'WALCL': 'Fed_Assets',
        'RRPONTSYD': 'RRP',
        'WDTGAL': 'TGA_Weekly',
        'H41RESPPALDKNWW': 'Liquidity_Facilities',
        'WLCFLL': 'Loans_Held',
        'CPIAUCSL': 'CPI_Index',
        'CORESTICKM159SFRBATL': 'Sticky_CPI_YoY',
        'CSUSHPINSA': 'Case_Shiller_Index',
        'PPIACO': 'PPI_Index',
        'T5YIE': 'Breakeven_5Y'
    }

    combined_df = pd.DataFrame()
    for fred_code, new_name in series_dict.items():
        try:
            print(f"Fetching {fred_code} ({new_name})...")
            df = web.DataReader(fred_code, 'fred', FRED_START_DATE, TODAY)
            df = df.rename(columns={fred_code: new_name})
            if combined_df.empty:
                combined_df = df
            else:
                combined_df = combined_df.join(df, how='outer')
        except Exception as e:
            print(f"WARNING: Could not fetch {fred_code}. Error: {e}")

    if combined_df.empty:
        return pd.DataFrame()

    for new_name in series_dict.values():
        if new_name not in combined_df.columns:
            print(f"Setting missing data column '{new_name}' to 0.")
            combined_df[new_name] = 0.0

    return combined_df


def fetch_latest_btc_candles(start_ms):
    """
    Fetches daily BTC-USD candles since start_ms using US-accessible APIs
    (Coinbase Exchange -> Kraken -> Binance.US fallback) so GitHub Actions US runners never hit HTTP 451.
    """
    new_candles = {}
    headers = {'User-Agent': 'Mozilla/5.0'}

    # 1. Try Coinbase Exchange Daily Candles
    try:
        start_dt = datetime.datetime.fromtimestamp(start_ms / 1000, tz=datetime.timezone.utc)
        end_dt = datetime.datetime.now(datetime.timezone.utc)
        url = "https://api.exchange.coinbase.com/products/BTC-USD/candles"
        params = {
            'granularity': 86400,
            'start': (start_dt - datetime.timedelta(days=2)).isoformat(),
            'end': (end_dt + datetime.timedelta(days=1)).isoformat()
        }
        r = requests.get(url, params=params, headers=headers, timeout=15)
        if r.status_code == 200:
            for row in r.json():
                # Coinbase format: [time_sec, low, high, open, close, volume]
                day_ms = int(row[0]) * 1000
                close_price = float(row[4])
                if close_price > 0:
                    new_candles[day_ms] = close_price
            print(f"Fetched {len(new_candles)} recent BTC daily candles from Coinbase.")
            return new_candles
    except Exception as e:
        print(f"Coinbase BTC fetch fallback: {e}")

    # 2. Fallback: Kraken OHLC (interval=1440 mins = 1 day)
    try:
        url = "https://api.kraken.com/0/public/OHLC"
        params = {'pair': 'XXBTZUSD', 'interval': 1440, 'since': int(start_ms / 1000) - 172800}
        r = requests.get(url, params=params, headers=headers, timeout=15)
        if r.status_code == 200:
            res = r.json().get('result', {})
            ohlc = res.get('XXBTZUSD', [])
            for row in ohlc:
                day_dt = datetime.datetime.fromtimestamp(int(row[0]), tz=datetime.timezone.utc)
                day_ms = int(datetime.datetime(day_dt.year, day_dt.month, day_dt.day, tzinfo=datetime.timezone.utc).timestamp() * 1000)
                close_price = float(row[4])
                if close_price > 0:
                    new_candles[day_ms] = close_price
            print(f"Fetched {len(new_candles)} recent BTC daily candles from Kraken.")
            return new_candles
    except Exception as e:
        print(f"Kraken BTC fetch fallback: {e}")

    return new_candles


def raqqr_quantiles_at_ms(ms):
    """Evaluates the 7 Rearranged Asymmetric Quadratic Quantile Regression (RAQQR) price bands."""
    t = max(1, round((ms - RAQQR_GENESIS_MS) / ONE_DAY_MS))
    x = math.log(t) - RAQQR_MU
    raw = []
    for k in RAQQR_KEYS:
        c, a, b = RAQQR_COEF[k]
        raw.append(10 ** (c + a * x + b * x * x))
    raw.sort()
    return raw


def price_z_score(price, q01, q50, q99):
    """Reversed RAQQR valuation Z-score: +3 = Q1% bottom (buy), 0 = Q50% median, -3 = Q99% top (sell)."""
    if price <= 0 or not (q01 < q50 < q99):
        return 0.0
    lp, ll, lm, lh = math.log(price), math.log(q01), math.log(q50), math.log(q99)
    if lp <= lm:
        return max(0.0, min(3.0, 3.0 * (lm - lp) / max(1e-12, lm - ll)))
    return max(-3.0, min(0.0, -3.0 * (lp - lm) / max(1e-12, lh - lm)))


def build_btc_strategist_data(full_macro_df):
    """
    Loads public/btc_seed.json (or FRED/API fallback), appends new daily BTC candles,
    computes RAQQR bands, extends on-chain/Sharpe/Liquidity Z-scores, and writes public/btc_data.json.
    """
    print("Building BTC Strategic DCA dataset...")
    seed_path = 'public/btc_seed.json'
    btc_map = {}
    sharpe_start, sharpe_vals = None, []
    cbpl_start, cbpl_vals = None, []
    onchain_start, onchain_vals = None, []

    if os.path.exists(seed_path):
        try:
            with open(seed_path, 'r', encoding='utf-8') as f:
                seed = json.load(f)
            for ms, close in seed.get('btc', []):
                if close and close > 0:
                    btc_map[int(ms)] = float(close)
            if 'sharpe' in seed:
                sharpe_start = int(seed['sharpe']['start'])
                sharpe_vals = list(seed['sharpe']['values'])
            if 'cbpl' in seed:
                cbpl_start = int(seed['cbpl']['start'])
                cbpl_vals = list(seed['cbpl']['values'])
            if 'onchain' in seed:
                onchain_start = int(seed['onchain']['start'])
                onchain_vals = list(seed['onchain']['values'])
            print(f"Loaded {len(btc_map)} historical BTC candles from {seed_path}.")
        except Exception as e:
            print(f"Warning reading {seed_path}: {e}")

    # Fallback if btc_seed.json hasn't been added yet: fetch FRED CBBTCUSD from 2014
    if not btc_map:
        print("btc_seed.json not found; fetching CBBTCUSD history from FRED...")
        try:
            btc_fred = web.DataReader('CBBTCUSD', 'fred', '2014-12-01', TODAY).dropna()
            for dt_idx, row in btc_fred.iterrows():
                ms = int(datetime.datetime(dt_idx.year, dt_idx.month, dt_idx.day, tzinfo=datetime.timezone.utc).timestamp() * 1000)
                if float(row['CBBTCUSD']) > 0:
                    btc_map[ms] = float(row['CBBTCUSD'])
        except Exception as e:
            print(f"FRED CBBTCUSD fallback error: {e}")

    if not btc_map:
        print("WARNING: No BTC price data available to build btc_data.json.")
        return

    # Fetch and merge newest daily candles up to today UTC
    today_utc = datetime.datetime.now(datetime.timezone.utc)
    today_ms = int(datetime.datetime(today_utc.year, today_utc.month, today_utc.day, tzinfo=datetime.timezone.utc).timestamp() * 1000)

    # Filter out any future placeholder timestamps beyond today_ms
    btc_map = {ms: p for ms, p in btc_map.items() if ms <= today_ms}
    last_ms = max(btc_map.keys())
    live_candles = fetch_latest_btc_candles(last_ms - 5 * ONE_DAY_MS)
    for ms, p in live_candles.items():
        if ms <= today_ms:
            btc_map[ms] = p

    sorted_ms = sorted(btc_map.keys())
    closes = np.array([btc_map[ms] for ms in sorted_ms], dtype=float)

    # Compute dynamic fallback proxies for any dates beyond the seed arrays
    # 1. Rolling 365d Realized Sharpe proxy (14d EMA, percentile rank -> [+3, -3])
    log_ret = np.diff(np.log(closes), prepend=np.log(closes[0]))
    ret_s = pd.Series(log_ret)
    roll_sharpe = (ret_s.rolling(365, min_periods=30).mean() / ret_s.rolling(365, min_periods=30).std().replace(0, np.nan)).fillna(0)
    sharpe_ema = roll_sharpe.ewm(span=14, adjust=False).mean()
    sharpe_pct_rank = sharpe_ema.rank(pct=True).fillna(0.5).values
    sharpe_proxy_z = np.clip(3.0 - 6.0 * sharpe_pct_rank, -3.0, 3.0)

    # 2. Rolling 200d/4yr Realized Value (MVRV / CBPL proxy) for post-seed dates
    sma_200 = pd.Series(closes).rolling(200, min_periods=20).mean().values
     sma_1460 = pd.Series(closes).rolling(1460, min_periods=100).mean().values
    mvrv_raw = np.log(closes / np.maximum(1e-8, 0.5 * sma_200 + 0.5 * sma_1460))
    mvrv_ema = pd.Series(mvrv_raw).ewm(span=7, adjust=False).mean().values
    med_mvrv = np.nanmedian(mvrv_ema)
    mad_mvrv = np.nanmedian(np.abs(mvrv_ema - med_mvrv)) or 1.0
    onchain_proxy_z = np.clip(-(mvrv_ema - med_mvrv) / (1.4826 * mad_mvrv), -3.0, 3.0)

    # 3. Hoagie Net Liquidity Z-score (90-day momentum of Net Fed Liquidity mapped to [-3, +3])
    liq_z_by_date = {}
    if full_macro_df is not None and 'Net_Liquidity' in full_macro_df.columns:
        liq_s = full_macro_df['Net_Liquidity'].dropna()
        liq_roc = liq_s.pct_change(90).ewm(span=7, adjust=False).mean().dropna()
        if not liq_roc.empty:
            med_l = liq_roc.median()
            mad_l = (liq_roc - med_l).abs().median() or 1e-6
            # Positive liquidity impulse -> positive buy-side support Z
            liq_z_series = ((liq_roc - med_l) / (1.4826 * mad_l)).clip(-3.0, 3.0)
            for dt_idx, val in liq_z_series.items():
                liq_z_by_date[dt_idx.strftime('%Y-%m-%d')] = round(float(val), 4)

    def lookup_seed_or_proxy(start_ts, vals, ms, proxy_val):
        if start_ts is not None and vals:
            idx = round((ms - start_ts) / ONE_DAY_MS)
            if 0 <= idx < len(vals) and vals[idx] is not None:
                return round(float(vals[idx]), 4)
        return round(float(proxy_val), 4)

    records = []
    for i, ms in enumerate(sorted_ms):
        price = round(float(closes[i]), 2)
        dt_str = datetime.datetime.fromtimestamp(ms / 1000, tz=datetime.timezone.utc).strftime('%Y-%m-%d')
        q = raqqr_quantiles_at_ms(ms)
        zp = round(price_z_score(price, q[0], q[3], q[6]), 4)
        zs = lookup_seed_or_proxy(sharpe_start, sharpe_vals, ms, sharpe_proxy_z[i])
        zc = lookup_seed_or_proxy(cbpl_start, cbpl_vals, ms, onchain_proxy_z[i])
        zo = lookup_seed_or_proxy(onchain_start, onchain_vals, ms, onchain_proxy_z[i])
        zl = liq_z_by_date.get(dt_str, None)

        records.append({
            "ms": ms,
            "d": dt_str,
            "p": price,
            "q": [round(v, 2) for v in q],  # [Q1%, Q10%, Q25%, Q50%, Q75%, Q95%, Q99%]
            "zp": zp,
            "zs": zs,
            "zc": zc,
            "zo": zo,
            "zl": zl
        })

    out_payload = {
        "last_updated": records[-1]["d"] if records else TODAY,
        "count": len(records),
        "records": records
    }
    with open('public/btc_data.json', 'w', encoding='utf-8') as f:
        json.dump(out_payload, f, separators=(',', ':'))
    print(f"Saved {len(records)} daily BTC records to public/btc_data.json (through {out_payload['last_updated']}).")


def main():
    # 1. Get the data
    tga_df = fetch_treasury_tga()
    fred_df = fetch_fred_data()

    if fred_df.empty:
        print("CRITICAL: No FRED data found at all. Exiting.")
        sys.exit(1)

    # 2. Merge Data & Resample to Daily ('D') so 365-day YoY math is exact
    if not tga_df.empty:
        merged_df = fred_df.join(tga_df, how='outer')
        merged_df = merged_df.resample('D').mean()
        merged_df['Final_TGA'] = merged_df['TGA_Daily'].ffill()
    else:
        print("WARNING: Using Weekly TGA (FRED) as fallback.")
        merged_df = fred_df.resample('D').mean()
        merged_df['Final_TGA'] = (merged_df['TGA_Weekly'] * 1000).ffill()

    # 3. Fill Missing Values
    merged_df = merged_df.ffill().bfill()

    # 4. Calculate Composite Inflation (YoY %) on full lookback before slicing to START_DATE
    merged_df['Official_CPI_YoY'] = merged_df['CPI_Index'].pct_change(365) * 100
    merged_df['Housing_YoY'] = merged_df['Case_Shiller_Index'].pct_change(365) * 100
    merged_df['PPI_YoY'] = merged_df['PPI_Index'].pct_change(365) * 100

    merged_df['Composite_Inflation'] = (
        (0.10 * merged_df['Official_CPI_YoY']) +
        (0.25 * merged_df['Sticky_CPI_YoY']) +
        (0.20 * merged_df['Housing_YoY']) +
        (0.25 * merged_df['PPI_YoY']) +
        (0.20 * merged_df['Breakeven_5Y'])
    )

    # Calculate Net Liquidity across full lookback so BTC Liquidity Z-score has 90d history
    merged_df['Net_Liquidity'] = (
        merged_df['Fed_Assets']
        - merged_df['Final_TGA']
        - (merged_df['RRP'] * 1000)
        + merged_df['Liquidity_Facilities']
        + merged_df['Loans_Held']
    )

    # Build BTC Strategic DCA data (uses full_macro_df for optional Liquidity Z-score)
    build_btc_strategist_data(merged_df)

    # Filter macro data back to START_DATE ('2023-01-01')
    macro_df = merged_df.loc[START_DATE:].copy()

    # 6. Format and Save Macro Data
    macro_df.index.name = 'date'
    final_df = macro_df.reset_index()
    final_df['date'] = final_df['date'].dt.strftime('%Y-%m-%d')

    output_df = final_df[[
        'date',
        'Net_Liquidity',
        'Composite_Inflation',
        'Official_CPI_YoY',
        'Fed_Assets',
        'RRP',
        'Final_TGA',
        'Liquidity_Facilities',
        'Loans_Held'
    ]].round(2)

    output_df = output_df.rename(columns={'Final_TGA': 'TGA_Daily'})

    print("Saving data to public/data.json...")
    output_df.to_json('public/data.json', orient='records')
    print("Done! Data updated.")


if __name__ == "__main__":
    main()
