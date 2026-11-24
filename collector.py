import os
import re
import html
import logging
import requests

logger = logging.getLogger(__name__)

# 네이버 서버 문전박대 방지를 위한 매너 명찰 (User-Agent)
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://stock.naver.com/",
}

REQUEST_TIMEOUT = 10


def resolve_stock_target(query: str) -> dict:
    """종목명·줄임말·티커를 네이버 자동완성 API로 조회해 국내(KR)/미국(US) 종목 식별 정보를 반환한다."""
    url = "https://ac.stock.naver.com/ac"
    cleaned_query = str(query).strip()
    params = {"q": cleaned_query, "target": "stock"}
    logger.info("[NAVER] 종목명/티커 자동완성 검색 시작 (query=%s)", cleaned_query)

    def _fetch_items(q_text: str) -> list:
        try:
            response = requests.get(
                url,
                params={"q": q_text, "target": "stock"},
                headers=HEADERS,
                timeout=REQUEST_TIMEOUT,
            )
        except requests.exceptions.Timeout as exc:
            logger.error("[ERROR] 종목명 검색 타임아웃: %s", exc)
            raise RuntimeError("네트워크 타임아웃: 종목명 검색 서버 응답이 지연되고 있습니다.") from exc
        except requests.exceptions.RequestException as exc:
            logger.error("[ERROR] 종목명 검색 네트워크 오류: %s", exc)
            raise RuntimeError(f"종목명 검색 중 네트워크 오류가 발생했습니다: {exc}") from exc

        if response.status_code != 200:
            raise RuntimeError(f"종목명 검색 실패 (HTTP {response.status_code})")

        try:
            return response.json().get("items") or []
        except ValueError as exc:
            raise RuntimeError("JSON 변환 실패: 종목명 검색 응답 형식이 올바르지 않습니다.") from exc

    items = _fetch_items(cleaned_query)
    if not items and "." in cleaned_query:
        items = _fetch_items(cleaned_query.replace(".", ""))

    candidates = []
    for item in items:
        if not isinstance(item, dict):
            continue
        nation = item.get("nationCode")
        item_code = str(item.get("code", "")).strip()
        if nation == "KOR" and re.fullmatch(r"\d{6}", item_code):
            candidates.append({
                "market": "KR",
                "code": item_code,
                "reuters_code": item_code,
                "name": item.get("name"),
                "exchange": item.get("typeCode"),
            })
        elif nation == "USA" and item_code and item.get("reutersCode"):
            candidates.append({
                "market": "US",
                "code": item_code,
                "reuters_code": str(item["reutersCode"]).strip(),
                "name": item.get("name"),
                "exchange": item.get("typeCode"),
            })

    if not candidates:
        raise ValueError(f"'{cleaned_query}'에 해당하는 국내/미국 주식·ETF 종목을 찾을 수 없습니다.")

    normalized_q = cleaned_query.replace(" ", "").upper()

    # 1순위: 티커/코드 정확 일치
    for cand in candidates:
        if cand["code"].upper() == normalized_q:
            logger.info("[NAVER] 티커/코드 정확 매칭 완료 (query=%s -> %s)", cleaned_query, cand)
            return cand

    # 2순위: 종목명 정확 일치
    for cand in candidates:
        cand_name = str(cand.get("name") or "").replace(" ", "").upper()
        if cand_name == normalized_q:
            logger.info("[NAVER] 종목명 정확 매칭 완료 (query=%s -> %s)", cleaned_query, cand)
            return cand

    # 3순위: 네이버 검색 1순위 선택
    best = candidates[0]
    logger.info("[NAVER] 종목 자동완성 1순위 선택 (query=%s -> %s)", cleaned_query, best)
    return best


def resolve_stock_code(query: str) -> str:
    """종목명·줄임말·티커를 네이버 자동완성 API로 조회해 표준 종목코드(국내 6자리 또는 미국 티커)를 반환한다."""
    return resolve_stock_target(query)["code"]


def _resolve_target_for_code(code_or_name: str) -> dict:
    """입력이 6자리 국내 코드면 즉시 반환하고, 그 외(종목명/미국 티커)는 자동완성으로 식별 정보를 조회한다."""
    if not code_or_name or not str(code_or_name).strip():
        raise ValueError("종목명 또는 종목코드(티커)가 입력되지 않았습니다.")

    cleaned = str(code_or_name).strip()
    if re.fullmatch(r"\d{6}", cleaned):
        return {
            "market": "KR",
            "code": cleaned,
            "reuters_code": cleaned,
            "name": None,
            "exchange": None,
        }
    return resolve_stock_target(cleaned)


def validate_stock_code(code_or_name: str) -> str:
    """6자리 국내 코드면 그대로 반환하고, 종목명·미국 티커면 네이버 자동완성으로 표준 코드를 찾아 반환한다."""
    return _resolve_target_for_code(code_or_name)["code"]


def parse_number(value, as_int: bool = False):
    """문자열에서 콤마(,)와 단위를 제거하고 순수 숫자(int 또는 float)로 변환한다."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value) if as_int else float(value)

    text = str(value).strip()
    if not text or text in ("-", "N/A"):
        return None

    # 콤마와 기본 단위(원, 배, %, 주 등) 제거 후 숫자/부호/소수점만 추출
    cleaned = text.replace(",", "")
    match = re.search(r"-?\d+(?:\.\d+)?", cleaned)
    if not match:
        return None

    num = float(match.group())
    return int(num) if as_int else num


def parse_korean_amount(value) -> int | None:
    """'894조 1,227억' 같은 한글 금액 단위를 순수 원(KRW) 단위 정수로 변환한다."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)

    text = str(value).strip().replace(",", "")
    if not text or text in ("-", "N/A"):
        return None

    units = {"조": 10**12, "억": 10**8, "만": 10**4}
    total = 0
    matched = False

    for unit, multiplier in units.items():
        m = re.search(rf"(\d+(?:\.\d+)?)\s*{unit}", text)
        if m:
            total += int(float(m.group(1)) * multiplier)
            matched = True

    if matched:
        return total

    # 단위가 없는 순수 숫자인 경우
    return parse_number(text, as_int=True)


def _fetch_naver_json(url: str, label: str, allow_404: bool = False) -> dict | None:
    """네이버 금융 API를 호출하고 공통 HTTP/JSON 예외 처리를 수행한다."""
    logger.info("[NAVER] %s 접근 시작 url=%s", label, url)

    try:
        response = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    except requests.exceptions.Timeout as exc:
        logger.error("[ERROR] %s 요청 타임아웃: %s", label, exc)
        raise RuntimeError(f"네트워크 타임아웃: {label} 서버 응답이 지연되고 있습니다.") from exc
    except requests.exceptions.RequestException as exc:
        logger.error("[ERROR] %s 네트워크 오류: %s", label, exc)
        raise RuntimeError(f"{label} 접근 중 네트워크 오류가 발생했습니다: {exc}") from exc

    if response.status_code == 404:
        if allow_404:
            logger.info("[PARSE] %s 정보 없음 (404): url=%s", label, url)
            return None
        logger.error("[ERROR] 존재하지 않는 종목 (404): url=%s", url)
        raise RuntimeError(f"{label} 접근 실패 (404): 해당 종목을 찾을 수 없습니다.")
    if response.status_code in (403, 429):
        logger.error("[ERROR] %s 접근 차단 (%d): url=%s", label, response.status_code, url)
        raise RuntimeError(f"{label} 접근 실패 ({response.status_code}): 일시적으로 접근이 제한되었습니다.")
    if response.status_code != 200:
        logger.error("[ERROR] %s HTTP 오류 (%d): url=%s", label, response.status_code, url)
        raise RuntimeError(f"{label} 접근 실패 (HTTP {response.status_code})")

    try:
        return response.json()
    except ValueError as exc:
        logger.error("[ERROR] %s JSON 변환 실패: %s", label, exc)
        raise RuntimeError(f"JSON 변환 실패: {label} 응답 형식이 올바르지 않습니다.") from exc


def _extract_common_metrics(info_items: list) -> dict:
    """네이버 totalInfos / stockItemTotalInfos 리스트에서 주요 시세·투자 지표를 추출한다."""
    info_map = {
        item.get("code"): item.get("value")
        for item in (info_items or [])
        if isinstance(item, dict)
    }
    return {
        "industry": info_map.get("industryGroupKor") or info_map.get("industry"),
        "prev_close": info_map.get("lastClosePrice") or info_map.get("basePrice"),
        "open_price": info_map.get("openPrice"),
        "high_price": info_map.get("highPrice"),
        "low_price": info_map.get("lowPrice"),
        "high_52w": info_map.get("highPriceOf52Weeks"),
        "low_52w": info_map.get("lowPriceOf52Weeks"),
        "volume": info_map.get("accumulatedTradingVolume"),
        "trading_value": info_map.get("accumulatedTradingValue"),
        "foreign_rate": info_map.get("foreignRate"),
        "eps": info_map.get("eps"),
        "bps": info_map.get("bps"),
        "cns_per": info_map.get("cnsPer"),
        "cns_eps": info_map.get("cnsEps"),
        "dividend": info_map.get("dividend"),
        "dividend_yield": info_map.get("dividendYieldRatio"),
        "dividend_date": info_map.get("dividendAt"),
        "ex_dividend_date": info_map.get("exDividendAt"),
        "split_info": info_map.get("faceValueDivisionRate"),
    }


def _extract_us_snapshot_from_basic(data: dict) -> dict:
    """미국 주식 basic 응답의 stockItemTotalInfos 등에서 시가총액, PER, PBR을 추출한다."""
    total_infos = data.get("stockItemTotalInfos") or []
    info_map = {
        item.get("code"): item.get("value")
        for item in total_infos
        if isinstance(item, dict)
    }

    market_cap = parse_number(data.get("marketValueFullRaw"), as_int=True)
    if market_cap is None:
        market_cap = parse_korean_amount(info_map.get("marketValue"))

    per = parse_number(info_map.get("per"), as_int=False)
    pbr = parse_number(info_map.get("pbr"), as_int=False)

    return {
        "market_cap": market_cap,
        "per": per,
        "pbr": pbr,
        "metrics": _extract_common_metrics(total_infos),
    }


def fetch_basic_info(code: str, target: dict | None = None) -> dict:
    """네이버 금융 기본 API에서 정식 종목명, 현재가, 등락률, 통화를 수집한다."""
    resolved = target or _resolve_target_for_code(code)
    market = resolved["market"]
    lookup_code = resolved["reuters_code"] if market == "US" else resolved["code"]

    if market == "US":
        url = f"https://api.stock.naver.com/stock/{lookup_code}/basic"
    else:
        url = f"https://m.stock.naver.com/api/stock/{lookup_code}/basic"

    data = _fetch_naver_json(url, "네이버 금융 기본 API")

    stock_name = data.get("stockName")
    if not stock_name:
        logger.error("[ERROR] 종목명 파싱 실패: 응답에 stockName이 없습니다. keys=%s", list(data.keys()))
        raise RuntimeError("종목명 파싱 실패: 네이버 데이터 구조가 변경되었거나 유효하지 않은 종목입니다.")

    is_kr = market == "KR"
    current_price = parse_number(data.get("closePrice"), as_int=is_kr)
    change_rate = parse_number(data.get("fluctuationsRatio"), as_int=False)

    if current_price is None:
        logger.error("[ERROR] 현재가 파싱 실패: closePrice=%s", data.get("closePrice"))
        raise RuntimeError("네이버 데이터 구조 변경: 현재가 정보를 읽을 수 없습니다.")

    currency_obj = data.get("currencyType")
    currency = (
        currency_obj.get("code")
        if isinstance(currency_obj, dict) and currency_obj.get("code")
        else ("KRW" if is_kr else "USD")
    )

    logger.info(
        "[PARSE] 기본 시세 파싱 완료 (market=%s, name=%s, current_price=%s, change_rate=%s, currency=%s)",
        market, stock_name, current_price, change_rate, currency
    )

    result = {
        "name": stock_name,
        "name_eng": data.get("stockNameEng"),
        "exchange": data.get("stockExchangeName") or resolved.get("exchange"),
        "is_etf": data.get("stockEndType") == "etf" or bool(data.get("isEtf")),
        "current_price": current_price,
        "change_rate": change_rate,
        "currency": currency,
    }
    if market == "US":
        result["_us_snapshot"] = _extract_us_snapshot_from_basic(data)
    return result


def _fetch_kr_wisereport_overview(code: str) -> dict:
    """국내 종목의 기업개요(dot_cmp)와 WICS 업종을 네이버 증권 기업현황 페이지에서 직접 수집한다."""
    url = f"https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd={code}"
    logger.info("[NAVER] 국내 기업개요 수집 시작 url=%s", url)
    try:
        res = requests.get(
            url,
            headers={"User-Agent": HEADERS["User-Agent"], "Referer": "https://finance.naver.com/"},
            timeout=REQUEST_TIMEOUT,
        )
        if res.status_code != 200:
            return {}
    except requests.exceptions.RequestException as exc:
        logger.warning("[WARN] 국내 기업개요 수집 실패 (code=%s): %s", code, exc)
        return {}

    summary_lines = []
    ul_match = re.search(r'<ul class="dot_cmp"[^>]*>(.*?)</ul>', res.text, re.S)
    if ul_match:
        for li in re.findall(r"<li[^>]*>(.*?)</li>", ul_match.group(1), re.S):
            cleaned = html.unescape(re.sub(r"<[^>]+>", " ", li))
            cleaned = re.sub(r"\s+", " ", cleaned).strip()
            if cleaned:
                summary_lines.append(f"• {cleaned}")

    industry = None
    cell_match = re.search(r'<td class="cmp-table-cell td0101"[^>]*>(.*?)</td>', res.text, re.S)
    if cell_match:
        cell_txt = html.unescape(re.sub(r"<[^>]+>", " ", cell_match.group(1)))
        cell_txt = re.sub(r"\s+", " ", cell_txt).strip()
        wics_match = re.search(r"WICS\s*:\s*(.+)$", cell_txt)
        if wics_match:
            industry = wics_match.group(1).strip()

    extra_metrics = {}
    target_labels = {
        "52주베타": "beta",
        "발행주식수/유동비율": "shares_float",
        "수익률 (1M/3M/6M/1Y)": "returns_period",
        "EV/EBITDA": "ev_ebitda",
        "PCR": "pcr",
        "액면가": "face_value",
    }
    for m in re.finditer(r"<th[^>]*>(.*?)</th>\s*<td[^>]*>(.*?)</td>", res.text, re.S):
        k = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", m.group(1)))).strip()
        v = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", m.group(2)))).strip()
        if k in target_labels and v and len(v) < 80 and "${" not in v:
            extra_metrics[target_labels[k]] = v

    return {
        "overview_summary": "\n".join(summary_lines) if summary_lines else None,
        "industry": industry,
        "extra_metrics": extra_metrics,
    }


def fetch_price_history(code: str, target: dict | None = None, limit: int = 60) -> dict:
    """네이버 증권 API에서 최근 N거래일 일별 종가 시계열을 수집한다."""
    resolved = target or _resolve_target_for_code(code)
    market = resolved["market"]
    lookup_code = resolved["reuters_code"] if market == "US" else resolved["code"]

    dates = []
    closes = []

    if market == "US":
        url = f"https://api.stock.naver.com/stock/{lookup_code}/price?page=1&pageSize={limit}"
        data = _fetch_naver_json(url, "미국 일별 시세 API", allow_404=True)
        if isinstance(data, list):
            for row in reversed(data[:limit]):
                if not isinstance(row, dict):
                    continue
                dt = str(row.get("localTradedAt", ""))[:10]
                price = parse_number(row.get("closePrice"), as_int=False)
                if dt and price is not None:
                    dates.append(dt)
                    closes.append(price)
    else:
        url = f"https://api.stock.naver.com/chart/domestic/item/{lookup_code}?periodType=dayCandle"
        data = _fetch_naver_json(url, "국내 일별 차트 API", allow_404=True)
        price_infos = (data or {}).get("priceInfos") or []
        for row in price_infos[-limit:]:
            if not isinstance(row, dict):
                continue
            raw_dt = str(row.get("localDate", ""))
            dt = f"{raw_dt[:4]}-{raw_dt[4:6]}-{raw_dt[6:8]}" if len(raw_dt) == 8 else raw_dt
            price = parse_number(row.get("closePrice"), as_int=True)
            if dt and price is not None:
                dates.append(dt)
                closes.append(price)

    return {"dates": dates, "closes": closes}


def fetch_etf_constituents(code: str, market: str, limit: int = 20) -> dict | None:
    """국내 ETF의 구성종목(포트폴리오 비중 상위) 목록을 수집한다."""
    if market != "KR":
        return None
    url = f"https://m.stock.naver.com/api/etf/{code}/constituent"
    data = _fetch_naver_json(url, "ETF 구성종목 API", allow_404=True)
    if not isinstance(data, dict):
        return None

    raw_list = data.get("result") or []
    holdings = []
    for item in raw_list[:limit]:
        if not isinstance(item, dict):
            continue
        holdings.append({
            "code": item.get("itemCode"),
            "name": item.get("itemName"),
            "weight": item.get("constituentWeight"),
            "quantity": item.get("cuUnitQuantity"),
            "unit": item.get("cuUnit") or "주",
        })

    if not holdings:
        return None

    return {
        "total_count": data.get("totalCount"),
        "total_weight": data.get("totalWeight"),
        "holdings": holdings,
    }


def fetch_etf_dividend(code: str, market: str, page_size: int = 12) -> dict | None:
    """국내 ETF의 배당(분배금) 요약 및 최근 분배금 지급 내역을 수집한다."""
    if market != "KR":
        return None

    summary = _fetch_naver_json(
        f"https://stock.naver.com/api/domestic/detail/{code}/ETFDividend",
        "ETF 배당 요약 API",
        allow_404=True,
    )
    hist = _fetch_naver_json(
        f"https://stock.naver.com/api/domestic/detail/{code}/ETFDividendHist?startIdx=0&pageSize={page_size}",
        "ETF 배당 내역 API",
        allow_404=True,
    )

    if not isinstance(summary, dict) and not isinstance(hist, list):
        return None

    summary = summary if isinstance(summary, dict) else {}
    history = []
    if isinstance(hist, list):
        for item in hist:
            if not isinstance(item, dict):
                continue
            ex_date = (item.get("id") or {}).get("exDividendAt") if isinstance(item.get("id"), dict) else None
            if ex_date:
                history.append({
                    "ex_date": ex_date,
                    "amount": item.get("dividendAmount"),
                    "yield": item.get("dividendYield"),
                })

    if not summary and not history:
        return None

    return {
        "yield_ttm": summary.get("dividendYieldTtm"),
        "dps_ttm": summary.get("dividendPerShareTtm"),
        "count_this_year": summary.get("dividendCountThisYear"),
        "months_this_year": summary.get("dividendMonthsThisYear"),
        "recent_ex_date": summary.get("recentExDividendAt"),
        "recent_amount": summary.get("recentDividendAmount"),
        "recent_yield": summary.get("recentDividendYield"),
        "history": history,
    }


def _parse_integration_details(data: dict, market: str) -> dict:
    """네이버 integration 응답에서 기업현황(컨센서스, 동종업계, 리포트, 수급)과 기업개요를 추출한다."""
    consensus_raw = data.get("consensusInfo") if isinstance(data.get("consensusInfo"), dict) else {}
    consensus = None
    if consensus_raw.get("priceTargetMean") or consensus_raw.get("recommMean"):
        consensus = {
            "target_price": consensus_raw.get("priceTargetMean"),
            "recomm_mean": consensus_raw.get("recommMean"),
            "create_date": consensus_raw.get("createDate"),
        }

    # 동종업계 비교
    raw_peers = data.get("industryCompareInfo")
    if isinstance(raw_peers, dict):
        peer_list = raw_peers.get("globalStocks") or []
    elif isinstance(raw_peers, list):
        peer_list = raw_peers
    else:
        peer_list = []

    peers = []
    for p in peer_list[:4]:
        if not isinstance(p, dict):
            continue
        peers.append({
            "name": p.get("stockName"),
            "code": p.get("itemCode") or p.get("symbolCode") or p.get("reutersCode"),
            "close_price": p.get("closePrice"),
            "change_rate": p.get("fluctuationsRatio"),
        })

    # 증권사 리포트
    raw_reports = data.get("researches") if market == "KR" else data.get("reports")
    reports = []
    for rep in (raw_reports or [])[:5]:
        if not isinstance(rep, dict):
            continue
        reports.append({
            "title": rep.get("tit") or rep.get("title") or "",
            "broker": rep.get("bnm") or rep.get("brokerName") or rep.get("author") or "",
            "date": rep.get("wdt") or rep.get("writeDate") or rep.get("createDate") or "",
        })

    # 투자자별 매매동향 (국내 전용)
    investor_trends = []
    if market == "KR":
        for tr in (data.get("dealTrendInfos") or [])[:5]:
            if not isinstance(tr, dict):
                continue
            investor_trends.append({
                "date": tr.get("bizdate"),
                "foreigner": tr.get("foreignerPureBuyQuant"),
                "organ": tr.get("organPureBuyQuant"),
                "individual": tr.get("individualPureBuyQuant"),
                "foreigner_ratio": tr.get("foreignerHoldRatio"),
            })

    # 기업개요
    overview_summary = data.get("corporateOverview") or data.get("description")
    if not overview_summary and isinstance(data.get("summaries"), dict):
        overview_summary = data["summaries"].get("summary")

    # ETF 핵심 지표 (운용사, NAV, 총보수, 괴리율, 기간수익률)
    etf_raw = data.get("etfKeyIndicator") if isinstance(data.get("etfKeyIndicator"), dict) else None
    etf_info = None
    if etf_raw:
        etf_info = {
            "issuer": etf_raw.get("issuerName"),
            "nav": etf_raw.get("nav"),
            "total_nav": etf_raw.get("totalNav"),
            "total_fee": etf_raw.get("totalFee"),
            "deviation_rate": etf_raw.get("deviationRate"),
            "dividend_yield_ttm": etf_raw.get("dividendYieldTtm"),
            "return_1m": etf_raw.get("returnRate1m"),
            "return_3m": etf_raw.get("returnRate3m"),
            "return_1y": etf_raw.get("returnRate1y"),
        }

    return {
        "consensus": consensus,
        "peers": peers,
        "reports": reports,
        "investor_trends": investor_trends,
        "overview_summary": overview_summary,
        "etf_info": etf_info,
    }


def fetch_integration_info(code: str, target: dict | None = None) -> dict:
    """네이버 금융 통합 API에서 시가총액, PER, PBR 및 기업현황·개요 상세를 수집한다."""
    resolved = target or _resolve_target_for_code(code)
    market = resolved["market"]
    lookup_code = resolved["reuters_code"] if market == "US" else resolved["code"]

    if market == "US":
        basic_data = _fetch_naver_json(f"https://api.stock.naver.com/stock/{lookup_code}/basic", "미국 주식 기본 API")
        snapshot = _extract_us_snapshot_from_basic(basic_data)
        integ_data = _fetch_naver_json(
            f"https://api.stock.naver.com/stock/{lookup_code}/integration",
            "미국 주식 통합 API",
            allow_404=True,
        ) or {}
        snapshot["details"] = _parse_integration_details(integ_data, "US")
        return snapshot

    url = f"https://m.stock.naver.com/api/stock/{lookup_code}/integration"
    data = _fetch_naver_json(url, "통합 투자정보 API")

    total_infos = data.get("totalInfos")
    if not isinstance(total_infos, list):
        logger.error("[ERROR] 투자정보 데이터 구조 변경: totalInfos가 리스트가 아닙니다.")
        raise RuntimeError("네이버 데이터 구조 변경: 투자정보 목록을 찾을 수 없습니다.")

    info_map = {item.get("code"): item.get("value") for item in total_infos if isinstance(item, dict)}

    market_cap = parse_korean_amount(info_map.get("marketValue"))
    per = parse_number(info_map.get("per"), as_int=False)
    pbr = parse_number(info_map.get("pbr"), as_int=False)

    logger.info(
        "[PARSE] 투자정보 파싱 완료 (market_cap=%s, per=%s, pbr=%s)",
        market_cap, per, pbr
    )

    return {
        "market_cap": market_cap,
        "per": per,
        "pbr": pbr,
        "metrics": _extract_common_metrics(total_infos),
        "details": _parse_integration_details(data, "KR"),
    }


def collect_stock_data(code: str) -> dict:
    """종목코드·종목명·미국 티커를 받아 네이버 금융 데이터와 뉴스를 수집하여 표준 JSON 규격으로 반환한다."""
    target = _resolve_target_for_code(code)
    valid_code = target["code"]
    market = target["market"]
    reuters_code = target["reuters_code"]

    if market == "KR":
        naver_urls = {
            "company": f"https://stock.naver.com/domestic/stock/{valid_code}/info/company",
            "overview": f"https://stock.naver.com/domestic/stock/{valid_code}/info/overview",
            "financial": f"https://stock.naver.com/domestic/stock/{valid_code}/info/financial",
        }
    else:
        naver_urls = {
            "company": f"https://stock.naver.com/worldstock/stock/{reuters_code}/total",
            "overview": f"https://stock.naver.com/worldstock/stock/{reuters_code}/overview",
            "financial": f"https://stock.naver.com/worldstock/stock/{reuters_code}/finance",
        }

    result = {
        "code": valid_code,
        "market": market,
        "currency": "KRW" if market == "KR" else "USD",
        "is_etf": False,
        "name": None,
        "snapshot": {
            "current_price": None,
            "change_rate": None,
            "market_cap": None,
            "per": None,
            "pbr": None,
        },
        "financials": [],
        "news": [],
        "details": {
            "naver_urls": naver_urls,
            "exchange": target.get("exchange"),
            "name_eng": None,
            "metrics": {},
            "consensus": None,
            "peers": [],
            "reports": [],
            "investor_trends": [],
            "overview_summary": None,
            "etf_info": None,
            "etf_constituents": None,
            "etf_dividend": None,
            "price_history": {"dates": [], "closes": []},
            "financial_tables": {
                "annual": None,
                "quarter": None,
            },
        },
        "errors": [],
    }

    # 1차: 기본 시세 및 정식 종목명 수집
    basic = fetch_basic_info(valid_code, target=target)
    result["name"] = basic["name"]
    result["currency"] = basic["currency"]
    result["is_etf"] = bool(basic.get("is_etf"))
    result["snapshot"]["current_price"] = basic["current_price"]
    result["snapshot"]["change_rate"] = basic["change_rate"]
    result["details"]["name_eng"] = basic.get("name_eng")
    if basic.get("exchange"):
        result["details"]["exchange"] = basic["exchange"]

    # 2차: 통합 투자정보(시총, PER, PBR + 기업현황·개요) 수집
    try:
        if market == "US":
            us_snap = basic.get("_us_snapshot") or {}
            result["snapshot"]["market_cap"] = us_snap.get("market_cap")
            result["snapshot"]["per"] = us_snap.get("per")
            result["snapshot"]["pbr"] = us_snap.get("pbr")
            result["details"]["metrics"] = us_snap.get("metrics") or {}

            us_integ = _fetch_naver_json(
                f"https://api.stock.naver.com/stock/{reuters_code}/integration",
                "미국 주식 통합 API",
                allow_404=True,
            )
            if us_integ:
                parsed_det = _parse_integration_details(us_integ, "US")
                result["details"].update(parsed_det)
        else:
            integ = fetch_integration_info(valid_code, target=target)
            result["snapshot"]["market_cap"] = integ["market_cap"]
            result["snapshot"]["per"] = integ["per"]
            result["snapshot"]["pbr"] = integ["pbr"]
            result["details"]["metrics"] = integ.get("metrics") or {}
            result["details"].update(integ.get("details") or {})

            if not result["details"].get("overview_summary") or not result["details"]["metrics"].get("industry"):
                wise = _fetch_kr_wisereport_overview(valid_code)
                if wise.get("overview_summary") and not result["details"].get("overview_summary"):
                    result["details"]["overview_summary"] = wise["overview_summary"]
                if wise.get("industry") and not result["details"]["metrics"].get("industry"):
                    result["details"]["metrics"]["industry"] = wise["industry"]
                if wise.get("extra_metrics"):
                    result["details"]["metrics"].update(wise["extra_metrics"])
    except Exception as exc:
        logger.exception("[ERROR] 투자정보 수집 실패: %s", exc)
        result["errors"].append({"section": "snapshot", "message": str(exc)})

    # 3차: 기업실적분석 연간/분기 데이터 수집
    try:
        annual_table = fetch_financial_table(valid_code, period_type="annual", target=target)
        result["details"]["financial_tables"]["annual"] = annual_table
        result["financials"] = _table_to_legacy_financials(annual_table, market)
    except Exception as exc:
        logger.exception("[ERROR] 연간 실적 수집 실패: %s", exc)
        result["errors"].append({"section": "financials", "message": str(exc)})

    try:
        quarter_table = fetch_financial_table(valid_code, period_type="quarter", target=target)
        result["details"]["financial_tables"]["quarter"] = quarter_table
    except Exception as exc:
        logger.warning("[WARN] 분기 실적 수집 실패: %s", exc)

    try:
        result["details"]["price_history"] = fetch_price_history(valid_code, target=target, limit=60)
    except Exception as exc:
        logger.warning("[WARN] 일별 주가 차트 수집 실패: %s", exc)

    if result["is_etf"]:
        try:
            result["details"]["etf_constituents"] = fetch_etf_constituents(valid_code, market, limit=20)
        except Exception as exc:
            logger.warning("[WARN] ETF 구성종목 수집 실패: %s", exc)
        try:
            result["details"]["etf_dividend"] = fetch_etf_dividend(valid_code, market, page_size=12)
        except Exception as exc:
            logger.warning("[WARN] ETF 배당 정보 수집 실패: %s", exc)

    # 4차: 파싱된 정식 종목명 기반 Serper News API 연동
    try:
        news_query = result["name"]
        result["news"] = fetch_serper_news(news_query, limit=5)
    except Exception as exc:
        logger.exception("[ERROR] 뉴스 수집 실패: %s", exc)
        result["errors"].append({"section": "news", "message": str(exc)})

    return result


def fetch_financial_table(code: str, period_type: str = "annual", target: dict | None = None) -> dict | None:
    """네이버 금융 연간/분기 실적 API에서 전체 재무 테이블(기간, 항목별 수치)을 수집한다."""
    resolved = target or _resolve_target_for_code(code)
    market = resolved["market"]
    lookup_code = resolved["reuters_code"] if market == "US" else resolved["code"]

    ep = "annual" if period_type == "annual" else "quarter"
    if market == "US":
        url = f"https://api.stock.naver.com/stock/{lookup_code}/finance/{ep}"
    else:
        url = f"https://m.stock.naver.com/api/stock/{lookup_code}/finance/{ep}"

    data = _fetch_naver_json(url, f"{'연간' if ep == 'annual' else '분기'} 실적 API", allow_404=True)
    if not data:
        return None

    finance_info = data if market == "US" else data.get("financeInfo")
    if not isinstance(finance_info, dict):
        return None

    tr_title_list = finance_info.get("trTitleList") or []
    row_list = finance_info.get("rowList") or []
    if not tr_title_list or not row_list:
        return None

    periods = [
        {
            "key": col_info.get("key"),
            "title": str(col_info.get("title", "")).strip().rstrip("."),
            "is_consensus": col_info.get("isConsensus") == "Y",
        }
        for col_info in tr_title_list
    ]

    rows = []
    for row in row_list:
        if not isinstance(row, dict):
            continue
        title = row.get("title")
        columns = row.get("columns") or {}
        values = []
        for p in periods:
            cell = columns.get(p["key"]) or {}
            values.append(cell.get("value") if cell.get("value") not in (None, "") else "-")
        rows.append({"title": title, "values": values})

    return {
        "unit": finance_info.get("unit") or ("USD(백만)" if market == "US" else "억원"),
        "periods": periods,
        "rows": rows,
    }


def _table_to_legacy_financials(table: dict | None, market: str) -> list[dict]:
    """재무 테이블에서 AI 챗봇용 표준 연간 실적 리스트(매출액, 영업이익/EBIT, ROE)를 추출한다."""
    if not table:
        return []
    periods = table.get("periods") or []
    row_map = {r["title"]: r["values"] for r in (table.get("rows") or [])}
    rev_vals = row_map.get("매출액") or []
    op_vals = row_map.get("영업이익") or row_map.get("EBIT") or []
    roe_vals = row_map.get("ROE") or []

    unit_multiplier = 10**6 if market == "US" else 10**8
    financials = []
    for idx, p in enumerate(periods):
        rev_val = parse_number(rev_vals[idx], as_int=False) if idx < len(rev_vals) else None
        op_val = parse_number(op_vals[idx], as_int=False) if idx < len(op_vals) else None
        roe_val = parse_number(roe_vals[idx], as_int=False) if idx < len(roe_vals) else None
        financials.append({
            "period": p["title"],
            "period_type": "annual",
            "is_consensus": p["is_consensus"],
            "revenue": round(rev_val * unit_multiplier) if rev_val is not None else None,
            "operating_income": round(op_val * unit_multiplier) if op_val is not None else None,
            "roe": roe_val,
        })
    return financials


def fetch_annual_financials(code: str, target: dict | None = None) -> list[dict]:
    """네이버 금융 연간 실적 API에서 매출액, 영업이익(또는 EBIT), ROE 및 추정치(is_consensus)를 수집한다."""
    resolved = target or _resolve_target_for_code(code)
    table = fetch_financial_table(resolved["code"], period_type="annual", target=resolved)
    return _table_to_legacy_financials(table, resolved["market"])


def fetch_serper_news(query: str, limit: int = 5) -> list[dict]:
    """파싱된 정식 종목명으로 Serper News API를 호출해 최신 관련 뉴스를 수집한다."""
    api_key = os.getenv("SERPER_API_KEY")
    if not api_key or api_key == "your_serper_api_key_here":
        logger.error("[ERROR] Serper API Key 미설정")
        raise RuntimeError("Serper API Key 미설정: .env 파일에 유효한 SERPER_API_KEY를 입력해 주세요.")

    if not query or not str(query).strip():
        raise RuntimeError("종목명 파싱 실패: 뉴스 검색에 사용할 종목명이 비어 있습니다.")

    url = "https://google.serper.dev/news"
    headers = {
        "X-API-KEY": api_key,
        "Content-Type": "application/json",
    }
    payload = {
        "q": str(query).strip(),
        "gl": "kr",
        "hl": "ko",
        "num": limit,
    }

    logger.info("[SERPER] Serper News API 호출 시작 (query=%s)", payload["q"])

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=REQUEST_TIMEOUT)
    except requests.exceptions.Timeout as exc:
        logger.error("[ERROR] Serper API 요청 타임아웃: %s", exc)
        raise RuntimeError("네트워크 타임아웃: 뉴스 검색 서버 응답이 지연되고 있습니다.") from exc
    except requests.exceptions.RequestException as exc:
        logger.error("[ERROR] Serper API 네트워크 오류: %s", exc)
        raise RuntimeError(f"Serper API 호출 실패: 네트워크 오류가 발생했습니다 ({exc})") from exc

    if response.status_code != 200:
        logger.error("[ERROR] Serper API HTTP 오류 (%d)", response.status_code)
        raise RuntimeError(f"Serper API 호출 실패 (HTTP {response.status_code})")

    try:
        data = response.json()
    except ValueError as exc:
        logger.error("[ERROR] Serper API JSON 변환 실패: %s", exc)
        raise RuntimeError("JSON 변환 실패: Serper 뉴스 응답 형식이 올바르지 않습니다.") from exc

    raw_news = data.get("news") or []
    news_list = []
    for item in raw_news[:limit]:
        if not isinstance(item, dict):
            continue
        news_list.append({
            "title": item.get("title", ""),
            "url": item.get("link", ""),
            "description": item.get("snippet", ""),
            "published": item.get("date", ""),
        })

    logger.info("[PARSE] 뉴스 수집 완료 (count=%d)", len(news_list))
    return news_list
