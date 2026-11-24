import os
import json
import logging
from flask import Flask, jsonify, render_template, request
from dotenv import load_dotenv
from collector import collect_stock_data
from quant import calculate_rebalance, calculate_technical_indicators
from dify_client import ask_dify_chatbot, is_dify_key_configured

# .env 환경변수 로드
load_dotenv(override=True)

# 로깅 설정 (print() 대신 logging 모듈 사용)
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)


@app.route('/')
def index():
    """3탭 메인 웹앱 화면 반환"""
    return render_template('index.html')


@app.route('/test')
def test_page():
    """기존 1차 종목 수집기 단독 테스트 화면 반환"""
    return render_template('test.html')


@app.route('/health')
def health():
    """서버 상태 및 4종 API 키 설정 여부만 반환 (키 값 자체는 절대 노출 금지)"""
    serper_key_set = bool(os.getenv("SERPER_API_KEY") and os.getenv("SERPER_API_KEY") != "your_serper_api_key_here")
    gemini_key_set = bool(os.getenv("GEMINI_API_KEY") and os.getenv("GEMINI_API_KEY") != "your_gemini_api_key_here")
    dify_analysis_set = is_dify_key_configured("analysis")
    dify_technical_set = is_dify_key_configured("technical")

    logger.info(
        "[HEALTH] serper=%s, gemini=%s, dify_analysis=%s, dify_technical=%s",
        serper_key_set, gemini_key_set, dify_analysis_set, dify_technical_set
    )

    return jsonify({
        "status": "healthy",
        "keys": {
            "serper_api_key_configured": serper_key_set,
            "gemini_api_key_configured": gemini_key_set,
            "dify_analysis_api_key_configured": dify_analysis_set,
            "dify_technical_api_key_configured": dify_technical_set,
        }
    })


@app.route('/fetch', methods=['POST'])
def fetch():
    """[기존 유지] /test 화면용 네이버 + Serper 통합 JSON 반환"""
    body = request.get_json(silent=True) or {}
    code = body.get("code", "")
    logger.info("[REQUEST] POST /fetch code=%s", code)

    try:
        data = collect_stock_data(code)
    except ValueError as exc:
        logger.warning("[ERROR] 잘못된 입력 요청: %s", exc)
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        logger.error("[ERROR] 수집 실패: %s", exc)
        return jsonify({"error": str(exc)}), 502
    except Exception:
        logger.exception("[ERROR] 수집 중 예기치 못한 오류 발생")
        return jsonify({"error": "서버 내부 오류가 발생했습니다. 로그를 확인해 주세요."}), 500

    logger.info(
        "[RESPONSE] 수집 성공 (name=%s, financials=%d, news=%d, errors=%d)",
        data.get("name"),
        len(data.get("financials", [])),
        len(data.get("news", [])),
        len(data.get("errors", [])),
    )
    return jsonify(data), 200


EXPERT_ANALYSIS_PROMPT = """당신은 개인 투자자를 돕는 시니어 주식 애널리스트입니다.
제공된 [참고 데이터](네이버 금융 실시간 시세, 밸류에이션, 연간 실적, Serper 최신 뉴스)만을 근거로 아래 4가지 항목을 초보자도 이해하기 쉽게, 구체적인 숫자와 함께 체계적으로 분석해 주세요.
(제공되지 않은 숫자를 지어내지 말고, 매수/매도 직접 권유는 피하며 객관적 근거 중심으로 설명하세요.)

1. 현재 주가 및 밸류에이션 진단 (현재가, 시가총액, PER·PBR 수준 평가)
2. 실적 성장성 및 수익성 분석 (매출액·영업이익·ROE 추이와 확정/추정치 구분)
3. 최신 뉴스 핵심 이슈 요약 (수집된 뉴스 기반 호재·리스크 요인)
4. 투자자가 꼭 체크해야 할 핵심 포인트 3가지"""


@app.route('/api/chat/analysis', methods=['POST'])
def chat_analysis():
    """[탭1] 종목 근거 수집 후 전문가 프롬프트 분석 또는 이어지는 Dify 챗봇① 대화 반환"""
    body = request.get_json(silent=True) or {}
    code = str(body.get("code", "")).strip()
    query = str(body.get("query", "")).strip()
    mode = str(body.get("mode", "chat")).strip()  # "analyze" (초기 종목 분석) | "chat" (후속 질문)
    use_tool = bool(body.get("use_tool", True))
    conversation_id = str(body.get("conversation_id", "")).strip()

    logger.info("[REQUEST] POST /api/chat/analysis mode=%s code=%s use_tool=%s", mode, code, use_tool)

    if mode == "analyze":
        query = EXPERT_ANALYSIS_PROMPT
        conversation_id = ""  # 새 종목 분석 시 대화 새로 시작
    elif not query:
        return jsonify({"error": "질문 내용을 입력해 주세요."}), 400

    evidence = None
    context_text = None
    inputs = {}

    # 초기 분석(mode=="analyze")이거나, 대화 기록 없이 도구 모드로 바로 질문한 경우 실시간 수집 실행
    should_collect = use_tool and (mode == "analyze" or not conversation_id)

    if should_collect:
        if not code:
            return jsonify({"error": "근거 수집 모드를 사용하려면 6자리 종목코드를 입력해 주세요."}), 400
        try:
            logger.info("[COLLECTOR] 네이버/Serper 근거 수집 실행 (code=%s)", code)
            evidence = collect_stock_data(code)
            context_json = json.dumps(evidence, ensure_ascii=False, indent=2)
            context_text = context_json
            inputs = {
                "stock_code": evidence.get("code", ""),
                "stock_name": evidence.get("name", ""),
                "stock_data": context_json,
            }
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        except RuntimeError as exc:
            return jsonify({"error": str(exc)}), 502
        except Exception:
            logger.exception("[ERROR] 탭1 근거 수집 중 예기치 못한 오류")
            return jsonify({"error": "종목 데이터 수집 중 오류가 발생했습니다."}), 500

    try:
        dify_res = ask_dify_chatbot(
            bot_type="analysis",
            query=query,
            context_text=context_text,
            inputs=inputs,
            conversation_id=conversation_id,
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 502
    except Exception:
        logger.exception("[ERROR] Dify 분석 챗봇 호출 중 오류")
        return jsonify({"error": "Dify 챗봇 호출 중 서버 오류가 발생했습니다."}), 500

    logger.info("[RESPONSE] 탭1 Dify 분석 응답 반환 완료 (mode=%s, used_tool=%s)", mode, use_tool)
    return jsonify({
        "answer": dify_res["answer"],
        "conversation_id": dify_res["conversation_id"],
        "used_tool": use_tool,
        "evidence": evidence,
    }), 200


@app.route('/api/rebalance', methods=['POST'])
def rebalance():
    """[탭2] FDR 1년 데이터 수집 + 몬테카를로/효율적 프론티어 계산 (Dify 미사용)"""
    body = request.get_json(silent=True) or {}
    raw_codes = body.get("codes", [])
    if isinstance(raw_codes, str):
        codes = [c.strip() for c in raw_codes.split(",") if c.strip()]
    elif isinstance(raw_codes, list):
        codes = [str(c).strip() for c in raw_codes if str(c).strip()]
    else:
        codes = []

    logger.info("[REQUEST] POST /api/rebalance codes=%s", codes)

    try:
        result = calculate_rebalance(codes)
    except ValueError as exc:
        logger.warning("[ERROR] 리밸런싱 입력 오류: %s", exc)
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        logger.error("[ERROR] 리밸런싱 계산 실패: %s", exc)
        return jsonify({"error": str(exc)}), 502
    except Exception:
        logger.exception("[ERROR] 리밸런싱 중 예기치 못한 오류")
        return jsonify({"error": "포트폴리오 계산 중 서버 오류가 발생했습니다."}), 500

    logger.info("[RESPONSE] 탭2 리밸런싱 계산 결과 반환 완료")
    return jsonify(result), 200


@app.route('/api/technical', methods=['POST'])
def technical():
    """[탭3] FDR 주가 수집 + MA/RSI/MACD/볼린저밴드 시계열 및 요약 수치 반환"""
    body = request.get_json(silent=True) or {}
    code = str(body.get("code", "")).strip()
    logger.info("[REQUEST] POST /api/technical code=%s", code)

    try:
        result = calculate_technical_indicators(code)
    except ValueError as exc:
        logger.warning("[ERROR] 기술지표 입력 오류: %s", exc)
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        logger.error("[ERROR] 기술지표 계산 실패: %s", exc)
        return jsonify({"error": str(exc)}), 502
    except Exception:
        logger.exception("[ERROR] 기술지표 계산 중 예기치 못한 오류")
        return jsonify({"error": "기술지표 계산 중 서버 오류가 발생했습니다."}), 500

    logger.info("[RESPONSE] 탭3 기술지표 계산 결과 반환 완료 (code=%s)", code)
    return jsonify(result), 200


@app.route('/api/chat/technical', methods=['POST'])
def chat_technical():
    """[탭3] 계산된 기술지표 숫자를 눈에 안 보이게 주입해 Dify 챗봇② 호출 결과 반환"""
    body = request.get_json(silent=True) or {}
    code = str(body.get("code", "")).strip()
    query = str(body.get("query", "")).strip()
    indicators = body.get("indicators")
    conversation_id = str(body.get("conversation_id", "")).strip()

    logger.info("[REQUEST] POST /api/chat/technical code=%s has_indicators=%s", code, bool(indicators))

    if not query:
        return jsonify({"error": "질문 내용을 입력해 주세요."}), 400

    if not indicators:
        if not code:
            return jsonify({"error": "먼저 종목코드를 조회하여 기술지표를 계산해 주세요."}), 400
        try:
            tech_data = calculate_technical_indicators(code)
            indicators = {
                "code": tech_data["code"],
                "name": tech_data["name"],
                "latest": tech_data["latest"],
            }
        except (ValueError, RuntimeError) as exc:
            return jsonify({"error": str(exc)}), 400

    context_json = json.dumps(indicators, ensure_ascii=False, indent=2)
    inputs = {
        "stock_code": str(indicators.get("code", code)),
        "stock_name": str(indicators.get("name", "")),
        "technical_data": context_json,
    }

    try:
        dify_res = ask_dify_chatbot(
            bot_type="technical",
            query=query,
            context_text=context_json,
            inputs=inputs,
            conversation_id=conversation_id,
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 502
    except Exception:
        logger.exception("[ERROR] Dify 기술지표 챗봇 호출 중 오류")
        return jsonify({"error": "Dify 기술지표 챗봇 호출 중 서버 오류가 발생했습니다."}), 500

    logger.info("[RESPONSE] 탭3 Dify 기술지표 설명 응답 반환 완료")
    return jsonify({
        "answer": dify_res["answer"],
        "conversation_id": dify_res["conversation_id"],
    }), 200


if __name__ == '__main__':
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "true").lower() == "true"
    logger.info("Starting Flask server on port %d (debug=%s)", port, debug)
    app.run(host='0.0.0.0', port=port, debug=debug)
