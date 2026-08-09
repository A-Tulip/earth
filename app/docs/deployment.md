# 部署

本文档说明「地球探索者」的完整部署方式：**本地开发**、**前端 Vercel**、**后端 Railway**、**全栈容器化**，以及**生产排障**。

## 目录

1. [部署架构](#1-部署架构)
2. [本地开发](#2-本地开发)
3. [配置环境变量](#3-配置环境变量)
4. [生产构建](#4-生产构建)
5. [前端部署（Vercel）](#5-前端部署vercel)
6. [后端部署（Railway）](#6-后端部署railway)
7. [生产排障](#7-生产排障)
8. [全栈容器化（Docker）](#8-全栈容器化docker)
9. [测试](#9-测试)
10. [已知限制](#10-已知限制)
11. [安全](#11-安全)

---

## 1. 部署架构

```
                        用户浏览器
                            │
        ┌───────────────────┼────────────────────┐
        │ 静态资源           │ 同源 /api/* 代理      │
        ▼                   ▼                      ▼
┌─────────────────┐   ┌─────────────┐   ┌──────────────────────────┐
│   Vercel 前端     │   │ vercel.json │   │   Railway 后端（FastAPI）  │
│ earth.vercel.app │   │  rewrites   │   │ earth-production.railway  │
└─────────────────┘   └─────────────┘   └───────────┬──────────────┘
                                                  │ 出网
                                    ┌─────────────┴──────────────┐
                                    ▼                            ▼
                          火山引擎 LLM/TTS/ASR    Open-Meteo / Nominatim / OSM
```

- **前端（Vercel）** 托管静态 SPA（`app/` 目录，Vite 构建产物 `dist/`）。
- **`app/vercel.json`** 通过 `rewrites` 将 `/api/(.*)` **同源代理**到 Railway 后端，前端代码无需感知后端地址。
- **实时语音 WebSocket（/ws/s2s）**：Vercel 无法代理 WebSocket 到外部后端，故前端通过 `VITE_S2S_WS_URL` **直连** Railway 的 `wss://earth-production.up.railway.app/ws/s2s`（开发环境留空走同源 Vite 代理）。
- **密钥不落前端**：火山引擎密钥仅存 Railway 后端环境变量，浏览器只访问同源 `/api/*`。

当前生产地址：

| 环境 | 地址 | 状态 |
|---|---|---|
| 前端（Vercel） | <https://earth-beryl-eight.vercel.app> | ✅ 已部署 |
| 后端（Railway） | <https://earth-production.up.railway.app> | ✅ 已部署 |

---

## 2. 本地开发

**推荐方式（仓库根 Makefile，前后端两命令）：**

```bash
# 0. （可选）一键准备环境：app/node_modules + api/.venv + pip 依赖
make setup

# 1. 启动后端 FastAPI（端口 8787，开发模式）
make api
#   等价命令： npm run api:dev（在 app/ 目录下）

# 2. 另开终端启动前端
make dev
#   等价命令： npm run dev（在 app/ 目录下）
#   → http://localhost:5173/

# 一键同时启动前后端（需系统装有 concurrently）
make start
```

**纯前端方式（不启动后端，仅用回退能力）：**

```bash
cd app
npm install
npm run dev
# → http://localhost:5173/
```

**零配置即可启动**：不需要任何环境变量，使用 OSM 免 token 底图 + 椭球地形 + 浏览器语音 + 关键词意图解析回退。后端未启动时，语音/LLM/图表/地理编码自动降级到浏览器或本地能力。

> 注：原 `npm run voice:proxy`（Node.js 版）已废弃，由 FastAPI 后端（`api/`）完全替代。两者监听同一端口（8787）互斥，启用 FastAPI 后无需再运行 Node 版。

---

## 3. 配置环境变量

### 3.1 后端密钥（`api/.env`，不进入前端构建）

```bash
cp api/.env.example api/.env
# 编辑填入 VOLC_ARK_API_KEY、VOLC_ASR_API_KEY 等
# 依赖：pip install -r api/requirements.txt（或 make setup）
```

### 3.2 前端供应商开关（`app/.env.local`）

```bash
cd app
cp .env.example .env.local
# 编辑 .env.local 填入真实值
```

| 变量 | 作用 | 不填的回退 |
|---|---|---|
| `VITE_CESIUM_ION_TOKEN` | Cesium World Terrain + 高清影像 | OSM 底图 + 椭球地形 |
| `VITE_AMAP_KEY` | 高德卫星/路网/中文注记（街景级） | OSM / Esri 回退 |
| `VITE_TIANDITU_TOKEN` | 天地图中文注记底图 | OSM / Esri |
| `VITE_ASR_PROVIDER` | 语音识别供应商（`browser`/`volcengine`） | 浏览器 Web Speech API |
| `VITE_TTS_PROVIDER` | 语音合成供应商（`browser`/`volcengine`） | 浏览器 speechSynthesis |
| `VITE_LLM_PROVIDER` | 意图理解供应商（`keyword`/`volcengine`） | 本地关键词解析 |

### 3.3 后端密钥清单（FastAPI）

| 密钥 | 作用 | 鉴权模式 |
|---|---|---|
| `VOLC_ARK_API_KEY` | 豆包大模型（LLM 意图理解/回答） | Bearer |
| `VOLC_ASR_API_KEY` | 流式语音识别（ASR）**与 TTS 共用** | v3 `X-Api-Key` |
| `VOLC_ASR_RESOURCE_ID` | ASR/S2S 资源 ID（`volc.speech.dialog`） | — |
| `VOLC_TTS_APP_ID` / `VOLC_TTS_ACCESS_TOKEN` | 旧版 TTS（仅当无 `VOLC_ASR_API_KEY` 时回退） | SAMI query |

**鉴权优先级（TTS）：** `VOLC_TTS_API_KEY` → `VOLC_ASR_API_KEY`（新版 v3，推荐）→ `VOLC_TTS_APP_ID + VOLC_TTS_ACCESS_TOKEN`（旧版 query）。

> **TTS 与 ASR 共用 key**：新版语音应用控制台签发的是**单一 API Key**，TTS 未单独配置 `VOLC_TTS_API_KEY` 时自动回退到 `VOLC_ASR_API_KEY`。已验证该 key 配合 `seed-tts-2.0` 可正常合成。

**密钥安全：**
- 带 `VITE_` 前缀的变量进入前端构建，**只放可公开的 token**
- 真实密钥（火山）**不带 `VITE_` 前缀**，仅 FastAPI 后端可见（`api/.env`）
- `.env.local` 与 `api/.env` 均在 `.gitignore`，不提交

---

## 4. 生产构建

```bash
cd app
npm run build
# 产物在 app/dist/
```

构建过程：
1. `tsc --noEmit` 类型检查
2. `vite build` 打包
3. `vite-plugin-static-copy` 复制 Cesium 静态资源（Workers/Assets/ThirdParty/Widgets）到 `dist/cesium/`

**产物结构：**

```
dist/
├── index.html
├── assets/
│   ├── index-*.js          # 应用代码
│   ├── react-*.js          # React 供应商包
│   ├── cesium-*.js         # Cesium 供应商包
│   └── index-*.css
└── cesium/                 # Cesium 静态资源
    ├── Workers/
    ├── Assets/
    ├── ThirdParty/
    └── Widgets/
```

---

## 5. 前端部署（Vercel）

生产环境已部署至 <https://earth-beryl-eight.vercel.app>。

### 5.1 项目配置

Vercel 控制台 → 项目设置：

| 配置项 | 值 |
|---|---|
| Root Directory | `app` |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Node Version | 24.x |

### 5.2 环境变量

在 Vercel 项目 **Settings → Environment Variables** 配置（Preview + Production 均需）：

| 变量 | 值 |
|---|---|
| `VITE_LLM_PROVIDER` | `volcengine` |
| `VITE_ASR_PROVIDER` | `volcengine` |
| `VITE_TTS_PROVIDER` | `volcengine` |
| `VITE_AMAP_KEY` | 你的高德 Web 服务 Key |
| `VITE_S2S_WS_URL` | `wss://earth-production.up.railway.app/ws/s2s` |

> `VITE_S2S_WS_URL` 也可烘焙进仓库内 `app/.env.production`（当前已配置），Vercel 环境变量优先。

### 5.3 SPA 回退与后端代理（`app/vercel.json`）

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "https://earth-production.up.railway.app/api/$1" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

- 第一条 rewrite：`/api/*` 同源代理到 Railway 后端。
- 第二条 rewrite：SPA 回退，所有路由指向 `index.html`。
- 静态资源（`/cesium`、`/assets`）优先于 rewrites，不受影响。

### 5.4 部署方式

**推荐：Vercel 原生 GitHub 集成。** 关联 `A-Tulip/earth` 仓库后，push / PR 到 `main` 自动部署 Preview + Production，无需额外 token。

**CLI 部署（可选）：**

```bash
vercel link --project earth --scope <你的 scope> --token $VERCEL_TOKEN
vercel deploy --prod --yes --token $VERCEL_TOKEN
```

---

## 6. 后端部署（Railway）

后端为 **FastAPI 独立服务**，通过 Dockerfile 部署，代码与配置已就绪：

- [`api/Dockerfile`](../api/Dockerfile) — `python:3.11-slim` + Noto CJK 字体 + 非 root 用户，端口读取 `$PORT`（兼容 Railway 随机端口）。
- [`api/railway.json`](../api/railway.json) — 指定 Dockerfile 构建 + `/api/health` 健康检查。
- [`api/.dockerignore`](../api/.dockerignore) — 排除 `.env`、`.venv`、测试脚本，防止密钥进镜像。

### 6.1 部署步骤

1. 在 [Railway](https://railway.com) 创建项目，新建 Service → *Deploy from GitHub repo*，选择仓库 `A-Tulip/earth`。
2. 在 Service 设置中，**Root / Deploy Directory 设为 `api`**。
3. Railway 自动识别 `api/Dockerfile` 并构建（如未识别，在 Settings 强制选择 Dockerfile）。
4. 在 Variables 中配置密钥环境变量（见[后端密钥清单](#33-后端密钥清单fastapi)）；`PORT` 由 Railway 自动注入。
5. 部署完成后，Railway 给出公网 URL（`https://<service>.up.railway.app`）。
6. 回到 `app/vercel.json`，将 `/api` 转发地址替换为真实 URL。

### 6.2 健康检查

Railway 会轮询 `/api/health`，返回 200 即视为就绪。

```bash
curl https://earth-production.up.railway.app/api/health
# 期望：{"ok":true,"llm":true,"tts":true,"asr":true,"charts":true,"geocoding":true,...}
```

> `rtc:false` 表示 RTC 视频通话预留端点未配置（`VOLC_RTC_APP_ID/KEY`），当前未使用可忽略。

### 6.3 修改环境变量后需重新部署

Railway 环境变量变更后，**运行中的实例不会自动加载**。需触发重新部署：

```bash
railway login
railway link            # 选择项目 radiant-cat / 服务 earth
railway variables set VOLC_ASR_API_KEY=xxx   # 或 railway variables
railway redeploy --from-source -s earth -y   # --from-source 拉取最新源码+变量重建
```

> 必须使用 `--from-source`，否则仅复用旧镜像，新环境变量不生效。

---

## 7. 生产排障

### 7.1 诊断清单

| 症状 | 排查 | 解决 |
|---|---|---|
| TTS 502 `40200002 IllegalToken` | 后端是否读到 `VOLC_ASR_API_KEY` | 见下节 |
| `/api/health` 返回 404 | `vercel.json` rewrite 是否指向正确后端 | 检查 `destination` |
| LLM 无响应 / 502 | Railway 是否配置 `VOLC_ARK_API_KEY` | 配置后 `--from-source` redeploy |
| 实时语音连不上 | `VITE_S2S_WS_URL` 是否指向后端 | 检查前端构建烘焙值 |
| 底图 403 | 高德/天地图 key 是否有效 | 检查 `VITE_AMAP_KEY` |

### 7.2 TTS 生产 502 修复（实战案例）

**症状：** 生产 `/api/tts/synthesize` 返回 502，错误 `40200002 DeniedAccess:IllegalToken`，且走的是 `tts:old-query-body-raw`（旧版 path）。

**根因：** Railway 环境缺少新版单 API Key（`VOLC_ASR_API_KEY`），后端回退到旧版 `AppID+Token`（`9611991605` / `eW1o...`），而这对旧凭证无效。

**修复：**
1. 确认本地 `api/.env` 的 `VOLC_ASR_API_KEY` 有效（直接 curl 火山 v3 TTS 端点返回 200）。
2. 将 key 同步到 Railway 环境变量。
3. `railway redeploy --from-source` 让实例加载新变量。
4. 重新 `curl` 生产 TTS，确认返回 200 + MP3。

**验证命令：**

```bash
# 本地验证 key 有效（直接打火山 v3 TTS）
curl -X POST https://openspeech.bytedance.com/api/v3/tts/unidirectional \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $VOLC_ASR_API_KEY" \
  -H "X-Api-Resource-Id: seed-tts-2.0" \
  -d '{"user":{"uid":"earth-explorer"},"namespace":"UnidirectionalTTS","req_params":{"text":"你好","speaker":"zh_female_qingxinnvsheng_uranus_bigtts","audio_params":{"format":"mp3","sample_rate":24000,"speech_rate":0}}}'

# 验证生产 TTS
curl -X POST https://earth-production.up.railway.app/api/tts/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text":"你好测试"}'
```

### 7.3 健康检查的假阳性

`/api/health` 的 `tts:true` 基于**凭据存在性**判断（检查 `VOLC_ASR_API_KEY` 是否配置），并非每次真实合成。若你要确认 TTS 端到端可用，直接调用 `/api/tts/synthesize` 验证。

---

## 8. 全栈容器化（Docker）

```bash
make docker          # 构建并后台启动（前端 8080 + 后端 8787）
make docker-up       # 仅启动（不重建）
make docker-logs     # 跟踪日志
make docker-down     # 停止并移除
```

- 前端：Nginx 托管 SPA，`/api`、`/ws` 反代到 `api:8787`。
- 后端：FastAPI，密钥经 `api/.env` 或宿主环境注入。

**密钥安全：**
- 镜像内**不打包**任何密钥：`api/.dockerignore` 排除了 `.env`
- 密钥通过 `docker compose` 的 `env_file: ./api/.env` 在**运行时**注入容器
- CI/云平台部署时，可直接在宿主环境注入 `VOLC_*`（优先级高于 `.env` 文件）

**注意事项：**
- 容器监听 `8787`，映射到宿主机同端口；如需改端口，同步修改 `docker-compose.yml` 的 `ports` 与 `app/vite.config.ts` 的 `/api` 代理 target
- 容器以非 root 用户运行；matplotlib 中文图表已内置 Noto CJK 字体

---

## 9. 测试

```bash
cd app
npm test            # 单元 + 集成测试（Vitest，7 个文件 / 144 用例）
npm run test:watch  # 监听模式
npm run test:e2e    # 端到端测试（Playwright，17 用例）
npm run typecheck   # 类型检查（tsc --noEmit）
npm run lint        # ESLint
```

或仓库根整合：`make test`（单元测试）、`make check`（lint + typecheck + test）。

课程内容校验：

```bash
cd app
npm run validate:content
```

校验项：字段完整性、工具名称合法、地点经纬度合法、GeoJSON/CZML 语法、引用存在。

---

## 10. 已知限制

- 无 ion token 时使用椭球地形（无真实起伏），等高线/高程分层效果有限
- 浏览器 Web Speech API 中文识别质量有限，建议生产环境接入云端 ASR（火山引擎）
- 本地关键词意图解析覆盖教学常用指令，复杂问句需接入 LLM（火山方舟）
- 火山引擎 ASR/TTS/LLM 需在 `api/.env` 配置密钥并启动 FastAPI 后端，否则自动降级
- `rtc:false`：RTC 视频通话预告警端点未配置（当前未使用）
- 日出日落计算、世界时钟、城市对比、分享功能待迁移

---

## 11. 安全

- 所有外部密钥通过 `.env.example` 描述，真实密钥不提交
- 模型工具调用使用白名单 Schema（`TOOL_SCHEMAS`）
- 富文本和生成 HTML 待接入清理（DOMPurify）和沙箱隔离
- URL 抓取、课程材料上传待接入安全校验
- 生产环境通过服务端代理调用 ASR/TTS/LLM，前端不直接请求
- 密钥仅存后端环境变量（Railway / `api/.env`），前端经 `/api/*` 同源代理调用