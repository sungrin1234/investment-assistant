document.addEventListener("DOMContentLoaded", () => {
    let activeTab = "tab1";
    let tab1ConversationId = "";
    let tab3ConversationId = "";
    let currentTechContext = null;

    // Chart.js 인스턴스 관리 (재계산 시 destroy 필요)
    let weightChart = null;
    let scatterChart = null;
    let techPriceChart = null;
    let techRsiChart = null;
    let techMacdChart = null;

    console.log(`[PAGE]       페이지 로드 완료 (현재 활성 탭: ${activeTab})`);
    loadHealthStatus();

    // ==================== 1. 상단 API 상태 체크 ====================
    async function loadHealthStatus() {
        try {
            const res = await fetch("/health");
            const data = await res.json();
            const keys = data.keys || {};
            const container = document.getElementById("api-status-badges");
            container.innerHTML = "";

            const items = [
                { label: "Serper", ok: keys.serper_api_key_configured },
                { label: "Dify 분석①", ok: keys.dify_analysis_api_key_configured },
                { label: "Dify 지표②", ok: keys.dify_technical_api_key_configured },
            ];
            items.forEach((it) => {
                const span = document.createElement("span");
                span.className = `api-badge ${it.ok ? "ok" : "warn"}`;
                span.textContent = `${it.label}: ${it.ok ? "연결됨" : "미설정"}`;
                container.appendChild(span);
            });
        } catch (err) {
            console.error(`[ERROR]      상태 확인 실패 (${err.message})`);
        }
    }

    // ==================== 2. 탭 전환 & 예시 버튼 ====================
    document.querySelectorAll(".tab-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const target = btn.getAttribute("data-tab");
            if (target === activeTab) return;

            document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
            document.querySelectorAll(".tab-panel").forEach((p) => {
                p.classList.remove("active");
                p.classList.add("hidden");
            });

            btn.classList.add("active");
            const panel = document.getElementById(target);
            panel.classList.remove("hidden");
            panel.classList.add("active");

            activeTab = target;
            console.log(`[TAB]        탭 전환 (${target})`);
        });
    });

    document.querySelectorAll(".example-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const targetId = btn.getAttribute("data-target");
            const code = btn.getAttribute("data-code");
            const input = document.getElementById(targetId);
            if (input) {
                input.value = code;
                if (targetId === "tab1-code") {
                    runTab1Analysis(code);
                } else if (targetId === "tab3-code") {
                    document.getElementById("tab3-form").dispatchEvent(new Event("submit"));
                }
            }
        });
    });

    // ==================== 3. [탭1] 종목 심층분석 채팅 ====================
    const tab1Form = document.getElementById("tab1-chat-form");
    const tab1Messages = document.getElementById("tab1-chat-messages");
    const tab1SendBtn = document.getElementById("tab1-send-btn");
    const tab1AnalyzeBtn = document.getElementById("tab1-analyze-btn");

    document.getElementById("tab1-reset-btn").addEventListener("click", () => {
        tab1ConversationId = "";
        tab1Messages.innerHTML = "";
        appendChatMessage(tab1Messages, "bot", "새 대화가 시작되었습니다. 종목코드를 입력하고 '종목 조회 & AI 분석' 버튼을 눌러보세요.");
        document.getElementById("tab1-evidence-box").classList.add("hidden");
    });

    tab1AnalyzeBtn.addEventListener("click", () => {
        const code = document.getElementById("tab1-code").value.trim();
        runTab1Analysis(code);
    });

    async function runTab1Analysis(rawCode) {
        const code = (rawCode || "").trim();
        if (!code) {
            appendChatMessage(tab1Messages, "error", "종목명 또는 6자리 종목코드를 입력해 주세요. (예: SK하이닉스, 000660)");
            console.error("[ERROR]      종목명/코드 미입력");
            return;
        }

        tab1ConversationId = "";
        tab1Messages.innerHTML = "";
        appendChatMessage(tab1Messages, "user", `[${code}] 종목 데이터 수집 및 전문가 심층 분석 요청`);

        tab1AnalyzeBtn.disabled = true;
        tab1AnalyzeBtn.textContent = "수집 & 분석 중...";
        tab1SendBtn.disabled = true;

        console.log(`[COLLECT]    종목 근거 수집 시작 (code=${code})`);
        console.log("[DIFY]       Dify 챗봇 전문가 분석 요청 시작 (bot=analysis)");

        try {
            const res = await fetch("/api/chat/analysis", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code,
                    mode: "analyze",
                    use_tool: true,
                    conversation_id: "",
                }),
            });
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || `요청 실패 (HTTP ${res.status})`);
            }

            if (data.evidence) {
                console.log(`[COLLECT]    종목 근거 수집 완료 (${data.evidence.code}, ${data.evidence.name})`);
                renderEvidenceBox(data.evidence);
            }
            console.log("[DIFY]       Dify 챗봇 전문가 리포트 수신 (bot=analysis)");

            tab1ConversationId = data.conversation_id || "";
            appendChatMessage(
                tab1Messages,
                "bot",
                data.answer,
                "✅ 실시간 수집 근거 기반 전문가 분석 리포트 (아래에서 이어서 질문하세요)"
            );
        } catch (err) {
            console.error(`[ERROR]      탭1 분석 오류 (${err.message})`);
            appendChatMessage(tab1Messages, "error", err.message);
        } finally {
            tab1AnalyzeBtn.disabled = false;
            tab1AnalyzeBtn.textContent = "종목 조회 & AI 분석";
            tab1SendBtn.disabled = false;
        }
    }

    tab1Form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const code = document.getElementById("tab1-code").value.trim();
        const queryInput = document.getElementById("tab1-query");
        const query = queryInput.value.trim();
        const useTool = document.getElementById("tab1-use-tool").checked;

        if (!query) return;

        if (useTool && !tab1ConversationId && !code) {
            appendChatMessage(tab1Messages, "error", "근거 수집 모드에서는 종목명 또는 종목코드를 입력해 주세요.");
            console.error("[ERROR]      종목명/코드 미입력");
            return;
        }

        appendChatMessage(tab1Messages, "user", useTool ? query : `[도구 없음] ${query}`);
        queryInput.value = "";
        tab1SendBtn.disabled = true;
        tab1SendBtn.textContent = "답변 중...";

        console.log("[DIFY]       Dify 챗봇 후속 질문 요청 (bot=analysis)");

        try {
            const res = await fetch("/api/chat/analysis", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code,
                    query,
                    mode: "chat",
                    use_tool: useTool,
                    conversation_id: tab1ConversationId,
                }),
            });
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || `요청 실패 (HTTP ${res.status})`);
            }

            if (data.evidence) {
                console.log(`[COLLECT]    종목 근거 수집 완료 (${data.evidence.code}, ${data.evidence.name})`);
                renderEvidenceBox(data.evidence);
            }
            console.log("[DIFY]       Dify 챗봇 응답 수신 (bot=analysis)");

            tab1ConversationId = data.conversation_id || tab1ConversationId;
            const meta = data.used_tool ? "✅ 수집된 종목 맥락 기반 이어지는 대화" : "⚠️ 수집 도구 없이 일반 AI 답변";
            appendChatMessage(tab1Messages, "bot", data.answer, meta);
        } catch (err) {
            console.error(`[ERROR]      탭1 오류 (${err.message})`);
            appendChatMessage(tab1Messages, "error", err.message);
        } finally {
            tab1SendBtn.disabled = false;
            tab1SendBtn.textContent = "질문하기";
        }
    });

    function renderEvidenceBox(ev) {
        const box = document.getElementById("tab1-evidence-box");
        const summary = document.getElementById("tab1-evidence-summary");
        const cardsEl = document.getElementById("tab1-evidence-cards");
        const newsEl = document.getElementById("tab1-evidence-news");

        const snap = ev.snapshot || {};
        const price = snap.current_price != null ? `${Number(snap.current_price).toLocaleString()}원` : "-";
        const rate = snap.change_rate != null ? `${snap.change_rate > 0 ? "+" : ""}${snap.change_rate}%` : "-";
        const mcap = formatMarketCap(snap.market_cap);
        const per = snap.per != null ? `${snap.per}배` : "-";
        const pbr = snap.pbr != null ? `${snap.pbr}배` : "-";

        summary.textContent = `${ev.name} (${ev.code})`;

        cardsEl.innerHTML = "";
        const items = [
            { label: "현재가", value: `${price} (${rate})` },
            { label: "시가총액", value: mcap },
            { label: "PER / PBR", value: `${per} / ${pbr}` },
            { label: "수집 실적", value: `${(ev.financials || []).length}개년` },
        ];
        items.forEach((it) => {
            const chip = document.createElement("div");
            chip.className = "evidence-chip";
            const lbl = document.createElement("span");
            lbl.textContent = it.label;
            const val = document.createElement("strong");
            val.textContent = it.value;
            chip.appendChild(lbl);
            chip.appendChild(val);
            cardsEl.appendChild(chip);
        });

        newsEl.innerHTML = "";
        const newsList = ev.news || [];
        if (newsList.length > 0) {
            const newsTitle = document.createElement("div");
            newsTitle.className = "evidence-news-title";
            newsTitle.textContent = `📰 반영된 최신 뉴스 (${newsList.length}건)`;
            newsEl.appendChild(newsTitle);

            const ul = document.createElement("ul");
            ul.className = "evidence-news-list";
            newsList.forEach((n) => {
                const li = document.createElement("li");
                const a = document.createElement("a");
                a.href = n.url || "#";
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                a.textContent = n.title || "제목 없음";
                li.appendChild(a);
                ul.appendChild(li);
            });
            newsEl.appendChild(ul);
        }

        box.classList.remove("hidden");
    }

    // ==================== 4. [탭2] 리밸런싱 도우미 (Dify 없음) ====================
    const tab2Form = document.getElementById("tab2-form");
    const tab2Status = document.getElementById("tab2-status");
    const tab2Result = document.getElementById("tab2-result");
    const tab2Btn = document.getElementById("tab2-calc-btn");

    tab2Form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const rawCodes = document.getElementById("tab2-codes").value.trim();

        showBanner(tab2Status, "FinanceDataReader 최근 1년 주가 수집 및 2,000회 몬테카를로 계산 중...", "loading");
        tab2Btn.disabled = true;
        tab2Btn.textContent = "계산 중...";

        try {
            const res = await fetch("/api/rebalance", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ codes: rawCodes }),
            });
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || `계산 실패 (HTTP ${res.status})`);
            }

            console.log(`[QUANT]      FDR 주가 수집 및 몬테카를로 계산 완료 (${data.period_days}일)`);
            hideBanner(tab2Status);
            renderRebalanceResult(data);
            console.log("[CHART]      차트 렌더링 완료 (tab2)");
        } catch (err) {
            console.error(`[ERROR]      탭2 오류 (${err.message})`);
            showBanner(tab2Status, err.message, "error");
            tab2Result.classList.add("hidden");
        } finally {
            tab2Btn.disabled = false;
            tab2Btn.textContent = "최적 비중 계산하기";
        }
    });

    function renderRebalanceResult(data) {
        tab2Result.classList.remove("hidden");

        const opt = data.optimal_portfolio;
        const minv = data.min_volatility_portfolio;
        const eq = data.equal_weight_portfolio;

        document.getElementById("tab2-opt-sharpe").textContent = `샤프지수 ${opt.sharpe_ratio}`;
        document.getElementById("tab2-opt-stats").textContent = `기대수익률 ${opt.expected_return}% / 변동성 ${opt.volatility}%`;

        document.getElementById("tab2-minvol-sharpe").textContent = `변동성 ${minv.volatility}%`;
        document.getElementById("tab2-minvol-stats").textContent = `기대수익률 ${minv.expected_return}% / 샤프 ${minv.sharpe_ratio}`;

        document.getElementById("tab2-eq-sharpe").textContent = `샤프지수 ${eq.sharpe_ratio}`;
        document.getElementById("tab2-eq-stats").textContent = `기대수익률 ${eq.expected_return}% / 변동성 ${eq.volatility}%`;

        document.getElementById("tab2-period-info").textContent = `${data.start_date} ~ ${data.end_date} (${data.period_days}거래일)`;

        // 비중 리스트 & 도넛 차트
        const allocUl = document.getElementById("tab2-allocation-list");
        allocUl.innerHTML = "";
        const labels = [];
        const weights = [];
        const palette = ["#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];

        opt.allocations.forEach((a) => {
            labels.push(`${a.name}`);
            weights.push(a.weight);
            const li = document.createElement("li");
            li.textContent = `${a.name} (${a.code}): ${a.weight}%`;
            allocUl.appendChild(li);
        });

        if (weightChart) weightChart.destroy();
        weightChart = new Chart(document.getElementById("rebalance-weight-chart"), {
            type: "doughnut",
            data: {
                labels,
                datasets: [{
                    data: weights,
                    backgroundColor: palette.slice(0, labels.length),
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: "bottom" } },
            },
        });

        // 효율적 프론티어 산점도
        if (scatterChart) scatterChart.destroy();
        scatterChart = new Chart(document.getElementById("rebalance-scatter-chart"), {
            type: "scatter",
            data: {
                datasets: [
                    {
                        label: "시뮬레이션 포트폴리오",
                        data: data.scatter_points.map((p) => ({ x: p.x, y: p.y })),
                        backgroundColor: "rgba(148, 163, 184, 0.45)",
                        pointRadius: 3,
                    },
                    {
                        label: "최대 샤프지수 (추천)",
                        data: [{ x: opt.volatility, y: opt.expected_return }],
                        backgroundColor: "#ef4444",
                        pointRadius: 8,
                        pointStyle: "star",
                    },
                    {
                        label: "최소 변동성",
                        data: [{ x: minv.volatility, y: minv.expected_return }],
                        backgroundColor: "#2563eb",
                        pointRadius: 7,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { title: { display: true, text: "연환산 변동성 (%)" } },
                    y: { title: { display: true, text: "연환산 기대수익률 (%)" } },
                },
            },
        });

        // 개별 종목 테이블
        const tbody = document.getElementById("tab2-assets-tbody");
        tbody.innerHTML = "";
        data.assets.forEach((asset) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td style="text-align:left; font-weight:600;">${asset.name} (${asset.code})</td>
                <td>${asset.annual_return}%</td>
                <td>${asset.annual_volatility}%</td>
                <td style="color:#d62828;">${asset.mdd}%</td>
            `;
            tbody.appendChild(tr);
        });
    }

    // ==================== 5. [탭3] 기술지표 차트 + 채팅 ====================
    const tab3Form = document.getElementById("tab3-form");
    const tab3Status = document.getElementById("tab3-status");
    const tab3Result = document.getElementById("tab3-result");
    const tab3LoadBtn = document.getElementById("tab3-load-btn");
    const tab3ChatForm = document.getElementById("tab3-chat-form");
    const tab3ChatMessages = document.getElementById("tab3-chat-messages");
    const tab3SendBtn = document.getElementById("tab3-send-btn");

    tab3Form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const code = document.getElementById("tab3-code").value.trim();

        showBanner(tab3Status, `'${code}' 주가 수집 및 기술지표(MA/RSI/MACD/볼린저) 계산 중...`, "loading");
        tab3LoadBtn.disabled = true;
        tab3LoadBtn.textContent = "계산 중...";

        try {
            const res = await fetch("/api/technical", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code }),
            });
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || `계산 실패 (HTTP ${res.status})`);
            }

            console.log(`[QUANT]      FDR 주가 수집 및 기술지표 계산 완료 (${data.code}, ${data.name})`);
            hideBanner(tab3Status);

            // 채팅에 몰래 주입할 최신 수치 보관 + 새 종목이면 대화 초기화
            currentTechContext = {
                code: data.code,
                name: data.name,
                latest: data.latest,
            };
            tab3ConversationId = "";

            renderTechnicalResult(data);
            console.log("[CHART]      차트 렌더링 완료 (tab3)");
        } catch (err) {
            console.error(`[ERROR]      탭3 오류 (${err.message})`);
            showBanner(tab3Status, err.message, "error");
            tab3Result.classList.add("hidden");
        } finally {
            tab3LoadBtn.disabled = false;
            tab3LoadBtn.textContent = "차트 & 지표 계산";
        }
    });

    function renderTechnicalResult(data) {
        tab3Result.classList.remove("hidden");
        const l = data.latest;
        const s = data.series;

        document.getElementById("tab3-stock-name").textContent = `${data.name} (${data.code})`;
        document.getElementById("tab3-latest-date").textContent = `기준일: ${l.date}`;

        const closeEl = document.getElementById("tab3-close-price");
        const pctEl = document.getElementById("tab3-change-pct");
        closeEl.textContent = `${Number(l.close).toLocaleString()}원`;
        pctEl.textContent = `${l.change_pct > 0 ? "+" : ""}${l.change_pct}%`;
        closeEl.className = `current-price ${l.change_pct > 0 ? "up" : l.change_pct < 0 ? "down" : "flat"}`;
        pctEl.className = `change-rate ${l.change_pct > 0 ? "up" : l.change_pct < 0 ? "down" : "flat"}`;

        document.getElementById("tab3-ma-val").textContent =
            `${Number(l.ma5).toLocaleString()} / ${Number(l.ma20).toLocaleString()} / ${Number(l.ma60).toLocaleString()}`;
        document.getElementById("tab3-rsi-val").textContent = `${l.rsi14}`;
        document.getElementById("tab3-macd-val").textContent = `${l.macd} / ${l.macd_signal}`;
        document.getElementById("tab3-bb-val").textContent =
            `${Number(l.bb_lower).toLocaleString()} ~ ${Number(l.bb_upper).toLocaleString()}`;

        // 1. 주가 + MA + 볼린저밴드 차트
        if (techPriceChart) techPriceChart.destroy();
        techPriceChart = new Chart(document.getElementById("tech-price-chart"), {
            type: "line",
            data: {
                labels: s.dates,
                datasets: [
                    { label: "종가", data: s.close, borderColor: "#111827", borderWidth: 2, pointRadius: 0 },
                    { label: "MA5", data: s.ma5, borderColor: "#ef4444", borderWidth: 1.5, pointRadius: 0 },
                    { label: "MA20", data: s.ma20, borderColor: "#f59e0b", borderWidth: 1.5, pointRadius: 0 },
                    { label: "MA60", data: s.ma60, borderColor: "#10b981", borderWidth: 1.5, pointRadius: 0 },
                    { label: "볼린저 상단", data: s.bb_upper, borderColor: "rgba(37,99,235,0.45)", borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
                    { label: "볼린저 하단", data: s.bb_lower, borderColor: "rgba(37,99,235,0.45)", borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: { legend: { position: "bottom" } },
            },
        });

        // 2. RSI 차트
        if (techRsiChart) techRsiChart.destroy();
        techRsiChart = new Chart(document.getElementById("tech-rsi-chart"), {
            type: "line",
            data: {
                labels: s.dates,
                datasets: [
                    { label: "RSI(14)", data: s.rsi14, borderColor: "#8b5cf6", borderWidth: 2, pointRadius: 0 },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { y: { min: 0, max: 100 } },
                plugins: { legend: { position: "bottom" } },
            },
        });

        // 3. MACD 차트
        if (techMacdChart) techMacdChart.destroy();
        techMacdChart = new Chart(document.getElementById("tech-macd-chart"), {
            type: "bar",
            data: {
                labels: s.dates,
                datasets: [
                    { type: "line", label: "MACD", data: s.macd, borderColor: "#2563eb", borderWidth: 1.8, pointRadius: 0 },
                    { type: "line", label: "Signal", data: s.macd_signal, borderColor: "#ef4444", borderWidth: 1.5, pointRadius: 0 },
                    { type: "bar", label: "Histogram", data: s.macd_hist, backgroundColor: "rgba(107, 114, 128, 0.45)" },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: "bottom" } },
            },
        });
    }

    // 탭 3 채팅 전송 (계산된 숫자를 눈에 안 보이게 주입)
    tab3ChatForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const queryInput = document.getElementById("tab3-query");
        const query = queryInput.value.trim();
        if (!query) return;

        if (!currentTechContext) {
            appendChatMessage(tab3ChatMessages, "error", "먼저 상단에서 종목코드를 입력해 차트와 지표를 계산해 주세요.");
            return;
        }

        appendChatMessage(tab3ChatMessages, "user", query);
        queryInput.value = "";
        tab3SendBtn.disabled = true;
        tab3SendBtn.textContent = "설명 중...";

        console.log("[DIFY]       Dify 챗봇 요청 시작 (bot=technical, 숨은 숫자 주입)");

        try {
            const res = await fetch("/api/chat/technical", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code: currentTechContext.code,
                    query,
                    indicators: currentTechContext,
                    conversation_id: tab3ConversationId,
                }),
            });
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || `요청 실패 (HTTP ${res.status})`);
            }

            console.log("[DIFY]       Dify 챗봇 응답 수신 (bot=technical)");
            tab3ConversationId = data.conversation_id || tab3ConversationId;
            appendChatMessage(tab3ChatMessages, "bot", data.answer, `📊 ${currentTechContext.name} 최신 계산 수치 기반 설명`);
        } catch (err) {
            console.error(`[ERROR]      탭3 채팅 오류 (${err.message})`);
            appendChatMessage(tab3ChatMessages, "error", err.message);
        } finally {
            tab3SendBtn.disabled = false;
            tab3SendBtn.textContent = "해설 요청";
        }
    });

    // ==================== 6. 공통 유틸리티 ====================
    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function formatBotMarkdown(rawText) {
        const safe = escapeHtml(rawText || "");
        const lines = safe.split(/\r?\n/);
        const htmlLines = lines.map((line) => {
            let trimmed = line.trim();
            if (!trimmed) return '<div class="md-spacer"></div>';

            // 인라인 강조(**굵게**) 및 인라인 코드(`코드`) 처리
            const applyInline = (s) =>
                s
                    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
                    .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
                    .replace(/\*\*/g, "");

            // 마크다운 제목 (#, ##, ###, ####)
            const headingMatch = trimmed.match(/^#{1,4}\s+(.+)$/);
            if (headingMatch) {
                return `<div class="md-heading">${applyInline(headingMatch[1])}</div>`;
            }

            // 구분선 (---)
            if (/^[-*_]{3,}$/.test(trimmed)) {
                return '<hr class="md-hr">';
            }

            // 불릿 목록 (* 또는 -)
            const listMatch = trimmed.match(/^[-*•]\s+(.+)$/);
            if (listMatch) {
                return `<div class="md-list-item"><span class="md-bullet">•</span><span>${applyInline(listMatch[1])}</span></div>`;
            }

            // 번호 목록 (1. , 2. )
            const numMatch = trimmed.match(/^(\d+\.)\s+(.+)$/);
            if (numMatch) {
                return `<div class="md-list-item"><span class="md-num">${numMatch[1]}</span><span>${applyInline(numMatch[2])}</span></div>`;
            }

            return `<div class="md-line">${applyInline(trimmed)}</div>`;
        });

        return htmlLines.join("");
    }

    function appendChatMessage(container, role, text, metaText = "") {
        const wrapper = document.createElement("div");
        wrapper.className = `chat-msg ${role}`;

        const bubble = document.createElement("div");
        bubble.className = "msg-bubble";
        if (role === "bot") {
            bubble.innerHTML = formatBotMarkdown(text);
        } else {
            bubble.textContent = text;
        }
        wrapper.appendChild(bubble);

        if (metaText) {
            const meta = document.createElement("div");
            meta.className = "msg-meta";
            meta.textContent = metaText;
            wrapper.appendChild(meta);
        }

        container.appendChild(wrapper);
        container.scrollTop = container.scrollHeight;
    }

    function showBanner(el, message, type) {
        el.textContent = message;
        el.className = `status-banner ${type}`;
    }

    function hideBanner(el) {
        el.className = "status-banner hidden";
        el.textContent = "";
    }

    function formatMarketCap(won) {
        if (won === null || won === undefined) return "-";
        const eok = Math.round(won / 1e8);
        const jo = Math.floor(eok / 10000);
        const remainEok = eok % 10000;
        if (jo > 0) {
            return remainEok > 0
                ? `${jo.toLocaleString()}조 ${remainEok.toLocaleString()}억`
                : `${jo.toLocaleString()}조`;
        }
        return `${eok.toLocaleString()}억`;
    }
});
