# 地球探索者 · AI 地理画布

> 打开即用、无需登录、AI 语音驱动的初高中地理互动教学平台。

打开网站直接看到完整地球，按住空格说出你想观察的地点或知识点，AI 理解语音指令并改变画面、解释知识、播放教学过程、发起问题。地球和地貌是整个页面的核心画布，工具按需收起，界面不堆叠。

## 快速开始

```bash
cd app
npm install
npm run dev
# 打开 http://localhost:5173/
```

**零配置即可启动**：不需要任何环境变量。无 ion token 时使用 OSM 免 token 底图 + 椭球地形；无云端 ASR/TTS/LLM 时使用浏览器 Web Speech API + 本地关键词意图解析回退。

> **可选的云端能力**：如需火山引擎语音/大模型，另起终端启动 FastAPI 后端——`cp api/.env.example api/.env` 填密钥后 `make api`（端口 8787）。详见下方[配置](#配置可选)。

## 使用

### 语音（桌面端）
- **按住空格** 开始录音，**松开空格** 提交
- 说"打开等高线"、"飞到北京"、"切换到二维"、"地形夸张 3 倍"、"开始等高线课程"等
- 识别结果和执行状态短暂显示后自动淡出

### 语音（平板/手机）
- 右下角麦克风按钮

### 手动工具坞（左下角）
可折叠，5 个紧凑入口：视图 / 标注 / 天文 / 数据 / 测量。点击地图空白处或按 Esc 收起。

### 课程（右上角）
点击"课程"打开可搜索层级菜单，按初中/高中 + 自然/人文/区域/地球地图分类。选中后地球进入对应场景。

## 配置（可选）

**零配置即可启动**：不需要任何密钥即可看到完整地球。以下均为可选增强。

### 前端（`app/.env.local`）

```bash
cd app
cp .env.example .env.local   # 仅填需要的 VITE_ 开关
```

| 变量 | 作用 | 不填的回退 | 申请地址 |
|---|---|---|---|
| `VITE_CESIUM_ION_TOKEN` | Cesium World Terrain（真实地形，等高线/坡度/高程分析）| OSM 底图 + 椭球地形 | https://ion.cesium.com/tokens |
| `VITE_TIANDITU_TOKEN` | 天地图中英文注记卫星/政区/地形底图 | OSM / Esri（英文注记）| https://console.tianditu.gov.cn/api/key |
| `VITE_AMAP_KEY` | 高德卫星/路网/中文注记（街景级，zoom 19–20）| OSM / Esri 回退 | https://console.amap.com/dev/key/app |
| `VITE_ASR_PROVIDER` | 语音识别供应商（`browser`/`volcengine`）| 浏览器 Web Speech API | — |
| `VITE_TTS_PROVIDER` | 语音合成供应商（`browser`/`volcengine`）| 浏览器 speechSynthesis | — |
| `VITE_LLM_PROVIDER` | 意图理解供应商（`keyword`/`volcengine`）| 本地关键词解析 | — |

### 后端（火山引擎云端能力，可选）

启用云端语音/大模型前，先配置 FastAPI 后端密钥：

```bash
cp api/.env.example api/.env   # 填入所需的 VOLC_* 密钥
make api                        # 启动后端（端口 8787）
```

| 密钥 | 作用 | 申请地址 |
|---|---|---|
| `VOLC_ARK_API_KEY` | 豆包大模型（LLM 意图理解/回答）| https://console.volcengine.com/ark |
| `VOLC_ASR_API_KEY` / `VOLC_ASR_APP_ID` | 流式语音识别（ASR）| https://console.volcengine.com/speech/app |
| `VOLC_TTS_API_KEY` / `VOLC_TTS_APP_ID` | 语音合成（TTS）| https://console.volcengine.com/speech/app |

> 详细密钥项、鉴权模式与申请步骤见 [api/.env.example](api/.env.example)。所有真实密钥只进服务端，前端通过 `/api/*` 同源代理调用，绝不暴露到浏览器。

## 构建与测试

```bash
cd app
npm run build          # 类型检查 + 生产构建 → dist/
npm run preview        # 预览生产构建
npm test               # 单元 + 集成测试（Vitest）
npm run typecheck      # 类型检查
npm run lint           # ESLint
npm run validate:content  # 课程内容校验
```

## 架构

```
app/
├── src/
│   ├── cesium/         # Cesium 运行时（controller 抽象层 + canvas 组件）
│   ├── commands/       # Command Bus + 工具协议 Schema（按钮与 AI 共用）
│   ├── state/          # GeographySceneState（Zustand 集中式状态）
│   ├── voice/          # ASR/TTS/LLM 适配层 + Push-to-Talk
│   ├── lessons/        # 课程运行时 + Schema + 目录
│   ├── data/           # 数据源 Provider（带回退）
│   └── ui/             # React 组件（TopBar/ToolDock/CommandMenu/SubtitleLayer...）
├── content/            # 课程内容包（独立于代码）
│   └── contour-lines/  # 等高线样板课程
├── tests/              # 单元 + 集成测试
└── docs/               # 内部开发文档
```

**核心原则：**
- 手动按钮与 AI 语音指令共用同一个 `Geography Command Bus`
- 所有状态集中在 `GeographySceneState`，React 组件只读状态
- Cesium API 通过 `CesiumController` 抽象层隔离
- AI 不能直接执行 Cesium 代码，通过白名单工具协议调用
- 所有外部服务失败都有回退，课堂不中断

详见 [app/docs/architecture.md](app/docs/architecture.md)。

## 演示课程

- **等高线与地形判读**（初中八年级）：二维等高线、地形判断、三维抬升、高程分层、二维三维切换、互动题、AI 解释
- 中国地势三级阶梯、地球自转与昼夜、板块运动与地震带、地球公转与四季、冷锋与暖锋、季风与气候、洋流与气候（已在目录注册，内容待补全）

## 文档

- [AGENTS.md](AGENTS.md) — AI 开发规范与项目目标
- [app/docs/architecture.md](app/docs/architecture.md) — 架构
- [app/docs/ui-system.md](app/docs/ui-system.md) — UI 系统
- [app/docs/voice-agent.md](app/docs/voice-agent.md) — 语音 Agent
- [app/docs/lesson-authoring.md](app/docs/lesson-authoring.md) — 课程编写
- [app/docs/data-sources.md](app/docs/data-sources.md) — 数据源
- [app/docs/migration.md](app/docs/migration.md) — 旧版迁移对照
- [app/docs/deployment.md](app/docs/deployment.md) — 部署

## 技术栈

- TypeScript + React 18
- CesiumJS 1.143（真实地球、地形、影像、GeoJSON、CZML）
- Zustand（状态管理）
- Vite 5（构建）
- Tailwind CSS 3（样式）
- Vitest + Playwright（测试）

## 旧版

`src/earth.html` 是旧版 Three.js 地球演示，保留为算法参考，不再扩展。新主线在 `app/`。迁移对照见 [app/docs/migration.md](app/docs/migration.md)。

## 许可证

MIT License
