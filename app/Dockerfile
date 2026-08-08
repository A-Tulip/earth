# ============================================================
# 地球探索者 · 前端（React SPA）镜像
# 多阶段构建：Node 构建 → nginx 静态托管 + 反向代理到后端 API
#
# 构建： docker build -t earth-explorer-frontend ./app
# 运行： 由 docker-compose 编排（前端 8080 → nginx，/api、/ws 反代到 api:8787）
# 单个前台运行示例：
#   docker run --rm -p 8080:80 --network=earth_default earth-explorer-frontend
# ============================================================
FROM node:20-alpine AS build
WORKDIR /app

# 先装依赖再拷源码，最大化 Docker 层缓存
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline --no-audit --no-fund

COPY . .
# 构建期注入的 VITE_* 环境变量来自 docker-compose 的 build args（可选）
# 未注入时使用仓库内默认值（OSM 底图 + 浏览器语音回退，零配置可用）
ARG VITE_CESIUM_ION_TOKEN
ARG VITE_ASR_PROVIDER
ARG VITE_TTS_PROVIDER
ARG VITE_LLM_PROVIDER
ARG VITE_AMAP_KEY
RUN npm run build

# ---- 运行时：nginx ----
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]