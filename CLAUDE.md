# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PenyCounts is a family expense tracking web app (Chinese UI) with: categorized transactions, multi-person expense splitting, social gift tracking (红包/礼金), statistics charts, AI-powered natural language bookkeeping via LLM integration (SSE streaming), and multi-family support.

## Development Commands

### Backend (Rust + Axum)

```bash
cd backend
cargo run                        # Start dev server on :8080
cargo check                      # Fast compile check (needs DB or SQLX_OFFLINE=true)
SQLX_OFFLINE=true cargo check    # Compile check without DB connection
cargo build --release            # Production build
```

### Frontend (React + Vite)

```bash
cd frontend
npm install                      # Install dependencies
npm run dev                      # Dev server on :3000, proxies /api → :8080
npm run build                    # Type-check (tsc --noEmit) + production build
npm run lint                     # ESLint
npx tsc --noEmit                 # Type-check only
```

### Docker (full stack)

```bash
docker compose up -d --build     # Build and start all services
docker compose down              # Stop all services
```

### Database

PostgreSQL 15. Migrations run automatically on backend startup via `sqlx::migrate!()`, which **embeds migration files at compile time** — adding/editing a migration requires rebuilding the backend image (`docker compose up -d --build backend`), not just a restart.

Migrations are consolidated into two files (the project assumes full redeployment / DB wipe rather than incremental migration history):

- `001_initial_schema.sql` — all tables, indexes, constraints (multi-family schema with `family_id` scoping, circular FK between users/families resolved via `ALTER TABLE`).
- `002_seed_default_categories.sql` — all default categories + subcategories (icons inlined).

Add new migrations as `backend/migrations/NNN_description.sql`. Editing the consolidated files requires wiping the DB (`docker compose down -v`) before redeploy, since changing already-applied migration files breaks the `_sqlx_migrations` checksum.

Access DB in Docker: `docker exec penycounts-postgres-1 psql -U penycounts -d penycounts`

## Architecture

**Three-service Docker Compose:** postgres → backend (Axum :8080) → frontend (Nginx :80, reverse-proxies `/api/` to backend). Backend Dockerfile uses multi-stage "dummy build" to cache Rust crate compilation separately from app code.

**Backend layers:** `handlers/` (HTTP routing) → `services/` (business logic) → SQLx direct queries (no ORM). Each domain module has its own handler and service file. All routes defined in `handlers/mod.rs::create_router()`.

**Frontend layers:** Pages (lazy-loaded) → Components → Services (Axios REST + fetch SSE) → Stores (Zustand). Path alias `@/` maps to `src/`.

**Auth flow:** JWT (HS256) stored in localStorage, attached via Axios interceptor. 401 response triggers logout + redirect. Argon2 password hashing in `services/auth.rs`.

**Multi-family / multi-tenancy:** Each user can belong to multiple families. All data tables (transactions, members, categories, subcategories, social_gifts, llm_configs, chat_messages) are scoped by `family_id`. The `AuthUser` middleware resolves both `user_id` and `family_id` from the JWT — `family_id` comes from the user's `default_family_id`. Registration auto-creates a default family.

- **Read operations** (list, get, stats): pass `auth.family_id` only
- **Write operations** (create, import): pass both `auth.user_id` (for FK `user_id` column) and `auth.family_id` (for scoping)
- Family switching: `PUT /api/families/switch` updates `default_family_id`, then frontend reloads

**AI agent:** Backend proxies user messages to a user-configured OpenAI-compatible LLM endpoint. Responses stream via SSE (`POST /api/ai/chat`). The agent runs a multi-turn tool-use loop (up to 10 iterations) — each iteration streams LLM output, collects tool calls, executes them, appends results to the message history, and loops until the LLM responds without tool calls.

9 tools: `create_transaction`, `query_transactions`, `update_transaction`, `delete_transaction`, `get_statistics`, `create_social_gift`, `query_social_gifts`, `update_social_gift`, `delete_social_gift`. Schemas and implementations live in `services/ai_tools.rs` (lenient argument parsing, category self-healing, model-facing error hints); the agent loop, history replay and SSE parsing live in `services/ai.rs`. System prompt includes the user's category tree and member list. The client sends `tz_offset_minutes` with each chat request so "today" and default times follow the user's timezone. Write results carry a `（记录ID: …）` line for the model only (stripped from the chat history view) so follow-up edits can skip a query. Loop guards: repeated identical reads are answered from the earlier result; a write that already succeeded in an earlier round isn't replayed (identical writes within one round are a legitimate batch).

Reasoning model support: the streaming loop detects `reasoning_content` (DeepSeek R1 etc.) and silently filters it + any leaked `content` during the thinking phase, so only the final answer is streamed to the client.

**SSE + compression caveat:** `CompressionLayer` buffers responses, which breaks SSE streaming. The router splits into two sub-routers: `api_routes` (with compression) and `sse_routes` (`/api/ai/chat`, no compression), merged into the parent router.

**AI chat client details:** Assistant messages render Markdown via `react-markdown` + `remark-gfm`. The frontend SSE parser (`services/ai.ts`) buffers multi-line `data:` segments and rejoins them with `\n` so Markdown (lists, code blocks) renders correctly during live streaming, not just after refresh. Clearing the chat (`clearMessages`) also calls `clearChatHistory()` (`DELETE /api/ai/chat/history`) to reset the backend conversation context, not just the local UI. The agent loop de-duplicates repeated identical tool calls to prevent infinite tool-use loops.

## Key Conventions

- UI components follow shadcn/ui patterns (Radix UI primitives + CVA for variants) in `frontend/src/components/ui/`
- TailwindCSS v4 with `@tailwindcss/vite` plugin — theme uses CSS custom properties defined in `src/index.css`
- Semantic color tokens: `primary` (indigo), `income` (green), `expense` (red), `muted`, `destructive`
- **Glassmorphism UI**: Cards/dialogs use semi-transparent backgrounds (`rgba`) + `.glass` utility (backdrop-blur + glass-border + glass-shadow). New components should apply `glass` class for consistency rather than opaque `bg-card` with manual borders.
- Theme follows system preference via `@media (prefers-color-scheme: dark)` — no manual toggle. Custom tokens `--glass-border` and `--glass-shadow` adapt per theme.
- Database amounts use `NUMERIC(15,2)`, serialized as strings in JSON via `serde(with-str)`
- System-default categories have `user_id IS NULL`; family-created categories have `family_id` set
- All protected API endpoints require `Authorization: Bearer <JWT>` header
- Pagination pattern: query params `page` + `per_page`, response wraps in `PaginatedResponse { data, total, page, per_page }`. Backend clamps `per_page` to a max of 100 (`services/transaction.rs`). The transactions page exposes a user-selectable page size (20/50/100) plus first/prev/next/last navigation controls.
- Members table has `UNIQUE (family_id, name)` constraint — member names are unique per family
- **人情 data model:** 人情 statistics (`stats::social_summary`, 人情分析 tab, 人情往来 page cards) are computed from transactions in categories named like `%人情%` (人情往来 / 人情收入), with the **counterpart stored as the transaction member**. `social_gifts` (`type` is `give` / `receive`) holds structured details (occasion, relation). Creating a gift — from the 人情往来 page or the AI's `create_social_gift` — goes through `social_gift::create_social_gift`, which books the ledger entry and the gift atomically and links them via `social_gifts.transaction_id` (FK, `ON DELETE CASCADE`); the optional `kind` (红包 / 礼金 / 礼物) picks the ledger subcategory. Editing/deleting a linked gift syncs its transaction and vice versa. Gifts created before this have `transaction_id` NULL (shown as 未记账) and are not backfilled. Occasion/relation values are normalized onto the page's preset lists (`social_gift::OCCASIONS` / `RELATIONS`).
- **Clearing all transactions also deletes that family's members** — `clear_all_transactions()` deletes `transactions` and `members` atomically within a DB transaction.
- **CSV round-trip:** Export columns are `备注,日期,分类,金额,收支,流水,月份,人员,地点,子分类` (two-level category, no parent-record column). Import is **header-based** (maps columns by name, tolerant of column order / older formats). It prioritizes matching the explicit `分类`/`子分类` values to existing categories, falling back to `classify_transaction()` keyword classification only when no explicit match exists. `classify_transaction()` ordering matters: more-specific categories (e.g. `通讯网络`) must come before broader ones (e.g. `数码电子`) to avoid keyword misclassification.
- **Cross-component data invalidation:** `dataStore.ts` uses a Zustand revision-counter pattern (`transactionsRev`, `categoriesRev`, `membersRev`, `familiesRev`, `socialGiftsRev`). Components subscribe to the relevant `*Rev` counter in their `useEffect` deps; mutating components call `invalidate*()` after writes. The AI chat store calls `invalidateTransactions()` / `invalidateMembers()` / `invalidateSocialGifts()` on successful tool results so the whole UI updates in real time.

## Adding a New Feature

**New API endpoint:** models/mod.rs (DTO) → services/*.rs (logic) → handlers/*.rs (handler) → handlers/mod.rs (register route) → frontend types/index.ts → frontend services/*.ts

**New page:** pages/*.tsx (default export) → App.tsx (lazy import + route) → Sidebar.tsx (nav entry if needed)
