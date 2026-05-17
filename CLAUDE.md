# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PenyCounts is a family expense tracking web app (Chinese UI) with: categorized transactions, multi-person expense splitting, social gift tracking (红包/礼金), statistics charts, and AI-powered natural language bookkeeping via LLM integration (SSE streaming).

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

## Architecture

**Three-service Docker Compose:** postgres → backend (Axum :8080) → frontend (Nginx :80, reverse-proxies `/api/` to backend).

**Backend layers:** `handlers/` (HTTP routing) → `services/` (business logic) → SQLx direct queries (no ORM). Each domain module has its own handler and service file. All routes defined in `handlers/mod.rs::create_router()`.

**Frontend layers:** Pages (lazy-loaded) → Components → Services (Axios REST + fetch SSE) → Stores (Zustand). Path alias `@/` maps to `src/`.

**Auth flow:** JWT (HS256) stored in localStorage, attached via Axios interceptor. 401 response triggers logout + redirect.

**AI chat:** Backend proxies user messages to a user-configured OpenAI-compatible LLM endpoint. Responses stream via SSE (`POST /api/ai/chat`). System prompt includes user's category tree and defines `create_transaction`/`query_transactions` tools.

## Key Conventions

- UI components follow shadcn/ui patterns (Radix UI primitives + CVA for variants) in `frontend/src/components/ui/`
- TailwindCSS v4 with `@tailwindcss/vite` plugin — theme uses CSS custom properties defined in `src/index.css`
- Semantic color tokens: `primary` (indigo), `income` (green), `expense` (red), `muted`, `destructive`
- Database amounts use `NUMERIC(15,2)`, serialized as strings in JSON via `serde(with-str)`
- System-default categories have `user_id IS NULL`; user-created categories have `user_id` set
- All protected API endpoints require `Authorization: Bearer <JWT>` header
- Pagination pattern: query params `page` + `per_page`, response wraps in `PaginatedResponse { data, total, page, per_page }`

## Adding a New Feature

**New API endpoint:** models/mod.rs (DTO) → services/*.rs (logic) → handlers/*.rs (handler) → handlers/mod.rs (register route) → frontend types/index.ts → frontend services/*.ts

**New page:** pages/*.tsx (default export) → App.tsx (lazy import + route) → Sidebar.tsx (nav entry if needed)
