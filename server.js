const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');// 引入限流中间件
require('dotenv').config();

const app = express();

// 【重要】如果你部署在 Nginx、Vercel 等反向代理之后，必须开启此项以获取真实用户 IP
// 如果是本地直接跑或直接对外网暴露端口，可以注释掉这行
app.set('trust proxy', 1); 

app.use(express.json());
app.use(express.static('public'));

app.get('/api/config', (req, res) => {
    res.json({
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY
    });
});

// 初始化 Supabase 客户端，用于后端验证 JWT 
const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_ANON_KEY
);

// =========================================
// 模型网关配置：统一由 config.json 管理（API 地址 / 密钥 / 模型选择）
// 缺失时回退到下方内置默认；文件变更自动热加载，无需重启
// =========================================
const CONFIG_FILE = path.join(__dirname, 'config.json');
let cachedConfig = null;
let cachedConfigMtime = 0;

const FALLBACK_CONFIG = {
    defaultModel: 'glm',
    hotwordsModel: 'glm',
    models: {
        'glm': {
            name: 'GLM 4 Flash',
            url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
            model: 'glm-4-flash-250414',
            key: 'env:GLM_API_KEY',
            requiresLogin: false,
            enabled: true
        },
        'deepseek': {
            name: 'DeepSeek Flash',
            url: 'https://api.deepseek.com/chat/completions',
            model: 'deepseek-flash',
            key: 'env:DS_API_KEY',
            requiresLogin: true,
            enabled: true
        }
    }
};

function resolveKeyValue(keyVal) {
    // 支持 "env:VAR_NAME" 形式引用 .env 中的环境变量，也可直接写明文密钥
    if (typeof keyVal === 'string' && keyVal.startsWith('env:')) {
        return process.env[keyVal.slice(4)] || '';
    }
    return keyVal || '';
}

function normalizeModel(id, raw, defaultModelId) {
    return {
        id,
        name: (raw && raw.name) || id,
        url: raw && raw.url,
        model: raw && raw.model,
        key: resolveKeyValue(raw && raw.key),
        requiresLogin: raw && raw.requiresLogin !== undefined ? raw.requiresLogin !== false : id !== defaultModelId,
        enabled: !raw || raw.enabled !== false
    };
}

function loadConfig() {
    try {
        const stat = fs.statSync(CONFIG_FILE);
        if (cachedConfig && stat.mtimeMs === cachedConfigMtime) return cachedConfig;
        const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        if (!raw || typeof raw !== 'object' || !raw.models || typeof raw.models !== 'object' || !Object.keys(raw.models).length) {
            throw new Error('config.json 缺少有效的 models 配置');
        }
        cachedConfig = raw;
        cachedConfigMtime = stat.mtimeMs;
        console.log(`config.json 已加载（默认引擎: ${raw.defaultModel}）`);
        return cachedConfig;
    } catch (e) {
        if (e.code !== 'ENOENT') {
            // 文件存在但损坏/不合法时告警并回退，保证服务可用
            if (cachedConfig !== FALLBACK_CONFIG) {
                console.warn('config.json 加载失败，回退内置默认模型配置:', e.message);
            }
        }
        cachedConfig = FALLBACK_CONFIG;
        cachedConfigMtime = 0;
        return cachedConfig;
    }
}

function getModelConfig(id) {
    const cfg = loadConfig();
    if (!id || !cfg.models[id]) return null;
    return normalizeModel(id, cfg.models[id], cfg.defaultModel);
}

function listEnabledModels() {
    const cfg = loadConfig();
    return Object.keys(cfg.models)
        .map(id => normalizeModel(id, cfg.models[id], cfg.defaultModel))
        .filter(m => m.enabled && m.url);
}

// =========================================
// 1. 前置鉴权中间件
// =========================================
const checkAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    req.user = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const { data: { user: supabaseUser }, error } = await supabase.auth.getUser(token);
            if (!error && supabaseUser) {
                req.user = supabaseUser; // 将解析出的用户对象挂载到 req 上
            }
        } catch (err) {
            console.error('Supabase 身份验证发生错误:', err.message);
        }
    }
    next();
};

// =========================================
// 2. 动态频率限流中间件
// =========================================
const enhanceRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1小时的时间窗口
    max: (req, res) => {
        return req.user ? 50 : 20;
    },
    keyGenerator: (req, res) => {
        // 核心防刷逻辑：已登录基于 UserID，未登录则使用官方函数处理 IP，满足新版底层安全校验
        return req.user ? req.user.id : ipKeyGenerator(req.ip || req.socket.remoteAddress || '');
    },
    handler: (req, res, next, options) => {
        const limitType = req.user ? '注册用户' : '游客';
        const limitCount = req.user ? 50 : 20;
        res.status(429).json({ 
            error: `请求过于频繁：${limitType}每小时最多允许重构 ${limitCount} 次，请稍后再试。` 
        });
    }
});

// =========================================
// 3. 核心重构接口 (挂载中间件)
// =========================================
app.post('/api/enhance', checkAuth, enhanceRateLimiter, async (req, res) => {
    const { userText, contextType, outputLang, modelChoice = 'glm' } = req.body;
    const user = req.user; // 直接从上游中间件获取 user 状态

    // 核心权限控制：非登录用户强行请求非默认模型时直接拦截
    if (!user && modelChoice !== 'glm') {
        return res.status(401).json({ error: "权限不足：该模型仅限注册登录用户使用。" });
    }

    if (!userText) {
        return res.status(400).json({ error: "文本不能为空" });
    }

    // 后端严格字数硬防线
    const maxAllowedChars = user ? 500 : 300;
    if (userText.length > maxAllowedChars) {
        return res.status(400).json({ 
            error: `输入越界：当前权限组最多允许处理 ${maxAllowedChars} 个字符。` 
        });
    }

    // 后端兜底收敛：确保即使前端被绕过，非登录用户的模型仍会降级为默认引擎
    const defaultModelId = loadConfig().defaultModel;
    const finalModel = user ? modelChoice : defaultModelId;
    const config = getModelConfig(finalModel) || getModelConfig(defaultModelId);
    
    if (!config || !config.key) {
        return res.status(500).json({ error: `后端缺失 ${finalModel} 的 API 密钥` });
    }

    const langMap = {
        'zh': '无论用户输入的是中文、西班牙、法语、日语、英文还是混合语言，最终输出必须是纯正且符合专业语境的【中文】。',
        'en': '无论用户输入的是中文、西班牙、法语、日语、英文还是混合语言，最终输出必须是母语级别的地道【英文】。',
        'jp': '无论用户输入的是中文、西班牙、法语、日语、英文还是混合语言，最终输出必须是母语级别的地道【日语】。'
    };
    const targetLang = langMap[outputLang] || langMap['zh'];

    // 定义不同场景的 AI Prompt 配置
    const contextConfigs = {
        'auto': {
            description: '自动路由（Auto-Detect）：自动推断最适合的沟通博弈场景，并加载对应的战术指令。',
            rules: `1. 场景侦测（Context Sniffing）：先判断文本的核心诉求是【维权交涉】、【向上管理】、【边界设定】、【弱连结破冰】，还是常规协作。
2. 动态加载战术规则：
   - 【规则博弈/维权】：剥离私人情绪，使用客观事实与商业质询，建立平视的契约姿态。
   - 【向上管理】：绝对消除过度道歉，提出建设性方案，主动给出时间节点以降低对方决策成本。
   - 【边界设定】：绝不直接指责。以共同业务目标为掩护，通过“提供柔性支持”来施加隐性的进度压力。
   - 【弱连结破冰】：将高成本索取转化为低成本互动。结尾强制附带低压关怀（如 No pressure to reply immediately）。
   - 【常规沟通】：打破机械断句，使用破折号/轻连词，保持职场原生语感。
3. 结果提取：在输出的 JSON 中，必须将你侦测到的具体场景名填入 \`detectedContext\` 字段。`,
            example: `User: "我的网断了三天，你们为什么还不修？我明天要在线考试，快点解决！"
Assistant: {
  "suggestion": "I'm writing to formally report a three-day service outage at my address. Given that I rely on this connection for an upcoming remote exam tomorrow, this disruption is highly critical. Could you please provide an immediate update on the repair status?",
  "detectedContext": "规则博弈 (维权)",
  "rationale": "剥离情绪，用正式报告建立严肃性，将焦虑转化为客观的业务受损陈述。"
}`
        },
        'advocacy': {
            description: '规则博弈与维权（如：与机构、房东交涉）。聚焦事实、逻辑驱动与体面的商业质询。',
            rules: `1. 事实与逻辑驱动（Fact-Driven）：剥离所有“中式祈使句”的愤怒或无助求饶（如 Why you do this / Please help），使用客观事实建立谈判威慑力。
2. 商业质询（Commercial Inquiry）：将私人的焦虑转化为业务视角的客观陈述（如用“业务连续性受损”替代“我明天要考试”）。
3. 平视与契约精神（Equal Footing）：不卑不亢，以平视的姿态要求对方履约。绝对禁止情绪化宣泄和反问句。`,
            example: `User: "我的网断了三天，你们为什么还不修？我明天要在线考试，快点解决！"
Assistant: {
  "suggestion": "I'm writing to formally report a three-day service outage at my address. Given that I rely on this connection for an upcoming remote exam tomorrow, this disruption is highly critical. Could you please provide an immediate update on the repair status?",
  "rationale": "剥离情绪，用正式报告建立书面记录的严肃性，将私人焦虑转化为客观的业务受损陈述。"
}`
        },
        'upward': {
            description: '向上管理（如：申请延期、请求资源）。消除过度道歉，提供建设性方案。',
            rules: `1. 消除过度道歉（Zero Over-Apologizing）：彻底删除多余的 sorry、麻烦您了等带有道德亏欠感的词汇，避免主动剥夺自身的专业对等性。
2. 建设性掩护（Constructive Framing）：将诉求包装为“为了保证交付质量”、“基于客观排期冲突”等正当、专业的理由。
3. 降低决策成本（Actionable Proposal）：主动给出一个明确的新时间节点或补救方案，将开放式的索要转化为封闭式的确认。`,
            example: `User: "教授您好，非常抱歉打扰您。我生病了，能不能求您把作业延期几天？非常对不起！"
Assistant: {
  "suggestion": "Dear Professor, I'm reaching out to request a brief extension for the upcoming assignment. Given an unexpected health issue, I'd like to ensure the quality of my submission isn't compromised. Would it be possible to submit the paper by Friday?",
  "rationale": "删除了过度道歉，将请求包装为保证交付质量的建设性提议，并主动提供明确的补救时间点。"
}`
        },
        'boundary': {
            description: '边界设定（如：催促团队进度、拒绝不合理要求）。建设性直率，施加隐性压力。',
            rules: `1. 建设性直率（Constructive Firmness）：绝对不直接指责对方拖延或犯错，避免产生防御机制和火药味。
2. 共同目标掩护（Shared Goal Alignment）：以“团队共同的交付节点”或“顺利推进项目”作为推进对话的合理掩护。
3. 柔性施压（Soft Pressure）：使用体面的职场外交辞令（如“是否遇到阻碍需要帮助”），在表面提供支持的同时，施加实质性的进度压力。`,
            example: `User: "你为什么还没把PPT发给我？明天就要交了，拖延会害了全组。"
Assistant: {
  "suggestion": "Just checking in on your section of the deck — as we're aiming to finalize everything by tomorrow, let me know if you've run into any blockers or need support wrapping it up so we can safely hit the deadline.",
  "rationale": "不指责拖延，以团队共同目标为掩护，用提供帮助的体面姿态施加隐性的进度压力。"
}`
        },
        'cold_reach': {
            description: '弱连结破冰（如：Cold Email、LinkedIn自荐）。低压关怀，提供体面退路。',
            rules: `1. 降本交往（Low-Cost Interaction）：必须将高成本索取（直接索要内推、发简历、求职）转化为低成本互动（寻求行业洞察、简短建议）。⚠️ 允许且必须删减原文中“投递简历”、“求职艰难”等带有强压迫感和低估个人价值的元素。
            2. 价值前置与留白（Value Upfront）：用极其克制的短句表明背景。如果原文缺乏对方信息，可使用“[对方公司/领域]”作为占位符，引导用户自行填补商业赞美。
            3. 异步低压体贴（Low-Pressure Closure）：结尾强制使用松弛的现代职场关怀（如：占用您宝贵时间，如近期繁忙完全不必急于回复/随时在您方便时交流），给对方留下绝对体面的退路。`,  
            example: `User: "学长您好，我刚来英国找工作很艰难。这是我的简历，请问能帮我内推吗？万分感谢！"
Assistant: {
  "suggestion": "Hi [Name], I recently relocated to the UK and have been following your impressive work at [Company]. I'm currently exploring opportunities in this space and would love to hear your brief insights on the local industry landscape. No pressure to reply immediately.",
  "rationale": "去除了沉重的情感包袱，将高门槛的内推索求降级为低成本的洞察交流，结尾补充标准的低压关怀。"
}`
        },
        // --- 原有基础场景保留 ---
        'internal': {
            description: '内部协作（常规）：聚焦高效率与客观现状。',
            rules: `1. 建设性直率（Constructive Firmness）：拒绝弱势兜圈子（如 I think, maybe），禁止对抗性词汇（如 impossible）。使用“客观现状+同步进展”的柔性表达。
2. 地道职场原生语（Native Corporate Phrasing）：优先使用跨国企业高频惯用语组合（如 revisit, firm up）。
3. 明确诉求（Clear Ask）：将模糊担忧转化为［客观现状］+［明确建议］。`,
            example: `{ "suggestion": "This timeline feels tight on our side — a few dependencies are still unresolved. Can we revisit the dates once those are firmed up?", "rationale": "替换不自信修饰词，使用职场原生动词组合建立柔性边界。" }`
        },
        'business': {
            description: '商业沟通（常规）：聚焦平等的同行交流与高级感。',
            rules: `1. 句流呼吸感（Rhythm & Fluidity）：打破机械断句，使用破折号（—）或轻量连词将语意自然串联。
2. 异步低压体贴（Low-Pressure Courtesy）：将“方便时查看”转化为松弛的异步表达（feel free to review when it works for you）。
3. 平视感与探索性（Constructive Peer Tone）：提出合作时使用留有余地的句式（would you be open to）。`,
            example: `{ "suggestion": "I've attached the updated deck — sending now given the time difference, so feel free to review when it works for you.", "rationale": "利用破折号串联语流，并注入毫无压迫感的异步关怀。" }`
        },
        'social': {
            description: '日常社交（常规）：聚焦情绪价值与自然人感。',
            rules: `1. 真实人感（Human Touch）：语气真诚自然，消除官方腔调或机器味。
2. 情绪共鸣（Emotional Resonance）：增加表达情绪的口语化词汇，拉近人际距离。
3. 极简口语化（Conversational Simplicity）：符合即时通讯阅读习惯，避免复杂书面词汇。`,
            example: `{ "suggestion": "Thanks a million for stepping in today — I really appreciate it!", "rationale": "用极具人情味的口语替换刻板的书面致谢。" }`
        }
    };

    const currentConfig = contextConfigs[contextType] || contextConfigs['auto'];
    const isAuto = (contextType === 'auto' || currentConfig === contextConfigs['auto']);

    const jsonFormatInstruction = isAuto 
        ? `{\n  "suggestion": "润色后的最终文案（⚠️ 必须严格使用【语言路径】要求的语言输出）",\n  "detectedContext": "你识别出的场景（如：商业沟通、内部协作、日常社交）",\n  "rationale": "用一句极简中文，点明该改写如何优化了句流或心理体验"\n}`
        : `{\n  "suggestion": "润色后的最终文案（⚠️ 必须严格使用【语言路径】要求的语言输出）",\n  "rationale": "用一句极简中文，点明该改写如何优化了句流或心理体验"\n}`;

    const systemPrompt = `你是一个精通跨文化职场心理学的顶级沟通教练。
    
【绝对核心指令】
你的唯一任务是【润色和重写】用户提供的原始文本。
⚠️ 致命错误警告：绝不能作为对话对象去“回答”文本里的问题！绝不能顺着用户的话茬接话！你必须保持“改写者”的客观身份，将用户的原话重构为更符合目标场景的表达！

当前任务参数：
- 场景设定：${currentConfig.description}
- 语言路径：🚨 ${targetLang}

严格执行以下场景专属约束：
${currentConfig.rules}
4. 绝对忠实（Anti-Hallucination）：严禁凭空捏造原文没有的时间（如 next week）、地点、业务细节或多余的具体行动指令。

5. 结构保留与弹性重构（Format Preservation vs. Context Shift）：
   - 一般场景下：必须完整保留原文的信件结构（包含称呼与落款），不可随意裁减用户的格式骨架。
   - ⚠️ 特例豁免：如果当前场景是【弱连结破冰 (cold_reach)】或【向上管理 (upward)】，你被授权大胆剔除原文中“过度卑微”、“附带高压任务（如强行塞简历）”的结构，以确保最终输出符合平视的商业契约精神。

【场景专属范例参考】
(注：以下范例仅供语感参考，最终输出的语言请严格遵循上方“语言路径”的要求)
${currentConfig.example}

强制返回 JSON 格式：
${jsonFormatInstruction}`;

    const payload = {
        model: config.model,
        messages: [
            { role: "system", content: systemPrompt },
            { 
              role: "user", 
              content: `请严格按照系统设定的场景和规则，重写以下这段话：\n\n"""\n${userText}\n"""` 
            }
        ],
        response_format: { type: "json_object" },
        temperature: 0.7 
    };

    // 带重试的模型调用：免费模型高峰期可能返回 1305（过载）/ 429（限流），自动退避重试
    const callModelWithRetry = async (retries = 2, delayMs = 1500) => {
        let lastError;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                return await axios.post(config.url, payload, {
                    headers: {
                        'Authorization': `Bearer ${config.key}`,
                        'Content-Type': 'application/json'
                    }
                });
            } catch (err) {
                lastError = err;
                const errCode = err.response && err.response.data && err.response.data.error && err.response.data.error.code;
                const isTransient = errCode === '1305' || (err.response && err.response.status === 429);
                if (isTransient && attempt < retries) {
                    console.warn(`[${config.model}] 触发限流(${errCode || err.response.status})，${delayMs * (attempt + 1)}ms 后第 ${attempt + 1} 次重试...`);
                    await new Promise(resolve => setTimeout(resolve, delayMs * (attempt + 1)));
                    continue;
                }
                throw err;
            }
        }
        throw lastError;
    };

    try {
        const response = await callModelWithRetry();

        const resultText = response.data.choices[0].message.content;
        const cleanJsonText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
        const resultJson = JSON.parse(cleanJsonText);
        
        res.json(resultJson);
    } catch (error) {
        console.error(`[${config.model}] API 调用失败:`, error.response ? error.response.data : error.message);
        res.status(500).json({ error: `增强引擎 (${finalModel}) 响应异常，请重试。` });
    }
});

// =========================================
// 4. 每周热词接口（AI 自动检索当周热点词汇，按自然周缓存）
// =========================================
const HOTWORDS_CACHE_FILE = path.join(__dirname, '.hotwords-cache.json');
const HOTWORDS_COUNT = 8;
const hotwordsMemCache = new Map();   // key: `${lang}@${isoWeek}` -> words[]
const hotwordsInflight = new Map();   // 同周同语言的并发请求去重，避免重复消耗 AI 额度

function isoWeekKey(d = new Date()) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// 启动时从本地文件恢复本周缓存，PM2 重启后不重复消耗 AI 额度
(function restoreHotwordsCache() {
    try {
        const raw = JSON.parse(fs.readFileSync(HOTWORDS_CACHE_FILE, 'utf8'));
        if (raw && raw.week === isoWeekKey() && raw.data) {
            for (const [lang, words] of Object.entries(raw.data)) {
                if (Array.isArray(words) && words.length) {
                    hotwordsMemCache.set(`${lang}@${raw.week}`, words);
                }
            }
            console.log(`热词缓存已恢复（${raw.week}）`);
        }
    } catch (e) { /* 缓存文件缺失或损坏属正常首启状态，静默跳过 */ }
})();

function persistHotwordsCache(weekKey) {
    const data = {};
    for (const lang of ['zh', 'en', 'jp']) {
        const words = hotwordsMemCache.get(`${lang}@${weekKey}`);
        if (words) data[lang] = words;
    }
    try {
        fs.writeFileSync(HOTWORDS_CACHE_FILE, JSON.stringify({ week: weekKey, data }, null, 2));
    } catch (e) {
        console.warn('热词缓存写入失败:', e.message);
    }
}

function buildHotwordsPrompt(lang, weekKey, count) {
    const specs = {
        zh: {
            intro: `请筛选本周（${weekKey}）中文互联网上最新、最热门的 ${count} 个热点词汇/流行语/新梗，领域尽量分散，覆盖：科技、数码、时事、游戏、电影、生活、文化。`,
            fields: `- "term": 中文热词原文
- "translation": 对应的地道英文表达（简短）
- "category": 所属领域，中文，从「科技/数码/时事/游戏/电影/生活/文化」中选择
- "origin": 用一句中文（30字以内）介绍该词的来源或出处`
        },
        en: {
            intro: `Pick the ${count} freshest trending terms / slang / buzzwords of this week (${weekKey}) from the English-speaking internet. Spread them across: Tech, Gadgets, Current Affairs, Gaming, Movies, Lifestyle, Culture.`,
            fields: `- "term": the English trending term
- "translation": its natural Chinese equivalent (short)
- "category": one of Tech/Gadgets/News/Gaming/Movies/Lifestyle/Culture (in English)
- "origin": one English sentence (max 20 words) explaining where the term came from`
        },
        jp: {
            intro: `今週（${weekKey}）の日本のインターネットで話題の最新トレンド語・流行語・バズワードを${count}個選んでください。分野は「テック、ガジェット、時事、ゲーム、映画、ライフ、カルチャー」からまんべんなく。`,
            fields: `- "term": 日本語のトレンドワード
- "translation": 対応する自然な英語表現（短く）
- "category": 「テック/ガジェット/時事/ゲーム/映画/ライフ/カルチャー」から一つ（日本語）
- "origin": その語の出所・由来を日本語で一文（30字以内）で`
        }
    };
    const spec = specs[lang] || specs.zh;
    return `${spec.intro}

严格只输出一个 JSON 对象（不要任何解释、不要 markdown 代码块标记），格式为：
{ "words": [ { 以下字段 }, ... ] }
${spec.fields}`;
}

function parseHotwords(text) {
    const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
    let parsed;
    try {
        parsed = JSON.parse(cleaned);
    } catch (e) {
        // 模型在 JSON 前后夹带说明文字时，按最外层结构括号截取
        const objStart = cleaned.indexOf('{');
        const arrStart = cleaned.indexOf('[');
        if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
            const arrEnd = cleaned.lastIndexOf(']');
            if (arrEnd <= arrStart) throw new Error('未能从返回中解析出 JSON 数组');
            parsed = JSON.parse(cleaned.slice(arrStart, arrEnd + 1));
        } else if (objStart !== -1) {
            const objEnd = cleaned.lastIndexOf('}');
            if (objEnd <= objStart) throw new Error('未能从返回中解析出 JSON 对象');
            parsed = JSON.parse(cleaned.slice(objStart, objEnd + 1));
        } else {
            throw new Error('未能从返回中解析出 JSON');
        }
    }
    const arr = Array.isArray(parsed) ? parsed : parsed.words;
    if (!Array.isArray(arr)) throw new Error('热词返回结构异常');
    return arr
        .filter(w => w && typeof w.term === 'string' && w.term.trim())
        .slice(0, HOTWORDS_COUNT)
        .map(w => ({
            term: String(w.term).trim(),
            translation: String(w.translation || '').trim(),
            category: String(w.category || '').trim(),
            origin: String(w.origin || '').trim()
        }));
}

async function generateHotwords(lang, weekKey) {
    const cfg = loadConfig();
    const hotwordsModelId = cfg.hotwordsModel || cfg.defaultModel;
    const config = getModelConfig(hotwordsModelId);
    if (!config || !config.key) throw new Error(`后端缺失热词引擎 (${hotwordsModelId}) 的 API 密钥`);

    const payload = {
        model: config.model,
        messages: [
            { role: 'system', content: '你是一位敏锐的中日英跨语言热点观察员，擅长追踪全球互联网每周的新词热梗，输出严格遵循要求的 JSON 格式。' },
            { role: 'user', content: buildHotwordsPrompt(lang, weekKey, HOTWORDS_COUNT) }
        ],
        temperature: 0.8
    };

    const response = await axios.post(config.url, payload, {
        headers: {
            'Authorization': `Bearer ${config.key}`,
            'Content-Type': 'application/json'
        },
        timeout: 60000
    });

    const text = response.data.choices[0].message.content;
    const words = parseHotwords(text);
    if (!words.length) throw new Error('热词解析结果为空');
    return words;
}

async function getHotwords(lang) {
    const weekKey = isoWeekKey();
    const cacheKey = `${lang}@${weekKey}`;

    if (hotwordsMemCache.has(cacheKey)) return hotwordsMemCache.get(cacheKey);
    if (hotwordsInflight.has(cacheKey)) return hotwordsInflight.get(cacheKey);

    const task = generateHotwords(lang, weekKey)
        .then(words => {
            hotwordsMemCache.set(cacheKey, words);
            persistHotwordsCache(weekKey);
            return words;
        })
        .finally(() => hotwordsInflight.delete(cacheKey));

    hotwordsInflight.set(cacheKey, task);
    return task;
}

const hotwordsRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 分钟窗口
    max: 20,
    keyGenerator: (req) => ipKeyGenerator(req.ip || req.socket.remoteAddress || ''),
    handler: (req, res) => {
        res.status(429).json({ error: '请求过于频繁：热词查询每分钟最多 20 次，请稍后再试。' });
    }
});

// 模型列表接口：供前端下拉框动态渲染（不含任何密钥信息）
app.get('/api/models', (req, res) => {
    const cfg = loadConfig();
    res.json({
        defaultModel: cfg.defaultModel,
        models: listEnabledModels().map(m => ({
            id: m.id,
            name: m.name,
            requiresLogin: m.requiresLogin
        }))
    });
});

app.get('/api/hotwords', hotwordsRateLimiter, async (req, res) => {
    const lang = ['zh', 'en', 'jp'].includes(req.query.lang) ? req.query.lang : 'zh';
    try {
        const words = await getHotwords(lang);
        res.json({ week: isoWeekKey(), lang, words });
    } catch (error) {
        console.error('每周热词生成失败:', error.response ? error.response.data : error.message);
        res.status(502).json({ error: '热词生成失败，请稍后重试。' });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`MVP 引擎已启动: http://localhost:${PORT}`);
});