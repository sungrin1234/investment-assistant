import logging
from datetime import datetime, timedelta
import numpy as np
import pandas as pd
import FinanceDataReader as fdr
from collector import validate_stock_code, fetch_basic_info

logger = logging.getLogger(__name__)


def _safe_stock_name(code: str) -> str:
    """네이버 기본 API에서 종목명을 조회하고, 실패 시 종목코드를 그대로 반환한다."""
    try:
        info = fetch_basic_info(code)
        return info.get("name") or code
    except Exception:
        return code


def _clean_float(val, digits: int = 2):
    """NaN/Inf를 None으로 안전하게 변환한다."""
    if val is None or pd.isna(val) or np.isinf(val):
        return None
    return round(float(val), digits)


def calculate_rebalance(codes: list[str], num_portfolios: int = 2000) -> dict:
    """복수 종목의 최근 1년 데이터를 FDR로 수집해 몬테카를로·효율적 프론티어 최적 비중을 계산한다."""
    if not codes or not isinstance(codes, list):
        raise ValueError("종목코드 목록을 입력해 주세요.")

    # 중복 제거 및 순서 유지
    unique_codes = []
    for raw in codes:
        c = validate_stock_code(raw)
        if c not in unique_codes:
            unique_codes.append(c)

    if len(unique_codes) < 2:
        raise ValueError("리밸런싱 계산을 위해서는 최소 2개 이상의 서로 다른 종목코드가 필요합니다.")
    if len(unique_codes) > 10:
        raise ValueError("한 번에 최대 10개 종목까지만 비교할 수 있습니다.")

    end_date = datetime.today()
    start_date = end_date - timedelta(days=365)
    start_str = start_date.strftime("%Y-%m-%d")

    logger.info("[FDR] FinanceDataReader 주가 조회 (codes=%s, period=1Y)", unique_codes)

    close_series = {}
    name_map = {}

    for code in unique_codes:
        try:
            df = fdr.DataReader(code, start_str)
        except Exception as exc:
            logger.error("[ERROR] FDR 주가 조회 실패 (%s): %s", code, exc)
            raise RuntimeError(f"FDR 주가 데이터 조회 실패 ({code}): {exc}") from exc

        if df is None or df.empty or "Close" not in df.columns:
            raise RuntimeError(f"FDR 주가 데이터 조회 실패: '{code}'에 대한 최근 1년 주가 데이터가 없습니다.")

        close_series[code] = df["Close"].astype(float)
        name_map[code] = _safe_stock_name(code)

    prices_df = pd.DataFrame(close_series).dropna()
    if len(prices_df) < 60:
        raise RuntimeError(
            f"데이터 기간 부족: 공통 거래일이 {len(prices_df)}일뿐이어서 리밸런싱 분석에 충분하지 않습니다. (최소 60일 필요)"
        )

    returns_df = prices_df.pct_change().dropna()
    trading_days = 252
    risk_free_rate = 0.03

    mean_returns = returns_df.mean() * trading_days
    cov_matrix = returns_df.cov() * trading_days
    n_assets = len(unique_codes)

    # 개별 종목 성과 요약 (연율화 수익률, 변동성, MDD)
    asset_stats = []
    for code in unique_codes:
        series = prices_df[code]
        cum_max = series.cummax()
        mdd = ((series - cum_max) / cum_max).min()
        ann_ret = mean_returns[code]
        ann_vol = returns_df[code].std() * np.sqrt(trading_days)
        asset_stats.append({
            "code": code,
            "name": name_map[code],
            "annual_return": round(float(ann_ret * 100), 2),
            "annual_volatility": round(float(ann_vol * 100), 2),
            "mdd": round(float(mdd * 100), 2),
        })

    # 단순화 몬테카를로 시뮬레이션
    np.random.seed(None)
    results_ret = np.zeros(num_portfolios)
    results_vol = np.zeros(num_portfolios)
    results_sharpe = np.zeros(num_portfolios)
    weights_record = np.zeros((num_portfolios, n_assets))

    mean_arr = mean_returns.values
    cov_arr = cov_matrix.values

    for i in range(num_portfolios):
        w = np.random.random(n_assets)
        w /= np.sum(w)
        weights_record[i, :] = w

        p_ret = float(np.sum(mean_arr * w))
        p_vol = float(np.sqrt(np.dot(w.T, np.dot(cov_arr, w))))
        p_sharpe = (p_ret - risk_free_rate) / p_vol if p_vol > 0 else 0.0

        results_ret[i] = p_ret
        results_vol[i] = p_vol
        results_sharpe[i] = p_sharpe

    max_sharpe_idx = int(np.argmax(results_sharpe))
    min_vol_idx = int(np.argmin(results_vol))

    def _build_portfolio(idx: int) -> dict:
        w = weights_record[idx]
        allocations = []
        for j, code in enumerate(unique_codes):
            allocations.append({
                "code": code,
                "name": name_map[code],
                "weight": round(float(w[j] * 100), 2),
            })
        return {
            "expected_return": round(float(results_ret[idx] * 100), 2),
            "volatility": round(float(results_vol[idx] * 100), 2),
            "sharpe_ratio": round(float(results_sharpe[idx]), 3),
            "allocations": allocations,
        }

    max_sharpe_port = _build_portfolio(max_sharpe_idx)
    min_vol_port = _build_portfolio(min_vol_idx)

    # 동일 비중 비교군 계산
    eq_w = np.array([1.0 / n_assets] * n_assets)
    eq_ret = float(np.sum(mean_arr * eq_w))
    eq_vol = float(np.sqrt(np.dot(eq_w.T, np.dot(cov_arr, eq_w))))
    eq_sharpe = (eq_ret - risk_free_rate) / eq_vol if eq_vol > 0 else 0.0

    # 산점도 시각화용 포인트 (최대 300개 샘플링)
    sample_step = max(1, num_portfolios // 300)
    scatter_points = []
    for i in range(0, num_portfolios, sample_step):
        scatter_points.append({
            "x": round(float(results_vol[i] * 100), 2),
            "y": round(float(results_ret[i] * 100), 2),
            "sharpe": round(float(results_sharpe[i]), 2),
        })

    logger.info(
        "[QUANT] 몬테카를로/효율적 프론티어 계산 완료 (portfolios=%d, max_sharpe=%.3f)",
        num_portfolios,
        max_sharpe_port["sharpe_ratio"],
    )

    return {
        "period_days": len(prices_df),
        "start_date": prices_df.index[0].strftime("%Y-%m-%d"),
        "end_date": prices_df.index[-1].strftime("%Y-%m-%d"),
        "num_simulations": num_portfolios,
        "risk_free_rate": round(risk_free_rate * 100, 1),
        "assets": asset_stats,
        "optimal_portfolio": max_sharpe_port,
        "min_volatility_portfolio": min_vol_port,
        "equal_weight_portfolio": {
            "expected_return": round(eq_ret * 100, 2),
            "volatility": round(eq_vol * 100, 2),
            "sharpe_ratio": round(eq_sharpe, 3),
        },
        "scatter_points": scatter_points,
    }


def calculate_technical_indicators(code: str) -> dict:
    """단일 종목의 최근 1년 주가를 FDR로 수집하여 MA(5/20/60), RSI(14), MACD, 볼린저밴드를 계산한다."""
    valid_code = validate_stock_code(code)
    end_date = datetime.today()
    start_date = end_date - timedelta(days=365)
    start_str = start_date.strftime("%Y-%m-%d")

    logger.info("[FDR] FinanceDataReader 기술지표용 주가 조회 (code=%s, period=1Y)", valid_code)

    try:
        df = fdr.DataReader(valid_code, start_str)
    except Exception as exc:
        logger.error("[ERROR] FDR 기술지표 주가 조회 실패 (%s): %s", valid_code, exc)
        raise RuntimeError(f"FDR 주가 데이터 조회 실패 ({valid_code}): {exc}") from exc

    if df is None or df.empty or "Close" not in df.columns:
        raise RuntimeError(f"FDR 주가 데이터 조회 실패: '{valid_code}'에 대한 주가 데이터가 없습니다.")

    if len(df) < 60:
        raise RuntimeError(
            f"데이터 기간 부족: 거래일이 {len(df)}일뿐이어서 이동평균(60일) 등 기술지표 계산이 어렵습니다."
        )

    close = df["Close"].astype(float)

    # 1. 이동평균선 (MA 5 / 20 / 60)
    df["MA5"] = close.rolling(window=5).mean()
    df["MA20"] = close.rolling(window=20).mean()
    df["MA60"] = close.rolling(window=60).mean()

    # 2. 볼린저밴드 (20일, ±2 표준편차)
    std20 = close.rolling(window=20).std()
    df["BB_UPPER"] = df["MA20"] + (std20 * 2)
    df["BB_LOWER"] = df["MA20"] - (std20 * 2)

    # 3. RSI (14일 Wilder EMA 방식)
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / 14, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / 14, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    df["RSI14"] = 100 - (100 / (1 + rs))

    # 4. MACD (12, 26, 9)
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    df["MACD"] = ema12 - ema26
    df["MACD_SIGNAL"] = df["MACD"].ewm(span=9, adjust=False).mean()
    df["MACD_HIST"] = df["MACD"] - df["MACD_SIGNAL"]

    # 차트 시각화용 최근 90거래일 슬라이싱
    recent_df = df.tail(90)
    latest_row = recent_df.iloc[-1]
    prev_row = recent_df.iloc[-2] if len(recent_df) >= 2 else latest_row

    stock_name = _safe_stock_name(valid_code)
    is_kr = valid_code.isdigit() and len(valid_code) == 6
    price_digits = 0 if is_kr else 2
    currency = "KRW" if is_kr else "USD"

    latest_close = float(latest_row["Close"])
    prev_close = float(prev_row["Close"])
    change_pct = ((latest_close - prev_close) / prev_close * 100) if prev_close else 0.0

    latest_summary = {
        "date": recent_df.index[-1].strftime("%Y-%m-%d"),
        "close": int(round(latest_close)) if is_kr else round(latest_close, 2),
        "change_pct": round(change_pct, 2),
        "ma5": _clean_float(latest_row["MA5"], price_digits),
        "ma20": _clean_float(latest_row["MA20"], price_digits),
        "ma60": _clean_float(latest_row["MA60"], price_digits),
        "bb_upper": _clean_float(latest_row["BB_UPPER"], price_digits),
        "bb_lower": _clean_float(latest_row["BB_LOWER"], price_digits),
        "rsi14": _clean_float(latest_row["RSI14"], 2),
        "macd": _clean_float(latest_row["MACD"], 2),
        "macd_signal": _clean_float(latest_row["MACD_SIGNAL"], 2),
        "macd_hist": _clean_float(latest_row["MACD_HIST"], 2),
    }

    series = {
        "dates": [idx.strftime("%Y-%m-%d") for idx in recent_df.index],
        "close": [_clean_float(v, price_digits) for v in recent_df["Close"]],
        "ma5": [_clean_float(v, price_digits) for v in recent_df["MA5"]],
        "ma20": [_clean_float(v, price_digits) for v in recent_df["MA20"]],
        "ma60": [_clean_float(v, price_digits) for v in recent_df["MA60"]],
        "bb_upper": [_clean_float(v, price_digits) for v in recent_df["BB_UPPER"]],
        "bb_lower": [_clean_float(v, price_digits) for v in recent_df["BB_LOWER"]],
        "rsi14": [_clean_float(v, 2) for v in recent_df["RSI14"]],
        "macd": [_clean_float(v, 2) for v in recent_df["MACD"]],
        "macd_signal": [_clean_float(v, 2) for v in recent_df["MACD_SIGNAL"]],
        "macd_hist": [_clean_float(v, 2) for v in recent_df["MACD_HIST"]],
    }

    logger.info(
        "[QUANT] 기술지표 계산 완료 (code=%s, name=%s, currency=%s, RSI14=%s)",
        valid_code,
        stock_name,
        currency,
        latest_summary["rsi14"],
    )

    return {
        "code": valid_code,
        "name": stock_name,
        "currency": currency,
        "latest": latest_summary,
        "series": series,
    }
