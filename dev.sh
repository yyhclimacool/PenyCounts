#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

log()  { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $1"; }
ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
warn() { echo -e "${YELLOW}  ! $1${NC}"; }
err()  { echo -e "${RED}  ✗ $1${NC}"; }

usage() {
    echo "用法: ./dev.sh [命令]"
    echo ""
    echo "命令:"
    echo "  docker    Docker Compose 构建并重启（默认）"
    echo "  local     本地开发模式（cargo run + npm run dev）"
    echo "  stop      停止所有服务"
    echo "  logs      查看 Docker 容器日志"
    echo ""
    exit 0
}

# ═══════════════════════════════════════════════════════════════════════════════
# Docker 模式
# ═══════════════════════════════════════════════════════════════════════════════
cmd_docker() {
    # Check Docker daemon
    log "检查 Docker 状态..."
    if ! docker info >/dev/null 2>&1; then
        err "Docker 未运行"
        if [[ "$(uname)" == "Darwin" ]]; then
            warn "尝试启动 Docker Desktop..."
            open -a Docker
            for i in $(seq 1 30); do
                if docker info >/dev/null 2>&1; then
                    ok "Docker Desktop 已启动"
                    break
                fi
                sleep 2
            done
            if ! docker info >/dev/null 2>&1; then
                err "Docker 启动超时（60s），请手动启动 Docker Desktop"
                exit 1
            fi
        else
            err "请先启动 Docker daemon"
            exit 1
        fi
    else
        ok "Docker 正在运行"
    fi

    # Stop existing containers
    log "停止现有容器..."
    docker compose down 2>/dev/null && ok "容器已停止" || ok "无运行中的容器"

    # Build
    log "构建镜像..."
    if ! docker compose build --progress=plain 2>&1; then
        err "构建失败"
        echo ""
        warn "常见原因："
        warn "  - Rust 编译错误: 运行 'SQLX_OFFLINE=true cargo check' 检查"
        warn "  - 前端编译错误: 运行 'cd frontend && npx tsc --noEmit' 检查"
        exit 1
    fi
    ok "镜像构建完成"

    # Start
    log "启动服务..."
    if ! docker compose up -d 2>&1; then
        err "启动失败"
        docker compose logs --tail=20 2>/dev/null
        exit 1
    fi

    # Wait for health checks
    log "等待服务就绪..."
    for i in $(seq 1 30); do
        if docker exec penycounts-postgres-1 pg_isready -U penycounts -d penycounts >/dev/null 2>&1; then
            break
        fi
        sleep 1
    done

    # Verify backend is responding
    BACKEND_READY=false
    for i in $(seq 1 20); do
        if curl -sf http://localhost/api/categories >/dev/null 2>&1; then
            BACKEND_READY=true
            break
        fi
        sleep 1
    done

    if [ "$BACKEND_READY" = true ]; then
        ok "后端就绪"
    else
        BACKEND_STATUS=$(docker inspect --format='{{.State.Status}}' penycounts-backend-1 2>/dev/null || echo "missing")
        if [ "$BACKEND_STATUS" != "running" ]; then
            err "后端容器未正常运行（状态: $BACKEND_STATUS）"
            echo ""
            warn "后端日志："
            docker logs penycounts-backend-1 --tail=15 2>/dev/null
        else
            warn "后端已启动但尚未响应，可能仍在初始化"
        fi
    fi

    # Summary
    echo ""
    echo -e "${GREEN}════════════════════════════════════════${NC}"
    docker compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null
    echo -e "${GREEN}════════════════════════════════════════${NC}"
    echo -e "${GREEN}  访问: http://localhost${NC}"
    echo -e "${GREEN}════════════════════════════════════════${NC}"
}

# ═══════════════════════════════════════════════════════════════════════════════
# 本地开发模式
# ═══════════════════════════════════════════════════════════════════════════════
BACKEND_PID=""
FRONTEND_PID=""

cleanup_local() {
    echo ""
    log "正在关闭所有服务..."
    [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null && ok "前端已停止"
    [ -n "$BACKEND_PID" ]  && kill "$BACKEND_PID"  2>/dev/null && ok "后端已停止"
    wait 2>/dev/null
    ok "所有服务已关闭"
    exit 0
}

cmd_local() {
    trap cleanup_local SIGINT SIGTERM

    # PostgreSQL
    log "检查 PostgreSQL ..."
    if brew services list 2>/dev/null | grep -q "postgresql.*started"; then
        ok "PostgreSQL 已在运行"
    else
        warn "正在启动 PostgreSQL ..."
        brew services start postgresql@15 >/dev/null 2>&1 || brew services start postgresql >/dev/null 2>&1
        sleep 2
        if brew services list 2>/dev/null | grep -q "postgresql.*started"; then
            ok "PostgreSQL 启动成功"
        else
            err "PostgreSQL 启动失败，请手动检查"
            exit 1
        fi
    fi

    # Backend
    log "启动后端 (Rust/Axum) ..."
    if lsof -ti :8080 >/dev/null 2>&1; then
        warn "端口 8080 被占用，正在释放..."
        lsof -ti :8080 | xargs kill -9 2>/dev/null
        sleep 1
    fi

    cd "$PROJECT_DIR/backend"
    cargo run 2>&1 | while IFS= read -r line; do echo -e "  ${NC}[后端] $line"; done &
    BACKEND_PID=$!

    warn "等待后端就绪 ..."
    for i in $(seq 1 60); do
        if curl -sf http://localhost:8080/api/health >/dev/null 2>&1; then
            ok "后端已就绪 (http://localhost:8080)"
            break
        fi
        if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
            err "后端进程异常退出"
            exit 1
        fi
        sleep 1
    done

    if ! curl -sf http://localhost:8080/api/health >/dev/null 2>&1; then
        err "后端启动超时 (60s)"
        cleanup_local
    fi

    # Frontend
    log "启动前端 (Vite) ..."
    if lsof -ti :3000 >/dev/null 2>&1; then
        warn "端口 3000 被占用，正在释放..."
        lsof -ti :3000 | xargs kill -9 2>/dev/null
        sleep 1
    fi

    cd "$PROJECT_DIR/frontend"
    npm run dev 2>&1 | while IFS= read -r line; do echo -e "  ${NC}[前端] $line"; done &
    FRONTEND_PID=$!
    sleep 3
    ok "前端已启动 (http://localhost:3000)"

    # Done
    echo ""
    echo -e "${GREEN}════════════════════════════════════════${NC}"
    echo -e "${GREEN}  PenyCounts 本地开发服务已启动${NC}"
    echo -e "${GREEN}  前端: http://localhost:3000${NC}"
    echo -e "${GREEN}  后端: http://localhost:8080${NC}"
    echo -e "${GREEN}  按 Ctrl+C 停止所有服务${NC}"
    echo -e "${GREEN}════════════════════════════════════════${NC}"
    echo ""
    wait
}

# ═══════════════════════════════════════════════════════════════════════════════
# 其他命令
# ═══════════════════════════════════════════════════════════════════════════════
cmd_stop() {
    log "停止服务..."
    if docker compose ps -q 2>/dev/null | grep -q .; then
        docker compose down
        ok "Docker 容器已停止"
    else
        ok "无 Docker 容器运行"
    fi
    if lsof -ti :8080 >/dev/null 2>&1; then
        lsof -ti :8080 | xargs kill -9 2>/dev/null
        ok "本地后端已停止"
    fi
    if lsof -ti :3000 >/dev/null 2>&1; then
        lsof -ti :3000 | xargs kill -9 2>/dev/null
        ok "本地前端已停止"
    fi
}

cmd_logs() {
    docker compose logs -f --tail=50
}

# ═══════════════════════════════════════════════════════════════════════════════
# 入口
# ═══════════════════════════════════════════════════════════════════════════════
CMD="${1:-docker}"

case "$CMD" in
    docker)  cmd_docker ;;
    local)   cmd_local ;;
    stop)    cmd_stop ;;
    logs)    cmd_logs ;;
    -h|--help|help) usage ;;
    *)
        err "未知命令: $CMD"
        usage
        ;;
esac
