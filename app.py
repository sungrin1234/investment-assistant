import os
import logging
from flask import Flask, jsonify, render_template, request
from dotenv import load_dotenv
from collector import collect_stock_data

# .env 환경변수 로드
load_dotenv()

# 로깅 설정 (print() 대신 logging 사용)
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

@app.route('/')
def index():
    """메인 화면 HTML 반환"""
    return render_template('index.html')

@app.route('/health')
def health():
    """서버 상태 및 API 키 설정 여부 확인 라우트 (키 값 자체는 절대 노출 금지)"""
    serper_key_set = bool(os.getenv("SERPER_API_KEY") and os.getenv("SERPER_API_KEY") != "your_serper_api_key_here")
    gemini_key_set = bool(os.getenv("GEMINI_API_KEY") and os.getenv("GEMINI_API_KEY") != "your_gemini_api_key_here")

    logger.info("[HEALTH] Health check requested. serper_key_set=%s, gemini_key_set=%s", serper_key_set, gemini_key_set)

    return jsonify({
        "status": "healthy",
        "keys": {
            "serper_api_key_configured": serper_key_set,
            "gemini_api_key_configured": gemini_key_set
        }
    })


@app.route('/fetch', methods=['POST'])
def fetch():
    """종목코드를 받아 네이버 금융 수집 + Serper 뉴스 검색을 통합 실행하고 최종 JSON 반환"""
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

if __name__ == '__main__':
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "true").lower() == "true"
    logger.info("Starting Flask server on port %d (debug=%s)", port, debug)
    app.run(host='0.0.0.0', port=port, debug=debug)
