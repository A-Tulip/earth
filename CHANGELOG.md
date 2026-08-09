# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号遵循
[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- 前端 Vercel 部署配置（`app/vercel.json`）：SPA 回退 + `/api` 同源代理到后端。
- 后端 Railway 容器化配置（`api/railway.json`、`api/Dockerfile` 动态 `$PORT`）。
- 新增 GitHub Actions CI 工作流：lint + typecheck + 单元测试 + 课程校验 + 构建 + Vercel 部署 + 后端构建验证。
- 后端已部署至 Railway（`https://earth-production.up.railway.app`），`volc.*` 密钥写入 Railway 环境变量，
  `/api/health` 已确认 `llm / tts / asr` 就绪；Vercel `/api` 同源代理指向该 Railway 服务。

### Fixed
- 底图瓦片错误监听（`terrainProviders.ts`）：增加 SSR（`typeof window === 'undefined'`）防护，
  并对同一 provider 的重复报错做去重，避免重复上报污染日志。
- 生产环境实时语音（S2S）：Vercel 无法代理 WebSocket 到外部后端，导致 `/ws/s2s` 在生产失效。
  现通过 `VITE_S2S_WS_URL`（写入 `app/.env.production`）让前端直连 Railway 的
  `wss://earth-production.up.railway.app/ws/s2s`；开发环境留空仍走同源 Vite 代理。
- 生产 TTS 502（`40200002 IllegalToken`）：Railway 环境缺少新版单 API Key（`VOLC_ASR_API_KEY`），
  后端误回退到无效的旧版 `AppID+Token`。已将 key 同步到 Railway 环境变量并
  `railway redeploy --from-source` 重新部署，TTS 恢复 200 + MP3。

### Docs
- [`app/docs/deployment.md`](app/docs/deployment.md)：重写为当前 Vercel + Railway 真实生产部署文档，
  含部署架构图、前后端配置步骤、环境变量清单、TTS 502 实战排障、健康检查假阳性说明与安全边界。
- [`README.md`](README.md)：修正后端已部署地址（`earth-production.up.railway.app`）、
  `vercel.json` rewrite 目标、后端密钥清单（TTS/ASR 共用新版 v3 单 Key）与部署步骤。
- [`app/docs/voice-agent.md`](app/docs/voice-agent.md)：空格键改为默认 Toggle（单击开始/再按停止），
  统一 TTS/ASR v3 `X-Api-Key` 鉴权描述，更正后端启动命令。
- [`app/docs/migration.md`](app/docs/migration.md)：语音控制迁移表述改为空格单击 Toggle。

---

## [0.1.0] - 2026-08-08

### Added
- **AI 地理画布**：打开即用、无需登录、AI 语音驱动的初高中地理互动教学平台。
- **三维地球**：CesiumJS 渲染，二维 / 哥伦布 / 三维切换，真实地形、影像、GeoJSON、CZML 动画。
- **AI 语音交互**：单击空格 Toggle 录音，自然语言指令 + 关键词意图双回退链路。
- **统一命令总线**（Geography Command Bus）：手动按钮与 AI 共用，工具协议 Schema 校验。
- **分级课程体系**：9 门初高中地理课程，自动推进、互动提问、AI 解释。
- **多源底图与回退**：天地图 / 高德 / Esri / OSM / 离线 Natural Earth 多级回退。
- **地形分析工具**：等高线、坡度、坡向、高程分层。
- **数据图层**：天气、地震、自然事件、GDP、人口、气温、降水 7 类数据，均带离线兜底。
- **太阳系引擎**：Three.js 懒加载，行星纹理、自转、公转、晨昏线、地轴等天文图层。
- **后端 FastAPI 服务**：火山引擎 LLM/TTS/ASR 代理、图表生成、地理编码、WebSocket 实时语音。

### Changed
- 旧版 `src/` 仅作算法参考，主应用迁移至 `app/`。

### Security
- 火山引擎密钥仅存服务端（`api/.env` / 部署平台环境变量），前端经 `/api/*` 同源代理调用，不落浏览器。

[Unreleased]: https://github.com/A-Tulip/earth/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/A-Tulip/earth/releases/tag/v0.1.0