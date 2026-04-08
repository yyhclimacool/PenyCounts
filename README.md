# PenyCounts - 家庭记账系统

一个现代化的家庭记账应用，支持分类记账、多人分摊、人情往来、丰富的统计图表和 AI 聊天记账。

## 功能特性

- **用户系统**：邮箱注册（SMTP 验证）、JWT 认证、权限隔离
- **分类记账**：两级分类体系（预置 + 自定义），支持收入和支出
- **多人分摊**：一笔支出可关联多个家庭成员，费用自动平分
- **多币种**：支持 CNY、USD、EUR 等多种货币
- **人情往来**：记录红包礼金的送出与收到，按人汇总
- **统计图表**：月度趋势、分类占比、人员排名、人情汇总
- **AI 记账**：接入 LLM（LM Studio / OpenAI 兼容 API），通过聊天自然语言记账和查询
- **Docker 部署**：一键 Docker Compose 部署

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite + TailwindCSS v4 |
| UI 组件 | shadcn/ui 风格 (Radix UI + CVA) |
| 图表 | Recharts |
| 状态管理 | Zustand |
| 后端 | Rust + Axum |
| 数据库 | PostgreSQL 15 |
| 认证 | JWT + Argon2 密码哈希 |
| 邮件 | Lettre (SMTP) |
| 部署 | Docker + Docker Compose |

## 快速开始

### Docker 部署（推荐）

1. 克隆项目并配置环境变量：

```bash
git clone <repo-url>
cd PenyCounts
cp .env.example .env
```

2. 编辑 `.env` 文件，至少修改以下配置：

```bash
# 必须修改：JWT 密钥（随机字符串）
JWT_SECRET=your-random-secret-key-here

# 必须修改：SMTP 邮件配置
SMTP_HOST=smtp.qq.com        # QQ邮箱示例
SMTP_PORT=587
SMTP_USERNAME=your@qq.com
SMTP_PASSWORD=your-smtp-auth-code
SMTP_FROM=PenyCounts <your@qq.com>

# 按需修改：前端访问地址
FRONTEND_URL=http://localhost  # 或你的域名
```

3. 启动服务：

```bash
docker compose up -d --build
```

4. 访问 `http://localhost` 即可使用。

### 本地开发

**前置要求**：Rust, Node.js 20+, PostgreSQL

1. 启动 PostgreSQL 并创建数据库：

```bash
createdb penycounts
```

2. 配置环境变量：

```bash
cp .env.example .env
# 编辑 .env，设置 DATABASE_URL 和 SMTP 配置
# 开发模式 FRONTEND_URL 设为 http://localhost:3000
```

3. 启动后端：

```bash
cd backend
cargo run
```

4. 启动前端：

```bash
cd frontend
npm install
npm run dev
```

5. 前端访问 `http://localhost:3000`，API 自动代理到 `http://localhost:8080`。

## SMTP 配置示例

### QQ 邮箱

1. 开启 SMTP 服务：QQ邮箱 -> 设置 -> 账户 -> 开启 SMTP 服务
2. 获取授权码

```
SMTP_HOST=smtp.qq.com
SMTP_PORT=587
SMTP_USERNAME=your@qq.com
SMTP_PASSWORD=QQ邮箱授权码
SMTP_FROM=PenyCounts <your@qq.com>
```

### Gmail

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your@gmail.com
SMTP_PASSWORD=App Password
SMTP_FROM=PenyCounts <your@gmail.com>
```

## AI 功能配置

注册登录后，进入「设置」页面配置 LLM：

### LM Studio（本地）

```
Provider: lm-studio
API URL: http://host.docker.internal:1234/v1/chat/completions
Model: 你的模型名称
```

> Docker 中访问宿主机的 LM Studio 使用 `host.docker.internal`

### OpenAI / 兼容 API

```
Provider: openai
API URL: https://api.openai.com/v1/chat/completions
API Key: sk-...
Model: gpt-4o-mini
```

配置完成后，使用底部快捷输入框或右侧 AI 聊天面板，用自然语言记账：

- "今天中午在食堂花了 25 元"
- "这个月花了多少钱？"
- "上个月餐饮类支出是多少？"

## 项目结构

```
PenyCounts/
├── frontend/                  # React 前端
│   ├── src/
│   │   ├── components/        # 组件
│   │   │   ├── ui/            # 基础 UI 组件
│   │   │   ├── layout/        # 布局组件
│   │   │   └── chat/          # AI 聊天组件
│   │   ├── pages/             # 页面
│   │   ├── services/          # API 请求
│   │   ├── stores/            # 状态管理
│   │   ├── types/             # 类型定义
│   │   └── utils/             # 工具函数
│   └── nginx.conf             # 生产环境 Nginx 配置
├── backend/                   # Rust 后端
│   ├── src/
│   │   ├── handlers/          # HTTP 路由处理
│   │   ├── services/          # 业务逻辑
│   │   ├── models/            # 数据模型
│   │   ├── middleware/        # JWT 认证
│   │   └── config.rs          # 配置
│   └── migrations/            # 数据库迁移
├── docker-compose.yml
├── Dockerfile.backend
├── Dockerfile.frontend
└── .env.example
```

## API 文档

| 模块 | 端点 | 说明 |
|------|------|------|
| 认证 | `POST /api/auth/register` | 注册 |
| | `POST /api/auth/login` | 登录 |
| | `GET /api/auth/verify-email` | 邮箱验证 |
| 分类 | `GET /api/categories` | 获取所有分类 |
| | `POST /api/categories` | 创建分类 |
| 交易 | `GET /api/transactions` | 交易列表（分页/筛选） |
| | `POST /api/transactions` | 创建交易 |
| 成员 | `GET /api/members` | 成员列表 |
| 人情 | `GET /api/social-gifts` | 人情往来列表 |
| 统计 | `GET /api/stats/monthly-trend` | 月度趋势 |
| | `GET /api/stats/category-breakdown` | 分类分析 |
| | `GET /api/stats/member-breakdown` | 人员分析 |
| | `GET /api/stats/social-summary` | 人情汇总 |
| AI | `POST /api/ai/chat` | AI 聊天（SSE 流式） |
| | `GET /api/ai/configs` | LLM 配置 |

## License

MIT
