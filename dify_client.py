import os
import logging
import requests

logger = logging.getLogger(__name__)

DIFY_TIMEOUT = 60

DEFAULT_PLACEHOLDERS = {
    "your_dify_analysis_api_key_here",
    "your_dify_technical_api_key_here",
}


def is_dify_key_configured(bot_type: str) -> bool:
    """Dify 챗봇별 API 키가 유효하게 설정되어 있는지 반환한다."""
    env_name = "DIFY_ANALYSIS_API_KEY" if bot_type == "analysis" else "DIFY_TECHNICAL_API_KEY"
    key = os.getenv(env_name, "").strip()
    return bool(key and key not in DEFAULT_PLACEHOLDERS)


def _get_dify_api_key(bot_type: str) -> str:
    if bot_type == "analysis":
        env_name = "DIFY_ANALYSIS_API_KEY"
        label = "종목 심층분석용(챗봇①)"
    elif bot_type == "technical":
        env_name = "DIFY_TECHNICAL_API_KEY"
        label = "기술지표 설명용(챗봇②)"
    else:
        raise ValueError(f"알 수 없는 Dify 챗봇 유형입니다: {bot_type}")

    api_key = os.getenv(env_name, "").strip()
    if not api_key or api_key in DEFAULT_PLACEHOLDERS:
        logger.error("[ERROR] Dify API Key 미설정: env=%s", env_name)
        raise RuntimeError(
            f"Dify API Key 미설정: .env 파일에 {label} {env_name}를 입력해 주세요."
        )
    return api_key


def ask_dify_chatbot(
    bot_type: str,
    query: str,
    context_text: str | None = None,
    inputs: dict | None = None,
    conversation_id: str = "",
    user_id: str = "investment-assistant-user",
) -> dict:
    """Dify 챗봇 API(/v1/chat-messages)를 호출하여 답변과 conversation_id를 반환한다."""
    if not query or not str(query).strip():
        raise ValueError("질문 내용을 입력해 주세요.")

    api_key = _get_dify_api_key(bot_type)
    base_url = os.getenv("DIFY_BASE_URL", "https://api.dify.ai/v1").strip().rstrip("/")
    url = f"{base_url}/chat-messages"

    has_context = bool(context_text and str(context_text).strip())
    logger.info("[DIFY] Dify 챗봇 API 호출 (bot=%s, has_context=%s)", bot_type, has_context)

    # Dify 기본 챗봇은 오케스트레이트에 별도 변수를 안 만들어뒀을 수도 있으므로
    # context_text가 있으면 query 앞에 안전하게 주입하고 inputs도 함께 전달한다.
    final_query = str(query).strip()
    if has_context:
        final_query = (
            "[참고 데이터 — 반드시 아래 제공된 숫자/사실만 근거로 답변하세요]\n"
            f"{context_text}\n\n"
            f"[사용자 질문]\n{final_query}"
        )

    payload = {
        "inputs": inputs or {},
        "query": final_query,
        "response_mode": "blocking",
        "conversation_id": conversation_id or "",
        "user": user_id,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=DIFY_TIMEOUT)
    except requests.exceptions.Timeout as exc:
        logger.error("[ERROR] Dify API 요청 타임아웃: %s", exc)
        raise RuntimeError("네트워크 타임아웃: Dify 챗봇 응답 시간이 초과되었습니다.") from exc
    except requests.exceptions.RequestException as exc:
        logger.error("[ERROR] Dify API 네트워크 오류: %s", exc)
        raise RuntimeError(f"Dify API 호출 실패: 네트워크 오류가 발생했습니다 ({exc})") from exc

    if response.status_code != 200:
        detail = ""
        try:
            err_json = response.json()
            detail = err_json.get("message") or err_json.get("code") or ""
        except ValueError:
            detail = response.text[:200]
        logger.error("[ERROR] Dify API HTTP 오류 (%d): %s", response.status_code, detail)
        raise RuntimeError(f"Dify API 호출 실패 (HTTP {response.status_code}): {detail}")

    try:
        data = response.json()
    except ValueError as exc:
        logger.error("[ERROR] Dify API JSON 변환 실패: %s", exc)
        raise RuntimeError("JSON 변환 실패: Dify 챗봇 응답 형식이 올바르지 않습니다.") from exc

    return {
        "answer": data.get("answer", ""),
        "conversation_id": data.get("conversation_id", ""),
        "message_id": data.get("message_id", ""),
    }
