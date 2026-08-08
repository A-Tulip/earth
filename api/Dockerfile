# ============================================================
# 地球探索者 · FastAPI 后端镜像
#
# 构建：  docker build -t earth-explorer-api ./api
# 运行：  docker run --rm -p 8787:8787 -v $PWD/api/.env:/app/.env earth-explorer-api
# Compose：docker compose up -d --build   （见仓库根 docker-compose.yml）
# ============================================================
FROM python:3.11-slim

# matplotlib 中文图表需要 Noto CJK 字体（否则中文标题/标签显示为方框）
RUN apt-get update && apt-get install -y --no-install-recommends \
        fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先装依赖再拷代码，最大化利用 Docker 层缓存
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# main.py 内置 sys.path 兜底（仓库根 + api/ 双保险），无需额外 PYTHONPATH
COPY main.py .

EXPOSE 8787

# ---- 以非 root 身份运行（安全）；matplotlib 缓存写临时目录 ----
RUN addgroup --system earth && adduser --system --ingroup earth earth \
    && mkdir -p /home/earth /tmp/matplotlib && chown -R earth:earth /home/earth /tmp/matplotlib
ENV HOME=/home/earth \
    MPLCONFIGDIR=/tmp/matplotlib
USER earth

# 生产模式：不启用 --reload。
# 端口读取 $PORT 环境变量（Railway 会注入随机 $PORT；本地 Docker compose 注入 PORT=8787），
# 未设置时默认 8787，兼容直接 docker run 场景。
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port \"${PORT:-8787}\""]