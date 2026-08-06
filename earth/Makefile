# ============================================================
# Earth Explorer AI Makefile
#
# 设计原则：
#   1. 所有命令无论当前 cwd 在哪都能跑（通过绝对/相对路径定位 repo root）
#   2. 零心智负担：只暴露用户关心的 4 个命令（dev / api / start / check）
#   3. 环境准备：make setup 一次性装好前端 node_modules + 后端 venv + pip 依赖
# ============================================================

SHELL         := /bin/bash
ROOT          := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
APP_DIR       := $(ROOT)/app
API_DIR       := $(ROOT)/api
PY_VENV       := $(API_DIR)/.venv/bin/python
NODE          := $(if $(shell command -v pnpm 2>/dev/null),pnpm,$(if $(shell command -v npm 2>/dev/null),npm,yarn))

.PHONY: help setup dev api start test lint typecheck clean docker docker-up docker-down

help:  ## 显示所有命令
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---------- 环境准备 ----------
setup:  ## 一键准备：前端 node_modules + 后端 venv + 依赖
	@echo "▶ [1/2] 前端安装依赖（$(NODE)）..."
	@cd $(APP_DIR) && test -d node_modules || $(NODE) install --silent
	@echo "▶ [2/2] 后端 venv + pip 依赖..."
	@cd $(API_DIR) && test -x $(PY_VENV) || python3 -m venv $(API_DIR)/.venv
	@$(PY_VENV) -m pip install --quiet -r $(API_DIR)/requirements.txt
	@echo "✅ 环境准备完成"

# ---------- 日常开发（两条命令分别起前后端）----------
dev:  ## 启动前端 Vite（端口 5173）
	@cd $(APP_DIR) && $(NODE) run dev

api:  ## 启动后端 FastAPI（端口 8787，开发模式：--reload）
	@test -x $(PY_VENV) || (echo "❌ 未检测到 venv，请先运行： make setup" && exit 1)
	@cd $(ROOT) && exec $(PY_VENV) -m uvicorn main:app --app-dir $(API_DIR) --host 127.0.0.1 --port 8787 --reload

start:  ## 同时启动前端 + 后端（需要系统已装 concurrently；否则用两个 Terminal 分别 make dev / make api）
	@cd $(APP_DIR) && $(NODE) install --silent --save-dev concurrently >/dev/null 2>&1 || true
	@cd $(APP_DIR) && ($(NODE) exec --no concurrently --kill-others-on-fail \
	  -n "前端,后端" \
	  -c "cyan,orange" \
	  "cd $(APP_DIR) && $(NODE) run dev" \
	  "cd $(ROOT) && make api") || \
	  (echo "⚠️  concurrently 不可用，请开两个终端分别运行： make dev  与  make api" && exit 1)

# ---------- 质量校验 ----------
test:  ## 前端单元测试（Vitest）
	@cd $(APP_DIR) && $(NODE) run test --run

lint:  ## 前端 ESLint（仅 app/src）
	@cd $(APP_DIR) && $(NODE) run lint

typecheck:  ## 前端 tsc --noEmit（0 错误才算通过）
	@cd $(APP_DIR) && $(NODE) exec --no tsc --noEmit 2>&1 | tail -20

check: lint typecheck test  ## 全量校验（lint + tsc + 单元测试）

# ---------- 清理 ----------
clean:  ## 清理前端 dist、后端 pyc、__pycache__
	@rm -rf $(APP_DIR)/dist
	@find $(API_DIR) -type d -name __pycache__ -prune -exec rm -rf {} +
	@echo "🧹 清理完成"

# ---------- Docker（后端容器化部署）----------
docker:  ## 构建并后台启动后端容器（需系统装有 docker compose）
	@cd $(ROOT) && docker compose up -d --build

docker-up:  ## 后台启动后端容器（不重新构建）
	@cd $(ROOT) && docker compose up -d

docker-down:  ## 停止并移除后端容器
	@cd $(ROOT) && docker compose down
