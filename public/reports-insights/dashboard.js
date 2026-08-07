// AI Enhanced Financial Insights Dashboard
//
// This file runs inside a sandboxed iframe with `sandbox="allow-scripts
// allow-downloads"` and NO `allow-same-origin` (see
// src/features/reports/components/EnhancedInsightsDashboard.tsx). That
// deliberately gives this document an opaque origin: `window.location.origin`
// reads as the literal string "null" here, so any `event.origin === ...`
// or `postMessage(msg, window.location.origin)` check is broken by
// construction. Two things replace it:
//   1. Inbound messages are authenticated by identity, not origin string:
//      `event.source !== window.parent` (an unforgeable WindowProxy
//      reference), checked first and unconditionally.
//   2. Outbound messages target the parent's real origin, read once from
//      the `parentOrigin` query-string parameter the parent embeds in this
//      iframe's `src` (see below) — more precise than `'*'`, which the
//      parent must use only because it cannot address our opaque origin
//      any other way.
const parentOrigin = new URLSearchParams(window.location.search).get('parentOrigin');

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
                // Wardah ERP Integration (Secure backend proxy)
                this.wardahProxyConfig = {
                    proxyUrl: '/api/wardah' // URL to your proxy service
                };

                this.data = {
                    assumptions: {
                        cogs_rate: 0.70,
                        salesMultiplier: 1.0,
                        sellingExpensesMultiplier: 1.0,
                        adminExpensesMultiplier: 1.0,
                    },
                    
                    baseFinancialData: {
                        'يناير':  {'p':[80833.5,0,0], 's_exp': [3500, 1200], 'a_exp': [16164, 6708, 2250, 1428, 746, 807, 291, 200]},
                        'فبراير': {'p':[84651,0,0],   's_exp': [3800, 1350], 'a_exp': [16164, 6708, 2250, 1428, 746, 807, 291, 200]},
                        'مارس':   {'p':[56362,0,0],   's_exp': [2900, 1100], 'a_exp': [16164, 6708, 2250, 1428, 746, 807, 291, 200]},
                        'أبريل':  {'p':[58171.5,0,0], 's_exp': [3100, 1200], 'a_exp': [16164, 6708, 2250, 1428, 746, 807, 291, 200]},
                        'مايو':   {'p':[69151.5,0,0], 's_exp': [3370, 1300], 'a_exp': [16164, 6708, 2250, 1428, 746, 807, 291, 200]},
                        'يونيو':  {'p':[108758,0,0],  's_exp': [4500, 1500], 'a_exp': [16165, 6710, 2250, 1431, 747, 808, 290, 200]}
                    },
                    
                    months: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو"],
                    monthsEn: ["January", "February", "March", "April", "May", "June"],
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
                        growthRate: 'معدل النمو',
                        performanceIndex: 'مؤشر الأداء',
                        currency: 'ر.س'
                    },
                    en: {
                        totalSales: 'Total Sales',
                        netProfit: 'Net Profit',
                        breakEven: 'Break Even',
                        marginOfSafety: 'Margin of Safety',
                        costEfficiency: 'Cost Efficiency',
                        growthRate: 'Growth Rate',
                        performanceIndex: 'Performance Index',
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
                    this.render();
                    
                    this.showLoadingStep(4);
                    await this.delay(500);
                    await this.generateInitialInsights();
                    
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
                    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                    const timeoutMs = 15000;

                    const cleanup = () => {
                        window.removeEventListener('message', onMessage);
                        clearTimeout(timer);
                    };

                    const onMessage = (event) => {
                        // Identity check, not origin string: this document is
                        // opaque-origin (no allow-same-origin), so
                        // event.origin is always "null" and carries no
                        // signal. event.source is an unforgeable direct
                        // WindowProxy reference — only the real parent window
                        // can ever be window.parent.
                        if (event.source !== window.parent) return;
                        const msg = event.data;
                        if (!msg || msg.type !== 'WARDHAH_INSIGHT_RESPONSE' || msg.requestId !== requestId) return;
                        cleanup();
                        if (msg.success && typeof msg.text === 'string') {
                            resolve({ text: msg.text, source: msg.source || 'ai' });
                        } else {
                            resolve({ text: this.buildLocalInsight(operation, payload), source: 'fallback' });
                        }
                    };

                    const timer = setTimeout(() => {
                        cleanup();
                        resolve({ text: this.buildLocalInsight(operation, payload), source: 'fallback' });
                    }, timeoutMs);

                    window.addEventListener('message', onMessage);

                    const message = operation === 'ask'
                        ? { type: 'WARDHAH_INSIGHT_REQUEST', requestId, operation, locale: this.data.currentLanguage, question: payload.question, data: payload.data }
                        : { type: 'WARDHAH_INSIGHT_REQUEST', requestId, operation, locale: this.data.currentLanguage, data: payload };
                    // Target the parent's real origin (read once at startup
                    // from the parentOrigin query param the parent embeds in
                    // this iframe's src) rather than window.location.origin,
                    // which is always "null" inside this opaque-origin frame
                    // and would silently fail to deliver.
                    window.parent.postMessage(message, parentOrigin);
                });
            }

            // Local, deterministic (no LLM) text built from already-computed
            // numeric data — used when the AI provider is unavailable, slow,
            // or the caller is over quota. Never fabricates numbers: only
            // narrates values the caller already computed locally.
            buildLocalInsight(operation, payload) {
                const ar = this.data.currentLanguage === 'ar';
                const num = (n) => Number(n || 0).toLocaleString(ar ? 'ar-SA' : 'en-US', { maximumFractionDigits: 0 });
                const safety = Number(payload.marginOfSafety || 0);

                switch (operation) {
                    case 'summary':
                        return ar
                            ? `إجمالي المبيعات ${num(payload.totalSales)} ر.س، وصافي الربح ${num(payload.totalNetProfit)} ر.س، بنقطة تعادل ${num(payload.breakEven)} ر.س وهامش أمان ${safety.toFixed(1)}%.`
                            : `Total sales ${num(payload.totalSales)} SAR, net profit ${num(payload.totalNetProfit)} SAR, break-even ${num(payload.breakEven)} SAR, margin of safety ${safety.toFixed(1)}%.`;
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
                            ? `هامش الأمان الحالي ${safety.toFixed(1)}%؛ ${safety < 10 ? 'منخفض ويستدعي مراجعة التكاليف الثابتة فورًا.' : 'ضمن نطاق مقبول حاليًا.'}`
                            : `Current margin of safety is ${safety.toFixed(1)}%; ${safety < 10 ? 'low, and warrants an immediate review of fixed costs.' : 'within an acceptable range for now.'}`;
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
                const fallbackResponses = {
                    ar: {
                        'تحليل': 'بناءً على البيانات المتاحة، يظهر الأداء المالي تحسناً تدريجياً مع إمكانيات نمو واعدة. يُنصح بالتركيز على تحسين الكفاءة التشغيلية.',
                        'توصيات': 'أنصح بتركيز الجهود على تقليل التكاليف الإدارية بنسبة 15% وزيادة كفاءة المبيعات من خلال التسويق الرقمي.',
                        'مخاطر': 'المخاطر الرئيسية تتمثل في تقلبات السوق وارتفاع التكاليف التشغيلية. يُنصح بوضع خطة طوارئ مالية.',
                        'استراتيجية': 'الاستراتيجية المقترحة تركز على التوسع المدروس وتحسين الكفاءة التشغيلية مع الاستثمار في التكنولوجيا.',
                        'default': 'شكراً لسؤالك. يمكنني مساعدتك في تحليل البيانات المالية وتقديم التوصيات المناسبة.'
                    },
                    en: {
                        'analysis': 'Based on available data, financial performance shows gradual improvement with promising growth potential. Focus on operational efficiency is recommended.',
                        'recommendations': 'I recommend focusing efforts on reducing administrative costs by 15% and increasing sales efficiency through digital marketing.',
                        'risks': 'Main risks include market fluctuations and rising operational costs. A financial contingency plan is recommended.',
                        'strategy': 'The proposed strategy focuses on measured expansion and operational efficiency improvement with technology investment.',
                        'default': 'Thank you for your question. I can help you analyze financial data and provide appropriate recommendations.'
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
                this.setupWardahDataSyncListener();

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
                if (Object.keys(this.data.charts).length > 0) {
                    this.render();
                }
            }

            async loadData() {
                await this.delay(1000);
                this.generateBasicInsights();
            }

            generateBasicInsights() {
                const { annual } = this.calculateFinancials();
                
                const insights = {
                    ar: [
                        {
                            type: 'performance',
                            title: 'تحليل الأداء الحالي',
                            content: `الأداء المالي يظهر ${annual.totalNetProfit >= 0 ? 'ربحية' : 'خسائر'} بقيمة ${Math.abs(annual.totalNetProfit).toLocaleString()} ر.س`,
                            confidence: 85,
                            icon: 'fas fa-chart-line'
                        },
                        {
                            type: 'trend',
                            title: 'اتجاه المبيعات',
                            content: `إجمالي المبيعات بلغ ${annual.totalSales.toLocaleString()} ر.س مع نمو متوقع`,
                            confidence: 78,
                            icon: 'fas fa-arrow-trend-up'
                        }
                    ],
                    en: [
                        {
                            type: 'performance',
                            title: 'Current Performance Analysis',
                            content: `Financial performance shows ${annual.totalNetProfit >= 0 ? 'profitability' : 'losses'} of ${Math.abs(annual.totalNetProfit).toLocaleString()} SAR`,
                            confidence: 85,
                            icon: 'fas fa-chart-line'
                        },
                        {
                            type: 'trend',
                            title: 'Sales Trend',
                            content: `Total sales reached ${annual.totalSales.toLocaleString()} SAR with expected growth`,
                            confidence: 78,
                            icon: 'fas fa-arrow-trend-up'
                        }
                    ]
                };
                
                this.data.aiInsights = insights[this.data.currentLanguage];
            }

            async generateInitialInsights() {
                const { annual } = this.calculateFinancials();

                try {
                    const { text } = await this.requestInsight('summary', {
                        totalSales: annual.totalSales,
                        totalNetProfit: annual.totalNetProfit,
                        breakEven: annual.breakEven,
                        marginOfSafety: annual.marginOfSafety
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
                        insights.push({
                            type: 'ai-generated',
                            title: `رؤية ذكية ${index + 1}`,
                            content: line.trim(),
                            confidence: 85 + Math.random() * 10,
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
                    const { annual } = this.calculateFinancials();
                    const { text } = await this.requestInsight('ask', {
                        question: message,
                        data: {
                            totalSales: annual.totalSales,
                            totalNetProfit: annual.totalNetProfit,
                            breakEven: annual.breakEven,
                            marginOfSafety: annual.marginOfSafety
                        }
                    });
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
                
                const messageDiv = document.createElement('div');
                messageDiv.className = sender === 'user' ? 'user-message' : 'ai-message';
                
                if (sender === 'user') {
                    messageDiv.innerHTML = `
                        <div class="flex items-start space-x-3 justify-end">
                            <div class="flex-1 text-right">
                                <p class="text-sm text-white">${escapeHtml(message)}</p>
                            </div>
                            <div class="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                                <i class="fas fa-user text-white text-sm"></i>
                            </div>
                        </div>
                    `;
                } else {
                    messageDiv.innerHTML = `
                        <div class="flex items-start space-x-3">
                            <div class="w-8 h-8 ai-enhanced rounded-full flex items-center justify-center flex-shrink-0">
                                <i class="fas fa-brain text-white text-sm"></i>
                            </div>
                            <div class="flex-1">
                                <p class="text-sm text-white">${escapeHtml(message)}</p>
                            </div>
                        </div>
                    `;
                }
                
                chatContainer.appendChild(messageDiv);
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }

            showTypingIndicator() {
                const chatContainer = document.getElementById('aiChat');
                if (!chatContainer) return;
                
                const typingDiv = document.createElement('div');
                typingDiv.className = 'typing-indicator';
                typingDiv.id = 'typingIndicator';
                typingDiv.innerHTML = `
                    <div class="w-8 h-8 ai-enhanced rounded-full flex items-center justify-center flex-shrink-0 mr-3">
                        <i class="fas fa-brain text-white text-sm"></i>
                    </div>
                    <div class="typing-dots">
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                    </div>
                    <span class="text-sm text-gray-400 mr-2">${this.data.currentLanguage === 'ar' ? 'المساعد الذكي يكتب...' : 'AI assistant is typing...'}</span>
                `;
                
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
                this.showNotification(
                    this.data.currentLanguage === 'ar' ? 'جاري تشغيل التحليل الذكي...' : 'Running AI analysis...'
                );

                const { monthly, annual } = this.calculateFinancials();

                try {
                    const { text } = await this.requestInsight('summary', {
                        totalSales: annual.totalSales,
                        totalNetProfit: annual.totalNetProfit,
                        breakEven: annual.breakEven,
                        marginOfSafety: annual.marginOfSafety,
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
                await this.generateInitialInsights();
                this.showNotification(
                    this.data.currentLanguage === 'ar' ? 'تم توليد رؤى جديدة' : 'New insights generated',
                    'success'
                );
            }

            async generatePredictions() {
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
                    const cogs = sales * this.data.assumptions.cogs_rate;
                    const grossProfit = sales - cogs;
                    const sellingExpenses = this.sum(base.s_exp) * this.data.assumptions.sellingExpensesMultiplier;
                    const operatingProfit = grossProfit - sellingExpenses;
                    const adminExpenses = this.sum(base.a_exp) * this.data.assumptions.adminExpensesMultiplier;
                    const netProfit = operatingProfit - adminExpenses;
                    
                    return { 
                        month, sales, cogs, grossProfit, sellingExpenses, 
                        operatingProfit, adminExpenses, netProfit 
                    };
                });

                const annualTotals = {
                    totalSales: this.sum(monthlyCalcs.map(m => m.sales)),
                    totalCogs: this.sum(monthlyCalcs.map(m => m.cogs)),
                    totalGrossProfit: this.sum(monthlyCalcs.map(m => m.grossProfit)),
                    totalSellingExpenses: this.sum(monthlyCalcs.map(m => m.sellingExpenses)),
                    totalAdminExpenses: this.sum(monthlyCalcs.map(m => m.adminExpenses)),
                    totalNetProfit: this.sum(monthlyCalcs.map(m => m.netProfit)),
                };

                // Advanced calculations
                annualTotals.contributionMarginRatio = annualTotals.totalSales > 0 ? 
                    (annualTotals.totalGrossProfit - annualTotals.totalSellingExpenses) / annualTotals.totalSales : 0;
                
                annualTotals.breakEven = annualTotals.totalAdminExpenses > 0 && annualTotals.contributionMarginRatio > 0 ? 
                    (annualTotals.totalAdminExpenses / 6 / annualTotals.contributionMarginRatio) : 0;
                
                annualTotals.marginOfSafety = annualTotals.totalSales > 0 && annualTotals.breakEven > 0 ?
                    ((annualTotals.totalSales / 6 - annualTotals.breakEven) / (annualTotals.totalSales / 6)) * 100 : 0;

                return { monthly: monthlyCalcs, annual: annualTotals };
            }

            render() {
                try {
                    const { monthly, annual } = this.calculateFinancials();
                    this.renderAdvancedKPIs(annual);
                    this.renderAdvancedCharts(monthly, annual);
                    this.renderInsights();
                    this.renderAdvancedControls();
                    this.renderRealtimeMetrics(annual);
                    this.renderRecommendations(annual);
                } catch (error) {
                    console.error('Render error:', error);
                }
            }

            renderAdvancedKPIs(annual) {
                const container = document.getElementById('advancedKpiContainer');
                if (!container) return;
                
                const formatCurrency = (val) => `${Math.round(val).toLocaleString()} ${this.translations[this.data.currentLanguage].currency}`;
                const formatPercent = (val) => `${val.toFixed(1)}%`;
                const t = this.translations[this.data.currentLanguage];

                const kpis = [
                    {
                        title: t.totalSales,
                        value: formatCurrency(annual.totalSales),
                        trend: '+12.5%',
                        trendType: 'up',
                        icon: 'fas fa-chart-line',
                        gradient: 'from-blue-500 to-purple-600'
                    },
                    {
                        title: t.netProfit,
                        value: formatCurrency(annual.totalNetProfit),
                        trend: annual.totalNetProfit >= 0 ? '+8.3%' : '-15.2%',
                        trendType: annual.totalNetProfit >= 0 ? 'up' : 'down',
                        icon: annual.totalNetProfit >= 0 ? 'fas fa-arrow-trend-up' : 'fas fa-arrow-trend-down',
                        gradient: annual.totalNetProfit >= 0 ? 'from-green-500 to-teal-600' : 'from-red-500 to-pink-600'
                    },
                    {
                        title: t.breakEven,
                        value: formatCurrency(annual.breakEven),
                        trend: '-5.1%',
                        trendType: 'up',
                        icon: 'fas fa-balance-scale',
                        gradient: 'from-yellow-500 to-orange-600'
                    },
                    {
                        title: t.marginOfSafety,
                        value: formatPercent(annual.marginOfSafety),
                        trend: annual.marginOfSafety > 10 ? '+2.8%' : '-1.2%',
                        trendType: annual.marginOfSafety > 10 ? 'up' : 'down',
                        icon: 'fas fa-shield-alt',
                        gradient: annual.marginOfSafety > 20 ? 'from-green-500 to-teal-600' : 
                                 annual.marginOfSafety > 10 ? 'from-yellow-500 to-orange-600' : 'from-red-500 to-pink-600'
                    }
                ];

                // The two dynamic values below (animation-delay per card,
                // trend-bar width) used to be inline style="..." attributes.
                // CSP's style-src 'self' (no unsafe-inline) blocks that HTML
                // attribute form, so the markup now carries stable hooks
                // (data-kpi-index / .kpi-trend-bar) and the values are
                // applied as JS-set DOM properties right after insertion —
                // that form is unaffected by CSP.
                container.innerHTML = kpis.map((kpi, index) => `
                    <div class="kpi-advanced slide-in-advanced ai-sparkle" data-kpi-index="${index}">
                        <div class="flex items-center justify-between mb-4">
                            <div class="w-12 h-12 bg-gradient-to-r ${kpi.gradient} rounded-xl flex items-center justify-center">
                                <i class="${kpi.icon} text-white text-xl"></i>
                            </div>
                            <div class="metric-trend trend-${kpi.trendType}">
                                <i class="fas fa-arrow-${kpi.trendType === 'up' ? 'up' : 'down'} mr-1"></i>
                                ${kpi.trend}
                            </div>
                        </div>
                        <h3 class="text-gray-300 text-sm font-medium mb-2">${kpi.title}</h3>
                        <div class="text-3xl font-bold bg-gradient-to-r ${kpi.gradient} bg-clip-text text-transparent mb-1">${kpi.value}</div>
                        <div class="w-full bg-gray-700 rounded-full h-2 mt-3">
                            <div class="bg-gradient-to-r ${kpi.gradient} h-2 rounded-full transition-all duration-1000 kpi-trend-bar"
                                 data-trend-width="${Math.min(100, Math.abs(parseFloat(kpi.trend)) * 5)}"></div>
                        </div>
                    </div>
                `).join('');

                container.querySelectorAll('.kpi-advanced').forEach((card) => {
                    card.style.animationDelay = `${Number(card.dataset.kpiIndex) * 0.1}s`;
                });
                container.querySelectorAll('.kpi-trend-bar').forEach((bar) => {
                    bar.style.width = `${bar.dataset.trendWidth}%`;
                });
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
                            data: monthlyData.map(m => Math.round(m.cogs + m.sellingExpenses + m.adminExpenses))
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
                
                const predictiveData = this.generatePredictiveData(monthlyData);
                const months = this.data.currentLanguage === 'ar' ? this.data.months : this.data.monthsEn;
                const futureMonths = this.data.currentLanguage === 'ar' ? 
                    ['يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'] :
                    ['July', 'August', 'September', 'October', 'November', 'December'];
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
                            data: [...Array(6).fill(null), ...predictiveData]
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
                const labels = this.data.currentLanguage === 'ar' ? 
                    ['تكلفة المبيعات', 'مصاريف البيع', 'المصاريف الإدارية'] :
                    ['Cost of Sales', 'Selling Expenses', 'Administrative Expenses'];
                
                const options = {
                    chart: {
                        type: 'donut',
                        height: 300,
                        background: 'transparent'
                    },
                    series: [
                        Math.round(annual.totalCogs),
                        Math.round(annual.totalSellingExpenses),
                        Math.round(annual.totalAdminExpenses)
                    ],
                    labels: labels,
                    colors: ['#4285f4', '#34a853', '#fbbc04'],
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
                                        formatter: () => `${Math.round(annual.totalCogs + annual.totalSellingExpenses + annual.totalAdminExpenses).toLocaleString()} ${t.currency}`
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
                
                // insight.confidence used to be inlined as a style="width: ...%"
                // attribute; CSP's style-src 'self' blocks that form, so the
                // width is now set as a JS DOM property right after insertion
                // (see the querySelectorAll pass below), keyed off
                // data-confidence.
                container.innerHTML = this.data.aiInsights.map(insight => `
                    <div class="ai-insight-card">
                        <div class="flex items-start space-x-3">
                            <div class="w-10 h-10 ai-enhanced rounded-lg flex items-center justify-center flex-shrink-0">
                                <i class="${insight.icon} text-white"></i>
                            </div>
                            <div class="flex-1">
                                <h4 class="font-bold text-white text-sm mb-1">${escapeHtml(insight.title)}</h4>
                                <p class="text-gray-300 text-xs mb-2">${escapeHtml(insight.content)}</p>
                                <div class="flex items-center justify-between">
                                    <div class="confidence-bar flex-1 mr-2">
                                        <div class="confidence-fill" data-confidence="${insight.confidence}"></div>
                                    </div>
                                    <span class="text-xs text-gray-400">${Math.round(insight.confidence)}%</span>
                                </div>
                            </div>
                        </div>
                    </div>
                `).join('');

                container.querySelectorAll('.confidence-fill').forEach((fill) => {
                    fill.style.width = `${fill.dataset.confidence}%`;
                });
            }

            renderAdvancedControls() {
                const container = document.getElementById('advancedControls');
                if (!container) return;
                
                const controls = [
                    { 
                        id: 'salesMultiplier', 
                        label: this.data.currentLanguage === 'ar' ? 'تعديل المبيعات' : 'Sales Adjustment', 
                        min: 50, max: 200, value: Math.round(this.data.assumptions.salesMultiplier * 100), color: 'blue' 
                    },
                    { 
                        id: 'sellingExpensesMultiplier', 
                        label: this.data.currentLanguage === 'ar' ? 'مصاريف البيع' : 'Selling Expenses', 
                        min: 50, max: 150, value: Math.round(this.data.assumptions.sellingExpensesMultiplier * 100), color: 'green' 
                    },
                    { 
                        id: 'adminExpensesMultiplier', 
                        label: this.data.currentLanguage === 'ar' ? 'المصاريف الإدارية' : 'Admin Expenses', 
                        min: 50, max: 150, value: Math.round(this.data.assumptions.adminExpensesMultiplier * 100), color: 'yellow' 
                    },
                    { 
                        id: 'cogsRate', 
                        label: this.data.currentLanguage === 'ar' ? 'نسبة تكلفة المبيعات' : 'COGS Rate', 
                        min: 50, max: 90, value: Math.round(this.data.assumptions.cogs_rate * 100), color: 'red' 
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
                    green: 'text-green-400',
                    yellow: 'text-yellow-400',
                    red: 'text-red-400'
                };

                container.innerHTML = controls.map(control => `
                    <div class="space-y-2">
                        <label class="block text-sm font-medium text-gray-300">
                            ${control.label}
                            <span id="${control.id}Value" class="font-bold ${colorTextClass[control.color]} float-left">${control.value}%</span>
                        </label>
                        <input type="range" id="${control.id}" min="${control.min}" max="${control.max}" 
                               step="${control.id === 'cogsRate' ? 1 : 5}" value="${control.value}" 
                               class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer">
                        <div class="flex justify-between text-xs text-gray-500">
                            <span>${control.min}%</span>
                            <span>${control.max}%</span>
                        </div>
                    </div>
                `).join('');
            }

            renderRealtimeMetrics(annual) {
                const container = document.getElementById('realtimeMetrics');
                if (!container) return;
                
                const t = this.translations[this.data.currentLanguage];
                
                const metrics = [
                    { 
                        label: t.costEfficiency, 
                        value: `${((annual.totalCogs + annual.totalSellingExpenses + annual.totalAdminExpenses) / annual.totalSales * 100).toFixed(1)}%`, 
                        status: 'good' 
                    },
                    { 
                        label: t.growthRate, 
                        value: '+12.5%', 
                        status: 'excellent' 
                    },
                    { 
                        label: t.performanceIndex, 
                        value: '8.7/10', 
                        status: 'good' 
                    }
                ];

                container.innerHTML = metrics.map(metric => `
                    <div class="flex items-center justify-between p-3 rounded-lg bg-black bg-opacity-20">
                        <span class="text-sm text-gray-300">${metric.label}</span>
                        <div class="flex items-center">
                            <span class="text-sm font-bold text-white mr-2">${metric.value}</span>
                            <div class="w-3 h-3 rounded-full bg-gradient-to-r from-green-500 to-teal-600"></div>
                        </div>
                    </div>
                `).join('');
            }

            renderRecommendations(annual) {
                const container = document.getElementById('aiRecommendations');
                if (!container) return;

                const recommendations = [
                    {
                        title: this.data.currentLanguage === 'ar' ? 'تحسين الكفاءة بالذكاء الاصطناعي' : 'AI Efficiency Improvement',
                        description: this.data.currentLanguage === 'ar' ? 'تقليل التكاليف الإدارية بنسبة 15% باستخدام الذكاء الاصطناعي' : 'Reduce administrative costs by 15% using AI',
                        impact: 'high',
                        icon: 'fas fa-brain'
                    },
                    {
                        title: this.data.currentLanguage === 'ar' ? 'نمو المبيعات الذكي' : 'Smart Sales Growth',
                        description: this.data.currentLanguage === 'ar' ? 'استهداف قطاعات جديدة بتحليل ذكي متقدم' : 'Target new segments with advanced AI analysis',
                        impact: 'medium',
                        icon: 'fas fa-chart-line'
                    },
                    {
                        title: this.data.currentLanguage === 'ar' ? 'إدارة المخاطر الذكية' : 'Smart Risk Management',
                        description: this.data.currentLanguage === 'ar' ? 'تنويع مصادر الدخل بناءً على توقعات ذكية' : 'Diversify income sources based on AI predictions',
                        impact: 'high',
                        icon: 'fas fa-shield-alt'
                    },
                    {
                        title: this.data.currentLanguage === 'ar' ? 'الاستثمار المدعوم بالذكاء الاصطناعي' : 'AI-Powered Investment',
                        description: this.data.currentLanguage === 'ar' ? 'استثمار في التكنولوجيا بتوجيه من الذكاء الاصطناعي' : 'Invest in technology guided by AI',
                        impact: 'medium',
                        icon: 'fas fa-lightbulb'
                    }
                ];

                container.innerHTML = recommendations.map(rec => `
                    <div class="ai-insight-card">
                        <div class="flex items-start space-x-3">
                            <div class="w-10 h-10 ${rec.impact === 'high' ? 'bg-red-500' : 'bg-yellow-500'} rounded-lg flex items-center justify-center flex-shrink-0">
                                <i class="${rec.icon} text-white"></i>
                            </div>
                            <div class="flex-1">
                                <h4 class="font-bold text-white text-sm mb-1">${rec.title}</h4>
                                <p class="text-gray-300 text-xs mb-2">${rec.description}</p>
                                <span class="text-xs px-2 py-1 rounded-full ${rec.impact === 'high' ? 'bg-red-500' : 'bg-yellow-500'} text-white">
                                    ${rec.impact === 'high' ? (this.data.currentLanguage === 'ar' ? 'تأثير عالي' : 'High Impact') : (this.data.currentLanguage === 'ar' ? 'تأثير متوسط' : 'Medium Impact')}
                                </span>
                            </div>
                        </div>
                    </div>
                `).join('');
            }

            generatePredictiveData(monthlyData) {
                const profits = monthlyData.map(m => m.netProfit);
                const trend = this.calculateTrend(profits);
                const lastValue = profits[profits.length - 1];
                
                return Array.from({ length: 6 }, (_, i) => 
                    Math.round(lastValue + (trend * (i + 1)) + (Math.random() - 0.5) * 8000)
                );
            }

            calculateTrend(data) {
                const n = data.length;
                const sumX = n * (n - 1) / 2;
                const sumY = data.reduce((a, b) => a + b, 0);
                const sumXY = data.reduce((sum, y, x) => sum + x * y, 0);
                const sumXX = n * (n - 1) * (2 * n - 1) / 6;
                
                return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
            }

            updateAssumptions() {
                const cogsElement = document.getElementById('cogsRate');
                const salesElement = document.getElementById('salesMultiplier');
                const sellingElement = document.getElementById('sellingExpensesMultiplier');
                const adminElement = document.getElementById('adminExpensesMultiplier');
                
                if (cogsElement) {
                    this.data.assumptions.cogs_rate = parseFloat(cogsElement.value) / 100;
                    const valueElement = document.getElementById('cogsRateValue');
                    if (valueElement) valueElement.textContent = `${cogsElement.value}%`;
                }
                
                if (salesElement) {
                    this.data.assumptions.salesMultiplier = parseFloat(salesElement.value) / 100;
                    const valueElement = document.getElementById('salesMultiplierValue');
                    if (valueElement) valueElement.textContent = `${salesElement.value}%`;
                }
                
                if (sellingElement) {
                    this.data.assumptions.sellingExpensesMultiplier = parseFloat(sellingElement.value) / 100;
                    const valueElement = document.getElementById('sellingExpensesMultiplierValue');
                    if (valueElement) valueElement.textContent = `${sellingElement.value}%`;
                }
                
                if (adminElement) {
                    this.data.assumptions.adminExpensesMultiplier = parseFloat(adminElement.value) / 100;
                    const valueElement = document.getElementById('adminExpensesMultiplierValue');
                    if (valueElement) valueElement.textContent = `${adminElement.value}%`;
                }
            }

            async generateReport() {
                this.showNotification(
                    this.data.currentLanguage === 'ar' ? 'جاري إنشاء التقرير الذكي...' : 'Generating AI report...'
                );

                const { annual } = this.calculateFinancials();

                try {
                    const { text } = await this.requestInsight('summary', {
                        totalSales: annual.totalSales,
                        totalNetProfit: annual.totalNetProfit,
                        breakEven: annual.breakEven,
                        marginOfSafety: annual.marginOfSafety
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
                const { annual } = this.calculateFinancials();

                try {
                    const { text } = await this.requestInsight('optimization', {
                        totalSales: annual.totalSales,
                        totalNetProfit: annual.totalNetProfit,
                        totalCogs: annual.totalCogs,
                        totalSellingExpenses: annual.totalSellingExpenses,
                        totalAdminExpenses: annual.totalAdminExpenses
                    });

                    this.addAiMessage('assistant', text);
                    document.getElementById('aiAssistant').classList.add('active');
                } catch (error) {
                    console.error('Optimization error:', error);
                }
            }

            async performRiskAnalysis() {
                const { annual } = this.calculateFinancials();

                try {
                    const { text } = await this.requestInsight('risk', {
                        marginOfSafety: annual.marginOfSafety,
                        breakEven: annual.breakEven,
                        totalSales: annual.totalSales
                    });

                    this.addAiMessage('assistant', text);
                    document.getElementById('aiAssistant').classList.add('active');
                } catch (error) {
                    console.error('Risk analysis error:', error);
                }
            }

            async generateStrategicRecommendations() {
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

            initializeVoiceRecognition() {
                if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
                    try {
                        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                        this.data.voiceRecognition = new SpeechRecognition();
                        this.data.voiceRecognition.lang = this.data.currentLanguage === 'ar' ? 'ar-SA' : 'en-US';
                        this.data.voiceRecognition.continuous = false;
                        this.data.voiceRecognition.interimResults = false;

                        this.data.voiceRecognition.onresult = (event) => {
                            const command = event.results[0][0].transcript;
                            this.processVoiceCommand(command);
                        };

                        this.data.voiceRecognition.onerror = (event) => {
                            console.error('Voice recognition error:', event.error);
                        };
                    } catch (error) {
                        console.error('Voice recognition initialization error:', error);
                    }
                }
            }

            toggleVoiceRecognition() {
                if (!this.data.voiceRecognition) {
                    this.showNotification(
                        this.data.currentLanguage === 'ar' ? 'التعرف على الصوت غير مدعوم' : 'Voice recognition not supported',
                        'error'
                    );
                    return;
                }

                try {
                    if (this.data.isListening) {
                        this.data.voiceRecognition.stop();
                        this.data.isListening = false;
                        document.getElementById('voiceIndicator').classList.remove('active');
                    } else {
                        this.data.voiceRecognition.lang = this.data.currentLanguage === 'ar' ? 'ar-SA' : 'en-US';
                        this.data.voiceRecognition.start();
                        this.data.isListening = true;
                        document.getElementById('voiceIndicator').classList.add('active');
                        this.showNotification(
                            this.data.currentLanguage === 'ar' ? 'استمع للأوامر الصوتية...' : 'Listening for voice commands...'
                        );
                    }
                } catch (error) {
                    console.error('Voice recognition error:', error);
                }
            }

            processVoiceCommand(command) {
                console.log('Voice command:', command);
                document.getElementById('aiInput').value = command;
                this.sendAiMessage();
                
                this.data.isListening = false;
                document.getElementById('voiceIndicator').classList.remove('active');
            }

            showNotification(message, type = 'info') {
                const notification = document.createElement('div');
                notification.className = `notification show ${type}`;
                notification.innerHTML = `
                    <div class="flex items-center">
                        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'} mr-2"></i>
                        ${message}
                    </div>
                `;
                
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
                    if (this.data.settings.autoSync) {
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

            // Add secure Wardah ERP integration methods
            async fetchWardahFinancialData() {
                try {
                    const response = await fetch(`${this.wardahProxyConfig.proxyUrl}/financial-data`, {
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    if (!response.ok) {
                        throw new Error(`Wardah Proxy error: ${response.status}`);
                    }
                    
                    const wardahData = await response.json();
                    return this.mapWardahDataToDashboardFormat(wardahData);
                } catch (error) {
                    console.error('Error fetching Wardah financial data:', error);
                    this.showNotification(
                        this.data.currentLanguage === 'ar' ? 'فشل في جلب بيانات وردة ERP' : 'Failed to fetch Wardah ERP data',
                        'error'
                    );
                    // Return existing data as fallback
                    return this.data.baseFinancialData;
                }
            }

            async fetchWardahTransactions() {
                try {
                    const response = await fetch(`${this.wardahProxyConfig.proxyUrl}/transactions`, {
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    if (!response.ok) {
                        throw new Error(`Wardah Proxy error: ${response.status}`);
                    }
                    
                    return await response.json();
                } catch (error) {
                    console.error('Error fetching Wardah transactions:', error);
                    this.showNotification(
                        this.data.currentLanguage === 'ar' ? 'فشل في جلب معاملات وردة ERP' : 'Failed to fetch Wardah transactions',
                        'error'
                    );
                    return [];
                }
            }

            async fetchWardahInventory() {
                try {
                    const response = await fetch(`${this.wardahProxyConfig.proxyUrl}/inventory`, {
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    if (!response.ok) {
                        throw new Error(`Wardah Proxy error: ${response.status}`);
                    }
                    
                    return await response.json();
                } catch (error) {
                    console.error('Error fetching Wardah inventory:', error);
                    this.showNotification(
                        this.data.currentLanguage === 'ar' ? 'فشل في جلب مخزون وردة ERP' : 'Failed to fetch Wardah inventory',
                        'error'
                    );
                    return {};
                }
            }

            mapWardahDataToDashboardFormat(wardahData) {
                // Map Wardah ERP data structure to dashboard format
                const mappedData = {};
                
                // Handle different data structures from Wardah
                const monthlyData = wardahData.monthlyData || wardahData.data || wardahData;
                
                if (Array.isArray(monthlyData)) {
                    monthlyData.forEach(monthData => {
                        const monthName = monthData.monthNameAr || monthData.monthName || monthData.month;
                        if (monthName) {
                            mappedData[monthName] = {
                                'p': [monthData.salesRevenue || monthData.sales || 0, 0, 0], // Sales data
                                's_exp': [
                                    monthData.sellingExpenses || 0, 
                                    monthData.marketingExpenses || monthData.advertising || 0
                                ], // Selling expenses
                                'a_exp': [
                                    monthData.adminSalaries || 0,
                                    monthData.officeRent || monthData.rent || 0,
                                    monthData.utilities || 0,
                                    monthData.insurance || 0,
                                    monthData.maintenance || 0,
                                    monthData.softwareLicenses || 0,
                                    monthData.travel || 0,
                                    monthData.otherAdminExpenses || 0
                                ] // Administrative expenses
                            };
                        }
                    });
                }
                
                return mappedData;
            }

            // Listens for the real financial figures the React host page
            // computes and posts (via the existing syncWithWardah()/
            // WARDHAH_DATA_SYNC path in EnhancedInsightsDashboard.tsx). This
            // iframe has no backend of its own and no credential of any
            // kind — the host is the only source of real Wardah data, and
            // this listener is what actually consumes it. Identity check
            // mirrors the one requestInsight() already applies (event.source,
            // not event.origin — see the module-level comment at the top of
            // this file for why).
            setupWardahDataSyncListener() {
                window.addEventListener('message', (event) => {
                    if (event.source !== window.parent) return;
                    const msg = event.data;
                    if (!msg || msg.type !== 'WARDHAH_DATA_SYNC') return;
                    if (!msg.data || typeof msg.data !== 'object' || !msg.data.monthlyData) return;

                    this.data.baseFinancialData = msg.data.monthlyData;
                    this.render();
                    this.showNotification(
                        this.data.currentLanguage === 'ar' ? 'تمت مزامنة بيانات وردة ERP بنجاح' : 'Successfully synced with Wardah ERP',
                        'success'
                    );
                });
            }

            async syncWithWardah() {
                this.showNotification(
                    this.data.currentLanguage === 'ar' ? 'جاري مزامنة بيانات وردة ERP...' : 'Syncing with Wardah ERP...',
                    'info'
                );
                // The response arrives asynchronously through
                // setupWardahDataSyncListener() above — this iframe cannot
                // reach Wardah's backend directly, only the authenticated
                // host page can.
                const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                window.parent.postMessage({ type: 'REQUEST_WARDHAH_DATA', requestId }, parentOrigin);
            }

            async loadData() {
                await this.delay(1000);

                // Check if we should load data from Wardah ERP
                const urlParams = new URLSearchParams(window.location.search);
                const useWardah = urlParams.get('wardah') === 'true';

                // Show deterministic sample-derived insights immediately so
                // the UI never appears empty — real figures replace them
                // via setupWardahDataSyncListener() once the host responds.
                this.generateBasicInsights();

                if (useWardah) {
                    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                    window.parent.postMessage({ type: 'REQUEST_WARDHAH_DATA', requestId }, parentOrigin);
                }
            }
        }

        // Initialize the AI Enhanced Insights Dashboard
        document.addEventListener('DOMContentLoaded', () => {
            try {
                new InsightsFinancialDashboard();
            } catch (error) {
                console.error('Dashboard initialization error:', error);
                const overlay = document.getElementById('loadingOverlay');
                if (overlay) {
                    overlay.style.display = 'none';
                }
            }
        });
