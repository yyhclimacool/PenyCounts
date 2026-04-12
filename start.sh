#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
    echo ""
    echo -e "${YELLOW}正在关闭所有服务...${NC}"
    [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null && echo -e "${CYAN}前端已停止${NC}"
    [ -n "$BACKEND_PID" ]  && kill "$BACKEND_PID"  2>/dev/null && echo -e "${CYAN}后端已停止${NC}"
    wait 2>/dev/null
    echo -e "${GREEN}所有服务已关闭，再见！${NC}"
    exit 0
}
trap cleanup SIGINT SIGTERM

# ─── 1. PostgreSQL ───
echo -e "${CYAN}[1/3] 检查 PostgreSQL ...${NC}"
if brew services list 2>/dev/null | grep -q "postgresql.*started"; then
    echo -e "${GREEN}  ✓ PostgreSQL 已在运行${NC}"
else
    echo -e "${YELLOW}  → 正在启动 PostgreSQL ...${NC}"
    brew services start postgresql@15 >/dev/null 2>&1 || brew services start postgresql >/dev/null 2>&1
    sleep 2
    if brew services list 2>/dev/null | grep -q "postgresql.*started"; then
        echo -e "${GREEN}  ✓ PostgreSQL 启动成功${NC}"
    else
        echo -e "${RED}  ✗ PostgreSQL 启动失败，请手动检查${NC}"
        exit 1
    fi
fi

# ─── 2. Backend ───
echo -e "${CYAN}[2/3] 启动后端 (Rust/Axum) ...${NC}"

if lsof -ti :8080 >/dev/null 2>&1; then
    echo -e "${YELLOW}  → 端口 8080 被占用，正在释放...${NC}"
    lsof -ti :8080 | xargs kill -9 2>/dev/null
    sleep 1
fi

cd "$PROJECT_DIR/backend"
cargo run 2>&1 | while IFS= read -r line; do echo -e "  ${NC}[后端] $line"; done &
BACKEND_PID=$!

echo -e "${YELLOW}  → 等待后端就绪 ...${NC}"
for i in $(seq 1 60); do
    if curl -sf http://localhost:8080/api/health >/dev/null 2>&1; then
        echo -e "${GREEN}  ✓ 后端已就绪 (http://localhost:8080)${NC}"
        break
    fi
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
        echo -e "${RED}  ✗ 后端进程异常退出${NC}"
        exit 1
    fi
    sleep 1
done

if ! curl -sf http://localhost:8080/api/health >/dev/null 2>&1; then
    echo -e "${RED}  ✗ 后端启动超时 (60s)${NC}"
    cleanup
    exit 1
fi

# ─── 3. Frontend ───
echo -e "${CYAN}[3/3] 启动前端 (Vite) ...${NC}"

if lsof -ti :3000 >/dev/null 2>&1; then
    echo -e "${YELLOW}  → 端口 3000 被占用，正在释放...${NC}"
    lsof -ti :3000 | xargs kill -9 2>/dev/null
    sleep 1
fi

cd "$PROJECT_DIR/frontend"
npm run dev 2>&1 | while IFS= read -r line; do echo -e "  ${NC}[前端] $line"; done &
FRONTEND_PID=$!

sleep 3
echo -e "${GREEN}  ✓ 前端已启动 (http://localhost:3000)${NC}"

# ─── Done ───
echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  PenyCounts 所有服务已启动！${NC}"
echo -e "${GREEN}  前端: http://localhost:3000${NC}"
echo -e "${GREEN}  后端: http://localhost:8080${NC}"
echo -e "${GREEN}  按 Ctrl+C 停止所有服务${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""

wait
