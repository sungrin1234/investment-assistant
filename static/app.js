document.addEventListener("DOMContentLoaded", () => {
    console.log("[PAGE]    페이지 로드 완료");

    const searchForm = document.getElementById("search-form");
    const codeInput = document.getElementById("stock-code-input");
    const fetchBtn = document.getElementById("fetch-btn");
    const statusBanner = document.getElementById("status-banner");
    const resultContainer = document.getElementById("result-container");
    const warningsBox = document.getElementById("warnings-box");

    // 예시 종목 버튼 클릭 이벤트
    document.querySelectorAll(".example-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const code = btn.getAttribute("data-code");
            codeInput.value = code;
            handleSearch(code);
        });
    });

    // 검색 폼 제출 이벤트
    searchForm.addEventListener("submit", (event) => {
        event.preventDefault();
        handleSearch(codeInput.value.trim());
    });

    async function handleSearch(rawCode) {
        const code = (rawCode || "").trim();

        if (!code) {
            showBanner("종목코드를 입력해 주세요.", "error");
            console.error("[ERROR]   수집 중 오류 발생 (종목코드 미입력)");
            return;
        }
        if (!/^\d{6}$/.test(code)) {
            showBanner("종목코드는 6자리 숫자여야 합니다. (예: 000660)", "error");
            console.error(`[ERROR]   수집 중 오류 발생 (6자리 숫자 아님: ${code})`);
            return;
        }

        console.log(`[SEARCH]  종목 수집 요청 시작 (${code})`);
        setLoading(true);
        showBanner(`'${code}' 종목 데이터를 수집하고 있습니다...`, "loading");

        try {
            const response = await fetch("/fetch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code }),
            });

            const data = await response.json();

            if (!response.ok) {
                const errMsg = data.error || `요청 실패 (HTTP ${response.status})`;
                throw new Error(errMsg);
            }

            const currentPrice = data.snapshot ? data.snapshot.current_price : null;
            console.log(`[PARSED]  기본 정보 수집 완료 (${data.name}, ${currentPrice})`);
            console.log(`[NEWS]    뉴스 수집 완료 (${(data.news || []).length}건)`);

            hideBanner();
            renderDashboard(data);
            console.log("[RENDER]  화면 데이터 카드 렌더링 완료");
        } catch (err) {
            console.error(`[ERROR]   수집 중 오류 발생 (${err.message})`);
            showBanner(err.message || "데이터 수집 중 오류가 발생했습니다.", "error");
            resultContainer.classList.add("hidden");
        } finally {
            setLoading(false);
        }
    }

    function setLoading(isLoading) {
        fetchBtn.disabled = isLoading;
        fetchBtn.textContent = isLoading ? "수집 중..." : "데이터 수집";
    }

    function showBanner(message, type) {
        statusBanner.textContent = message;
        statusBanner.className = `status-banner ${type}`;
    }

    function hideBanner() {
        statusBanner.className = "status-banner hidden";
        statusBanner.textContent = "";
    }

    function renderDashboard(data) {
        resultContainer.classList.remove("hidden");

        // 부분 오류 안내
        if (data.errors && data.errors.length > 0) {
            warningsBox.innerHTML = "";
            const title = document.createElement("strong");
            title.textContent = "일부 데이터 수집 중 알림: ";
            warningsBox.appendChild(title);

            const msgs = data.errors.map((e) => `[${e.section}] ${e.message}`).join(" / ");
            warningsBox.appendChild(document.createTextNode(msgs));
            warningsBox.classList.remove("hidden");
        } else {
            warningsBox.classList.add("hidden");
            warningsBox.textContent = "";
        }

        renderSnapshot(data);
        renderFinancials(data.financials || []);
        renderNews(data.news || []);
    }

    function renderSnapshot(data) {
        const snap = data.snapshot || {};
        document.getElementById("stock-name").textContent = data.name || "-";
        document.getElementById("stock-code-badge").textContent = data.code || "-";

        const priceEl = document.getElementById("current-price");
        const rateEl = document.getElementById("change-rate");

        priceEl.textContent = snap.current_price !== null && snap.current_price !== undefined
            ? `${Number(snap.current_price).toLocaleString()}원`
            : "-";

        priceEl.className = "current-price";
        rateEl.className = "change-rate";

        if (snap.change_rate !== null && snap.change_rate !== undefined) {
            const rate = Number(snap.change_rate);
            if (rate > 0) {
                rateEl.textContent = `+${rate.toFixed(2)}%`;
                priceEl.classList.add("up");
                rateEl.classList.add("up");
            } else if (rate < 0) {
                rateEl.textContent = `${rate.toFixed(2)}%`;
                priceEl.classList.add("down");
                rateEl.classList.add("down");
            } else {
                rateEl.textContent = "0.00%";
                priceEl.classList.add("flat");
                rateEl.classList.add("flat");
            }
        } else {
            rateEl.textContent = "-";
        }

        document.getElementById("market-cap").textContent = formatMarketCap(snap.market_cap);
        document.getElementById("per-value").textContent = snap.per !== null && snap.per !== undefined ? `${snap.per}배` : "-";
        document.getElementById("pbr-value").textContent = snap.pbr !== null && snap.pbr !== undefined ? `${snap.pbr}배` : "-";
    }

    function renderFinancials(financials) {
        const tbody = document.getElementById("financials-tbody");
        const emptyMsg = document.getElementById("financials-empty");
        tbody.innerHTML = "";

        if (!financials.length) {
            emptyMsg.classList.remove("hidden");
            return;
        }
        emptyMsg.classList.add("hidden");

        financials.forEach((item) => {
            const tr = document.createElement("tr");

            const tdPeriod = document.createElement("td");
            tdPeriod.textContent = item.period || "-";
            tr.appendChild(tdPeriod);

            const tdType = document.createElement("td");
            const badge = document.createElement("span");
            badge.className = item.is_consensus ? "badge-consensus" : "badge-actual";
            badge.textContent = item.is_consensus ? "추정(E)" : "확정";
            tdType.appendChild(badge);
            tr.appendChild(tdType);

            const tdRev = document.createElement("td");
            tdRev.textContent = formatEok(item.revenue);
            tr.appendChild(tdRev);

            const tdOp = document.createElement("td");
            tdOp.textContent = formatEok(item.operating_income);
            tr.appendChild(tdOp);

            const tdRoe = document.createElement("td");
            tdRoe.textContent = item.roe !== null && item.roe !== undefined ? `${item.roe}%` : "-";
            tr.appendChild(tdRoe);

            tbody.appendChild(tr);
        });
    }

    function renderNews(newsList) {
        const ul = document.getElementById("news-list");
        const emptyMsg = document.getElementById("news-empty");
        ul.innerHTML = "";

        if (!newsList.length) {
            emptyMsg.classList.remove("hidden");
            return;
        }
        emptyMsg.classList.add("hidden");

        newsList.forEach((article) => {
            const li = document.createElement("li");
            li.className = "news-item";

            const link = document.createElement("a");
            link.className = "news-title";
            link.href = article.url || "#";
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = article.title || "제목 없음";
            li.appendChild(link);

            if (article.published) {
                const meta = document.createElement("div");
                meta.className = "news-meta";
                meta.textContent = article.published;
                li.appendChild(meta);
            }

            if (article.description) {
                const desc = document.createElement("p");
                desc.className = "news-desc";
                desc.textContent = article.description;
                li.appendChild(desc);
            }

            ul.appendChild(li);
        });
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

    function formatEok(won) {
        if (won === null || won === undefined) return "-";
        const eok = Math.round(won / 1e8);
        return `${eok.toLocaleString()}억`;
    }
});
