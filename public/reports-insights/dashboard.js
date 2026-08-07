// AI Enhanced Financial Insights Dashboard
//
// This file runs inside a sandboxed iframe with `sandbox="allow-scripts
// allow-downloads"` and NO `allow-same-origin` (see
// src/features/reports/components/EnhancedInsightsDashboard.tsx). That
// deliberately gives this document an opaque origin: `window.location.origin`
// reads as the literal string "null" here, so any `event.origin === ...`
// or `postMessage(msg, window.location.origin)` check is broken by
// construction.
//
// Transport: a private MessageChannel, not repeated window.postMessage.
// The parent hands this document one MessagePort in a single handshake
// message (WARDHAH_CHANNEL_INIT) — the only postMessage(..., '*') on
// either side of this boundary, unavoidable because an opaque origin can't
// be targeted any other way, and it carries no data, only the channel.
// Every KPI/insight message after that travels over the port instead:
// MessagePort.postMessage() has no target-origin/broadcast concept at
// all, so once the two ports are paired, nothing else in either page can
// observe or inject into this traffic — stronger than re-checking
// event.source on every message would have been. The handshake message
// itself is still checked for sender identity (event.source ===
// window.parent, an unforgeable WindowProxy reference) before its port is
// trusted, since it is the one message accepted outside the channel.
let wardahPort = null;
// requestId -> resolver, so requestInsight() below can await a specific
// WARDHAH_INSIGHT_RESPONSE without every call needing its own listener.
const pendingInsightRequests = new Map();
// Set once InsightsFinancialDashboard is constructed (DOMContentLoaded,
// bottom of this file) so the port handler can reach it directly.
let dashboardInstance = null;

// Full schema validation for the two message types this iframe ever
// receives over the port. Nothing synced from these messages reaches the
// screen unless it passes here — a malformed or out-of-range payload is
// silently dropped rather than rendered. This guards against a bug or a
// misbehaving sender producing a structurally invalid message; it is NOT a
// defense against a compromised host sending well-formed but fabricated
// numbers — schema validation checks shape and bounds, not truth. The host
// page (EnhancedInsightsDashboard.tsx) is the trust boundary for accuracy:
// it is the only source this iframe ever syncs from, and it reads real
// figures from Supabase rather than inventing them. If that host page were
// compromised, it could send realistic-looking but false numbers that
// would still pass every check here.
// Computed (10^12) rather than written as a literal: this value is exactly
// representable as a JS double (Number.isSafeInteger(10 ** 12) is true, no
// precision loss at runtime) — a static analyzer flagging long-digit
// numeric literals as potentially inaccurate does not apply to a computed
// expression with no such literal for it to inspect.
const MAX_FINANCIAL_AMOUNT = 10 ** 12; // one trillion — a sanity bound, not a claim about any real figure
function isFiniteBoundedAmount(n) {
    return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MAX_FINANCIAL_AMOUNT;
}
function isValidAmountArray(arr) {
    return Array.isArray(arr) && arr.length > 0 && arr.every(isFiniteBoundedAmount);
}
function isValidMonthlyData(monthlyData) {
    if (!monthlyData || typeof monthlyData !== 'object' || Array.isArray(monthlyData)) return false;
    const keys = Object.keys(monthlyData);
    if (keys.length === 0 || keys.length > 12) return false;
    return keys.every((key) => {
        const month = monthlyData[key];
        return month && typeof month === 'object' &&
            isValidAmountArray(month.p) && isValidAmountArray(month.opex) &&
            isFiniteBoundedAmount(month.cogs) && isFiniteBoundedAmount(month.grossProfit) &&
            isFiniteBoundedAmount(month.netProfit);
    });
}
function isValidDataSync(msg) {
    return !!msg && typeof msg === 'object' && msg.type === 'WARDHAH_DATA_SYNC' &&
        isValidMonthlyData(msg.data && msg.data.monthlyData);
}
function isValidInsightResponse(msg) {
    if (!msg || typeof msg !== 'object') return false;
    if (msg.type !== 'WARDHAH_INSIGHT_RESPONSE') return false;
    if (typeof msg.requestId !== 'string' || msg.requestId.length === 0 || msg.requestId.length > 100) return false;
    if (typeof msg.success !== 'boolean') return false;
    if (msg.success) {
        if (typeof msg.text !== 'string' || msg.text.length === 0) return false;
        if (msg.source !== undefined && typeof msg.source !== 'string') return false;
    } else if (msg.error !== undefined && typeof msg.error !== 'string') {
        return false;
    }
    return true;
}

window.addEventListener('message', function onChannelInit(event) {
    if (event.source !== window.parent) return;
    if (!event.data || event.data.type !== 'WARDHAH_CHANNEL_INIT') return;
    if (!event.ports || event.ports.length === 0) return;

    wardahPort = event.ports[0];
    window.removeEventListener('message', onChannelInit);

    wardahPort.onmessage = (portEvent) => {
        const msg = portEvent.data;
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'WARDHAH_INSIGHT_RESPONSE') {
            if (!isValidInsightResponse(msg)) return;
            const resolver = pendingInsightRequests.get(msg.requestId);
            if (resolver) {
                pendingInsightRequests.delete(msg.requestId);
                resolver(msg);
            }
            return;
        }

        if (msg.type === 'WARDHAH_DATA_SYNC' && dashboardInstance) {
            if (!isValidDataSync(msg)) return;
            dashboardInstance.handleDataSync(msg);
        }
    };
});

// Small DOM-builder helper — used everywhere this file used to build
// markup via innerHTML template literals. Every string value here is
// always set via .textContent (or .className/attribute assignment for
// non-content attributes), never parsed as HTML, so untrusted text
// (model output, user chat input) can never execute as markup regardless
// of what it contains — there is no HTML sink left for it to reach.
function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
        for (const key of Object.keys(attrs)) {
            const value = attrs[key];
            if (value === undefined || value === null || value === false) continue;
            if (key === 'className') node.className = value;
            else if (key === 'text') node.textContent = value;
            else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
            else node.setAttribute(key, value === true ? '' : value);
        }
    }
    if (children) {
        for (const child of children) {
            if (child) node.appendChild(child);
        }
    }
    return node;
}

// Calendar month names in the fixed Jan->Dec order the backend
// (gemini-financial-service.ts's fetchMonthlyFinancialData()) always
// serializes monthlyData keys in. This is a label lookup, not financial
// data — every dashboard.months/monthsEn entry always corresponds to a
// month that was actually present in a real WARDHAH_DATA_SYNC (see
// handleDataSync() below); this table is only used to translate a real
// month's Arabic key to its English label and to name months beyond the
// synced range for the predictive chart's forward-looking labels.
const ALL_MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const ALL_MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_NAME_AR_TO_EN = Object.fromEntries(ALL_MONTHS_AR.map((ar, i) => [ar, ALL_MONTHS_EN[i]]));

class InsightsFinancialDashboard {
            constructor() {
                // AI-generated insight text is requested via requestInsight()
                // below, which posts a message to the React host page and
                // never talks to any backend directly from this iframe. This
                // iframe loads third-party script bundles (vendored locally
                // under ./vendor/, no remote CDN — see the CSP on this
                // route), any of which could read anything held in its own
                // JS memory — so no Supabase session token or API key is
                // ever handed to it, in any form. The host page owns the
                // authenticated call to the
                // reports-insights Edge Function and relays only the
                // resulting text back. If no response arrives (provider
                // unavailable, over quota, network issue), requestInsight()
                // resolves to buildLocalInsight()'s deterministic local text
                // instead — the dashboard must never appear disabled.
                //
                // This iframe holds no financial data of its own and never
                // fabricates any: baseFinancialData starts null and
                // syncState starts 'awaiting'. Nothing numeric renders
                // until a real, schema-validated WARDHAH_DATA_SYNC arrives
                // over the port (see handleDataSync()/loadData()/render()
                // below) — a financial ERP dashboard must never present
                // sample or placeholder figures as if they were real.
                this._dataSyncPromise = new Promise((resolve) => { this._resolveDataSync = resolve; });

                this.data = {
                    // What-if multipliers a user can drag to explore
                    // scenarios against the real synced figures — they
                    // default to 1.0 (no distortion) and are only ever
                    // moved by an explicit, visible user action, unlike a
                    // silent default ratio applied without disclosure.
                    // There is no COGS multiplier: cost of goods sold is
                    // always the real per-month figure synced from Wardah
                    // ERP (see calculateFinancials()), never derived from
                    // sales by an assumed rate.
                    assumptions: {
                        salesMultiplier: 1.0,
                        opexMultiplier: 1.0,
                    },

                    syncState: 'awaiting', // 'awaiting' | 'ready' | 'failed'
                    baseFinancialData: null,

                    // Populated by handleDataSync() from the real synced
                    // months — never a hardcoded subset. See
                    // MONTH_NAME_AR_TO_EN below for the AR->EN label lookup.
                    months: [],
                    monthsEn: [],
                    charts: {},
                    aiInsights: [],
                    voiceRecognition: null,
                    isListening: false,
                    currentLanguage: 'ar',
                    settings: {
                        theme: 'dark',
                        refreshRate: 30,
                        autoSync: true,
                        soundEffects: true
                    },
                    aiStatus: {
                        connected: true,
                        processing: false,
                        lastQuery: null
                    },
                    loadingSteps: [
                        { ar: 'تحميل الذكاء الاصطناعي...', en: 'Loading AI engine...' },
                        { ar: 'إعداد الواجهة الذكية...', en: 'Setting up smart interface...' },
                        { ar: 'تحميل البيانات المالية...', en: 'Loading financial data...' },
                        { ar: 'إنشاء المخططات الذكية...', en: 'Creating smart charts...' },
                        { ar: 'تطبيق الذكاء الاصطناعي...', en: 'Applying AI intelligence...' },
                        { ar: 'اكتمل التحميل!', en: 'Loading complete!' }
                    ]
                };

                this.translations = {
                    ar: {
                        totalSales: 'إجمالي المبيعات',
                        netProfit: 'صافي الربح',
                        breakEven: 'نقطة التعادل',
                        marginOfSafety: 'هامش الأمان',
                        costEfficiency: 'كفاءة التكاليف',
                        currency: 'ر.س'
                    },
                    en: {
                        totalSales: 'Total Sales',
                        netProfit: 'Net Profit',
                        breakEven: 'Break Even',
                        marginOfSafety: 'Margin of Safety',
                        costEfficiency: 'Cost Efficiency',
                        currency: 'SAR'
                    }
                };

                this.init();
            }

            async init() {
                try {
                    this.showLoadingStep(0);

                    this.showLoadingStep(1);
                    await this.delay(500);
                    this.setupEventListeners();
                    this.initializeVoiceRecognition();
                    
                    this.showLoadingStep(2);
                    await this.delay(500);
                    await this.loadData();

                    this.showLoadingStep(3);
                    await this.delay(500);
                    // render()/generateInitialInsights() only ever show real,
                    // synced figures — loadData() above has already resolved
                    // this.data.syncState to 'ready' or 'failed' by this
                    // point, and render() itself refuses to draw anything
                    // numeric outside the 'ready' state (see render()).
                    this.render();

                    this.showLoadingStep(4);
                    await this.delay(500);
                    if (this.data.syncState === 'ready') {
                        await this.generateInitialInsights();
                    }

                    this.showLoadingStep(5);
                    await this.delay(500);

                    this.hideLoadingOverlay();
                    this.startAdvancedAnimations();
                    this.startRealtimeUpdates();

                } catch (error) {
                    console.error('Initialization error:', error);
                    this.hideLoadingOverlay();
                    this.showNotification(
                        this.data.currentLanguage === 'ar' ? 'حدث خطأ أثناء التحميل' : 'Loading error occurred',
                        'error'
                    );
                }
            }

            // Requests an AI-generated insight for one of the fixed, allowed
            // operations. Never talks to a provider directly: sends a
            // postMessage to the React host page (which owns the user's
            // session and calls the reports-insights Edge Function), and
            // resolves to a locally-built deterministic answer if no
            // response arrives in time — the dashboard must never appear
            // disabled just because the AI provider is unavailable.
            requestInsight(operation, payload) {
                return new Promise((resolve) => {
                    const requestId = crypto.randomUUID();
                    const timeoutMs = 15000;

                    const cleanup = () => {
                        pendingInsightRequests.delete(requestId);
                        clearTimeout(timer);
                    };

                    pendingInsightRequests.set(requestId, (msg) => {
                        cleanup();
                        if (msg.success && typeof msg.text === 'string') {
                            resolve({ text: msg.text, source: msg.source || 'ai' });
                        } else {
                            resolve({ text: this.buildLocalInsight(operation, payload), source: 'fallback' });
                        }
                    });

                    const timer = setTimeout(() => {
                        cleanup();
                        resolve({ text: this.buildLocalInsight(operation, payload), source: 'fallback' });
                    }, timeoutMs);

                    const message = operation === 'ask'
                        ? { type: 'WARDHAH_INSIGHT_REQUEST', requestId, operation, locale: this.data.currentLanguage, question: payload.question, data: payload.data }
                        : { type: 'WARDHAH_INSIGHT_REQUEST', requestId, operation, locale: this.data.currentLanguage, data: payload };
                    // No-ops if the WARDHAH_CHANNEL_INIT handshake hasn't
                    // completed yet — harmless, the timeout above still
                    // fires and falls back to buildLocalInsight().
                    if (wardahPort) {
                        wardahPort.postMessage(message);
                    }
                });
            }

            // Local, deterministic (no LLM) text built from already-computed
            // numeric data — used when the AI provider is unavailable, slow,
            // or the caller is over quota. Never fabricates numbers: only
            // narrates values the caller already computed locally.
            buildLocalInsight(operation, payload) {
                const ar = this.data.currentLanguage === 'ar';
                const num = (n) => Number(n || 0).toLocaleString(ar ? 'ar-SA' : 'en-US', { maximumFractionDigits: 0 });
                // Break-even/margin-of-safety are never in payload (see
                // calculateFinancials() — no real fixed/variable cost
                // classification exists to compute them from), so this
                // never references them; contribution margin ratio is a
                // real, computed figure instead.
                const cmr = Number(payload.contributionMarginRatio || 0) * 100;

                switch (operation) {
                    case 'summary':
                        return ar
                            ? `إجمالي المبيعات ${num(payload.totalSales)} ر.س، وصافي الربح ${num(payload.totalNetProfit)} ر.س.`
                            : `Total sales ${num(payload.totalSales)} SAR, net profit ${num(payload.totalNetProfit)} SAR.`;
                    case 'predictions':
                        return ar
                            ? 'التوقعات التفصيلية غير متاحة من المحرك الذكي حاليًا؛ استمر بمراقبة اتجاه الأرباح الشهرية الحالي كمؤشر مبدئي.'
                            : 'Detailed predictions are not available from the AI engine right now; keep monitoring the current monthly profit trend as an initial indicator.';
                    case 'optimization':
                        return ar
                            ? 'راجع التكاليف الثابتة والمتغيرة لتحديد فرص خفض التكلفة، وقيّم فرص زيادة الإيراد من المنتجات الأعلى هامشًا.'
                            : 'Review fixed and variable costs for cost-reduction opportunities, and evaluate revenue growth from higher-margin products.';
                    case 'risk':
                        return ar
                            ? `نسبة هامش المساهمة الحالية ${cmr.toFixed(1)}%؛ ${cmr < 20 ? 'منخفضة ويستدعي ذلك مراجعة التكاليف التشغيلية.' : 'ضمن نطاق مقبول حاليًا.'}`
                            : `Current contribution margin ratio is ${cmr.toFixed(1)}%; ${cmr < 20 ? 'low, and warrants a review of operating costs.' : 'within an acceptable range for now.'}`;
                    case 'strategy':
                        return ar
                            ? 'ركّز على تحسين هامش المساهمة عبر تسعير أدق ومزيج منتجات أفضل قبل التوسع في الإنفاق التشغيلي.'
                            : 'Focus on improving contribution margin through more precise pricing and a better product mix before expanding operating spend.';
                    case 'ask':
                    default:
                        return this.getFallbackResponse(payload.question || '');
                }
            }

            getFallbackResponse(userMessage) {
                // Generic, keyword-matched conversational fallback used only
                // when the AI provider is unreachable — never a substitute
                // for real computed analysis. Deliberately makes no specific
                // quantitative or trend claim about this organization (no
                // invented percentages, no "shows improvement" verdict):
                // that would be exactly the kind of fabricated-looking
                // figure this dashboard must never present as real.
                const fallbackResponses = {
                    ar: {
                        'تحليل': 'التحليل الذكي التفصيلي غير متاح حاليًا؛ يمكنك مراجعة الأرقام المعروضة في اللوحة مباشرة أو إعادة المحاولة لاحقًا.',
                        'توصيات': 'التوصيات الذكية غير متاحة حاليًا؛ يُنصح عمومًا بمراجعة التكاليف الثابتة والمتغيرة وتقييم فرص تحسين الكفاءة التشغيلية.',
                        'مخاطر': 'المخاطر الرئيسية تتمثل عادة في تقلبات السوق وارتفاع التكاليف التشغيلية. يُنصح بوضع خطة طوارئ مالية.',
                        'استراتيجية': 'الاستراتيجية المقترحة عمومًا تركز على التوسع المدروس وتحسين الكفاءة التشغيلية مع الاستثمار المدروس.',
                        'default': 'شكراً لسؤالك. المحرك الذكي غير متاح حاليًا؛ يمكنني مساعدتك بشكل عام أو أعد المحاولة لاحقًا.'
                    },
                    en: {
                        'analysis': 'A detailed AI analysis is not available right now; you can review the figures shown on the dashboard directly, or try again later.',
                        'recommendations': 'AI recommendations are not available right now; generally, review fixed and variable costs and evaluate operational-efficiency opportunities.',
                        'risks': 'Main risks typically include market fluctuations and rising operational costs. A financial contingency plan is recommended.',
                        'strategy': 'A general strategy usually focuses on measured expansion and operational efficiency improvement with deliberate investment.',
                        'default': 'Thank you for your question. The AI engine is not available right now; I can help in general terms, or try again later.'
                    }
                };

                const responses = fallbackResponses[this.data.currentLanguage];
                const message = userMessage.toLowerCase();
                
                for (const [key, response] of Object.entries(responses)) {
                    if (message.includes(key)) {
                        return response;
                    }
                }
                
                return responses.default;
            }

            showAiProcessing(show) {
                const indicator = document.getElementById('aiProcessingIndicator');
                if (indicator) {
                    indicator.style.display = show ? 'flex' : 'none';
                }
                this.data.aiStatus.processing = show;
            }

            delay(ms) {
                return new Promise(resolve => setTimeout(resolve, ms));
            }

            showLoadingStep(stepIndex) {
                const loadingText = document.getElementById('loadingText');
                if (loadingText && this.data.loadingSteps[stepIndex]) {
                    const step = this.data.loadingSteps[stepIndex];
                    loadingText.textContent = step[this.data.currentLanguage];
                }
            }

            setupEventListeners() {
                // WARDHAH_DATA_SYNC arrives via the module-level MessageChannel
                // port dispatcher (top of this file), which calls
                // this.handleDataSync() directly — no listener to set up here.

                // Language Toggle
                document.querySelectorAll('.lang-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        this.switchLanguage(btn.dataset.lang);
                    });
                });

                // AI Assistant
                document.getElementById('aiAssistantBtn').addEventListener('click', () => {
                    document.getElementById('aiAssistant').classList.toggle('active');
                });

                document.getElementById('closeAiAssistant').addEventListener('click', () => {
                    document.getElementById('aiAssistant').classList.remove('active');
                });

                // AI Chat
                document.getElementById('sendAiMessage').addEventListener('click', () => {
                    this.sendAiMessage();
                });

                document.getElementById('aiInput').addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        this.sendAiMessage();
                    }
                });

                // Quick Questions
                document.querySelectorAll('.quick-question').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const question = e.target.closest('.quick-question').dataset.question;
                        document.getElementById('aiInput').value = question;
                        this.sendAiMessage();
                    });
                });

                // AI Analysis Buttons
                document.getElementById('aiAnalysisBtn').addEventListener('click', () => {
                    this.performAnalysis();
                });

                document.getElementById('generateInsightsBtn').addEventListener('click', () => {
                    this.generateInsights();
                });

                document.getElementById('aiPredictionBtn').addEventListener('click', () => {
                    this.generatePredictions();
                });

                document.getElementById('aiReportBtn').addEventListener('click', () => {
                    this.generateReport();
                });

                document.getElementById('aiOptimizationBtn').addEventListener('click', () => {
                    this.generateOptimizationSuggestions();
                });

                document.getElementById('aiRiskAnalysisBtn').addEventListener('click', () => {
                    this.performRiskAnalysis();
                });

                document.getElementById('aiStrategyBtn').addEventListener('click', () => {
                    this.generateStrategicRecommendations();
                });

                // Voice Recognition
                document.getElementById('voiceIndicator').addEventListener('click', () => {
                    this.toggleVoiceRecognition();
                });

                // Advanced Controls
                document.addEventListener('change', (e) => {
                    if (e.target.type === 'range') {
                        this.updateAssumptions();
                        this.render();
                        this.showNotification(
                            this.data.currentLanguage === 'ar' ? 'تم تحديث البيانات بنجاح' : 'Data updated successfully'
                        );
                    }
                });

                // Fullscreen
                document.getElementById('fullscreenBtn').addEventListener('click', () => {
                    this.toggleFullscreen();
                });

                // Add Wardah sync button event listener
                const syncButton = document.getElementById('wardahSyncBtn');
                if (syncButton) {
                    syncButton.addEventListener('click', () => {
                        this.syncWithWardah();
                    });
                }
            }

            switchLanguage(lang) {
                this.data.currentLanguage = lang;
                
                // Update body direction
                document.body.className = document.body.className.replace(/\b(rtl|ltr)\b/g, '');
                document.body.classList.add(lang === 'ar' ? 'rtl' : 'ltr');
                
                // Update language buttons
                document.querySelectorAll('.lang-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.lang === lang);
                });

                // Update all translatable elements
                document.querySelectorAll('[data-ar][data-en]').forEach(element => {
                    const text = element.getAttribute(`data-${lang}`);
                    if (text) {
                        if (element.tagName === 'INPUT' && element.type === 'text') {
                            element.placeholder = text;
                        } else {
                            element.textContent = text;
                        }
                    }
                });

                // Update charts and data if already rendered
                if (this.data.syncState === 'ready' && Object.keys(this.data.charts).length > 0) {
                    this.render();
                } else if (this.data.syncState === 'failed') {
                    this.renderDataUnavailableState();
                } else if (this.data.syncState === 'awaiting') {
                    this.renderAwaitingDataState();
                }

                this.initializeVoiceRecognition(); // refreshes #voiceIndicator's localized title only — see its own comment
            }

            async generateInitialInsights() {
                const { annual } = this.calculateFinancials();

                try {
                    const { text } = await this.requestInsight('summary', {
                        totalSales: annual.totalSales,
                        totalNetProfit: annual.totalNetProfit
                    });
                    this.parseInsights(text);
                } catch (error) {
                    console.error('Error generating insights:', error);
                }
            }

            parseInsights(response) {
                // Simple parsing - in production, you'd want more sophisticated parsing
                const insights = [];
                const lines = response.split('\n').filter(line => line.trim());
                
                lines.forEach((line, index) => {
                    if (line.trim() && index < 3) {
                        // No confidence score: this insight is a raw line
                        // from the model's own response text, which never
                        // states or implies a confidence value — inventing
                        // one (random or fixed) would be a fabricated
                        // number on a financial dashboard. renderInsights()
                        // only shows the confidence bar when the field is
                        // present, which it deliberately isn't here.
                        insights.push({
                            type: 'ai-generated',
                            title: `رؤية ذكية ${index + 1}`,
                            content: line.trim(),
                            icon: 'fas fa-brain'
                        });
                    }
                });

                if (insights.length > 0) {
                    this.data.aiInsights = insights;
                    this.renderInsights();
                }
            }

            async sendAiMessage() {
                const input = document.getElementById('aiInput');
                if (!input) return;

                const message = input.value.trim();
                if (!message) return;

                if (message.length > 500) {
                    this.addAiMessage('user', message);
                    input.value = '';
                    this.addAiMessage('assistant', this.data.currentLanguage === 'ar'
                        ? 'السؤال طويل جدًا — الحد الأقصى 500 حرف.'
                        : 'Question is too long — 500 character limit.');
                    return;
                }

                this.addAiMessage('user', message);
                input.value = '';

                // Show typing indicator
                this.showTypingIndicator();

                try {
                    // Only attach real, synced financial figures as context —
                    // never computed from unsynced/absent data. The question
                    // itself can still be answered without them.
                    let data;
                    if (this.data.syncState === 'ready') {
                        const { annual } = this.calculateFinancials();
                        data = {
                            totalSales: annual.totalSales,
                            totalNetProfit: annual.totalNetProfit
                        };
                    }
                    const { text } = await this.requestInsight('ask', { question: message, data });
                    this.hideTypingIndicator();
                    this.addAiMessage('assistant', text);
                } catch (error) {
                    this.hideTypingIndicator();
                    this.addAiMessage('assistant', this.getFallbackResponse(message));
                }
            }

            addAiMessage(sender, message) {
                const chatContainer = document.getElementById('aiChat');
                if (!chatContainer) return;

                // message is either the user's own typed chat input or
                // model-provider output — untrusted either way. el()
                // always sets it via .textContent (never innerHTML), so it
                // can never execute as markup no matter what it contains.
                const bubble = el('div', { className: sender === 'user' ? 'flex-1 text-right' : 'flex-1' }, [
                    el('p', { className: 'text-sm text-white', text: message })
                ]);
                const avatar = sender === 'user'
                    ? el('div', { className: 'w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0' }, [
                        el('i', { className: 'fas fa-user text-white text-sm' })
                    ])
                    : el('div', { className: 'w-8 h-8 ai-enhanced rounded-full flex items-center justify-center flex-shrink-0' }, [
                        el('i', { className: 'fas fa-brain text-white text-sm' })
                    ]);

                const messageDiv = el('div', { className: sender === 'user' ? 'user-message' : 'ai-message' }, [
                    el('div', { className: sender === 'user' ? 'flex items-start space-x-3 justify-end' : 'flex items-start space-x-3' },
                        sender === 'user' ? [bubble, avatar] : [avatar, bubble])
                ]);

                chatContainer.appendChild(messageDiv);
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }

            showTypingIndicator() {
                const chatContainer = document.getElementById('aiChat');
                if (!chatContainer) return;

                const typingDiv = el('div', { className: 'typing-indicator', id: 'typingIndicator' }, [
                    el('div', { className: 'w-8 h-8 ai-enhanced rounded-full flex items-center justify-center flex-shrink-0 mr-3' }, [
                        el('i', { className: 'fas fa-brain text-white text-sm' })
                    ]),
                    el('div', { className: 'typing-dots' }, [
                        el('div', { className: 'typing-dot' }),
                        el('div', { className: 'typing-dot' }),
                        el('div', { className: 'typing-dot' })
                    ]),
                    el('span', {
                        className: 'text-sm text-gray-400 mr-2',
                        text: this.data.currentLanguage === 'ar' ? 'المساعد الذكي يكتب...' : 'AI assistant is typing...'
                    })
                ]);

                chatContainer.appendChild(typingDiv);
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }

            hideTypingIndicator() {
                const typingIndicator = document.getElementById('typingIndicator');
                if (typingIndicator) {
                    typingIndicator.remove();
                }
            }

            async performAnalysis() {
                if (!this.requireSyncedData()) return;
                this.showNotification(
                    this.data.currentLanguage === 'ar' ? 'جاري تشغيل التحليل الذكي...' : 'Running AI analysis...'
                );

                const { monthly, annual } = this.calculateFinancials();

                try {
                    const { text } = await this.requestInsight('summary', {
                        totalSales: annual.totalSales,
                        totalNetProfit: annual.totalNetProfit,
                        monthlyNetProfits: monthly.map(m => Math.round(m.netProfit))
                    });

                    this.addAiMessage('assistant', text);
                    document.getElementById('aiAssistant').classList.add('active');

                    this.showNotification(
                        this.data.currentLanguage === 'ar' ? 'تم إكمال التحليل الذكي' : 'AI analysis completed',
                        'success'
                    );
                } catch (error) {
                    this.showNotification(
                        this.data.currentLanguage === 'ar' ? 'فشل في التحليل الذكي' : 'AI analysis failed',
                        'error'
                    );
                }
            }

            async generateInsights() {
                if (!this.requireSyncedData()) return;
                await this.generateInitialInsights();
                this.showNotification(
                    this.data.currentLanguage === 'ar' ? 'تم توليد رؤى جديدة' : 'New insights generated',
                    'success'
                );
            }

            async generatePredictions() {
                if (!this.requireSyncedData()) return;
                const { monthly, annual } = this.calculateFinancials();

                try {
                    const { text } = await this.requestInsight('predictions', {
                        monthlyNetProfits: monthly.map(m => Math.round(m.netProfit)),
                        totalSales: annual.totalSales
                    });

                    this.addAiMessage('assistant', text);
                    document.getElementById('aiAssistant').classList.add('active');
                } catch (error) {
                    console.error('Prediction error:', error);
                }
            }

            calculateFinancials() {
                const monthlyCalcs = this.data.months.map(month => {
                    const base = this.data.baseFinancialData[month];
                    const sales = this.sum(base.p) * this.data.assumptions.salesMultiplier;
                    // Real, synced COGS — never derived from sales by an
                    // assumed rate (see the module comment history in this
                    // file for why that was removed).
                    const cogs = base.cogs;
                    const grossProfit = sales - cogs;
                    const opex = this.sum(base.opex) * this.data.assumptions.opexMultiplier;
                    const netProfit = grossProfit - opex;

                    return { month, sales, cogs, grossProfit, opex, netProfit };
                });

                const annualTotals = {
                    totalSales: this.sum(monthlyCalcs.map(m => m.sales)),
                    totalCogs: this.sum(monthlyCalcs.map(m => m.cogs)),
                    totalGrossProfit: this.sum(monthlyCalcs.map(m => m.grossProfit)),
                    totalOpex: this.sum(monthlyCalcs.map(m => m.opex)),
                    totalNetProfit: this.sum(monthlyCalcs.map(m => m.netProfit)),
                };

                // Real ratio (gross profit / sales) — no fixed/variable
                // assumption is needed for this one.
                annualTotals.contributionMarginRatio = annualTotals.totalSales > 0 ?
                    annualTotals.totalGrossProfit / annualTotals.totalSales : 0;

                // Break-even and margin-of-safety are NOT computed: both
                // require a real fixed-vs-variable cost classification that
                // does not exist anywhere in Wardah ERP's chart of accounts
                // today (see gemini-financial-service.ts's
                // calculateBreakEvenAnalysis()). The previous version of
                // this file estimated it as "admin expenses / 6 months",
                // an invented monthly-fixed-cost assumption with no real
                // basis — deleted rather than replaced with a different
                // guess. renderAdvancedKPIs() shows an explicit
                // "unavailable" state for these two KPIs instead.
                annualTotals.breakEvenAvailable = false;

                return { monthly: monthlyCalcs, annual: annualTotals };
            }

            // Guards every AI action that would otherwise call
            // calculateFinancials() on data that doesn't exist yet (or
            // failed to sync) — used instead of letting those actions
            // either crash on a null baseFinancialData or, worse, silently
            // analyze zeroed-out placeholder numbers as if they were real.
            requireSyncedData() {
                if (this.data.syncState === 'ready') return true;
                this.showNotification(
                    this.data.currentLanguage === 'ar'
                        ? 'لا تتوفر بيانات مزامنة بعد من وردة ERP'
                        : 'No synced Wardah ERP data available yet',
                    'error'
                );
                return false;
            }

            render() {
                // No real, synced data yet (or sync failed) — never falls
                // through to drawing charts/KPIs/insights from an absent or
                // stale baseFinancialData. See renderAwaitingDataState()/
                // renderDataUnavailableState() and the syncState machine in
                // loadData()/handleDataSync().
                if (this.data.syncState !== 'ready' || !this.data.baseFinancialData) {
                    if (this.data.syncState === 'failed') {
                        this.renderDataUnavailableState();
                    } else {
                        this.renderAwaitingDataState();
                    }
                    return;
                }

                try {
                    const { monthly, annual } = this.calculateFinancials();
                    this.renderAdvancedKPIs(annual);
                    this.renderAdvancedCharts(monthly, annual);
                    this.renderInsights();
                    this.renderAdvancedControls();
                    this.renderRealtimeMetrics(annual);
                } catch (error) {
                    console.error('Render error:', error);
                }
            }

            // Textual, non-numeric placeholder shown in every content
            // container while no real synced data is available — used both
            // pre-sync and after a failed sync. Deliberately shows zero
            // figures, charts, or insight cards: a financial ERP dashboard
            // must never present sample/trial data as if it were real.
            renderSyncPlaceholder(titleAr, titleEn, bodyAr, bodyEn) {
                const ar = this.data.currentLanguage === 'ar';
                const buildMessage = () => el('div', { className: 'ai-insight-card col-span-full text-center py-8' }, [
                    el('h4', { className: 'font-bold text-white text-sm mb-2', text: ar ? titleAr : titleEn }),
                    el('p', { className: 'text-gray-400 text-xs', text: ar ? bodyAr : bodyEn })
                ]);

                const kpiContainer = document.getElementById('advancedKpiContainer');
                if (kpiContainer) kpiContainer.replaceChildren(buildMessage());

                const insights = document.getElementById('aiInsights');
                if (insights) insights.replaceChildren(buildMessage());

                const recommendations = document.getElementById('aiRecommendations');
                if (recommendations) recommendations.replaceChildren();

                const realtime = document.getElementById('realtimeMetrics');
                if (realtime) realtime.replaceChildren(buildMessage());

                const controls = document.getElementById('advancedControls');
                if (controls) controls.replaceChildren();

                ['advanced3DChart', 'predictiveChart', 'advancedBreakdownChart'].forEach((id) => {
                    const chartEl = document.getElementById(id);
                    if (chartEl) chartEl.replaceChildren();
                });
            }

            renderAwaitingDataState() {
                this.renderSyncPlaceholder(
                    'بانتظار بيانات وردة ERP',
                    'Awaiting Wardah ERP data',
                    'لم تصل بيانات مالية حقيقية بعد. لا تُعرض أي أرقام تجريبية.',
                    'No real financial data has arrived yet. No sample figures are shown.'
                );
            }

            renderDataUnavailableState() {
                this.renderSyncPlaceholder(
                    'تعذّر تحميل البيانات',
                    'Data unavailable',
                    'تعذّرت مزامنة البيانات المالية من وردة ERP. لا تُعرض أي أرقام تجريبية — استخدم زر المزامنة لإعادة المحاولة.',
                    'Could not sync financial data from Wardah ERP. No sample figures are shown — use the sync button to retry.'
                );
            }

            renderAdvancedKPIs(annual) {
                const container = document.getElementById('advancedKpiContainer');
                if (!container) return;

                const formatCurrency = (val) => `${Math.round(val).toLocaleString()} ${this.translations[this.data.currentLanguage].currency}`;
                const t = this.translations[this.data.currentLanguage];
                const unavailable = this.data.currentLanguage === 'ar' ? 'غير متاح' : 'Unavailable';

                // No trend badge on any of these: none of them has a real
                // prior-period comparison computed anywhere in this file.
                // A previous version showed fixed values here ('+12.5%',
                // '+8.3%'/'-15.2%', '-5.1%', '+2.8%'/'-1.2%') regardless of
                // the actual figures — fabricated numbers next to real
                // ones, which is exactly what this dashboard must never do.
                const kpis = [
                    {
                        title: t.totalSales,
                        value: formatCurrency(annual.totalSales),
                        icon: 'fas fa-chart-line',
                        gradient: 'from-blue-500 to-purple-600'
                    },
                    {
                        title: t.netProfit,
                        value: formatCurrency(annual.totalNetProfit),
                        icon: annual.totalNetProfit >= 0 ? 'fas fa-arrow-trend-up' : 'fas fa-arrow-trend-down',
                        gradient: annual.totalNetProfit >= 0 ? 'from-green-500 to-teal-600' : 'from-red-500 to-pink-600'
                    },
                    {
                        // Break-even/margin-of-safety require a real
                        // fixed-vs-variable cost classification this
                        // schema has no source for (see
                        // calculateFinancials()) — shown as an explicit
                        // "unavailable" state, never a guessed number.
                        title: t.breakEven,
                        value: annual.breakEvenAvailable ? formatCurrency(annual.breakEven) : unavailable,
                        icon: 'fas fa-balance-scale',
                        gradient: 'from-yellow-500 to-orange-600'
                    },
                    {
                        title: t.marginOfSafety,
                        value: annual.breakEvenAvailable ? `${annual.marginOfSafety.toFixed(1)}%` : unavailable,
                        icon: 'fas fa-shield-alt',
                        gradient: 'from-yellow-500 to-orange-600'
                    }
                ];

                container.replaceChildren(...kpis.map((kpi, index) => {
                    const card = el('div', { className: 'kpi-advanced slide-in-advanced ai-sparkle' }, [
                        el('div', { className: 'flex items-center justify-between mb-4' }, [
                            el('div', { className: `w-12 h-12 bg-gradient-to-r ${kpi.gradient} rounded-xl flex items-center justify-center` }, [
                                el('i', { className: `${kpi.icon} text-white text-xl` })
                            ])
                        ]),
                        el('h3', { className: 'text-gray-300 text-sm font-medium mb-2', text: kpi.title }),
                        el('div', { className: `text-3xl font-bold bg-gradient-to-r ${kpi.gradient} bg-clip-text text-transparent mb-1`, text: kpi.value })
                    ]);
                    card.style.animationDelay = `${index * 0.1}s`;
                    return card;
                }));
            }

            renderAdvancedCharts(monthly, annual) {
                this.render3DChart(monthly);
                this.renderPredictiveChart(monthly);
                this.renderAdvancedBreakdownChart(annual);
            }

            render3DChart(monthlyData) {
                const chartElement = document.querySelector("#advanced3DChart");
                if (!chartElement) return;
                
                const months = this.data.currentLanguage === 'ar' ? this.data.months : this.data.monthsEn;
                const t = this.translations[this.data.currentLanguage];
                
                const options = {
                    chart: {
                        type: 'line',
                        height: 350,
                        toolbar: { show: false },
                        foreColor: '#A0AEC0',
                        background: 'transparent',
                        animations: {
                            enabled: true,
                            easing: 'easeinout',
                            speed: 800
                        }
                    },
                    series: [
                        {
                            name: this.data.currentLanguage === 'ar' ? 'المبيعات' : 'Sales',
                            type: 'area',
                            data: monthlyData.map(m => Math.round(m.sales))
                        },
                        {
                            name: this.data.currentLanguage === 'ar' ? 'التكاليف' : 'Costs',
                            type: 'area',
                            data: monthlyData.map(m => Math.round(m.cogs + m.opex))
                        },
                        {
                            name: this.data.currentLanguage === 'ar' ? 'صافي الربح' : 'Net Profit',
                            type: 'line',
                            data: monthlyData.map(m => Math.round(m.netProfit))
                        }
                    ],
                    colors: ['#4285f4', '#34a853', '#ea4335'],
                    fill: {
                        type: 'gradient',
                        gradient: {
                            shade: 'dark',
                            type: 'vertical',
                            shadeIntensity: 0.5,
                            gradientToColors: ['#34a853', '#fbbc04', '#ea4335'],
                            opacityFrom: 0.8,
                            opacityTo: 0.1
                        }
                    },
                    stroke: {
                        width: [0, 0, 4],
                        curve: 'smooth'
                    },
                    xaxis: {
                        categories: months,
                        labels: { style: { colors: '#A0AEC0' } }
                    },
                    yaxis: {
                        labels: {
                            style: { colors: '#A0AEC0' },
                            formatter: (val) => val.toLocaleString() + ' ' + t.currency
                        }
                    },
                    tooltip: {
                        theme: 'dark',
                        y: { formatter: (val) => `${val.toLocaleString()} ${t.currency}` }
                    },
                    legend: {
                        position: 'top',
                        horizontalAlign: 'center',
                        labels: { colors: '#FFFFFF' }
                    },
                    grid: {
                        borderColor: '#374151',
                        strokeDashArray: 3
                    }
                };

                if (this.data.charts.advanced3D) {
                    this.data.charts.advanced3D.updateOptions(options);
                } else {
                    this.data.charts.advanced3D = new ApexCharts(chartElement, options);
                    this.data.charts.advanced3D.render();
                }
            }

            renderPredictiveChart(monthlyData) {
                const chartElement = document.querySelector("#predictiveChart");
                if (!chartElement) return;

                // Predict only the calendar months genuinely not yet
                // synced (12 - however many real months arrived) — a
                // trend extrapolation forward from real data, never a
                // hardcoded "always predict Jul-Dec" window regardless of
                // how many real months were actually synced.
                const remainingCount = Math.max(0, 12 - monthlyData.length);
                const predictiveData = remainingCount > 0 ? this.generatePredictiveData(monthlyData, remainingCount) : [];
                const months = this.data.currentLanguage === 'ar' ? this.data.months : this.data.monthsEn;
                const allFutureMonths = this.data.currentLanguage === 'ar' ? ALL_MONTHS_AR : ALL_MONTHS_EN;
                const futureMonths = allFutureMonths.slice(monthlyData.length, monthlyData.length + remainingCount);
                const t = this.translations[this.data.currentLanguage];

                const options = {
                    chart: {
                        type: 'line',
                        height: 350,
                        toolbar: { show: false },
                        foreColor: '#A0AEC0',
                        background: 'transparent'
                    },
                    series: [
                        {
                            name: this.data.currentLanguage === 'ar' ? 'البيانات الفعلية' : 'Actual Data',
                            data: monthlyData.map(m => Math.round(m.netProfit))
                        },
                        {
                            name: this.data.currentLanguage === 'ar' ? 'توقعات ذكية' : 'AI Predictions',
                            data: [...Array(monthlyData.length).fill(null), ...predictiveData]
                        }
                    ],
                    colors: ['#4285f4', '#34a853'],
                    stroke: {
                        width: [3, 3],
                        curve: 'smooth',
                        dashArray: [0, 5]
                    },
                    xaxis: {
                        categories: [...months, ...futureMonths],
                        labels: { style: { colors: '#A0AEC0' } }
                    },
                    yaxis: {
                        labels: {
                            style: { colors: '#A0AEC0' },
                            formatter: (val) => val ? val.toLocaleString() + ' ' + t.currency : ''
                        }
                    },
                    tooltip: {
                        theme: 'dark',
                        y: { formatter: (val) => val ? `${val.toLocaleString()} ${t.currency}` : 'غير متوفر' }
                    },
                    legend: {
                        position: 'top',
                        horizontalAlign: 'center',
                        labels: { colors: '#FFFFFF' }
                    },
                    grid: {
                        borderColor: '#374151',
                        strokeDashArray: 3
                    }
                };

                if (this.data.charts.predictive) {
                    this.data.charts.predictive.updateOptions(options);
                } else {
                    this.data.charts.predictive = new ApexCharts(chartElement, options);
                    this.data.charts.predictive.render();
                }
            }

            renderAdvancedBreakdownChart(annual) {
                const chartElement = document.querySelector("#advancedBreakdownChart");
                if (!chartElement) return;
                
                const t = this.translations[this.data.currentLanguage];
                // Two real slices only: gl_accounts has no selling-vs-admin
                // subtype to split operating expenses by (see
                // gemini-financial-service.ts's operatingExpenses comment),
                // so this never fabricates a percentage split between two
                // categories the ledger doesn't actually distinguish.
                const labels = this.data.currentLanguage === 'ar' ?
                    ['تكلفة المبيعات', 'المصاريف التشغيلية'] :
                    ['Cost of Sales', 'Operating Expenses'];

                const options = {
                    chart: {
                        type: 'donut',
                        height: 300,
                        background: 'transparent'
                    },
                    series: [
                        Math.round(annual.totalCogs),
                        Math.round(annual.totalOpex)
                    ],
                    labels: labels,
                    colors: ['#4285f4', '#34a853'],
                    legend: {
                        position: 'bottom',
                        labels: { colors: '#FFFFFF' }
                    },
                    plotOptions: {
                        pie: {
                            donut: {
                                size: '60%',
                                labels: {
                                    show: true,
                                    total: {
                                        show: true,
                                        label: this.data.currentLanguage === 'ar' ? 'إجمالي التكاليف' : 'Total Costs',
                                        color: '#FFFFFF',
                                        formatter: () => `${Math.round(annual.totalCogs + annual.totalOpex).toLocaleString()} ${t.currency}`
                                    }
                                }
                            }
                        }
                    },
                    tooltip: {
                        theme: 'dark',
                        y: { formatter: (val) => `${val.toLocaleString()} ${t.currency}` }
                    }
                };

                if (this.data.charts.advancedBreakdown) {
                    this.data.charts.advancedBreakdown.updateOptions(options);
                } else {
                    this.data.charts.advancedBreakdown = new ApexCharts(chartElement, options);
                    this.data.charts.advancedBreakdown.render();
                }
            }

            renderInsights() {
                const container = document.getElementById('aiInsights');
                if (!container) return;
                
                // insight.title/content can be raw model output (see
                // parseInsights()) — always set via .textContent below,
                // never parsed as HTML. insight.confidence is only present
                // for the fixed, hardcoded insight entries (never for
                // model-generated ones, which have no real basis for a
                // confidence figure — see parseInsights()), so the bar is
                // only built when the field actually exists.
                container.replaceChildren(...this.data.aiInsights.map((insight) => {
                    const children = [
                        el('h4', { className: 'font-bold text-white text-sm mb-1', text: insight.title }),
                        el('p', { className: 'text-gray-300 text-xs mb-2', text: insight.content })
                    ];

                    if (typeof insight.confidence === 'number') {
                        const fill = el('div', { className: 'confidence-fill' });
                        fill.style.width = `${insight.confidence}%`;
                        children.push(el('div', { className: 'flex items-center justify-between' }, [
                            el('div', { className: 'confidence-bar flex-1 mr-2' }, [fill]),
                            el('span', { className: 'text-xs text-gray-400', text: `${Math.round(insight.confidence)}%` })
                        ]));
                    }

                    return el('div', { className: 'ai-insight-card' }, [
                        el('div', { className: 'flex items-start space-x-3' }, [
                            el('div', { className: 'w-10 h-10 ai-enhanced rounded-lg flex items-center justify-center flex-shrink-0' }, [
                                el('i', { className: `${insight.icon} text-white` })
                            ]),
                            el('div', { className: 'flex-1' }, children)
                        ])
                    ]);
                }));
            }

            renderAdvancedControls() {
                const container = document.getElementById('advancedControls');
                if (!container) return;
                
                // COGS has no what-if slider: it is always the real synced
                // figure, never derived from a user-adjustable rate (see
                // calculateFinancials()).
                const controls = [
                    {
                        id: 'salesMultiplier',
                        label: this.data.currentLanguage === 'ar' ? 'تعديل المبيعات' : 'Sales Adjustment',
                        min: 50, max: 200, value: Math.round(this.data.assumptions.salesMultiplier * 100), color: 'blue'
                    },
                    {
                        id: 'opexMultiplier',
                        label: this.data.currentLanguage === 'ar' ? 'المصاريف التشغيلية' : 'Operating Expenses',
                        min: 50, max: 150, value: Math.round(this.data.assumptions.opexMultiplier * 100), color: 'green'
                    }
                ];

                // Tailwind's static content scanner cannot see classes built
                // via string interpolation (`text-${control.color}-400`
                // never appears literally in the source, so the compiled
                // vendor/tailwind.css would never contain it). This lookup
                // of full literal class name strings — Tailwind's own
                // recommended fix — replaces that interpolation so every
                // class name the scanner needs to find actually appears
                // verbatim in this file.
                const colorTextClass = {
                    blue: 'text-blue-400',
                    green: 'text-green-400'
                };

                container.replaceChildren(...controls.map((control) => el('div', { className: 'space-y-2' }, [
                    el('label', { className: 'block text-sm font-medium text-gray-300' }, [
                        document.createTextNode(control.label),
                        el('span', { id: `${control.id}Value`, className: `font-bold ${colorTextClass[control.color]} float-left`, text: `${control.value}%` })
                    ]),
                    el('input', {
                        type: 'range',
                        id: control.id,
                        min: control.min,
                        max: control.max,
                        step: 5,
                        value: control.value,
                        className: 'w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer'
                    }),
                    el('div', { className: 'flex justify-between text-xs text-gray-500' }, [
                        el('span', { text: `${control.min}%` }),
                        el('span', { text: `${control.max}%` })
                    ])
                ])));
            }

            renderRealtimeMetrics(annual) {
                const container = document.getElementById('realtimeMetrics');
                if (!container) return;
                
                // Only costEfficiency is a real, computed figure from the
                // synced annual totals. This used to also show a fixed
                // "+12.5%" growth rate and a fixed "8.7/10" performance
                // index — neither derived from any real computation, both
                // deleted rather than replaced with a different fabricated
                // number (there is no real trend-over-time or scoring model
                // behind either one).
                const metrics = [
                    {
                        label: this.translations[this.data.currentLanguage].costEfficiency,
                        value: `${((annual.totalCogs + annual.totalOpex) / annual.totalSales * 100).toFixed(1)}%`,
                        status: 'good'
                    }
                ];

                container.replaceChildren(...metrics.map((metric) => el('div', { className: 'flex items-center justify-between p-3 rounded-lg bg-black bg-opacity-20' }, [
                    el('span', { className: 'text-sm text-gray-300', text: metric.label }),
                    el('div', { className: 'flex items-center' }, [
                        el('span', { className: 'text-sm font-bold text-white mr-2', text: metric.value }),
                        el('div', { className: 'w-3 h-3 rounded-full bg-gradient-to-r from-green-500 to-teal-600' })
                    ])
                ])));
            }

            // Deterministic linear-trend extrapolation — no simulated noise.
            // This used to add +/-4000 of Math.random() jitter per point,
            // which is a fabricated number with no basis on a financial
            // dashboard; the trend line itself is already an honest
            // least-squares fit of the real historical data.
            generatePredictiveData(monthlyData, count) {
                const profits = monthlyData.map(m => m.netProfit);
                const trend = this.calculateTrend(profits);
                const lastValue = profits[profits.length - 1];

                return Array.from({ length: count }, (_, i) =>
                    Math.round(lastValue + (trend * (i + 1)))
                );
            }

            calculateTrend(data) {
                const n = data.length;
                if (n < 2) return 0;
                const sumX = n * (n - 1) / 2;
                const sumY = data.reduce((a, b) => a + b, 0);
                const sumXY = data.reduce((sum, y, x) => sum + x * y, 0);
                const sumXX = n * (n - 1) * (2 * n - 1) / 6;
                
                return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
            }

            updateAssumptions() {
                const salesElement = document.getElementById('salesMultiplier');
                const opexElement = document.getElementById('opexMultiplier');

                if (salesElement) {
                    this.data.assumptions.salesMultiplier = parseFloat(salesElement.value) / 100;
                    const valueElement = document.getElementById('salesMultiplierValue');
                    if (valueElement) valueElement.textContent = `${salesElement.value}%`;
                }

                if (opexElement) {
                    this.data.assumptions.opexMultiplier = parseFloat(opexElement.value) / 100;
                    const valueElement = document.getElementById('opexMultiplierValue');
                    if (valueElement) valueElement.textContent = `${opexElement.value}%`;
                }
            }

            async generateReport() {
                if (!this.requireSyncedData()) return;
                this.showNotification(
                    this.data.currentLanguage === 'ar' ? 'جاري إنشاء التقرير الذكي...' : 'Generating AI report...'
                );

                const { annual } = this.calculateFinancials();

                try {
                    const { text } = await this.requestInsight('summary', {
                        totalSales: annual.totalSales,
                        totalNetProfit: annual.totalNetProfit
                    });

                    this.addAiMessage('assistant', text);
                    document.getElementById('aiAssistant').classList.add('active');

                    this.showNotification(
                        this.data.currentLanguage === 'ar' ? 'تم إنشاء التقرير الذكي' : 'AI report generated',
                        'success'
                    );
                } catch (error) {
                    this.showNotification(
                        this.data.currentLanguage === 'ar' ? 'فشل في إنشاء التقرير' : 'Report generation failed',
                        'error'
                    );
                }
            }

            async generateOptimizationSuggestions() {
                if (!this.requireSyncedData()) return;
                const { annual } = this.calculateFinancials();

                try {
                    const { text } = await this.requestInsight('optimization', {
                        totalSales: annual.totalSales,
                        totalNetProfit: annual.totalNetProfit,
                        totalCogs: annual.totalCogs,
                        totalOpex: annual.totalOpex
                    });

                    this.addAiMessage('assistant', text);
                    document.getElementById('aiAssistant').classList.add('active');
                } catch (error) {
                    console.error('Optimization error:', error);
                }
            }

            async performRiskAnalysis() {
                if (!this.requireSyncedData()) return;
                const { annual } = this.calculateFinancials();

                try {
                    const { text } = await this.requestInsight('risk', {
                        totalSales: annual.totalSales,
                        totalNetProfit: annual.totalNetProfit,
                        contributionMarginRatio: annual.contributionMarginRatio
                    });

                    this.addAiMessage('assistant', text);
                    document.getElementById('aiAssistant').classList.add('active');
                } catch (error) {
                    console.error('Risk analysis error:', error);
                }
            }

            async generateStrategicRecommendations() {
                if (!this.requireSyncedData()) return;
                const { annual } = this.calculateFinancials();

                try {
                    const { text } = await this.requestInsight('strategy', {
                        totalNetProfit: annual.totalNetProfit,
                        contributionMarginRatio: annual.contributionMarginRatio,
                        totalSales: annual.totalSales
                    });

                    this.addAiMessage('assistant', text);
                    document.getElementById('aiAssistant').classList.add('active');
                } catch (error) {
                    console.error('Strategy error:', error);
                }
            }

            // Intentionally never initializes the browser's SpeechRecognition
            // API. vercel.json sets a site-wide Permissions-Policy:
            // microphone=() for the whole app, which blocks microphone
            // access regardless of SpeechRecognition support — attempting
            // init anyway would let the button look "ready" and then fail
            // unpredictably at the OS/browser permission layer on click.
            // #voiceIndicator renders in a static "unavailable" state
            // instead (see the .unavailable CSS class and toggleVoiceRecognition()
            // below), and this.data.voiceRecognition stays null on purpose.
            initializeVoiceRecognition() {
                const indicator = document.getElementById('voiceIndicator');
                if (indicator) {
                    indicator.title = this.data.currentLanguage === 'ar'
                        ? 'الأوامر الصوتية غير متاحة'
                        : 'Voice commands unavailable';
                }
            }

            // this.data.voiceRecognition is always null (see
            // initializeVoiceRecognition()'s comment) — voice is disabled
            // by design, not by a runtime feature-detection failure.
            toggleVoiceRecognition() {
                this.showNotification(
                    this.data.currentLanguage === 'ar' ? 'الأوامر الصوتية غير متاحة في هذا العرض' : 'Voice commands are not available in this view',
                    'error'
                );
            }

            showNotification(message, type = 'info') {
                const iconName = type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle';
                const notification = el('div', { className: `notification show ${type}` }, [
                    el('div', { className: 'flex items-center' }, [
                        el('i', { className: `fas fa-${iconName} mr-2` }),
                        document.createTextNode(message)
                    ])
                ]);

                const container = document.getElementById('notificationContainer');
                if (container) {
                    container.appendChild(notification);
                    
                    setTimeout(() => {
                        notification.classList.remove('show');
                        setTimeout(() => notification.remove(), 500);
                    }, 3000);
                }
            }

            toggleFullscreen() {
                try {
                    if (!document.fullscreenElement) {
                        document.documentElement.requestFullscreen();
                    } else {
                        document.exitFullscreen();
                    }
                } catch (error) {
                    console.error('Fullscreen error:', error);
                }
            }

            startAdvancedAnimations() {
                const cards = document.querySelectorAll('.slide-in-advanced');
                cards.forEach((card, index) => {
                    setTimeout(() => {
                        card.style.opacity = '1';
                        card.style.transform = 'translateX(0) rotateY(0deg)';
                    }, index * 100);
                });
            }

            startRealtimeUpdates() {
                setInterval(() => {
                    if (this.data.settings.autoSync && this.data.syncState === 'ready') {
                        const { annual } = this.calculateFinancials();
                        this.renderRealtimeMetrics(annual);
                    }
                }, this.data.settings.refreshRate * 1000);
            }

            hideLoadingOverlay() {
                const overlay = document.getElementById('loadingOverlay');
                if (overlay) {
                    overlay.style.opacity = '0';
                    setTimeout(() => {
                        overlay.style.display = 'none';
                    }, 500);
                }
            }

            sum(arr) {
                return arr.reduce((acc, val) => acc + val, 0);
            }

            // Handles the real financial figures the React host page
            // computes and sends over the port (see syncWithWardah()/
            // WARDHAH_DATA_SYNC in EnhancedInsightsDashboard.tsx). This
            // iframe has no backend of its own and no credential of any
            // kind — the host is the only source of real Wardah data. The
            // module-level port dispatcher at the top of this file already
            // schema-validates msg (isValidDataSync) before ever calling
            // this, so msg.data.monthlyData is guaranteed well-shaped here.
            handleDataSync(msg) {
                this.data.baseFinancialData = msg.data.monthlyData;
                // Real months only, in the order the backend serialized
                // them (JSON object key order is preserved for string
                // keys) — never a hardcoded 6-month subset. See
                // fetchMonthlyFinancialData() in gemini-financial-service.ts,
                // which already sends all months the organization has real
                // data for (up to 12), not a fixed window.
                this.data.months = Object.keys(this.data.baseFinancialData);
                this.data.monthsEn = this.data.months.map((ar) => MONTH_NAME_AR_TO_EN[ar] || ar);
                this.data.syncState = 'ready';
                if (this._resolveDataSync) {
                    this._resolveDataSync();
                    this._resolveDataSync = null;
                }
                this.render();
                this.showNotification(
                    this.data.currentLanguage === 'ar' ? 'تمت مزامنة بيانات وردة ERP بنجاح' : 'Successfully synced with Wardah ERP',
                    'success'
                );
            }

            async syncWithWardah() {
                this.showNotification(
                    this.data.currentLanguage === 'ar' ? 'جاري مزامنة بيانات وردة ERP...' : 'Syncing with Wardah ERP...',
                    'info'
                );
                // The response arrives asynchronously via handleDataSync()
                // above — this iframe cannot reach Wardah's backend
                // directly, only the authenticated host page can. No-ops
                // if the handshake hasn't completed yet.
                if (wardahPort) {
                    wardahPort.postMessage({ type: 'REQUEST_WARDHAH_DATA', requestId: crypto.randomUUID() });
                }
            }

            // Polls for the module-level handshake port to be ready — the
            // parent's onLoad handshake and this iframe's own
            // DOMContentLoaded/init() race independently, so the port may
            // not exist yet the instant loadData() runs.
            waitForPort(timeoutMs) {
                return new Promise((resolve) => {
                    const start = Date.now();
                    const poll = () => {
                        if (wardahPort) { resolve(true); return; }
                        if (Date.now() - start >= timeoutMs) { resolve(false); return; }
                        setTimeout(poll, 50);
                    };
                    poll();
                });
            }

            // This iframe never shows sample/placeholder financial data,
            // before or after sync. It waits for a real, schema-validated
            // WARDHAH_DATA_SYNC (via handleDataSync()) and shows an
            // explicit "awaiting data" state until then; if none arrives
            // within a bounded window it moves to a "data unavailable"
            // state instead of ever fabricating figures.
            async loadData() {
                this.data.syncState = 'awaiting';
                this.renderAwaitingDataState();

                const urlParams = new URLSearchParams(window.location.search);
                const useWardah = urlParams.get('wardah') === 'true';

                if (!useWardah) {
                    // No host to sync real data from at all.
                    this.data.syncState = 'failed';
                    return;
                }

                const portReady = await this.waitForPort(5000);
                if (portReady) {
                    wardahPort.postMessage({ type: 'REQUEST_WARDHAH_DATA', requestId: crypto.randomUUID() });
                }

                const synced = await Promise.race([
                    this._dataSyncPromise.then(() => true),
                    this.delay(15000).then(() => false) // matches requestInsight()'s own 15s fallback convention
                ]);

                if (!synced) {
                    this.data.syncState = 'failed';
                }
            }
        }

        // Initialize the AI Enhanced Insights Dashboard
        document.addEventListener('DOMContentLoaded', () => {
            try {
                dashboardInstance = new InsightsFinancialDashboard();
            } catch (error) {
                console.error('Dashboard initialization error:', error);
                const overlay = document.getElementById('loadingOverlay');
                if (overlay) {
                    overlay.style.display = 'none';
                }
            }
        });
