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

PostgreSQL 15. Migrations run automatically on backend startup via `sqlx::migrate!()`. Add new migrations as `backend/migrations/NNN_description.sql`.

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

7 tools: `create_transaction`, `query_transactions`, `delete_transaction`, `update_transaction`, `get_statistics`, `create_social_gift`, `query_social_gifts`. All implemented in `services/ai.rs` as `execute_*` functions. System prompt includes the user's category tree and member list.

Reasoning model support: the streaming loop detects `reasoning_content` (DeepSeek R1 etc.) and silently filters it + any leaked `content` during the thinking phase, so only the final answer is streamed to the client.

**SSE + compression caveat:** `CompressionLayer` buffers responses, which breaks SSE streaming. The router splits into two sub-routers: `api_routes` (with compression) and `sse_routes` (`/api/ai/chat`, no compression), merged into the parent router.

## Key Conventions

- UI components follow shadcn/ui patterns (Radix UI primitives + CVA for variants) in `frontend/src/components/ui/`
- TailwindCSS v4 with `@tailwindcss/vite` plugin — theme uses CSS custom properties defined in `src/index.css`
- Semantic color tokens: `primary` (indigo), `income` (green), `expense` (red), `muted`, `destructive`
- **Glassmorphism UI**: Cards/dialogs use semi-transparent backgrounds (`rgba`) + `.glass` utility (backdrop-blur + glass-border + glass-shadow). New components should apply `glass` class for consistency rather than opaque `bg-card` with manual borders.
- Theme follows system preference via `@media (prefers-color-scheme: dark)` — no manual toggle. Custom tokens `--glass-border` and `--glass-shadow` adapt per theme.
- Database amounts use `NUMERIC(15,2)`, serialized as strings in JSON via `serde(with-str)`
- System-default categories have `user_id IS NULL`; family-created categories have `family_id` set
- All protected API endpoints require `Authorization: Bearer <JWT>` header
- Pagination pattern: query params `page` + `per_page`, response wraps in `PaginatedResponse { data, total, page, per_page }`
- Members table has `UNIQUE (family_id, name)` constraint — member names are unique per family
- CSV import uses `classify_transaction()` to map free-form category strings from external data to the app's two-level category system
- **Cross-component data invalidation:** `dataStore.ts` uses a Zustand revision-counter pattern (`transactionsRev`, `categoriesRev`, `membersRev`, `familiesRev`). Components subscribe to the relevant `*Rev` counter in their `useEffect` deps; mutating components call `invalidate*()` after writes. The AI chat store calls `invalidateTransactions()` on successful tool results.

## Adding a New Feature

**New API endpoint:** models/mod.rs (DTO) → services/*.rs (logic) → handlers/*.rs (handler) → handlers/mod.rs (register route) → frontend types/index.ts → frontend services/*.ts

**New page:** pages/*.tsx (default export) → App.tsx (lazy import + route) → Sidebar.tsx (nav entry if needed)
