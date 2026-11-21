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
FRED_START_DATE = '2022-01-01'
TODAY = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')

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

def safe_round(val, decimals=4):
    if val is None or pd.isna(val) or math.isnan(val) or np.isnan(val):
        return None
    return round(float(val), decimals)

def fetch_treasury_tga():
    base_url = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance"
    params = {
        'fields': 'record_date,account_type,open_today_bal,close_today_bal',
        'filter': f'record_date:gte:{START_DATE}',
        'page[size]': 5000,
        'sort': '-record_date'
    }
    headers = {'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'}
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
        return df[['TGA_Daily']]
    except Exception as e:
        print(f"Error fetching Treasury API: {e}")
        return pd.DataFrame()

def fetch_fred_data():
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
            combined_df[new_name] = 0.0

    return combined_df

def fetch_latest_btc_candles(start_ms):
    new_candles = {}
    headers = {'User-Agent': 'Mozilla/5.0'}
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
                day_ms = int(row[0]) * 1000
                close_price = float(row[4])
                if close_price > 0:
                    new_candles[day_ms] = close_price
            return new_candles
    except Exception as e:
        print(f"Coinbase BTC fetch fallback: {e}")

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
            return new_candles
    except Exception as e:
        print(f"Kraken BTC fetch fallback: {e}")

    return new_candles

def raqqr_quantiles_at_ms(ms):
    t = max(1, round((ms - RAQQR_GENESIS_MS) / ONE_DAY_MS))
    x = math.log(t) - RAQQR_MU
    raw = []
    for k in RAQQR_KEYS:
        c, a, b = RAQQR_COEF[k]
        raw.append(10 ** (c + a * x + b * x * x))
    raw.sort()
    return raw

def price_z_score(price, q01, q50, q99):
    if price <= 0 or not (q01 < q50 < q99):
        return None
    lp, ll, lm, lh = math.log(price), math.log(q01), math.log(q50), math.log(q99)
    if lp <= lm:
        return max(0.0, min(3.0, 3.0 * (lm - lp) / max(1e-12, lm - ll)))
    return max(-3.0, min(0.0, -3.0 * (lp - lm) / max(1e-12, lh - lm)))

def build_btc_strategist_data(full_macro_df):
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
        except Exception as e:
            print(f"Warning reading {seed_path}: {e}")

    if not btc_map:
        try:
            btc_fred = web.DataReader('CBBTCUSD', 'fred', '2014-12-01', TODAY).dropna()
            for dt_idx, row in btc_fred.iterrows():
                ms = int(datetime.datetime(dt_idx.year, dt_idx.month, dt_idx.day, tzinfo=datetime.timezone.utc).timestamp() * 1000)
                if float(row['CBBTCUSD']) > 0:
                    btc_map[ms] = float(row['CBBTCUSD'])
        except Exception as e:
            print(f"FRED CBBTCUSD fallback error: {e}")

    if not btc_map:
        return

    today_utc = datetime.datetime.now(datetime.timezone.utc)
    today_ms = int(datetime.datetime(today_utc.year, today_utc.month, today_utc.day, tzinfo=datetime.timezone.utc).timestamp() * 1000)

    btc_map = {ms: p for ms, p in btc_map.items() if ms <= today_ms}
    last_ms = max(btc_map.keys())
    live_candles = fetch_latest_btc_candles(last_ms - 5 * ONE_DAY_MS)
    for ms, p in live_candles.items():
        if ms <= today_ms:
            btc_map[ms] = p

    sorted_ms = sorted(btc_map.keys())
    closes = np.array([btc_map[ms] for ms in sorted_ms], dtype=float)

    x_days = np.array([max(1, (m - RAQQR_GENESIS_MS)/ONE_DAY_MS) for m in sorted_ms])
    x_log = np.log(x_days)
    y_log = np.log10(closes)

    q_wf_out = np.zeros((len(sorted_ms), 7))
    q_static_out = np.zeros((len(sorted_ms), 7))

    for i in range(len(sorted_ms)):
        q_static_out[i] = raqqr_quantiles_at_ms(sorted_ms[i])
        
        if i < 365:
            q_wf_out[i] = q_static_out[i]
        else:
            p = np.polyfit(x_log[:i+1], y_log[:i+1], 2)
            preds = np.polyval(p, x_log[:i+1])
            residuals = y_log[:i+1] - preds
            pcts = np.percentile(residuals, [1, 10, 25, 50, 75, 95, 99])
            today_pred = np.polyval(p, x_log[i])
            q_wf_out[i, :] = 10**(today_pred + pcts)

    sma_50 = pd.Series(closes).rolling(50, min_periods=10).mean().values
    froth_raw = np.log(closes / np.maximum(1e-8, sma_50))
    med_f = np.nanmedian(froth_raw)
    mad_f = np.nanmedian(np.abs(froth_raw - med_f)) or 1.0
    zf_arr = np.clip(-(froth_raw - med_f) / (1.4826 * mad_f), -3.0, 3.0)

    liq_z_by_date = {}
    if full_macro_df is not None and 'Net_Liquidity' in full_macro_df.columns:
        liq_s = full_macro_df['Net_Liquidity'].dropna()
        liq_roc = liq_s.pct_change(90).ewm(span=7, adjust=False).mean().dropna()
        if not liq_roc.empty:
            med_l = liq_roc.median()
            mad_l = (liq_roc - med_l).abs().median() or 1e-6
            liq_z_series = ((liq_roc - med_l) / (1.4826 * mad_l)).clip(-3.0, 3.0)
            for dt_idx, val in liq_z_series.items():
                liq_z_by_date[dt_idx.strftime('%Y-%m-%d')] = float(val)

    log_ret = np.diff(np.log(closes), prepend=np.log(closes[0]))
    ret_s = pd.Series(log_ret)
    roll_sharpe = (ret_s.rolling(365, min_periods=30).mean() / ret_s.rolling(365, min_periods=30).std().replace(0, np.nan)).fillna(0)
    sharpe_ema = roll_sharpe.ewm(span=14, adjust=False).mean()
    sharpe_pct_rank = sharpe_ema.rank(pct=True).fillna(0.5).values
    sharpe_proxy_z = np.clip(3.0 - 6.0 * sharpe_pct_rank, -3.0, 3.0)

    sma_200 = pd.Series(closes).rolling(200, min_periods=20).mean().values
    sma_1460 = pd.Series(closes).rolling(1460, min_periods=100).mean().values
    mvrv_raw = np.log(closes / np.maximum(1e-8, 0.5 * sma_200 + 0.5 * sma_1460))
    mvrv_ema = pd.Series(mvrv_raw).ewm(span=7, adjust=False).mean().values
    med_mvrv = np.nanmedian(mvrv_ema)
    mad_mvrv = np.nanmedian(np.abs(mvrv_ema - med_mvrv)) or 1.0
    onchain_proxy_z = np.clip(-(mvrv_ema - med_mvrv) / (1.4826 * mad_mvrv), -3.0, 3.0)

    def lookup_seed_or_proxy(start_ts, vals, ms, proxy_val):
        if start_ts is not None and vals:
            idx = round((ms - start_ts) / ONE_DAY_MS)
            if 0 <= idx < len(vals) and vals[idx] is not None:
                return float(vals[idx])
        return float(proxy_val)

    records = []
    last_liq_z = None
    
    for i, ms in enumerate(sorted_ms):
        price = closes[i]
        dt_str = datetime.datetime.fromtimestamp(ms / 1000, tz=datetime.timezone.utc).strftime('%Y-%m-%d')
        
        if dt_str in liq_z_by_date:
            last_liq_z = liq_z_by_date[dt_str]

        q_stat = q_static_out[i]
        q_wf = q_wf_out[i]
        zs = lookup_seed_or_proxy(sharpe_start, sharpe_vals, ms, sharpe_proxy_z[i])
        zc = lookup_seed_or_proxy(cbpl_start, cbpl_vals, ms, onchain_proxy_z[i])
        zo = lookup_seed_or_proxy(onchain_start, onchain_vals, ms, onchain_proxy_z[i])

        records.append({
            "ms": ms,
            "d": dt_str,
            "p": safe_round(price, 2),
            "q_static": [safe_round(v, 2) for v in q_stat],
            "q_wf": [safe_round(v, 2) for v in q_wf],
            "zs": safe_round(zs),
            "zc": safe_round(zc),
            "zo": safe_round(zo),
            "zl": safe_round(last_liq_z),
            "zf": safe_round(zf_arr[i])
        })

    out_payload = {
        "last_updated": records[-1]["d"] if records else TODAY,
        "count": len(records),
        "records": records
    }
    with open('public/btc_data.json', 'w', encoding='utf-8') as f:
        json.dump(out_payload, f, separators=(',', ':'))

def main():
    tga_df = fetch_treasury_tga()
    fred_df = fetch_fred_data()

    if fred_df.empty:
        sys.exit(1)

    if not tga_df.empty:
        merged_df = fred_df.join(tga_df, how='outer')
        merged_df = merged_df.resample('D').mean()
        merged_df['Final_TGA'] = merged_df['TGA_Daily'].ffill()
    else:
        merged_df = fred_df.resample('D').mean()
        merged_df['Final_TGA'] = (merged_df['TGA_Weekly'] * 1000).ffill()

    merged_df = merged_df.ffill().bfill()

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

    merged_df['Net_Liquidity'] = (
        merged_df['Fed_Assets']
        - merged_df['Final_TGA']
        - (merged_df['RRP'] * 1000)
        + merged_df['Liquidity_Facilities']
        + merged_df['Loans_Held']
    )

    build_btc_strategist_data(merged_df)

    macro_df = merged_df.loc[START_DATE:].copy()
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
    output_df.to_json('public/data.json', orient='records')

if __name__ == "__main__":
    main()
