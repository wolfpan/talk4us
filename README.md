
# Talk4us (优雅沟通)

**[Talk4us.com](https://talk4us.com) | 100% 免费 · 完全开源 · 支持私有化部署**

> **“我们不做翻译，只是帮助你更专业、优雅地表达想法。”**

Talk4us 是一个轻量级、专注跨文化职场与商业语境的 AI 文本重构引擎。它超越了传统机器翻译“字对字”的局限，基于大语言模型（GLM、Qwen、DeepSeek）进行深度语境重塑。通过将原始想法转化为符合职场博弈、向上管理或弱连结破冰的地道表达，Talk4us 致力于消除“机器味”，重构沟通筹码。

---

## 核心演进 (Key Updates)

相较于早期版本，当前 Talk4us 已进化为具备完备用户鉴权与流量控制的全栈应用：

* **Supabase 状态机驱动:** 引入完整的 JWT 鉴权体系。支持游客模式（默认模型，300 字符限制）与注册用户模式（解锁全量高级模型，500 字符限制）。
* **多语种引擎 (i18n):** 原生支持中文（CN）、英文（EN）与日文（JP）界面的无缝热切换，并可指定目标输出语言。
* **智能场景路由 (Context Sniffing):** 新增 `Auto-Detect` 模式。引擎能自动侦测文本核心诉求（如：维权交涉、边界设定、弱连结破冰），并动态加载战术规则。
* **动态频率限流:** 基于 `express-rate-limit` 构建防刷机制。游客限频 20 次/小时，登录用户限频 50 次/小时，保障自部署环境的安全与稳定。

---

## 理念：语境重塑而非机械翻译 (Philosophy)

沟通的本质是信息架构的重组与接收者心理预期的管理。本项目摒弃直译逻辑，将核心建立在以下三大专业准则之上：

* **建设性 (Constructive Firmness):** 告别弱势的“I think”，用地道表达，守住底线。
* **低压感 (Low-Pressure Courtesy):** 拒绝命令式短句，避免攻击性，轻松交流，促成合作。
* **情绪价值 (Emotional Reframing):** 转为坦诚、克制的言语，让每次交流都有分寸感。

---

## 架构与部署 (Installation)

系统采用轻量级全栈架构（Node.js / Express + Vanilla JS），无需复杂的构建工具，极度契合个人 VPS 或 Docker 环境下的快速私有化部署。

### 1. 系统初始化

```bash
git clone [https://github.com/wolfpan/Talk4us.git](https://github.com/wolfpan/Talk4us.git)
cd Talk4us
npm install

```

### 2. 环境配置

在项目根目录下创建 `.env` 文件。系统依赖 Supabase 进行用户鉴权：

```env
# 端口配置
PORT=3001

# Supabase 鉴权配置 (必需)
SUPABASE_URL=您的_Supabase_Project_URL
SUPABASE_ANON_KEY=您的_Supabase_Anon_Key
```

AI 引擎（API 地址 / 密钥 / 模型选择 / 是否需登录）统一在项目根目录的 `config.json` 中管理。首次部署请复制模板：

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

> `config.json` 含密钥，已加入 `.gitignore`；修改后**自动热加载**，无需重启服务。

### 3. 启动服务

```bash
# 开发环境启动
npm start

# 生产环境建议使用 PM2 守护进程
pm2 start server.js --name "talk4us"

```

服务默认运行在 `http://localhost:3001`。对于公网暴露，建议结合 Nginx 进行反向代理并配置 HTTPS 证书。

---

## 使用指南 (Usage)

1. **访问与鉴权:**
* 访问网站（如 [talk4us.com](https://www.google.com/url?sa=E&source=gmail&q=https://talk4us.com)），可通过“游客模式”直接体验基础重构功能（默认调用 GLM-4-Flash）。
* 点击“登录”注册账户，即可解锁包括 DeepSeek-Flash 在内的高级引擎及更高的字符上限。


2. **设定与输入:**
* 在左侧面板输入您的原始想法（支持中、英、日等多语言夹杂）。
* 选择**场景**（推荐使用 `Auto` 自动侦测）及右侧面板的**目标输出语言**。


3. **重构与执行:**
* 按下 `Cmd/Ctrl + Enter`。
* 引擎将返回地道的高级文案，并在下方附带极简的 `Rationale`（重构逻辑），解释该表达如何优化了心理体验。一键复制即可应用于真实商业场景。


```
