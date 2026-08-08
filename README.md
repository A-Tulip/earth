# 地球探索者 · AI 地理画布

> **打开即用、无需登录、AI 语音驱动的初高中地理互动教学平台。**

<div align="center">

[![React](https://img.shields.io/badge/React-18.3-61dafb?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Cesium](https://img.shields.io/badge/Cesium-1.143-2097ff?logo=cesium&logoColor=white)](https://cesium.com)
[![Vite](https://img.shields.io/badge/Vite-5.4-646cff?logo=vite&logoColor=white)](https://vitejs.dev)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![License](https://img.shields.io/badge/License-MIT-3da639)](#-许可证)

[在线演示](#-在线演示) · [快速开始](#-快速开始) · [架构](#-架构设计) · [部署](#-部署) · [配置](#-环境变量配置) · [文档](#-文档)

</div>

---

## ✨ 项目简介

「地球探索者」把地球本身变成一块 **AI 地理画布**：打开页面即看到完整地球，无需登录、无需注册、无需任何 API 配置。学生用 **语音或文字** 下达指令，AI 理解意图后驱动三维地球改变镜头、切换图层、展开地形分析、播放课程动画、发起互动提问。

**三大设计原则：**

1. **零门槛** —— 打开即用，第三方服务不可用时自动降级，课堂不中断。
2. **语音优先** —— 手动按钮与 AI 语音指令共用同一个命令总线（Command Bus），所见即所得。
3. **教学可扩展** —— 课程内容与代码解耦，可独立校验、按课标扩展。

---

## 🚀 在线演示

| 环境 | 地址 | 状态 |
|---|---|---|
| **前端（Vercel）** | <https://earth-beryl-eight.vercel.app> | ✅ 已部署 |
| 后端（Railway） | 待创建（见[部署](#-部署-后端)） | ⏳ |

> 生产环境前端已通过 Vercel Rewrites 将 `/api/*` 同源代理到后端，后端就绪前云端能力自动回退到浏览器/关键词模式。

---

## ✨ 核心特性

- **🌍 真实三维地球** —— CesiumJS 渲染，支持二维 / 哥伦布 / 三维切换，真实地形、影像、GeoJSON、CZML 动画。
- **🎙️ AI 语音交互** —— 单击空格开始/结束录音（Toggle 模式），支持自然语言指令与关键词意图双回退链路。
- **🔌 同一命令总线** —— 手动按钮与 AI 共用 `Geography Command Bus`，工具协议 Schema 校验，杜绝非法调用。
- **📚 分级课程体系** —— 9 门初高中地理课程，按初中/高中 + 自然/人文/区域分类，自动推进、互动提问、AI 解释。
- **🗺️ 多源底图与回退** —— 天地图 / 高德 / Esri / OSM / 离线 Natural Earth 多级回退，中文注记优先。
- **⛰️ 地形分析工具** —— 等高线、坡度、坡向、高程分层，需 Cesium ion 真实地形（可选）。
- **🛰️ 数据图层** —— 天气、地震、自然事件、GDP、人口、气温、降水等 7 类数据，均带离线兜底。
- **🪐 太阳系引擎** —— Three.js 懒加载，行星真实纹理（CC BY 4.0），自转、公转、晨昏线、地轴等天文图层。

---

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18（推荐 20）
- Python ≥ 3.10（仅后端云端能力需要）
- 可选：Docker（容器化部署）

### 一键准备环境

```bash
make setup        # 前端 node_modules + 后端 venv + pip 依赖
```

### 启动开发服务

```bash
make dev          # 前端 Vite（http://localhost:5173）
make api          # 后端 FastAPI（http://localhost:8787，可选）
```

或分别手动启动：

```bash
# 前端
cd app && npm install && npm run dev

# 后端（可选，云端语音/LLM 需要）
cd api && python3 -m venv .venv && . .venv/bin/activate \
  && pip install -r requirements.txt \
  && uvicorn main:app --host 0.0.0.0 --port 8787 --reload
```

> **零配置即可启动**：不需要任何环境变量。无 ion token 时使用 OSM 底图 + 椭球地形；无云端 ASR/TTS/LLM 时使用浏览器 Web Speech API + 本地关键词解析回退。

打开 <http://localhost:5173/>，**单击空格** 说出指令，例如：

- 「飞到北京」「去青藏高原」
- 「打开等高线」「切二维地图」「打开经纬线」
- 「讲一讲这里」（先点选地球上一个位置）
- 「打开等高线课程」「退出课程」

---

## 📁 目录结构

```
earth/
├── app/                        # 主线应用（AI 地理画布）
│   ├── src/
│   │   ├── cesium/             # Cesium 运行时（controller 抽象 + canvas 组件）
│   │   ├── commands/           # Command Bus + 工具协议 Schema（按钮与 AI 共用）
│   │   ├── state/              # GeographySceneState（Zustand 集中式状态）
│   │   ├── voice/              # ASR/TTS/LLM 适配层 + Push-to-Talk + 实时对话
│   │   ├── lessons/            # 课程运行时 + Schema + 目录
│   │   ├── data/               # 数据源 Provider（带回退）
│   │   ├── solar-system/       # Three.js 太阳系引擎（懒加载）
│   │   └── ui/                 # React 组件（TopBar/ToolDock/CommandMenu...）
│   ├── content/                # 课程内容包（独立于代码，可校验）
│   ├── tests/                  # 单元 + 集成测试
│   ├── e2e/                    # Playwright 端到端测试
│   ├── vercel.json             # Vercel 部署配置（SPA 回退 + /api 代理）
│   └── Dockerfile / nginx.conf # 前端容器化（Nginx 托管 + 反代）
├── api/                        # 后端 FastAPI 独立服务（火山引擎代理）
│   ├── main.py                 # 10 个端点：LLM/TTS/ASR/RTC/图表/地理编码/健康/WS
│   ├── Dockerfile / railway.json  # 后端容器化（Railway/Docker 兼容）
│   └── requirements.txt
├── src/                        # 旧版 Three.js 地球演示（legacy 算法参考）
├── data/                       # 原始地理数据（Natural Earth 等）
├── assets/                     # 静态图片资源
├── Makefile                    # 一键命令（setup/dev/api/start/check/docker）
├── docker-compose.yml          # 全栈容器编排（前端 Nginx + 后端 FastAPI）
└── AGENTS.md                   # AI 开发规范与项目目标
```

---

## 🧠 架构设计

### 核心数据流

```
用户指令（语音 / 文字 / 按钮）
        │
        ▼
Geography Command Bus ──► 工具协议 Schema 校验（TOOL_NAMES / TOOL_SCHEMAS）
        │
        ├──► CesiumController（抽象层，隔离 Cesium API）
        ├──► Zustand Store（GeographySceneState，单一状态源）
        ├──► 数据源 Provider（带回退）
        └──► 课程运行时（lesson runtime）
```

### 关键原则

- **单一命令总线** —— React 组件不直接调用 Cesium API，一律经 `commandBus.execute({ name, args })`。
- **集中式状态** —— 所有视图、图层、地形、测量、镜头、语音、课程、UI 状态集中在 `GeographySceneState`。
- **白名单工具协议** —— AI 只能调用 Schema 白名单内的工具，参数经类型/范围/枚举校验。
- **回退优先** —— 任何外部服务失败都有降级路径，课堂绝不中断。
- **密钥不落前端** —— 火山引擎密钥仅存服务端，前端经 `/api/*` 同源代理调用。

---

## 🌍 部署

### 前端（Vercel）

生产环境已部署至 <https://earth-beryl-eight.vercel.app>。

**项目配置**（Vercel 控制台 → 项目设置）：

| 配置项 | 值 |
|---|---|
| Root Directory | `app` |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |

**`app/vercel.json`** 负责 SPA 回退与后端代理：

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "https://earth-backend.railway.app/api/$1" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

> ⚠️ **待办**：后端 Railway 就绪后，将第一条 rewrite 的 `https://earth-backend.railway.app` 替换为真实后端地址。静态资源（`/cesium`、`/assets`）优先于 rewrites，不受影响。

**CLI 部署**：

```bash
vercel link --project earth --scope <你的 scope> --token $VERCEL_TOKEN
vercel deploy --prod --yes --token $VERCEL_TOKEN
```

### 后端（Railway）

后端为 **FastAPI 独立服务**，通过 Dockerfile 部署，代码与配置已就绪：

- [`api/Dockerfile`](api/Dockerfile) —— `python:3.11-slim` + Noto CJK 字体 + 非 root 用户，端口读取 `$PORT`（兼容 Railway 随机端口）。
- [`api/railway.json`](api/railway.json) —— 指定 Dockerfile 构建 + `/api/health` 健康检查。
- [`api/.dockerignore`](api/.dockerignore) —— 排除 `.env`、`.venv`、测试脚本，防止密钥进镜像。

**Railway 部署步骤**：

1. 在 [Railway](https://railway.com) 创建项目，新建 Service → *Deploy from GitHub repo*，选择仓库 `A-Tulip/earth`。
2. 在 Service 设置中，**Root / Deploy Directory 设为 `api`**。
3. Railway 自动识别 `api/Dockerfile` 并构建（如未识别，在 Settings 强制选择 Dockerfile）。
4. 在 Variables 中配置密钥环境变量（见[后端环境变量](#后端-fastapi)）；`PORT` 由 Railway 自动注入。
5. 部署完成后，Railway 会给出公网 URL（`https://<service>.up.railway.app`）。
6. 回到 `app/vercel.json`，将 `/api` 转发地址替换为上述真实 URL。

> 健康检查：Railway 会轮询 `/api/health`，返回 200 即视为就绪。

### 全栈容器化（Docker / Docker Compose）

```bash
make docker          # 构建并后台启动（前端 8080 + 后端 8787）
make docker-up       # 仅启动（不重建）
make docker-logs     # 跟踪日志
make docker-down     # 停止并移除
```

- 前端：Nginx 托管 SPA，`/api`、`/ws` 反代到 `api:8787`。
- 后端：FastAPI，密钥经 `api/.env` 或宿主环境注入。

---

## ⚙️ 环境变量配置

### 前端（`app/.env.local`）

```bash
cd app && cp .env.example .env.local
```

| 变量 | 作用 | 不填的回退 | 申请地址 |
|---|---|---|---|
| `VITE_CESIUM_ION_TOKEN` | Cesium 真实地形（等高线/坡度/高程分析） | OSM 底图 + 椭球地形 | <https://ion.cesium.com/tokens> |
| `VITE_TIANDITU_TOKEN` | 天地图中文注记卫星/政区/地形底图 | OSM / Esri | <https://console.tianditu.gov.cn/api/key> |
| `VITE_AMAP_KEY` | 高德卫星/路网/中文注记（街景级） | OSM / Esri 回退 | <https://console.amap.com/dev/key/app> |
| `VITE_ASR_PROVIDER` | 语音识别供应商（`browser`/`volcengine`） | 浏览器 Web Speech API | — |
| `VITE_TTS_PROVIDER` | 语音合成供应商（`browser`/`volcengine`） | 浏览器 speechSynthesis | — |
| `VITE_LLM_PROVIDER` | 意图理解供应商（`keyword`/`volcengine`） | 本地关键词解析 | — |

### 后端（FastAPI）

密钥仅存服务端（`api/.env` 或部署平台环境变量），前端经 `/api/*` 同源代理调用，**绝不暴露到浏览器**。

| 密钥 | 作用 | 申请地址 |
|---|---|---|
| `VOLC_ARK_API_KEY` | 豆包大模型（LLM 意图理解/回答） | <https://console.volcengine.com/ark> |
| `VOLC_ASR_API_KEY` / `VOLC_ASR_APP_ID` | 流式语音识别（ASR） | <https://console.volcengine.com/speech/app> |
| `VOLC_TTS_API_KEY` / `VOLC_TTS_APP_ID` | 语音合成（TTS） | <https://console.volcengine.com/speech/app> |

> 完整密钥项、鉴权模式（AppID 体系 / API Key 体系）与申请步骤见 [`api/.env.example`](api/.env.example)。

---

## 🎙️ 语音与 AI 交互

- **单击空格（Toggle 模式）** —— 单击开始录音，再单击结束并提交 ASR + LLM 识别执行。
- **实时对话模式** —— 全双工，VAD 自动检测说话开始/结束，句末自动提交，AI 说话自动打断（barge-in）。
- **降级链** —— 流式 ASR → 浏览器 Web Speech API → 关键词意图解析；任一环节失败自动降级，字幕保留。

快捷键：

| 快捷键 | 功能 |
|---|---|
| `空格（单击）` | 开始录音（无需按住） |
| `空格（再按）` | 结束录音，提交识别 |
| `⌘ / Ctrl + /` | 打开 / 关闭 AI 对话面板 |
| `Cmd+K / Ctrl+K` | 打开课程/命令菜单 |
| `?` | 查看完整帮助 |

---

## 📚 课程体系

9 门已注册课程（`app/content/`）：

| 课程 | 主题 |
|---|---|
| 等高线与地形判读 | 初中八年级，等高线/地形判断/三维抬升/高程分层 |
| 中国地势三级阶梯 | 区域地理 |
| 地球自转与昼夜 | 地球地图 |
| 板块运动与地震带 | 自然地理 |
| 地球公转与四季 | 地球地图 |
| 冷锋与暖锋 | 自然地理 |
| 季风与气候 | 自然地理 |
| 洋流与气候 | 自然地理 |
| 典型地貌 | 自然地理 |

课程内容独立于代码，可校验：`npm run validate:content`。
课标对齐：初中（2022 年版）、高中（2017 年版 2020 年修订）。

---

## 🛠️ 技术栈

| 层 | 技术 | 用途 |
|---|---|---|
| 语言 | TypeScript 5.6（strict）/ Python 3.11 | 类型安全 / 后端 |
| 三维地球 | CesiumJS 1.143 | 地球、地形、影像、GeoJSON、CZML |
| 太阳系 | Three.js 0.160（懒加载） | 行星轨道、脱离地理坐标系的场景 |
| 前端框架 | React 18 + Vite 5 | UI 与构建 |
| 状态管理 | Zustand | 集中式场景状态 |
| 样式 | Tailwind CSS 3 | 组件样式 |
| 后端 | FastAPI + uvicorn | 火山引擎代理、图表、地理编码、WS |
| 测试 | Vitest + Playwright | 单元/集成 + 端到端 |

---

## 🧪 测试与持续集成

```bash
cd app
npm run build             # 类型检查 + 生产构建
npm test                  # 单元 + 集成测试（Vitest）
npm run test:e2e          # Playwright 端到端测试
npm run typecheck         # TypeScript 类型检查
npm run lint              # ESLint
npm run validate:content  # 课程内容校验
```

仓库通过 [GitHub Actions](.github/workflows/ci.yml) 在 **PR 与 push 到 main** 时自动执行：

| 阶段 | 检查项 |
|---|---|
| 前端质量 | `typecheck` + 单元测试 + 课程内容校验 + 生产构建 |
| 部署 | main 分支构建成功后自动部署前端到 Vercel |
| 后端 | 校验 `api/main.py` 可编译 + Docker 镜像构建（`python:3.11-slim`） |

> Vercel 部署需在仓库 Settings → Secrets 配置 `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID`（见 [Vercel 部署](#前端vercel)）。

---

## 📄 文档

- [AGENTS.md](AGENTS.md) —— AI 开发规范、项目目标、代码规范、数据来源规则
- [CHANGELOG.md](CHANGELOG.md) —— 版本变更记录（Keep a Changelog 规范）
- [`app/.env.example`](app/.env.example) —— 前端环境变量模板（含 FAQ）
- [`api/.env.example`](api/.env.example) —— 后端密钥模板（含鉴权模式说明）
- [`api/main.py`](api/main.py) —— 后端端点一览
- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) —— CI / CD 工作流定义

> 内部开发文档（架构/UI 系统/语音 Agent/课程编写等）保存在本地 `app/docs/`，不入库，避免与公开文档混淆。

---

## 🤝 贡献

1. 阅读 [AGENTS.md](AGENTS.md) 了解项目规范与"先读后写"原则。
2. 新建分支，遵循 Conventional Commits（`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`）。
3. 提交前运行 `make check`（lint + typecheck + 单元测试）。
4. 通过 PR 提交，由维护者 review 后合并。

---

## 📄 许可证

[MIT](LICENSE) © 地球探索者 项目组