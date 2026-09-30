// app.js
document.addEventListener('DOMContentLoaded', async () => {
    // =========================================
    // 1. 基础 DOM 节点获取 (必须前置以供后续引擎调用)
    // =========================================
    const userInput = document.getElementById('userInput');
    const charCountEl = document.getElementById('charCount'); 
    const submitBtn = document.getElementById('submitBtn');
    const submitBtnText = document.getElementById('submitBtnText');
    const suggestionText = document.getElementById('suggestionText');
    const rationaleText = document.getElementById('rationaleText');
    const pasteBtn = document.getElementById('pasteBtn');
    const copyBtn = document.getElementById('copyBtn');
    const modelSelect = document.getElementById('modelSelect');
    const triggerLoginBtn = document.getElementById('triggerLoginBtn');
    const langToggleBtn = document.getElementById('langToggleBtn');

    // Auth 弹窗节点获取
    const authOverlay = document.getElementById('authOverlay');
    const emailInput = document.getElementById('emailInput');
    const passwordInput = document.getElementById('passwordInput');
    const loginBtn = document.getElementById('loginBtn');
    const signupBtn = document.getElementById('signupBtn');
    const guestBtn = document.getElementById('guestBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const authError = document.getElementById('authError');

    // =========================================
    // 2. 语言切换引擎 (i18n Engine)
    // =========================================
    const langCycle = ['zh', 'en', 'jp'];
    const langDisplayMap = { 'zh': 'CN', 'en': 'EN', 'jp': 'JP' };
    
    // 智能侦测用户浏览器语言
    function getSystemLanguage() {
        const sysLang = navigator.language || navigator.userLanguage || '';
        const lowerLang = sysLang.toLowerCase();
        if (lowerLang.startsWith('zh')) return 'zh';
        if (lowerLang.startsWith('ja')) return 'jp'; // 浏览器标准缩写是 ja
        return 'en'; // 默认回落为英文
    }
    
    // 优先级：本地缓存 > 浏览器系统语言 > 默认英文
    let currentLang = localStorage.getItem('talk4us_lang') || getSystemLanguage();
    
    function applyLanguage(lang) {
        if (!i18nConfig || !i18nConfig[lang]) return;
        const dict = i18nConfig[lang];
        
        // 渲染常规文本内容
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (dict[key]) {
                el.textContent = dict[key];
            }
        });

        // 渲染输入框占位符
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (dict[key]) {
                el.setAttribute('placeholder', dict[key]);
            }
        });

        // 渲染 Select Group 的 Label 标签
        document.querySelectorAll('[data-i18n-label]').forEach(el => {
            const key = el.getAttribute('data-i18n-label');
            if (dict[key]) {
                el.setAttribute('label', dict[key]);
            }
        });

        langToggleBtn.textContent = langDisplayMap[lang];
        localStorage.setItem('talk4us_lang', lang);
    }

    langToggleBtn.addEventListener('click', () => {
        let currentIndex = langCycle.indexOf(currentLang);
        currentIndex = (currentIndex + 1) % langCycle.length;
        currentLang = langCycle[currentIndex];
        applyLanguage(currentLang);
    });

    // 初始化渲染当前语言
    applyLanguage(currentLang);

    // =========================================
    // 2.5 每周热词 (Weekly Hot Terms)
    // 语言方向：中文用户 中→EN，日语用户 日→EN，英文用户 EN→中
    // =========================================
    const hotwordsGrid = document.getElementById('hotwordsGrid');
    const hotwordsDir = document.getElementById('hotwordsDir');
    const hotwordsRefresh = document.getElementById('hotwordsRefresh');

    const hotwordsDirMap = { zh: '中 → EN', jp: '日 → EN', en: 'EN → 中' };
    const HOTWORDS_DISPLAY = 8;          // 每次展示数量
    const HOTWORDS_SHOWN_KEY = 'talk4us_hotwords_shown';
    let activeHotwordsLang = null;
    let hotwordsReqId = 0;               // 请求序号：丢弃过期响应，避免慢请求覆盖新结果

    // 从周词库随机抽取一组展示词：优先抽未展示过的，保证每次访问全部不同；
    // 剩余不足时重置该语言的记录重新开始（记录按语言独立、按周失效）
    function pickRandomWords(words, lang, week) {
        let store = {};
        try { store = JSON.parse(localStorage.getItem(HOTWORDS_SHOWN_KEY)) || {}; } catch (e) { /* 损坏则视为无记录 */ }
        if (store.week !== week || !Array.isArray(store[lang])) {
            store = { week, [lang]: [] };
        }
        const shown = new Set(store[lang]);
        let pool = words.filter(w => !shown.has(w.term));
        if (pool.length < HOTWORDS_DISPLAY) {
            shown.clear();
            pool = words.slice();
        }

        // Fisher-Yates 洗牌后取前 N 个
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const picked = pool.slice(0, HOTWORDS_DISPLAY);
        picked.forEach(w => shown.add(w.term));
        store[lang] = Array.from(shown);
        try { localStorage.setItem(HOTWORDS_SHOWN_KEY, JSON.stringify(store)); } catch (e) { /* 存储满时静默 */ }
        return picked;
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function renderHotwordsSkeleton(count) {
        hotwordsGrid.innerHTML = Array.from({ length: count }, () => '<div class="hotword-skeleton"></div>').join('');
    }

    function renderHotwords(words, lang, week) {
        const picked = pickRandomWords(words, lang, week);
        // 新闻出处链接：由热词+来源构造权威新闻搜索（中文走百度新闻，英/日走 Google News），
        // 避免直接采用 AI 生成的 URL（存在编造假链风险）
        const newsUrl = (w) => {
            const q = encodeURIComponent(w.term + (w.source ? ' ' + w.source : ''));
            return lang === 'zh'
                ? `https://www.baidu.com/s?tn=news&word=${q}`
                : `https://news.google.com/search?q=${q}`;
        };
        hotwordsGrid.innerHTML = picked.map(w => `
            <article class="hotword-card">
                <div class="hotword-top">
                    <span class="hotword-cat">${escapeHtml(w.category)}</span>
                    <span class="hotword-dir">${hotwordsDirMap[activeHotwordsLang] || ''}</span>
                </div>
                <div class="hotword-term">${escapeHtml(w.term)}</div>
                <div class="hotword-translation">${escapeHtml(w.translation)}</div>
                <p class="hotword-origin">${escapeHtml(w.origin)}</p>
                <a class="hotword-source" href="${newsUrl(w)}" target="_blank" rel="noopener noreferrer">${w.source ? escapeHtml(w.source) : ''} 阅读新闻 ↗</a>
            </article>
        `).join('');
    }

    function renderHotwordsError() {
        hotwordsGrid.innerHTML = `<div class="hotwords-state">${i18nConfig[currentLang].hotwordsError}</div>`;
    }

    async function loadHotwords(lang) {
        if (!hotwordsGrid || activeHotwordsLang === lang) return;
        const reqId = ++hotwordsReqId;
        activeHotwordsLang = lang;
        hotwordsDir.textContent = hotwordsDirMap[lang] || '';

        const refreshTitle = (i18nConfig[lang] && i18nConfig[lang].hotwordsRefresh) || 'Refresh';
        hotwordsRefresh.title = refreshTitle;
        hotwordsRefresh.setAttribute('aria-label', refreshTitle);

        renderHotwordsSkeleton(HOTWORDS_DISPLAY);

        try {
            const res = await fetch(`/api/hotwords?lang=${lang}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (reqId !== hotwordsReqId) return; // 期间已有更新的请求，丢弃过期结果
            const words = Array.isArray(data.words) ? data.words : [];
            if (!words.length) throw new Error('热词为空');
            renderHotwords(words, lang, data.week || '');
        } catch (err) {
            console.error('热词加载失败:', err);
            if (reqId === hotwordsReqId) renderHotwordsError();
        }
    }

    // 点击刷新按钮或错误提示卡片时强制重新拉取
    function forceReloadHotwords() {
        activeHotwordsLang = null;
        loadHotwords(currentLang);
    }

    hotwordsRefresh.addEventListener('click', forceReloadHotwords);
    hotwordsGrid.addEventListener('click', (e) => {
        if (e.target.closest('.hotwords-state')) forceReloadHotwords();
    });

    // 跟随语言切换联动刷新热词
    langToggleBtn.addEventListener('click', () => loadHotwords(currentLang));
    loadHotwords(currentLang);

    // =========================================
    // 2.6 AI 引擎下拉框（列表来自 /api/models，由服务端 config.json 统一配置）
    // =========================================
    let modelList = [];
    let defaultModelId = 'glm';
    let isLoggedIn = false;

    function renderModelOptions() {
        if (!modelList.length) return; // 列表加载失败时保留页面内置的静态选项
        const loginReqStr = (i18nConfig[currentLang] && i18nConfig[currentLang].loginRequiredSuffix) || '';
        const prevValue = modelSelect.value;

        modelSelect.innerHTML = '';
        modelList.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            const locked = m.requiresLogin && !isLoggedIn;
            opt.disabled = locked;
            opt.textContent = m.name + (locked ? loginReqStr : '');
            modelSelect.appendChild(opt);
        });

        // 保持用户原选择；若原选择不可用，回退默认引擎，再回退第一个可用引擎
        const isUsable = m => !(m.requiresLogin && !isLoggedIn);
        const keep = modelList.find(m => m.id === prevValue && isUsable(m));
        const preferred = modelList.find(m => m.id === defaultModelId && isUsable(m));
        const target = keep || preferred || modelList.find(isUsable);
        if (target) modelSelect.value = target.id;
    }

    async function loadModels() {
        try {
            const res = await fetch('/api/models');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            modelList = Array.isArray(data.models) ? data.models : [];
            defaultModelId = data.defaultModel || (modelList[0] && modelList[0].id) || 'glm';
            renderModelOptions();
        } catch (err) {
            console.error('模型列表加载失败，使用页面默认选项:', err);
        }
    }

    // 语言切换时同步刷新"(需登录)"后缀文案
    langToggleBtn.addEventListener('click', () => renderModelOptions());
    loadModels();

    // =========================================
    // 3. 初始化 Supabase 客户端
    // =========================================
    let supabaseClient;
    try {
        const configRes = await fetch('/api/config');
        const config = await configRes.json();
        
        supabaseClient = supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    } catch (error) {
        console.error("无法获取 Supabase 配置，请检查后端服务:", error);
        return; 
    }

    let sessionToken = null;
    let maxChars = 300; 

    // =========================================
    // 4. 字数引擎与输入拦截
    // =========================================
    
    function updateCharCount() {
        const currentLen = userInput.value.length;
        charCountEl.textContent = `${currentLen}/${maxChars}`;
        
        if (currentLen >= maxChars) {
            charCountEl.classList.add('limit-reached');
        } else {
            charCountEl.classList.remove('limit-reached');
        }
    }

    userInput.addEventListener('input', () => {
        if (userInput.value.length > maxChars) {
            userInput.value = userInput.value.substring(0, maxChars);
        }
        updateCharCount();
    });

    pasteBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                const newText = userInput.value + text;
                userInput.value = newText.substring(0, maxChars);
                updateCharCount();
                userInput.focus();
            }
        } catch (err) {
            console.error('粘贴失败: ', err);
            alert('无法读取剪贴板，请检查浏览器权限。');
        }
    });

    updateCharCount();

    // =========================================
    // 5. Supabase 状态机驱动
    // =========================================
    supabaseClient.auth.onAuthStateChange((event, session) => {
        isLoggedIn = !!session;
        if (session) {
            sessionToken = session.access_token;
            maxChars = 500; 
            logoutBtn.style.display = 'flex';
            hideAuthOverlay();

            if (triggerLoginBtn) triggerLoginBtn.style.display = 'none';
        } else {
            sessionToken = null;
            maxChars = 300; 
            logoutBtn.style.display = 'none';
            
            if (userInput.value.length > maxChars) {
                userInput.value = userInput.value.substring(0, maxChars);
            }

            if (triggerLoginBtn) triggerLoginBtn.style.display = 'inline-block';
        }
        
        // 登录态变化后重渲染模型下拉框（解锁/锁定需登录引擎）
        renderModelOptions();
        updateCharCount();
    });

    // =========================================
    // 6. 身份验证事件绑定
    // =========================================
    
    if (triggerLoginBtn) {
        triggerLoginBtn.addEventListener('click', showAuthOverlay);
    }

    loginBtn.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        const password = passwordInput.value.trim();
        if (!email || !password) return showAuthError(currentLang === 'zh' ? '请输入邮箱和密码' : 'Email/Password required');

        toggleAuthLoading(true);
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        
        if (error) showAuthError(error.message);
        toggleAuthLoading(false);
    });

    signupBtn.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        const password = passwordInput.value.trim();
        if (!email || !password) return showAuthError(currentLang === 'zh' ? '请输入邮箱和密码' : 'Email/Password required');

        toggleAuthLoading(true);
        const { error } = await supabaseClient.auth.signUp({ email, password });
        
        if (error) {
            showAuthError(error.message);
        } else {
            showAuthError(currentLang === 'zh' ? '注册成功！请查收验证邮件。' : 'Success! Check your email.');
        }
        toggleAuthLoading(false);
    });

    guestBtn.addEventListener('click', () => {
        hideAuthOverlay();
    });

    logoutBtn.addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        showAuthOverlay(); 
    });

    passwordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') loginBtn.click();
    });

    function showAuthError(msg) {
        authError.textContent = msg;
        setTimeout(() => authError.textContent = '', 4000);
    }

    function toggleAuthLoading(isLoading) {
        loginBtn.disabled = isLoading;
        signupBtn.disabled = isLoading;
        emailInput.disabled = isLoading;
        passwordInput.disabled = isLoading;
        const loadingText = currentLang === 'zh' ? '验证中...' : currentLang === 'en' ? 'Verifying...' : '認証中...';
        const loginText = i18nConfig[currentLang].login;
        loginBtn.textContent = isLoading ? loadingText : loginText;
    }

    function hideAuthOverlay() {
        authOverlay.classList.add('hidden');
        setTimeout(() => {
            authOverlay.style.display = 'none';
            userInput.focus();
        }, 300);
    }

    function showAuthOverlay() {
        authOverlay.style.display = 'flex';
        void authOverlay.offsetWidth;
        authOverlay.classList.remove('hidden');
        emailInput.focus();
    }


    // =========================================
    // 7. 业务提交与结果处理
    // =========================================

    copyBtn.addEventListener('click', async () => {
        const textToCopy = suggestionText.textContent;
        const emptyStateText = i18nConfig[currentLang].emptyState;
        
        if (!textToCopy || textToCopy === emptyStateText || suggestionText.classList.contains('empty-state')) {
            return;
        }
        
        try {
            await navigator.clipboard.writeText(textToCopy);
            
            const originalHTML = copyBtn.innerHTML;
            copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#27c93f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            copyBtn.style.borderColor = "rgba(39, 201, 63, 0.4)";
            
            setTimeout(() => {
                copyBtn.innerHTML = originalHTML;
                copyBtn.style.borderColor = "";
            }, 2000);
        } catch (err) {
            console.error('复制失败: ', err);
        }
    });

    userInput.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            submitRequest();
        }
    });
    
    submitBtn.addEventListener('click', submitRequest);

    async function submitRequest() {
        const text = userInput.value.trim();
        if (!text) return;

        const contextType = document.getElementById('contextSelect').value;
        const outputLang = document.getElementById('outputLangSelect').value;
        const modelChoice = modelSelect.value; 

        submitBtn.disabled = true;
        submitBtn.classList.add('loading');
        
        const loadingStr = currentLang === 'zh' ? '重构中' : currentLang === 'en' ? 'Processing' : '再構成中';
        submitBtn.innerHTML = `
            <div class="spinner"></div>
            ${loadingStr}
        `;
        
        const analyzingStr = currentLang === 'zh' ? `引擎 (${modelChoice}) 正在分析语境...` : `Engine (${modelChoice}) analyzing context...`;
        const rationaleStr = currentLang === 'zh' ? '推演最佳重构策略中...' : 'Formulating best response strategy...';

        suggestionText.textContent = analyzingStr;
        suggestionText.classList.remove('empty-state');
        rationaleText.textContent = rationaleStr;

        try {
            const headers = { 'Content-Type': 'application/json' };
            if (sessionToken) {
                headers['Authorization'] = `Bearer ${sessionToken}`;
            }

            const response = await fetch('/api/enhance', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ 
                    userText: text, 
                    contextType: contextType,
                    outputLang: outputLang,
                    modelChoice: modelChoice
                })
            });

            if (!response.ok) {
                if (response.status === 401) showAuthOverlay(); 
                
                let errorMessage = currentLang === 'zh' ? '网络请求失败，请稍后再试。' : 'Network request failed. Please try again.';
                try {
                    const errData = await response.json();
                    if (errData.error) {
                        errorMessage = errData.error; 
                    }
                } catch (parseError) {}
                
                throw new Error(errorMessage);
            }
            
            const data = await response.json();

            suggestionText.textContent = data.suggestion;
            
            if (contextType === 'auto' && data.detectedContext) {
                const routeBadgeStr = currentLang === 'zh' ? '智能路由' : currentLang === 'en' ? 'Auto-Route' : '自動ルーティング';
                rationaleText.innerHTML = `<span class="route-badge">${routeBadgeStr}: ${data.detectedContext}</span> ${data.rationale}`;
            } else {
                rationaleText.textContent = data.rationale;
            }
            
        } catch (error) {
            console.error(error);
            suggestionText.textContent = currentLang === 'zh' ? '重构失败。' : 'Reframing failed.';
            rationaleText.textContent = `Error: ${error.message}`;
        } finally {
            submitBtn.disabled = false;
            submitBtn.classList.remove('loading');
            const submitText = i18nConfig[currentLang].btnSubmit;
            submitBtn.innerHTML = `<span id="submitBtnText" data-i18n="btnSubmit">${submitText}</span> <span class="shortcut">(Cmd/Ctrl + Enter)</span>`;
        }
    }
});