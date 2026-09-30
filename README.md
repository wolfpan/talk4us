<div align="center">

# Talk4us · 会聊

**把想说的话，变成对方愿意听的话。**

[在线使用](https://talk4us.com) · 100% 免费 · [MIT 开源](LICENSE) · 支持私有化部署

中文 / English / 日本語

</div>

---

## 为什么做这个网站

不是每个人都能出口成章。很多时候我们心里明明有清楚的想法，话到嘴边却变了味：

- 想**拒绝**一个不合理的需求，打出来的字却生硬得像在下战书；
- 想**催促**对方推进，又怕显得咄咄逼人；
- 给老板写汇报、给客户写邮件，反复删改十几遍还是觉得“差点意思”；
- 换成英语、日语更慌——语法检查全绿，语气却总是不对。

Talk4us 就是为这些时刻做的。**它不是逐字翻译的机器，而是帮你优雅交流、流畅沟通的“高情商同事”**：你写下真实的想法，它帮你重写成专业、优雅、有分寸的表达——并告诉你为什么这样改。

而且，**每一次使用，都是一次外语写作课**。每条结果都附带简短的 Rationale（重构说明）：为什么换这个措辞、语气强在哪里、委婉在哪里。用得多了，地道表达自然就内化了——优雅沟通的同时，顺手把外语也学了。这就是我们做这个网站的初衷。

## 它能帮你做什么

**8 大场景，覆盖职场与生活中最难开口的时刻：**

| 场景 | 典型用途 |
| --- | --- |
| 自动检测（Auto） | 不确定选什么？引擎自动识别你的核心诉求 |
| 维权交涉 | 有理有据地争取应有的待遇与权益 |
| 向上管理 | 汇报、要资源、提异议，说进老板心里 |
| 催促 or 拒绝 | 温和施压不失分寸，婉拒对方不留疙瘩 |
| 弱连接增强 | cold email、破冰首联，让陌生人愿意回复 |
| 内部协作 | 跨部门协调、催排期，合作而非树敌 |
| 商业沟通 | 客户往来、商务谈判，专业得体 |
| 轻松社交 | 日常寒暄、闲聊接话，自然不尬 |

**其他能力：**

- **三语输出**：中文 / English / 日本語任选，输入可以中英日夹杂；
- **重构说明（Rationale）**：每次重写都解释“为什么这样更好”，看得多就学得快；
- **每周热词**：每周更新职场高频表达的地道用法；
- **游客即用**：打开就能体验，注册后解锁更多引擎与更高额度。

**所有重写遵循三个表达原则：**

1. **建设性**——告别弱势的 "I think"，用地道表达，守住底线；
2. **低压感**——拒绝命令式短句，让对方舒服地接受，促成合作；
3. **情绪价值**——坦诚、克制、有分寸，让每次交流都恰到好处。

## 使用指南

1. 打开 [talk4us.com](https://talk4us.com)（或你自己部署的地址），**无需注册**即可直接体验；
2. 在左侧输入框写下你的原始想法——口语化、碎片化、带情绪都没关系，越真实越好；
3. 选择**场景**（拿不准就选 `Auto` 自动检测），再在右侧选择**目标输出语言**；
4. 按 `Cmd/Ctrl + Enter`（或点击生成按钮）；
5. 右侧即呈现重写后的文案与 Rationale 说明，**一键复制**即可用于真实沟通。

**游客与注册用户的区别（注册同样免费）：**

| | 游客模式 | 注册用户 |
| --- | --- | --- |
| AI 引擎 | GLM 4 Flash | 全部引擎（含 DeepSeek Flash 等） |
| 单次输入上限 | 300 字符 | 500 字符 |
| 使用频率 | 20 次 / 小时 | 50 次 / 小时 |

## 自己部署一个

整个项目非常轻量（Node.js / Express + 原生 JS，无构建步骤），一台最便宜的 VPS 即可跑起来。

**准备事项：**

- Node.js ≥ 18（建议 20 LTS）与 npm；
- 一个 [Supabase](https://supabase.com) 项目（免费版即可，用于用户注册登录）；
- 至少一个 AI 引擎的 API Key（任何 OpenAI 兼容接口均可，如 [智谱 GLM](https://open.bigmodel.cn/)、[DeepSeek](https://www.deepseek.com/)）。

### 1. 克隆并安装依赖

```bash
git clone https://github.com/wolfpan/talk4us.git
cd talk4us
npm install
```

### 2. 配置环境变量

在项目根目录创建 `.env` 文件：

```env
# 端口（默认 3001）
PORT=3001

# Supabase 鉴权配置（必需）
SUPABASE_URL=你的_Supabase_Project_URL
SUPABASE_ANON_KEY=你的_Supabase_Anon_Key

# AI 引擎密钥（按需填写，与 config.json 中 env: 引用对应）
GLM_API_KEY=你的_智谱_API_Key
DS_API_KEY=你的_DeepSeek_API_Key

# Supabase 自动恢复（可选，强烈建议免费版配置）
# 免费版项目闲置 7 天会被暂停、全站鉴权失败。服务内置每日保活；
# 配置个人访问令牌后，项目万一被暂停也会自动 Restore，无需再到后台手动恢复。
# 令牌获取：https://supabase.com/dashboard/account/tokens （sbp_ 开头）
SUPABASE_ACCESS_TOKEN=你的_Supabase_Access_Token
```

> 可选：`SUPABASE_KEEPALIVE_CRON` 自定义保活时间表（默认 `0 9 * * *` 每天 09:00）；设 `SUPABASE_KEEPALIVE_DISABLED=1` 可关闭保活。

### 3. 配置 AI 引擎

复制模板并编辑：

```bash
cp config.example.json config.json
```

```jsonc
{
  "defaultModel": "glm",            // 游客默认引擎 & 未匹配时的回退引擎
  "hotwordsModel": "glm",           // 每周热词生成使用的引擎（缺省用 defaultModel）
  "models": {
    "glm": {
      "name": "GLM 4 Flash",        // 前端下拉框显示名称
      "url": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      "model": "glm-4-flash-250414",
      "key": "env:GLM_API_KEY",     // 支持 "env:变量名" 引用 .env，或直接写明文密钥
      "requiresLogin": false,       // 是否登录后才能选用
      "enabled": true               // false 时不下发到前端
    }
  }
}
```

> `config.json` 含密钥，已在 `.gitignore` 中排除；修改后**自动热加载**，无需重启服务。

### 4. 启动

```bash
# 开发环境
npm start

# 生产环境建议使用 PM2 守护进程
pm2 start server.js --name "talk4us"
```

服务默认运行在 `http://localhost:3001`。如需公网访问，建议用 Nginx 反向代理并配置 HTTPS 证书。

## 技术栈

Node.js / Express + 原生 JavaScript（无构建工具）· Supabase（注册登录与 JWT 鉴权）· express-rate-limit（游客 / 用户分级限流）· SQLite（每周热词）。AI 引擎通过 `config.json` 接入任意 OpenAI 兼容接口，GLM、DeepSeek、Qwen 等即插即用。

## 开源协议

本项目基于 [MIT License](LICENSE) 开源——你可以自由使用、修改和分发，包括商业用途。如果它帮到了你，欢迎 Star 支持；也欢迎通过 Issue 和 PR 一起把它做得更好。

---

**[Talk4us.com](https://talk4us.com) — 我们不做翻译，只是帮助你更专业、优雅地表达想法。**
