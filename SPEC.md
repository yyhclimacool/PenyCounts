# PenyCounts 技术规格文档

> 本文档为 AI 及开发者提供完整的项目上下文。修改功能前请先阅读。

## 1. 项目概述

PenyCounts 是一个家庭记账 Web 应用，支持：

- 邮箱注册（SMTP 验证码）+ JWT 认证，用户数据隔离
- 两级分类体系（系统预置 + 用户自定义）的收支记录
- 多人分摊：一笔支出关联多位家庭成员，费用自动平分
- 多币种（CNY/USD/EUR 等）
- 人情往来（红包/礼金的送出与收到）
- 四维统计图表：月度趋势、分类占比、人员排名、人情汇总
- AI Native：接入 OpenAI 兼容 LLM，通过自然语言聊天记账/查询（SSE 流式）
- Docker Compose 一键自部署

---

## 2. 技术栈


| 层      | 技术                                      | 版本            |
| ------ | --------------------------------------- | ------------- |
| 前端框架   | React + TypeScript                      | 19.x + TS 6.x |
| 构建工具   | Vite                                    | 8.x           |
| CSS    | TailwindCSS v4 (`@tailwindcss/vite` 插件) | 4.2           |
| UI 组件  | shadcn/ui 风格 (Radix UI + CVA)           | —             |
| 图表     | Recharts                                | 3.x           |
| 状态管理   | Zustand                                 | 5.x           |
| HTTP   | Axios (REST) + Fetch (SSE 流式)           | —             |
| 路由     | react-router                            | 7.x           |
| 后端框架   | Rust Axum                               | 0.8           |
| 数据库驱动  | SQLx (async PostgreSQL)                 | 0.8           |
| 数据库    | PostgreSQL                              | 15            |
| 认证     | jsonwebtoken (HS256) + Argon2 密码哈希      | —             |
| 邮件     | Lettre SMTP                             | 0.11          |
| LLM 代理 | Reqwest (OpenAI-compatible SSE)         | 0.12          |
| 部署     | Docker Compose (3 services)             | —             |


---

## 3. 目录结构

```
PenyCounts/
├── backend/
│   ├── Cargo.toml                      # Rust 依赖
│   ├── Cargo.lock
│   ├── migrations/
│   │   ├── 001_initial.sql             # DDL: 9 张表 + 索引
│   │   └── 002_seed_categories.sql     # 预置 16 个一级分类 + 63 个二级分类
│   └── src/
│       ├── main.rs                     # 入口: 加载配置 → 连 DB → 迁移 → 启动
│       ├── config.rs                   # AppConfig (env) + AppState
│       ├── errors.rs                   # AppError 枚举 → IntoResponse
│       ├── db/mod.rs                   # PgPool 初始化
│       ├── models/mod.rs               # 9 个 DB 模型 + 请求/响应 DTO
│       ├── middleware/mod.rs           # JWT Claims + AuthUser 提取器
│       ├── handlers/                   # HTTP handler (每模块一个文件)
│       │   ├── mod.rs                  # create_router(): 43 条路由
│       │   ├── auth.rs
│       │   ├── categories.rs
│       │   ├── transactions.rs
│       │   ├── members.rs
│       │   ├── social_gifts.rs
│       │   ├── stats.rs
│       │   └── ai.rs
│       └── services/                   # 业务逻辑层 (每模块一个文件)
│           ├── mod.rs
│           ├── auth.rs                 # 注册/登录/验证/重置 + SMTP
│           ├── category.rs             # 分类 CRUD (系统分类保护)
│           ├── transaction.rs          # 交易 CRUD + 成员分摊
│           ├── member.rs               # 家庭成员 CRUD
│           ├── social_gift.rs          # 人情往来 CRUD
│           ├── stats.rs                # 5 个统计查询
│           └── ai.rs                   # LLM 配置 + SSE 流式聊天
├── frontend/
│   ├── package.json
│   ├── vite.config.ts                  # @别名, 端口 3000, /api 代理 → 8080
│   ├── tsconfig.json                   # strict, paths: @/* → src/*
│   ├── nginx.conf                      # 生产 Nginx: SPA + /api/ 反代
│   ├── index.html
│   └── src/
│       ├── main.tsx                    # BrowserRouter 入口
│       ├── App.tsx                     # 路由定义 + RequireAuth/RedirectIfAuth
│       ├── index.css                   # TailwindCSS v4 主题 (亮/暗色)
│       ├── vite-env.d.ts
│       ├── types/index.ts              # 全部 TypeScript 接口
│       ├── utils/
│       │   ├── cn.ts                   # clsx + tailwind-merge
│       │   └── format.ts              # formatCurrency, formatDate, formatTime
│       ├── hooks/
│       │   └── useToast.ts            # Zustand toast 状态
│       ├── stores/
│       │   ├── authStore.ts           # user, token, login/logout
│       │   └── chatStore.ts           # messages, isOpen, sendMessage, loadHistory
│       ├── services/
│       │   ├── api.ts                 # Axios 实例 + 拦截器
│       │   ├── auth.ts
│       │   ├── categories.ts
│       │   ├── transactions.ts
│       │   ├── members.ts
│       │   ├── socialGifts.ts
│       │   ├── stats.ts
│       │   └── ai.ts                  # SSE 流式 chat 用 fetch
│       ├── components/
│       │   ├── ui/                    # 12 个 shadcn 风格基础组件
│       │   ├── layout/
│       │   │   ├── Sidebar.tsx        # 左侧导航 (6 项)
│       │   │   └── AppLayout.tsx      # 布局框架
│       │   └── chat/
│       │       ├── ChatSidebar.tsx    # 右侧滑入聊天面板
│       │       └── QuickChatInput.tsx # 底部浮动输入 (⌘K)
│       └── pages/
│           ├── LoginPage.tsx
│           ├── RegisterPage.tsx
│           ├── VerifyEmailPage.tsx
│           ├── ForgotPasswordPage.tsx
│           ├── ResetPasswordPage.tsx
│           ├── DashboardPage.tsx
│           ├── TransactionsPage.tsx
│           ├── CategoriesPage.tsx
│           ├── SocialGiftsPage.tsx
│           ├── StatisticsPage.tsx
│           └── SettingsPage.tsx
├── docker-compose.yml
├── Dockerfile.backend                  # cargo-chef 多阶段
├── Dockerfile.frontend                 # node build + nginx
├── .env.example
├── .gitignore
├── README.md
└── SPEC.md                             # ← 本文件
```

---

## 4. 数据库 Schema

### 4.1 表结构

#### `users`


| 列                  | 类型           | 约束                             |
| ------------------ | ------------ | ------------------------------ |
| id                 | UUID         | PK, DEFAULT uuid_generate_v4() |
| email              | VARCHAR(255) | UNIQUE NOT NULL                |
| password_hash      | VARCHAR(255) | NOT NULL                       |
| nickname           | VARCHAR(100) | NOT NULL                       |
| email_verified     | BOOLEAN      | DEFAULT FALSE                  |
| verification_token | VARCHAR(255) | nullable                       |
| created_at         | TIMESTAMPTZ  | DEFAULT NOW()                  |
| updated_at         | TIMESTAMPTZ  | DEFAULT NOW()                  |


#### `categories`


| 列          | 类型           | 约束                                                   |
| ---------- | ------------ | ---------------------------------------------------- |
| id         | UUID         | PK                                                   |
| user_id    | UUID         | FK→users ON DELETE CASCADE, **nullable** (NULL=系统默认) |
| name       | VARCHAR(100) | NOT NULL                                             |
| type       | VARCHAR(10)  | CHECK IN ('income', 'expense')                       |
| icon       | VARCHAR(50)  | DEFAULT '📦'                                         |
| sort_order | INT          | DEFAULT 0                                            |


#### `subcategories`


| 列           | 类型           | 约束                                       |
| ----------- | ------------ | ---------------------------------------- |
| id          | UUID         | PK                                       |
| category_id | UUID         | FK→categories ON DELETE CASCADE          |
| user_id     | UUID         | FK→users ON DELETE CASCADE, **nullable** |
| name        | VARCHAR(100) | NOT NULL                                 |
| icon        | VARCHAR(50)  | DEFAULT '📎'                             |
| sort_order  | INT          | DEFAULT 0                                |


#### `transactions`


| 列              | 类型            | 约束                             |
| -------------- | ------------- | ------------------------------ |
| id             | UUID          | PK                             |
| user_id        | UUID          | FK→users ON DELETE CASCADE     |
| category_id    | UUID          | FK→categories                  |
| subcategory_id | UUID          | FK→subcategories, nullable     |
| type           | VARCHAR(10)   | CHECK IN ('income', 'expense') |
| amount         | NUMERIC(15,2) | NOT NULL                       |
| currency       | VARCHAR(10)   | DEFAULT 'CNY'                  |
| date           | DATE          | NOT NULL                       |
| time           | TIME          | DEFAULT '00:00:00'             |
| location       | VARCHAR(255)  | nullable                       |
| note           | TEXT          | nullable                       |
| created_at     | TIMESTAMPTZ   | DEFAULT NOW()                  |


#### `transaction_members`


| 列              | 类型            | 约束                                |
| -------------- | ------------- | --------------------------------- |
| id             | UUID          | PK                                |
| transaction_id | UUID          | FK→transactions ON DELETE CASCADE |
| member_name    | VARCHAR(100)  | NOT NULL                          |
| share_amount   | NUMERIC(15,2) | NOT NULL                          |


#### `members`


| 列       | 类型           | 约束                         |
| ------- | ------------ | -------------------------- |
| id      | UUID         | PK                         |
| user_id | UUID         | FK→users ON DELETE CASCADE |
| name    | VARCHAR(100) | NOT NULL                   |


#### `social_gifts`


| 列           | 类型            | 约束                           |
| ----------- | ------------- | ---------------------------- |
| id          | UUID          | PK                           |
| user_id     | UUID          | FK→users ON DELETE CASCADE   |
| type        | VARCHAR(10)   | CHECK IN ('give', 'receive') |
| person_name | VARCHAR(100)  | NOT NULL                     |
| relation    | VARCHAR(100)  | nullable                     |
| occasion    | VARCHAR(255)  | NOT NULL                     |
| amount      | NUMERIC(15,2) | NOT NULL                     |
| currency    | VARCHAR(10)   | DEFAULT 'CNY'                |
| date        | DATE          | NOT NULL                     |
| note        | TEXT          | nullable                     |
| created_at  | TIMESTAMPTZ   | DEFAULT NOW()                |


#### `llm_configs`


| 列          | 类型           | 约束                         |
| ---------- | ------------ | -------------------------- |
| id         | UUID         | PK                         |
| user_id    | UUID         | FK→users ON DELETE CASCADE |
| provider   | VARCHAR(50)  | NOT NULL                   |
| api_url    | VARCHAR(500) | NOT NULL                   |
| api_key    | VARCHAR(500) | nullable                   |
| model_name | VARCHAR(100) | NOT NULL                   |
| is_active  | BOOLEAN      | DEFAULT TRUE               |


#### `chat_messages`


| 列          | 类型          | 约束                             |
| ---------- | ----------- | ------------------------------ |
| id         | UUID        | PK                             |
| user_id    | UUID        | FK→users ON DELETE CASCADE     |
| role       | VARCHAR(20) | CHECK IN ('user', 'assistant') |
| content    | TEXT        | NOT NULL                       |
| created_at | TIMESTAMPTZ | DEFAULT NOW()                  |


### 4.2 索引

`idx_categories_user_id`, `idx_subcategories_category_id`, `idx_transactions_user_id`, `idx_transactions_date`, `idx_transactions_type`, `idx_transaction_members_transaction_id`, `idx_members_user_id`, `idx_social_gifts_user_id`, `idx_social_gifts_date`, `idx_chat_messages_user_id`

### 4.3 预置分类 (user_id IS NULL)

**支出 (11 个一级):** 餐饮美食🍜、交通出行🚗、居家生活🏠、购物消费🛒、医疗健康🏥、教育学习📚、休闲娱乐🎮、人情往来🎁、金融保险💰、宠物🐾、其他支出📦

**收入 (5 个一级):** 工资薪酬💼、兼职副业💻、投资收益📈、人情收入🧧、其他收入📥

每个一级分类下有 2-6 个二级分类，共 63 个二级分类。详见 `002_seed_categories.sql`。

---

## 5. 后端 API 参考

### 5.1 全局约定

- **Base path:** `/api`
- **认证:** 除 `/api/auth/`* 和 `/api/health` 外，所有端点需 `Authorization: Bearer <JWT>` header
- **错误响应:** `{ "error": "message" }` + 对应 HTTP status (400/401/403/404/422/500)
- **分页:** 支持 `page` + `per_page` 查询参数，返回 `PaginatedResponse { data, total, page, per_page }`
- **ID 格式:** UUID v4
- **金额:** NUMERIC(15,2)，JSON 中序列化为字符串 (serde `with-str`)

### 5.2 路由表

#### 认证 (public)


| 方法   | 路径                        | Handler               | 请求体/参数                          | 响应                                 |
| ---- | ------------------------- | --------------------- | ------------------------------- | ---------------------------------- |
| POST | /api/auth/register        | auth::register        | `{ email, password, nickname }` | 201 `UserResponse`                 |
| POST | /api/auth/login           | auth::login           | `{ email, password }`           | 200 `AuthResponse { token, user }` |
| GET  | /api/auth/verify-email    | auth::verify_email    | `?token=xxx`                    | 200 `{ message }`                  |
| POST | /api/auth/forgot-password | auth::forgot_password | `{ email }`                     | 200 `{ message }`                  |
| POST | /api/auth/reset-password  | auth::reset_password  | `{ token, new_password }`       | 200 `{ message }`                  |


#### 分类 (需认证)


| 方法     | 路径                                          | Handler                        | 说明                     |
| ------ | ------------------------------------------- | ------------------------------ | ---------------------- |
| GET    | /api/categories                             | categories::list_categories    | 返回系统默认 + 用户自定义分类       |
| POST   | /api/categories                             | categories::create_category    | `{ name, type, icon }` |
| GET    | /api/categories/{id}                        | categories::get_category       |                        |
| PUT    | /api/categories/{id}                        | categories::update_category    | 系统默认分类禁止修改             |
| DELETE | /api/categories/{id}                        | categories::delete_category    | 系统默认分类禁止删除             |
| GET    | /api/categories/{category_id}/subcategories | categories::list_subcategories |                        |
| POST   | /api/categories/{category_id}/subcategories | categories::create_subcategory | `{ name, icon }`       |
| PUT    | /api/subcategories/{id}                     | categories::update_subcategory |                        |
| DELETE | /api/subcategories/{id}                     | categories::delete_subcategory |                        |


#### 交易 (需认证)


| 方法     | 路径                             | Handler                               | 说明                                                                                                           |
| ------ | ------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| GET    | /api/transactions              | transactions::list_transactions       | 查询: `start_date, end_date, category_id, type, search, page, per_page`                                        |
| POST   | /api/transactions              | transactions::create_transaction      | `{ category_id, subcategory_id?, type, amount, currency, date, time, location?, note?, members?: string[] }` |
| GET    | /api/transactions/{id}         | transactions::get_transaction         |                                                                                                              |
| PUT    | /api/transactions/{id}         | transactions::update_transaction      | 同 create 请求体                                                                                                 |
| DELETE | /api/transactions/{id}         | transactions::delete_transaction      |                                                                                                              |
| GET    | /api/transactions/{id}/members | transactions::get_transaction_members |                                                                                                              |


> **分摊逻辑:** 创建/更新交易时，若 `members` 非空，`share_amount = amount / members.len()`

#### 成员 (需认证)


| 方法     | 路径                | Handler                |
| ------ | ----------------- | ---------------------- |
| GET    | /api/members      | members::list_members  |
| POST   | /api/members      | members::create_member |
| GET    | /api/members/{id} | members::get_member    |
| PUT    | /api/members/{id} | members::update_member |
| DELETE | /api/members/{id} | members::delete_member |


#### 人情往来 (需认证)


| 方法     | 路径                     | Handler                          | 说明                                                                                        |
| ------ | ---------------------- | -------------------------------- | ----------------------------------------------------------------------------------------- |
| GET    | /api/social-gifts      | social_gifts::list_social_gifts  | 查询: `type, person_name, year, page, per_page`                                             |
| POST   | /api/social-gifts      | social_gifts::create_social_gift | `{ type(give/receive), person_name, relation?, occasion, amount, currency, date, note? }` |
| GET    | /api/social-gifts/{id} | social_gifts::get_social_gift    |                                                                                           |
| PUT    | /api/social-gifts/{id} | social_gifts::update_social_gift |                                                                                           |
| DELETE | /api/social-gifts/{id} | social_gifts::delete_social_gift |                                                                                           |


#### 统计 (需认证)


| 方法  | 路径                            | Handler                   | 查询参数                          | 响应类型                  |
| --- | ----------------------------- | ------------------------- | ----------------------------- | --------------------- |
| GET | /api/stats/monthly-trend      | stats::monthly_trend      | `year`                        | `MonthlyTrendItem[]`  |
| GET | /api/stats/monthly-detail     | stats::monthly_detail     | `year, month`                 | `Transaction[]`       |
| GET | /api/stats/category-breakdown | stats::category_breakdown | `start_date, end_date, type?` | `CategoryBreakdown[]` |
| GET | /api/stats/member-breakdown   | stats::member_breakdown   | `start_date, end_date`        | `MemberBreakdown[]`   |
| GET | /api/stats/social-summary     | stats::social_summary     | `year`                        | `SocialSummary[]`     |


#### AI (需认证)


| 方法     | 路径                            | Handler             | 说明                    |
| ------ | ----------------------------- | ------------------- | --------------------- |
| GET    | /api/ai/configs               | ai::list_configs    | 当前用户的 LLM 配置列表        |
| POST   | /api/ai/configs               | ai::create_config   | 创建并自动激活               |
| PUT    | /api/ai/configs/{id}          | ai::update_config   |                       |
| DELETE | /api/ai/configs/{id}          | ai::delete_config   |                       |
| POST   | /api/ai/configs/{id}/activate | ai::activate_config | 停用其他、激活此配置            |
| POST   | /api/ai/chat                  | ai::chat            | `{ message }` → SSE 流 |
| GET    | /api/ai/chat/history          | ai::chat_history    |                       |
| DELETE | /api/ai/chat/history          | ai::clear_history   |                       |


#### 健康检查


| 方法  | 路径          | 响应     |
| --- | ----------- | ------ |
| GET | /api/health | `"ok"` |


### 5.3 SSE 聊天协议

请求: `POST /api/ai/chat` with `{ "message": "..." }`

响应: `Content-Type: text/event-stream`

```
data: 内容片段1

data: 内容片段2

event: tool_call
data: {"name":"create_transaction","arguments":{...}}

data: [DONE]
```

后端构造 System Prompt 包含用户分类体系，定义了 `create_transaction` 和 `query_transactions` 两个 tool，以 OpenAI-compatible 格式转发到用户配置的 LLM endpoint。

---

## 6. 前端架构参考

### 6.1 路由表


| 路径               | 页面                 | 鉴权             | 布局        |
| ---------------- | ------------------ | -------------- | --------- |
| /login           | LoginPage          | RedirectIfAuth | 无 (全屏)    |
| /register        | RegisterPage       | RedirectIfAuth | 无         |
| /verify-email    | VerifyEmailPage    | 无              | 无         |
| /forgot-password | ForgotPasswordPage | RedirectIfAuth | 无         |
| /reset-password  | ResetPasswordPage  | RedirectIfAuth | 无         |
| /                | DashboardPage      | RequireAuth    | AppLayout |
| /transactions    | TransactionsPage   | RequireAuth    | AppLayout |
| /social-gifts    | SocialGiftsPage    | RequireAuth    | AppLayout |
| /categories      | CategoriesPage     | RequireAuth    | AppLayout |
| /statistics      | StatisticsPage     | RequireAuth    | AppLayout |
| /settings        | SettingsPage       | RequireAuth    | AppLayout |


所有受保护页面使用 `React.lazy()` + `Suspense` 实现代码分割。

### 6.2 状态管理

**authStore** (`stores/authStore.ts`)

- State: `user: User | null`, `token: string | null`, `isAuthenticated: boolean`
- Actions: `login(token, user)`, `logout()`, `setUser(user)`
- 持久化: token 存入 `localStorage` key `penycounts_token`

**chatStore** (`stores/chatStore.ts`)

- State: `messages: ChatMessageUI[]`, `isOpen: boolean`, `isLoading: boolean`, `historyLoaded: boolean`
- Actions: `setOpen(open)`, `sendMessage(text)`, `loadHistory()`, `clearMessages()`
- `ChatMessageUI` 扩展 `ChatMessage`，增加 `isStreaming?: boolean`

**useToast** (`hooks/useToast.ts`)

- Zustand store: `toasts: Toast[]`
- Actions: `addToast(toast)` / `toast(toast)`, `dismiss(id)` / `removeToast(id)`
- 自动 4 秒消失

### 6.3 Service 层约定

- 所有 REST 调用通过 `services/api.ts` 的 Axios 实例（自动附 Bearer token）
- 401 响应: 清除 token，重定向到 /login
- Base URL: `VITE_API_URL` 环境变量（默认 `/api`，开发时 Vite 代理到 8080）
- AI 聊天流: `services/ai.ts` 中 `chat()` 使用原生 `fetch` + `ReadableStream`，非 Axios

### 6.4 UI 组件库

基于 shadcn/ui 模式，位于 `components/ui/`:


| 组件               | 文件            | 底层                         |
| ---------------- | ------------- | -------------------------- |
| Button           | button.tsx    | CVA + @radix-ui/react-slot |
| Input            | input.tsx     | forwardRef                 |
| Textarea         | textarea.tsx  | forwardRef                 |
| Label            | label.tsx     | @radix-ui/react-label      |
| Card             | card.tsx      | div 组合                     |
| Dialog           | dialog.tsx    | @radix-ui/react-dialog     |
| Select           | select.tsx    | @radix-ui/react-select     |
| Tabs             | tabs.tsx      | @radix-ui/react-tabs       |
| Badge            | badge.tsx     | CVA                        |
| Separator        | separator.tsx | @radix-ui/react-separator  |
| Toast            | toast.tsx     | 自定义 + Zustand              |
| Toaster (unused) | toaster.tsx   | 旧版，未接入                     |


### 6.5 TailwindCSS v4 主题

配置在 `src/index.css`，使用 `@theme inline` + `:root` CSS 变量模式。

**语义色彩 token (可用作 TW 类如 `bg-primary`, `text-muted-foreground`):**


| Token              | 亮色      | 暗色      | 用途           |
| ------------------ | ------- | ------- | ------------ |
| background         | #f8fafc | #0f172a | 页面背景         |
| foreground         | #0f172a | #f8fafc | 主文字          |
| card               | #ffffff | #1e293b | 卡片背景         |
| primary            | #6366f1 | #818cf8 | 主题色 (indigo) |
| secondary          | #f1f5f9 | #334155 | 次要背景         |
| muted              | #f1f5f9 | #334155 | 弱化元素         |
| muted-foreground   | #64748b | #94a3b8 | 弱化文字         |
| destructive        | #ef4444 | #dc2626 | 危险操作         |
| border             | #e2e8f0 | #334155 | 边框           |
| ring               | #6366f1 | #818cf8 | 聚焦环          |
| income             | #22c55e | #4ade80 | 收入 (绿)       |
| expense            | #ef4444 | #f87171 | 支出 (红)       |
| sidebar            | #ffffff | #1e293b | 侧边栏背景        |
| sidebar-foreground | #334155 | #cbd5e1 | 侧边栏文字        |
| sidebar-accent     | #f1f5f9 | #334155 | 侧边栏高亮        |


**圆角:** `--radius: 0.625rem`，派生 `sm/md/lg/xl`。

**动画:** `fade-in`, `content-in`, `toast-in`, `toast-out`, `spin`。

支持 `prefers-color-scheme: dark` 自动暗色模式。

---

## 7. 环境变量

### 7.1 后端 (`.env` / docker-compose)


| 变量                | 必填  | 默认         | 说明                 |
| ----------------- | --- | ---------- | ------------------ |
| DATABASE_URL      | 是   | —          | PostgreSQL 连接串     |
| JWT_SECRET        | 是   | —          | JWT 签名密钥           |
| JWT_EXPIRY_HOURS  | 否   | 72         | Token 有效时长         |
| SMTP_HOST         | 是   | —          | SMTP 服务器           |
| SMTP_PORT         | 否   | 587        | SMTP 端口            |
| SMTP_USERNAME     | 是   | —          | SMTP 用户名           |
| SMTP_PASSWORD     | 是   | —          | SMTP 密码/授权码        |
| SMTP_FROM         | 是   | —          | 发件人地址              |
| SERVER_HOST       | 否   | 0.0.0.0    | 监听地址               |
| SERVER_PORT       | 否   | 8080       | 监听端口               |
| FRONTEND_URL      | 是   | —          | 前端地址 (CORS + 邮件链接) |
| POSTGRES_USER     | 否   | penycounts | Docker Compose 用   |
| POSTGRES_PASSWORD | 否   | penycounts | Docker Compose 用   |
| POSTGRES_DB       | 否   | penycounts | Docker Compose 用   |


### 7.2 前端 (Vite 环境变量)


| 变量           | 默认   | 说明           |
| ------------ | ---- | ------------ |
| VITE_API_URL | /api | API Base URL |


---

## 8. 部署架构

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Browser     │────▶│  Frontend    │────▶│  Backend     │
│  :80         │     │  (Nginx)     │     │  (Axum)      │
│              │     │  :80         │     │  :8080       │
│              │     │  静态文件     │     │              │
│              │     │  /api/ 反代   │────▶│  REST + SSE  │
└─────────────┘     └──────────────┘     └──────┬───────┘
                                                │
                                         ┌──────▼───────┐
                                         │  PostgreSQL   │
                                         │  :5432        │
                                         └──────────────┘
```

- **postgres**: 带 healthcheck，数据持久化到 named volume
- **backend**: 等待 postgres healthy 后启动，运行 `sqlx::migrate!()` 自动执行迁移
- **frontend**: Nginx 提供 SPA 静态文件 + 反代 `/api/` 到 backend
- Nginx 配置了 `proxy_buffering off` 以支持 SSE 流式传输

---

## 9. 开发指南

### 本地开发

```bash
# 后端
cd backend
cp ../.env.example ../.env  # 编辑配置
cargo run                    # 启动 :8080

# 前端
cd frontend
npm install
npm run dev                  # 启动 :3000，/api 代理到 :8080
```

### 添加新的 API 端点

1. 在 `backend/src/models/mod.rs` 添加请求/响应 DTO
2. 在 `backend/src/services/` 对应模块添加业务函数
3. 在 `backend/src/handlers/` 对应模块添加 handler
4. 在 `backend/src/handlers/mod.rs` 的 `create_router()` 注册路由
5. 在 `frontend/src/types/index.ts` 添加对应 TypeScript 接口
6. 在 `frontend/src/services/` 添加 API 调用函数

### 添加新的前端页面

1. 在 `frontend/src/pages/` 创建页面组件 (default export)
2. 在 `frontend/src/App.tsx` 添加 `lazy()` import 和路由
3. 若需要侧边栏入口，在 `frontend/src/components/layout/Sidebar.tsx` 的 `navItems` 数组添加

### 数据库迁移

新建 `backend/migrations/NNN_description.sql`，后端启动时 `sqlx::migrate!()` 自动执行。

### 编译检查

```bash
# 后端 (不需要数据库连接)
cd backend && SQLX_OFFLINE=true cargo check

# 前端
cd frontend && npx tsc --noEmit && npm run build
```

---

## 10. 已知限制 & 待改进

1. **Token 刷新**: 当前 JWT 过期后直接跳转登录，无静默刷新机制
2. **文件上传**: 不支持交易附件/收据图片
3. **导出**: 不支持 CSV/Excel 导出
4. **多语言**: 仅中文 UI
5. **通知**: 无预算超支提醒
6. **AI Tool Calling**: 后端已定义 `create_transaction` / `query_transactions` tools，但 tool call 结果尚未自动执行入库（需前端确认流程）
7. **toaster.tsx**: `components/ui/toaster.tsx` 是旧版未使用的 Toast 组件，可删除

