import os
import re
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


def resolve_stock_code(query: str) -> str:
    """종목명 또는 줄임말(예: '삼성전자', '삼전')을 네이버 자동완성 API로 조회해 국내 6자리 종목코드로 변환한다."""
    url = "https://ac.stock.naver.com/ac"
    params = {"q": query, "target": "stock"}
    logger.info("[NAVER] 종목명 자동완성 검색 시작 (query=%s)", query)

    try:
        response = requests.get(url, params=params, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    except requests.exceptions.Timeout as exc:
        logger.error("[ERROR] 종목명 검색 타임아웃: %s", exc)
        raise RuntimeError("네트워크 타임아웃: 종목명 검색 서버 응답이 지연되고 있습니다.") from exc
    except requests.exceptions.RequestException as exc:
        logger.error("[ERROR] 종목명 검색 네트워크 오류: %s", exc)
        raise RuntimeError(f"종목명 검색 중 네트워크 오류가 발생했습니다: {exc}") from exc

    if response.status_code != 200:
        raise RuntimeError(f"종목명 검색 실패 (HTTP {response.status_code})")

    try:
        items = response.json().get("items") or []
    except ValueError as exc:
        raise RuntimeError("JSON 변환 실패: 종목명 검색 응답 형식이 올바르지 않습니다.") from exc

    # 부작용 방지 필터: 국내 종목(KOR) + 순수 6자리 숫자 코드만 허용
    kor_candidates = [
        item for item in items
        if isinstance(item, dict)
        and item.get("nationCode") == "KOR"
        and re.fullmatch(r"\d{6}", str(item.get("code", "")))
    ]

    if not kor_candidates:
        raise ValueError(f"'{query}'에 해당하는 국내 주식/ETF 종목을 찾을 수 없습니다.")

    # 정확히 이름이 일치하는 항목이 있으면 최우선 선택
    normalized_q = query.replace(" ", "").upper()
    for item in kor_candidates:
        item_name = str(item.get("name", "")).replace(" ", "").upper()
        if item_name == normalized_q:
            resolved_code = item["code"]
            logger.info("[NAVER] 종목명 정확 매칭 완료 (query=%s -> code=%s, name=%s)", query, resolved_code, item.get("name"))
            return resolved_code

    # 그 외에는 네이버 검색 1순위 선택
    best = kor_candidates[0]
    logger.info("[NAVER] 종목명 자동완성 1순위 선택 (query=%s -> code=%s, name=%s)", query, best["code"], best.get("name"))
    return best["code"]


def validate_stock_code(code_or_name: str) -> str:
    """6자리 숫자 코드면 그대로 반환하고, 종목명/줄임말이면 네이버 자동완성으로 6자리 코드를 찾아 반환한다."""
    if not code_or_name or not str(code_or_name).strip():
        raise ValueError("종목명 또는 종목코드가 입력되지 않았습니다.")

    cleaned = str(code_or_name).strip()
    if re.fullmatch(r"\d{6}", cleaned):
        return cleaned

    return resolve_stock_code(cleaned)


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


def fetch_basic_info(code: str) -> dict:
    """네이버 금융 기본 API에서 정식 종목명, 현재가, 등락률을 수집한다."""
    url = f"https://m.stock.naver.com/api/stock/{code}/basic"
    logger.info("[NAVER] 네이버 금융 접근 시작 (User-Agent 적용) url=%s", url)

    try:
        response = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    except requests.exceptions.Timeout as exc:
        logger.error("[ERROR] 네이버 금융 요청 타임아웃: %s", exc)
        raise RuntimeError("네트워크 타임아웃: 네이버 금융 서버 응답이 지연되고 있습니다.") from exc
    except requests.exceptions.RequestException as exc:
        logger.error("[ERROR] 네이버 금융 네트워크 오류: %s", exc)
        raise RuntimeError(f"네이버 금융 접근 중 네트워크 오류가 발생했습니다: {exc}") from exc

    if response.status_code == 404:
        logger.error("[ERROR] 존재하지 않는 종목코드 (404): code=%s", code)
        raise RuntimeError(f"네이버 금융 접근 실패 (404): '{code}'에 해당하는 종목을 찾을 수 없습니다.")
    if response.status_code in (403, 429):
        logger.error("[ERROR] 네이버 금융 접근 차단 (%d): code=%s", response.status_code, code)
        raise RuntimeError(f"네이버 금융 접근 실패 ({response.status_code}): 일시적으로 접근이 제한되었습니다.")
    if response.status_code != 200:
        logger.error("[ERROR] 네이버 금융 HTTP 오류 (%d): code=%s", response.status_code, code)
        raise RuntimeError(f"네이버 금융 접근 실패 (HTTP {response.status_code})")

    try:
        data = response.json()
    except ValueError as exc:
        logger.error("[ERROR] 네이버 기본 API JSON 변환 실패: %s", exc)
        raise RuntimeError("JSON 변환 실패: 네이버 금융 응답 형식이 올바르지 않습니다.") from exc

    stock_name = data.get("stockName")
    if not stock_name:
        logger.error("[ERROR] 종목명 파싱 실패: 응답에 stockName이 없습니다. keys=%s", list(data.keys()))
        raise RuntimeError("종목명 파싱 실패: 네이버 데이터 구조가 변경되었거나 유효하지 않은 종목입니다.")

    current_price = parse_number(data.get("closePrice"), as_int=True)
    change_rate = parse_number(data.get("fluctuationsRatio"), as_int=False)

    if current_price is None:
        logger.error("[ERROR] 현재가 파싱 실패: closePrice=%s", data.get("closePrice"))
        raise RuntimeError("네이버 데이터 구조 변경: 현재가 정보를 읽을 수 없습니다.")

    logger.info("[PARSE] 기본 시세 파싱 완료 (name=%s, current_price=%s, change_rate=%s)", stock_name, current_price, change_rate)

    return {
        "name": stock_name,
        "current_price": current_price,
        "change_rate": change_rate,
    }


def fetch_integration_info(code: str) -> dict:
    """네이버 금융 통합 API에서 시가총액, PER, PBR을 수집하고 순수 숫자로 정제한다."""
    url = f"https://m.stock.naver.com/api/stock/{code}/integration"
    logger.info("[NAVER] 통합 투자정보 API 접근 시작 url=%s", url)

    try:
        response = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    except requests.exceptions.Timeout as exc:
        logger.error("[ERROR] 통합 투자정보 요청 타임아웃: %s", exc)
        raise RuntimeError("네트워크 타임아웃: 투자정보 서버 응답이 지연되고 있습니다.") from exc
    except requests.exceptions.RequestException as exc:
        logger.error("[ERROR] 통합 투자정보 네트워크 오류: %s", exc)
        raise RuntimeError(f"투자정보 접근 중 네트워크 오류가 발생했습니다: {exc}") from exc

    if response.status_code != 200:
        logger.error("[ERROR] 통합 투자정보 HTTP 오류 (%d): code=%s", response.status_code, code)
        raise RuntimeError(f"네이버 투자정보 접근 실패 (HTTP {response.status_code})")

    try:
        data = response.json()
    except ValueError as exc:
        logger.error("[ERROR] 통합 투자정보 JSON 변환 실패: %s", exc)
        raise RuntimeError("JSON 변환 실패: 투자정보 응답 형식이 올바르지 않습니다.") from exc

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
    }


def collect_stock_data(code: str) -> dict:
    """종목코드를 받아 네이버 금융 데이터와 뉴스를 수집하여 표준 JSON 규격으로 반환한다."""
    valid_code = validate_stock_code(code)

    result = {
        "code": valid_code,
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
        "errors": [],
    }

    # 1차: 기본 시세 및 정식 종목명 수집
    basic = fetch_basic_info(valid_code)
    result["name"] = basic["name"]
    result["snapshot"]["current_price"] = basic["current_price"]
    result["snapshot"]["change_rate"] = basic["change_rate"]

    # 2차: 통합 투자정보(시총, PER, PBR) 수집 (실패 시 전체 중단 대신 errors에 기록)
    try:
        integ = fetch_integration_info(valid_code)
        result["snapshot"]["market_cap"] = integ["market_cap"]
        result["snapshot"]["per"] = integ["per"]
        result["snapshot"]["pbr"] = integ["pbr"]
    except Exception as exc:
        logger.exception("[ERROR] 투자정보 수집 실패: %s", exc)
        result["errors"].append({"section": "snapshot", "message": str(exc)})

    # 3차: 기업실적분석 연간 데이터 수집 (매출액, 영업이익, ROE + 추정치 구분)
    try:
        result["financials"] = fetch_annual_financials(valid_code)
    except Exception as exc:
        logger.exception("[ERROR] 기업실적분석 수집 실패: %s", exc)
        result["errors"].append({"section": "financials", "message": str(exc)})

    # 4차: 파싱된 정식 종목명 기반 Serper News API 연동
    try:
        result["news"] = fetch_serper_news(result["name"], limit=5)
    except Exception as exc:
        logger.exception("[ERROR] 뉴스 수집 실패: %s", exc)
        result["errors"].append({"section": "news", "message": str(exc)})

    return result


def fetch_annual_financials(code: str) -> list[dict]:
    """네이버 금융 연간 실적 API에서 매출액, 영업이익, ROE 및 추정치(is_consensus)를 수집한다."""
    url = f"https://m.stock.naver.com/api/stock/{code}/finance/annual"
    logger.info("[NAVER] 연간 실적 API 접근 시작 url=%s", url)

    try:
        response = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    except requests.exceptions.Timeout as exc:
        logger.error("[ERROR] 연간 실적 요청 타임아웃: %s", exc)
        raise RuntimeError("네트워크 타임아웃: 연간 실적 서버 응답이 지연되고 있습니다.") from exc
    except requests.exceptions.RequestException as exc:
        logger.error("[ERROR] 연간 실적 네트워크 오류: %s", exc)
        raise RuntimeError(f"연간 실적 접근 중 네트워크 오류가 발생했습니다: {exc}") from exc

    if response.status_code == 404:
        logger.info("[PARSE] 연간 실적 정보 없음 (404, ETF 등): code=%s", code)
        return []
    if response.status_code != 200:
        logger.error("[ERROR] 연간 실적 HTTP 오류 (%d): code=%s", response.status_code, code)
        raise RuntimeError(f"네이버 연간 실적 접근 실패 (HTTP {response.status_code})")

    try:
        data = response.json()
    except ValueError as exc:
        logger.error("[ERROR] 연간 실적 JSON 변환 실패: %s", exc)
        raise RuntimeError("JSON 변환 실패: 연간 실적 응답 형식이 올바르지 않습니다.") from exc

    finance_info = data.get("financeInfo")
    if not isinstance(finance_info, dict):
        return []

    tr_title_list = finance_info.get("trTitleList") or []
    row_list = finance_info.get("rowList") or []
    if not tr_title_list or not row_list:
        return []

    # 행 제목 -> columns 딕셔너리 매핑
    row_map = {
        row.get("title"): row.get("columns", {})
        for row in row_list
        if isinstance(row, dict)
    }

    financials = []
    for col_info in tr_title_list:
        key = col_info.get("key")
        period = str(col_info.get("title", "")).strip().rstrip(".")
        is_consensus = col_info.get("isConsensus") == "Y"

        rev_raw = row_map.get("매출액", {}).get(key, {}).get("value")
        op_raw = row_map.get("영업이익", {}).get(key, {}).get("value")
        roe_raw = row_map.get("ROE", {}).get(key, {}).get("value")

        rev_eok = parse_number(rev_raw, as_int=True)
        op_eok = parse_number(op_raw, as_int=True)
        roe_val = parse_number(roe_raw, as_int=False)

        financials.append({
            "period": period,
            "period_type": "annual",
            "is_consensus": is_consensus,
            "revenue": rev_eok * 10**8 if rev_eok is not None else None,
            "operating_income": op_eok * 10**8 if op_eok is not None else None,
            "roe": roe_val,
        })

    logger.info("[PARSE] 연간 실적 파싱 완료 (count=%d)", len(financials))
    return financials


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
