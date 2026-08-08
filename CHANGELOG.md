# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号遵循
[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- 前端 Vercel 部署配置（`app/vercel.json`）：SPA 回退 + `/api` 同源代理到后端。
- 后端 Railway 容器化配置（`api/railway.json`、`api/Dockerfile` 动态 `$PORT`）。
- 新增 GitHub Actions CI 工作流：lint + typecheck + 单元测试 + 课程校验 + 构建 + Vercel 部署 + 后端构建验证。

### Fixed
- 底图瓦片错误监听（`terrainProviders.ts`）：增加 SSR（`typeof window === 'undefined'`）防护，
  并对同一 provider 的重复报错做去重，避免重复上报污染日志。

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