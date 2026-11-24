# 나의 투자도우미 (My Investment Assistant)

국내 주식 종목의 실시간 시세·재무·뉴스 데이터 수집과 AI 챗봇 분석, 퀀트 기반 포트폴리오 리밸런싱, 기술적 지표 시각화 및 해석을 한 번에 제공하는 Flask 웹 애플리케이션입니다.

## 주요 기능

1. **종목 심층분석 채팅 (`POST /api/chat/analysis`)**
   - 네이버 금융 실시간 시세·밸류에이션·연간 실적과 Serper 최신 뉴스를 수집해 근거 기반 AI 분석을 제공합니다.
   - Dify 챗봇①과 연동하여 초기 전문가 분석 리포트 생성 및 후속 질의응답을 지원합니다.
   - 근거 수집 도구 사용 여부를 선택할 수 있습니다.

2. **리밸런싱 도우미 (`POST /api/rebalance`)**
   - 2~10개 종목의 최근 1년 주가 데이터를 `FinanceDataReader`로 수집합니다.
   - 몬테카를로 시뮬레이션(2,000개 포트폴리오) 및 효율적 프론티어를 계산해 최적 비중을 도출합니다.

3. **기술지표 차트 + 채팅 (`POST /api/technical`, `POST /api/chat/technical`)**
   - 이동평균선(MA), RSI, MACD, 볼린저밴드 시계열 데이터를 계산하고 Chart.js로 시각화합니다.
   - 계산된 최신 기술지표 수치를 바탕으로 Dify 챗봇②에게 지표 해석을 질문할 수 있습니다.

4. **수집기 단독 테스트 & 헬스체크**
   - `/test` (`POST /fetch`): 네이버 금융 + Serper 통합 수집 JSON 결과를 단독으로 테스트합니다.
   - `/health`: 서버 상태 및 API 키 설정 여부를 확인합니다(키 값은 노출되지 않음).

## 기술 스택

- **Backend**: Python, Flask, `python-dotenv`, `requests`
- **Data & Quant**: `FinanceDataReader`, `pandas`, `numpy`
- **AI / Search**: Dify API, Serper API, `google-genai`
- **Frontend**: HTML, CSS, Vanilla JavaScript, Chart.js

## 프로젝트 구조

```text
investment-assistant/
├── app.py              # Flask 서버 및 API 라우트
├── collector.py        # 네이버 금융 및 Serper 뉴스 데이터 수집기
├── quant.py            # 몬테카를로 리밸런싱 및 기술지표(MA, RSI, MACD, 볼린저밴드) 계산
├── dify_client.py      # Dify 챗봇 API 클라이언트
├── requirements.txt    # Python 의존성 목록
├── .env.example        # 환경변수 템플릿
├── templates/
│   ├── index.html      # 3탭 메인 웹앱 화면
│   └── test.html       # 수집기 단독 테스트 화면
└── static/
    ├── app.js          # 메인 웹앱 프론트엔드 로직
    ├── test.js         # 테스트 화면 로직
    └── style.css       # 스타일시트
```

## 시작하기

### 1. 가상환경 생성 및 패키지 설치

```bash
python -m venv venv
```

- **Windows (PowerShell)**:
  ```powershell
  .\venv\Scripts\Activate.ps1
  pip install -r requirements.txt
  ```
- **macOS / Linux**:
  ```bash
  source venv/bin/activate
  pip install -r requirements.txt
  ```

### 2. 환경변수 설정

`.env.example` 파일을 복사하여 `.env` 파일을 생성한 뒤, 본인의 API 키를 입력합니다.

```bash
cp .env.example .env
```

```env
SERPER_API_KEY=your_serper_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
DIFY_BASE_URL=https://api.dify.ai/v1
DIFY_ANALYSIS_API_KEY=your_dify_analysis_api_key_here
DIFY_TECHNICAL_API_KEY=your_dify_technical_api_key_here
FLASK_DEBUG=true
```

### 3. 서버 실행

```bash
python app.py
```

실행 후 브라우저에서 `http://localhost:5000`으로 접속합니다. (기본 포트: `5000`, 환경변수 `PORT`로 변경 가능)

## 주의사항

- `.env` 파일과 `venv/` 디렉터리는 `.gitignore`에 의해 Git 추적에서 제외됩니다. API 키 등 민감한 정보는 절대 저장소에 커밋하지 마세요.
- 본 서비스는 객관적 데이터와 지표 기반의 정보 제공을 목적으로 하며, 직접적인 투자 권유가 아닙니다.
