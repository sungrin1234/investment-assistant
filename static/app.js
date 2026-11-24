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

    let evPriceChart = null;
    let evEtfChart = null;
    let evEtfDivChart = null;
    let evFinChart = null;

    // 탭1 수집 근거 서브탭 전환
    document.querySelectorAll(".evidence-subtab-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const target = btn.dataset.subtab;
            document.querySelectorAll(".evidence-subtab-btn").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            document.querySelectorAll(".evidence-subpanel").forEach((p) => p.classList.add("hidden"));
            const panel = document.getElementById(`ev-panel-${target}`);
            if (panel) panel.classList.remove("hidden");
            if (target === "company" && evPriceChart) evPriceChart.resize();
            if (target === "company" && evEtfChart) evEtfChart.resize();
            if (target === "company" && evEtfDivChart) evEtfDivChart.resize();
            if (target === "financial" && evFinChart) evFinChart.resize();
        });
    });

    function renderEvidenceBox(ev) {
        const box = document.getElementById("tab1-evidence-box");
        const summary = document.getElementById("tab1-evidence-summary");
        const cardsEl = document.getElementById("tab1-evidence-cards");
        const newsEl = document.getElementById("tab1-evidence-news");

        // 새 종목 조회 시 기본 서브탭(요약 & 뉴스)으로 초기화
        document.querySelectorAll(".evidence-subtab-btn").forEach((b) => {
            b.classList.toggle("active", b.dataset.subtab === "summary");
        });
        document.querySelectorAll(".evidence-subpanel").forEach((p) => {
            p.classList.toggle("hidden", p.id !== "ev-panel-summary");
        });

        const snap = ev.snapshot || {};
        const currency = ev.currency || "KRW";
        const details = ev.details || {};
        const isEtf = Boolean(ev.is_etf);
        const tables = details.financial_tables || {};
        const hasFinTables = Boolean(tables.annual || tables.quarter);

        // ETF 여부에 따라 서브탭 라벨 및 재무분석 탭 표시 동적 조정
        document.querySelectorAll(".evidence-subtab-btn").forEach((b) => {
            if (b.dataset.subtab === "company") {
                b.textContent = isEtf ? "상품현황 · 구성" : "기업현황";
            } else if (b.dataset.subtab === "overview") {
                b.textContent = isEtf ? "상품개요" : "기업개요";
            } else if (b.dataset.subtab === "financial") {
                b.textContent = "재무분석";
                b.classList.toggle("hidden", isEtf && !hasFinTables);
            }
        });

        const price = formatPrice(snap.current_price, currency);
        const rate = snap.change_rate != null ? `${snap.change_rate > 0 ? "+" : ""}${snap.change_rate}%` : "-";
        const mcap = formatMarketCap(snap.market_cap, currency);
        const per = snap.per != null ? `${snap.per}배` : "-";
        const pbr = snap.pbr != null ? `${snap.pbr}배` : "-";

        summary.textContent = `${ev.name} (${ev.code})`;
        const marketBadge = document.getElementById("tab1-evidence-market");
        if (marketBadge) {
            const marketLabel = ev.market || (currency === "USD" ? "US" : "KR");
            marketBadge.textContent = isEtf ? `${marketLabel} · ${currency} · ETF` : `${marketLabel} · ${currency}`;
            marketBadge.classList.remove("hidden");
        }

        cardsEl.innerHTML = "";
        const etfInfo = details.etf_info;
        const etfConst = details.etf_constituents;
        const items = isEtf
            ? [
                { label: "현재가", value: `${price} (${rate})` },
                { label: "시가총액", value: mcap },
                {
                    label: "총보수 / 괴리율",
                    value: etfInfo
                        ? `${etfInfo.total_fee != null ? etfInfo.total_fee + "%" : "-"} / ${etfInfo.deviation_rate != null ? etfInfo.deviation_rate + "%" : "-"}`
                        : `${per} / ${pbr}`,
                },
                {
                    label: "구성종목",
                    value: etfConst && etfConst.total_count
                        ? `${etfConst.total_count}개 종목`
                        : (etfInfo && etfInfo.nav ? `NAV ${etfInfo.nav}` : "-"),
                },
            ]
            : [
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

        renderCompanyTab(ev, details);
        renderOverviewTab(ev, details);
        renderFinancialTab(ev, details);

        box.classList.remove("hidden");
    }

    function _makeChip(label, value) {
        const chip = document.createElement("div");
        chip.className = "evidence-chip";
        const lbl = document.createElement("span");
        lbl.textContent = label;
        const val = document.createElement("strong");
        val.textContent = value || "-";
        chip.appendChild(lbl);
        chip.appendChild(val);
        return chip;
    }

    function renderCompanyTab(ev, details) {
        const container = document.getElementById("tab1-company-content");
        if (!container) return;
        container.innerHTML = "";

        const ph = details.price_history || {};
        if ((ph.dates || []).length > 0 && typeof Chart !== "undefined") {
            const chartSec = document.createElement("div");
            chartSec.className = "detail-section";
            chartSec.innerHTML = `<div class="detail-section-title">📈 최근 ${ph.dates.length}거래일 주가 추이 (${ev.currency || "KRW"})</div>`;
            const card = document.createElement("div");
            card.className = "evidence-chart-card";
            const box = document.createElement("div");
            box.className = "evidence-chart-box";
            const canvas = document.createElement("canvas");
            box.appendChild(canvas);
            card.appendChild(box);
            chartSec.appendChild(card);
            container.appendChild(chartSec);

            if (evPriceChart) evPriceChart.destroy();
            evPriceChart = new Chart(canvas, {
                type: "line",
                data: {
                    labels: ph.dates,
                    datasets: [{
                        label: `${ev.name} 종가`,
                        data: ph.closes,
                        borderColor: "#2563eb",
                        backgroundColor: "rgba(37, 99, 235, 0.08)",
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        fill: true,
                        tension: 0.2,
                    }],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { maxTicksLimit: 6, font: { size: 11 } }, grid: { display: false } },
                        y: { ticks: { font: { size: 11 } } },
                    },
                },
            });
        }

        const m = details.metrics || {};

        // 당일 시세 & 거래 현황
        const tradePairs = [
            ["전일 / 시가", m.prev_close || m.open_price ? `${m.prev_close || "-"} / ${m.open_price || "-"}` : null],
            ["고가 / 저가", m.high_price || m.low_price ? `${m.high_price || "-"} / ${m.low_price || "-"}` : null],
            ["거래량", m.volume],
            ["거래대금", m.trading_value],
            ["52주 최고 / 최저", m.high_52w || m.low_52w ? `${m.high_52w || "-"} / ${m.low_52w || "-"}` : null],
            ["외국인 소진율", m.foreign_rate],
            ["발행주식 / 유동비율", m.shares_float],
            ["기간 수익률 (1M/3M/6M/1Y)", m.returns_period],
        ].filter(([, v]) => v);

        if (tradePairs.length > 0) {
            const secTrade = document.createElement("div");
            secTrade.className = "detail-section";
            secTrade.innerHTML = `<div class="detail-section-title">💹 시세 · 거래 · 수익률 현황</div>`;
            const tGrid = document.createElement("div");
            tGrid.className = "detail-grid";
            tradePairs.forEach(([k, v]) => tGrid.appendChild(_makeChip(k, v)));
            secTrade.appendChild(tGrid);
            container.appendChild(secTrade);
        }

        // 주요 투자·밸류에이션 지표
        const valPairs = [
            ["업종", m.industry],
            ["EPS / BPS", m.eps || m.bps ? `${m.eps || "-"} / ${m.bps || "-"}` : null],
            ["추정 PER / EPS", m.cns_per || m.cns_eps ? `${m.cns_per || "-"} / ${m.cns_eps || "-"}` : null],
            ["배당 / 수익률", m.dividend || m.dividend_yield ? `${m.dividend || "-"} (${m.dividend_yield || "-"})` : null],
            ["EV/EBITDA", m.ev_ebitda],
            ["PCR", m.pcr],
            ["52주 베타", m.beta],
            ["액면가 / 액면분할", m.face_value || m.split_info],
            ["배당락일 / 배당일", m.ex_dividend_date || m.dividend_date ? `${m.ex_dividend_date || "-"} / ${m.dividend_date || "-"}` : null],
        ].filter(([, v]) => v);

        if (valPairs.length > 0) {
            const sec1 = document.createElement("div");
            sec1.className = "detail-section";
            sec1.innerHTML = `<div class="detail-section-title">📊 주요 투자 · 밸류에이션 지표</div>`;
            const grid = document.createElement("div");
            grid.className = "detail-grid";
            valPairs.forEach(([k, v]) => grid.appendChild(_makeChip(k, v)));
            sec1.appendChild(grid);
            container.appendChild(sec1);
        }

        // ETF 핵심 지표 (운용사, NAV, 총보수, 괴리율, 수익률)
        if (details.etf_info) {
            const ei = details.etf_info;
            const etfPairs = [
                ["운용사", ei.issuer],
                ["NAV / 순자산총액", ei.nav || ei.total_nav ? `${ei.nav || "-"} / ${ei.total_nav || "-"}` : null],
                ["총보수 / 괴리율", `${ei.total_fee != null ? ei.total_fee + "%" : "-"} / ${ei.deviation_rate != null ? ei.deviation_rate + "%" : "-"}`],
                ["ETF 수익률 (1M/3M/1Y)", `${ei.return_1m ?? "-"}% / ${ei.return_3m ?? "-"}% / ${ei.return_1y ?? "-"}%`],
            ].filter(([, v]) => v);

            if (etfPairs.length > 0) {
                const secEtf = document.createElement("div");
                secEtf.className = "detail-section";
                secEtf.innerHTML = `<div class="detail-section-title">🏷️ ETF 운용 · 수익률 정보</div>`;
                const eGrid = document.createElement("div");
                eGrid.className = "detail-grid";
                etfPairs.forEach(([k, v]) => eGrid.appendChild(_makeChip(k, v)));
                secEtf.appendChild(eGrid);
                container.appendChild(secEtf);
            }
        }

        // ETF 배당(분배금) 정보 & 지급 내역
        if (details.etf_dividend) {
            const ed = details.etf_dividend;
            const secD = document.createElement("div");
            secD.className = "detail-section";
            secD.innerHTML = `<div class="detail-section-title">💰 ETF 배당(분배금) 정보</div>`;

            const divPairs = [
                ["연간 배당률 (TTM)", ed.yield_ttm != null ? `${ed.yield_ttm}%` : null],
                ["연간 주당 분배금 (TTM)", ed.dps_ttm != null ? `${Number(ed.dps_ttm).toLocaleString()}원` : null],
                [
                    "올해 배당 횟수 / 배당월",
                    ed.count_this_year
                        ? `${ed.count_this_year}회${ed.months_this_year ? ` (${ed.months_this_year}월)` : ""}`
                        : null,
                ],
                [
                    "최근 배당락일 / 분배금",
                    ed.recent_ex_date
                        ? `${ed.recent_ex_date} / ${ed.recent_amount ? Number(ed.recent_amount).toLocaleString() + "원" : "-"}${ed.recent_yield ? ` (${ed.recent_yield}%)` : ""}`
                        : null,
                ],
            ].filter(([, v]) => v);

            if (divPairs.length > 0) {
                const dGrid = document.createElement("div");
                dGrid.className = "detail-grid";
                dGrid.style.marginBottom = "10px";
                divPairs.forEach(([k, v]) => dGrid.appendChild(_makeChip(k, v)));
                secD.appendChild(dGrid);
            }

            const hist = ed.history || [];
            if (hist.length > 0) {
                if (typeof Chart !== "undefined") {
                    const ordered = [...hist].reverse();
                    const chartCard = document.createElement("div");
                    chartCard.className = "evidence-chart-card";
                    const chartBox = document.createElement("div");
                    chartBox.className = "evidence-chart-box";
                    const canvas = document.createElement("canvas");
                    chartBox.appendChild(canvas);
                    chartCard.appendChild(chartBox);
                    secD.appendChild(chartCard);

                    if (evEtfDivChart) evEtfDivChart.destroy();
                    evEtfDivChart = new Chart(canvas, {
                        type: "bar",
                        data: {
                            labels: ordered.map((h) => h.ex_date),
                            datasets: [{
                                label: "주당 분배금 (원)",
                                data: ordered.map((h) => Number(String(h.amount || "0").replace(/,/g, ""))),
                                backgroundColor: "rgba(16, 185, 129, 0.8)",
                                borderRadius: 4,
                            }],
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: { legend: { display: false } },
                            scales: {
                                x: { grid: { display: false }, ticks: { font: { size: 11 } } },
                                y: { ticks: { font: { size: 11 } } },
                            },
                        },
                    });
                }

                const wrap = document.createElement("div");
                wrap.className = "table-wrapper";
                const table = document.createElement("table");
                table.className = "financials-table";
                table.innerHTML = "<thead><tr><th>배당락일</th><th>주당 분배금</th><th>배당률</th></tr></thead>";
                const tbody = document.createElement("tbody");
                hist.forEach((h) => {
                    const tr = document.createElement("tr");
                    const tdDate = document.createElement("td");
                    tdDate.textContent = h.ex_date || "-";
                    const tdAmt = document.createElement("td");
                    tdAmt.style.fontWeight = "600";
                    tdAmt.textContent = h.amount != null ? `${Number(String(h.amount).replace(/,/g, "")).toLocaleString()}원` : "-";
                    const tdY = document.createElement("td");
                    tdY.textContent = h.yield != null ? `${h.yield}%` : "-";
                    tr.appendChild(tdDate);
                    tr.appendChild(tdAmt);
                    tr.appendChild(tdY);
                    tbody.appendChild(tr);
                });
                table.appendChild(tbody);
                wrap.appendChild(table);
                secD.appendChild(wrap);
            }

            container.appendChild(secD);
        }

        // ETF 구성종목 (비중 차트 + 테이블)
        if (details.etf_constituents && (details.etf_constituents.holdings || []).length > 0) {
            const ec = details.etf_constituents;
            const holdings = ec.holdings;
            const secH = document.createElement("div");
            secH.className = "detail-section";
            secH.innerHTML = `<div class="detail-section-title">🧩 ETF 구성종목 (전체 ${ec.total_count || holdings.length}개 중 상위 ${holdings.length}개 · 비중 합계 ${ec.total_weight ?? "-"}%)</div>`;

            // 상위 10개 비중 가로 막대 차트
            if (typeof Chart !== "undefined") {
                const top10 = holdings.slice(0, 10);
                const chartCard = document.createElement("div");
                chartCard.className = "evidence-chart-card";
                const chartBox = document.createElement("div");
                chartBox.className = "evidence-chart-box";
                const canvas = document.createElement("canvas");
                chartBox.appendChild(canvas);
                chartCard.appendChild(chartBox);
                secH.appendChild(chartCard);

                if (evEtfChart) evEtfChart.destroy();
                evEtfChart = new Chart(canvas, {
                    type: "bar",
                    data: {
                        labels: top10.map((h) => h.name || h.code),
                        datasets: [{
                            label: "구성 비중 (%)",
                            data: top10.map((h) => h.weight),
                            backgroundColor: "rgba(37, 99, 235, 0.78)",
                            borderRadius: 4,
                        }],
                    },
                    options: {
                        indexAxis: "y",
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                            x: { ticks: { callback: (v) => `${v}%`, font: { size: 11 } } },
                            y: { grid: { display: false }, ticks: { font: { size: 11 } } },
                        },
                    },
                });
            }

            // 구성종목 테이블
            const wrap = document.createElement("div");
            wrap.className = "table-wrapper";
            const table = document.createElement("table");
            table.className = "financials-table";
            table.innerHTML = "<thead><tr><th>순위</th><th>종목명 (코드)</th><th>구성비중</th><th>1CU당 수량</th></tr></thead>";
            const tbody = document.createElement("tbody");
            holdings.forEach((h, idx) => {
                const tr = document.createElement("tr");
                const tdRank = document.createElement("td");
                tdRank.textContent = String(idx + 1);
                const tdName = document.createElement("td");
                tdName.style.fontWeight = "600";
                tdName.textContent = `${h.name || "-"} (${h.code || "-"})`;
                const tdW = document.createElement("td");
                tdW.textContent = h.weight != null ? `${h.weight}%` : "-";
                const tdQ = document.createElement("td");
                tdQ.textContent = h.quantity != null ? `${Number(h.quantity).toLocaleString()} ${h.unit || "주"}` : "-";
                tr.appendChild(tdRank);
                tr.appendChild(tdName);
                tr.appendChild(tdW);
                tr.appendChild(tdQ);
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            wrap.appendChild(table);
            secH.appendChild(wrap);
            container.appendChild(secH);
        }

        if (details.consensus) {
            const c = details.consensus;
            const secC = document.createElement("div");
            secC.className = "detail-section";
            secC.innerHTML = `<div class="detail-section-title">🎯 증권사 컨센서스</div>`;
            const cGrid = document.createElement("div");
            cGrid.className = "detail-grid";
            cGrid.appendChild(_makeChip("목표주가", c.target_price || "-"));
            cGrid.appendChild(_makeChip("투자의견 점수", c.recomm_mean ? `${c.recomm_mean} / 5.0` : "-"));
            cGrid.appendChild(_makeChip("기준일", c.create_date || "-"));
            secC.appendChild(cGrid);
            container.appendChild(secC);
        }

        const peers = details.peers || [];
        if (peers.length > 0) {
            const secP = document.createElement("div");
            secP.className = "detail-section";
            secP.innerHTML = `<div class="detail-section-title">🏢 동종업계 비교</div>`;
            const ul = document.createElement("ul");
            ul.className = "detail-list";
            peers.forEach((p) => {
                const li = document.createElement("li");
                li.className = "detail-list-item";
                const left = document.createElement("strong");
                left.textContent = `${p.name || "-"} (${p.code || "-"})`;
                const right = document.createElement("span");
                const rVal = p.change_rate != null ? `${Number(p.change_rate) > 0 ? "+" : ""}${p.change_rate}%` : "-";
                right.textContent = `${p.close_price || "-"} (${rVal})`;
                li.appendChild(left);
                li.appendChild(right);
                ul.appendChild(li);
            });
            secP.appendChild(ul);
            container.appendChild(secP);
        }

        const reports = details.reports || [];
        if (reports.length > 0) {
            const secR = document.createElement("div");
            secR.className = "detail-section";
            secR.innerHTML = `<div class="detail-section-title">📑 최근 증권사 리포트</div>`;
            const ul = document.createElement("ul");
            ul.className = "detail-list";
            reports.forEach((r) => {
                const li = document.createElement("li");
                li.className = "detail-list-item";
                const left = document.createElement("span");
                left.textContent = r.title || "-";
                const right = document.createElement("span");
                right.style.color = "#64748b";
                right.textContent = `${r.broker || ""} ${r.date || ""}`.trim();
                li.appendChild(left);
                li.appendChild(right);
                ul.appendChild(li);
            });
            secR.appendChild(ul);
            container.appendChild(secR);
        }

        const trends = details.investor_trends || [];
        if (trends.length > 0) {
            const secT = document.createElement("div");
            secT.className = "detail-section";
            secT.innerHTML = `<div class="detail-section-title">👥 최근 투자자별 순매수 (주)</div>`;
            const wrap = document.createElement("div");
            wrap.className = "table-wrapper";
            const table = document.createElement("table");
            table.className = "financials-table";
            table.innerHTML = "<thead><tr><th>일자</th><th>외국인</th><th>기관</th><th>개인</th><th>외국인 보유율</th></tr></thead>";
            const tbody = document.createElement("tbody");
            trends.forEach((t) => {
                const tr = document.createElement("tr");
                [t.date, t.foreigner, t.organ, t.individual, t.foreigner_ratio].forEach((val) => {
                    const td = document.createElement("td");
                    td.textContent = val || "-";
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            wrap.appendChild(table);
            secT.appendChild(wrap);
            container.appendChild(secT);
        }
    }

    function renderOverviewTab(ev, details) {
        const container = document.getElementById("tab1-overview-content");
        if (!container) return;
        container.innerHTML = "";

        const m = details.metrics || {};
        const isEtf = Boolean(ev.is_etf);
        const grid = document.createElement("div");
        grid.className = "detail-grid";
        grid.style.marginBottom = "12px";
        const overviewMeta = isEtf
            ? [
                ["운용사", (details.etf_info && details.etf_info.issuer) || "-"],
                ["거래소", details.exchange || (ev.market === "US" ? "US" : "KRX")],
                ["NAV", (details.etf_info && details.etf_info.nav) || "-"],
                ["통화", ev.currency || "-"],
            ]
            : [
                ["영문명", details.name_eng || "-"],
                ["거래소", details.exchange || (ev.market === "US" ? "US" : "KRX")],
                ["업종", m.industry || "-"],
                ["통화", ev.currency || "-"],
            ];
        overviewMeta.forEach(([k, v]) => grid.appendChild(_makeChip(k, v)));
        container.appendChild(grid);

        const box = document.createElement("div");
        box.className = "overview-text-box";
        box.style.whiteSpace = "pre-line";
        if (details.overview_summary) {
            box.textContent = details.overview_summary;
        } else {
            box.textContent = isEtf
                ? "해당 ETF의 상세 상품개요 텍스트가 제공되지 않습니다. '상품현황 · 구성' 탭에서 운용 정보와 구성종목을 확인하실 수 있습니다."
                : "해당 종목의 기업개요 정보가 제공되지 않습니다.";
        }
        container.appendChild(box);
    }

    function renderFinancialTab(ev, details) {
        const container = document.getElementById("tab1-financial-content");
        if (!container) return;
        container.innerHTML = "";

        const tables = details.financial_tables || {};
        let currentMode = tables.annual ? "annual" : (tables.quarter ? "quarter" : null);
        if (!currentMode) {
            container.innerHTML = `<p class="empty-msg">수집된 재무분석 데이터가 없습니다. (ETF 또는 미제공 종목)</p>`;
            return;
        }

        const headerRow = document.createElement("div");
        headerRow.className = "fin-toggle-row";

        const btns = document.createElement("div");
        btns.className = "fin-toggle-btns";

        const unitEl = document.createElement("span");
        unitEl.className = "section-note";

        const chartCard = document.createElement("div");
        chartCard.className = "evidence-chart-card";
        const chartBox = document.createElement("div");
        chartBox.className = "evidence-chart-box";
        const chartCanvas = document.createElement("canvas");
        chartBox.appendChild(chartCanvas);
        chartCard.appendChild(chartBox);

        const tableWrap = document.createElement("div");
        tableWrap.className = "table-wrapper";

        function _parseCellNum(v) {
            if (v === null || v === undefined || v === "-") return null;
            const n = Number(String(v).replace(/,/g, ""));
            return Number.isFinite(n) ? n : null;
        }

        function drawTable(mode) {
            const tblData = tables[mode];
            tableWrap.innerHTML = "";
            if (!tblData || !(tblData.rows || []).length) {
                unitEl.textContent = "";
                chartCard.classList.add("hidden");
                tableWrap.innerHTML = `<p class="empty-msg">해당 기간의 재무 데이터가 없습니다.</p>`;
                return;
            }
            unitEl.textContent = `단위: ${tblData.unit || "-"}`;

            // 차트 렌더링 (매출액, 영업이익/EBIT, 당기순이익)
            const rowMap = {};
            (tblData.rows || []).forEach((r) => { rowMap[r.title] = r.values || []; });
            const revArr = (rowMap["매출액"] || []).map(_parseCellNum);
            const opArr = (rowMap["영업이익"] || rowMap["EBIT"] || []).map(_parseCellNum);
            const netArr = (rowMap["당기순이익"] || []).map(_parseCellNum);
            const labels = (tblData.periods || []).map((p) => (p.is_consensus ? `${p.title}(E)` : p.title));

            if (typeof Chart !== "undefined" && labels.length > 0 && (revArr.some((v) => v !== null) || opArr.some((v) => v !== null))) {
                chartCard.classList.remove("hidden");
                if (evFinChart) evFinChart.destroy();
                const datasets = [];
                if (revArr.some((v) => v !== null)) {
                    datasets.push({
                        label: "매출액",
                        data: revArr,
                        backgroundColor: "rgba(37, 99, 235, 0.78)",
                        borderRadius: 4,
                    });
                }
                if (opArr.some((v) => v !== null)) {
                    datasets.push({
                        label: rowMap["영업이익"] ? "영업이익" : "EBIT",
                        data: opArr,
                        backgroundColor: "rgba(16, 185, 129, 0.8)",
                        borderRadius: 4,
                    });
                }
                if (netArr.some((v) => v !== null)) {
                    datasets.push({
                        label: "당기순이익",
                        data: netArr,
                        backgroundColor: "rgba(245, 158, 11, 0.8)",
                        borderRadius: 4,
                    });
                }
                evFinChart = new Chart(chartCanvas, {
                    type: "bar",
                    data: { labels, datasets },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { position: "top", labels: { boxWidth: 12, font: { size: 11 } } },
                        },
                        scales: {
                            x: { grid: { display: false }, ticks: { font: { size: 11 } } },
                            y: { ticks: { font: { size: 11 } } },
                        },
                    },
                });
            } else {
                chartCard.classList.add("hidden");
            }

            const table = document.createElement("table");
            table.className = "financials-table";

            const thead = document.createElement("thead");
            const headTr = document.createElement("tr");
            const firstTh = document.createElement("th");
            firstTh.textContent = "주요 재무항목";
            headTr.appendChild(firstTh);
            (tblData.periods || []).forEach((p) => {
                const th = document.createElement("th");
                th.textContent = p.is_consensus ? `${p.title} (E)` : p.title;
                headTr.appendChild(th);
            });
            thead.appendChild(headTr);
            table.appendChild(thead);

            const tbody = document.createElement("tbody");
            (tblData.rows || []).forEach((r) => {
                const tr = document.createElement("tr");
                const titleTd = document.createElement("td");
                titleTd.style.fontWeight = "600";
                titleTd.textContent = r.title || "-";
                tr.appendChild(titleTd);
                (r.values || []).forEach((v) => {
                    const td = document.createElement("td");
                    td.textContent = v || "-";
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            tableWrap.appendChild(table);
        }

        [
            { key: "annual", label: "연간 실적" },
            { key: "quarter", label: "분기 실적" },
        ].forEach((opt) => {
            if (!tables[opt.key]) return;
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = `fin-toggle-btn ${opt.key === currentMode ? "active" : ""}`;
            btn.textContent = opt.label;
            btn.addEventListener("click", () => {
                btns.querySelectorAll(".fin-toggle-btn").forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                drawTable(opt.key);
            });
            btns.appendChild(btn);
        });

        headerRow.appendChild(btns);
        headerRow.appendChild(unitEl);
        container.appendChild(headerRow);
        container.appendChild(chartCard);
        container.appendChild(tableWrap);
        drawTable(currentMode);
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
        closeEl.textContent = formatPrice(l.close, data.currency || "KRW");
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

    function formatPrice(val, currency = "KRW") {
        if (val === null || val === undefined) return "-";
        const num = Number(val);
        if (currency === "USD") {
            return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
        return `${num.toLocaleString()}원`;
    }

    function formatMarketCap(val, currency = "KRW") {
        if (val === null || val === undefined) return "-";
        if (currency === "USD") {
            const num = Number(val);
            if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
            if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
            if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
            return `$${num.toLocaleString()}`;
        }
        const eok = Math.round(val / 1e8);
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
