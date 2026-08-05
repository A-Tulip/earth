# 架构文档

## 1. 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    React UI Layer                        │
│  TopBar · ToolDock · CommandMenu · SubtitleLayer · ...   │
└────────────┬──────────────────────────┬─────────────────┘
             │ read state               │ dispatch commands
             ▼                          ▼
┌──────────────────────┐    ┌─────────────────────────────┐
│  GeographySceneState │    │     Geography Command Bus    │
│    (Zustand store)   │    │  validate → route → execute │
└──────────┬───────────┘    └──────────┬──────────────────┘
           │ subscribe                 │ calls
           ▼                           ▼
┌──────────────────────┐    ┌─────────────────────────────┐
│   React Components   │    │   CesiumController (抽象层)   │
│  (re-render on state)│    │   LessonRuntime             │
└──────────────────────┘    │   DataProviders             │
                            │   SolarSystemEngine         │
                            └──────────┬──────────────────┘
                                       │ scene orchestrator
                  ┌────────────────────┴───────────────────┐
                  ▼                                        ▼
       ┌────────────────────────┐         ┌────────────────────────┐
       │      CesiumJS          │         │       Three.js         │
       │ Globe·Terrain·Imagery  │         │ 太阳系·行星轨道·Bloom    │
       │ (solarSystemActive=false)│       │ (solarSystemActive=true)│
       └────────────────────────┘         └────────────────────────┘
```

## 2. 核心原则

### 2.1 单一状态源

所有运行时状态集中在 `GeographySceneState`（`src/state/sceneState.ts`），包括：
- 视图模式、底图
- 图层（标注/天文/数据）
- 地形分析、测量
- 镜头、选中对象、时间维度
- 语音、课程、临时 UI

React 组件**只读 state 并 re-render**，不直接散布 Cesium 操作。

### 2.2 单一命令总线

手动按钮和 AI 语音指令都调用 `commandBus.execute({ name, args })`：
1. `validateToolCall` 按 `TOOL_SCHEMAS` 校验参数
2. 路由到注册的 handler
3. handler 通过 `CesiumController` / `LessonRuntime` / `DataProviders` 执行
4. 返回统一的 `ToolResult`

**测试保证：** `tests/commandBus.test.ts` 验证按钮点击与 AI 调用使用同一实例。

### 2.3 抽象层隔离

`CesiumController` 封装所有 Cesium API 调用，隔离版本变化并支持测试 mock。React 组件和命令 handler 不直接 `import * as Cesium`。

## 3. 模块职责

### `src/cesium/`
- `CesiumCanvas.tsx` — React 组件，挂载 Cesium Viewer，关闭所有默认 UI
- `controller.ts` — 抽象层：镜头、视图模式、底图、地形材质、测量、地形采样

### `src/commands/`
- `schema.ts` — 工具白名单 `TOOL_NAMES`、参数 Schema、`validateToolCall`
- `bus.ts` — Command Bus：注册、执行、订阅、上下文管理

### `src/state/`
- `sceneState.ts` — `GeographySceneState` 接口定义 + 初始状态
- `store.ts` — Zustand store 实现

### `src/voice/`
- `adapters.ts` — ASR/TTS/LLM 适配器接口 + 浏览器/关键词回退实现
- `PushToTalk.ts` — 按住空格录音、松开提交；处理 repeat/输入框/失焦/隐藏

### `src/lessons/`
- `schema.ts` — 课程包 Schema（`LessonPackage`、`LessonStep`、`SceneConfig`）
- `catalog.ts` — 可搜索的课程目录索引
- `runtime.ts` — 课程播放器：加载、播放、暂停、恢复、推进
- `singletons.ts` — TTS 适配器单例

### `src/data/`
- `providers.ts` — 数据源封装：城市（预置）、天气、地震、自然事件；失败回退
- `planets.ts` — 太阳系行星真实天文数据（NASA Planetary Fact Sheet），含质量、半径、轨道偏心率、自转周期；缩放函数 `scaledRadius` / `scaledDistance`

### `src/solar-system/`
- `engine.ts` — `SolarSystemEngine`：Three.js 太阳系仿真引擎
  - 太阳本体（自发光 `MeshBasicMaterial`）+ 多层辉光 Sprite + 点光源
  - 8 大行星程序化纹理（Canvas 噪声，无需外部素材）
    - 岩石行星：陨石坑噪声点；地球特殊处理（海洋+陆地+云层）
    - 气态行星：水平条纹；木星大红斑
    - 冰巨星：淡色线性渐变
  - 椭圆轨道（`EllipseCurve` + 真实偏心率）
  - 土星环（`RingGeometry` + 程序化环纹理）
  - 自转速度使用真实 `dayLength`，金星/天王星逆向自转
  - `UnrealBloomPass` 后处理 + `ACESFilmic` 色调映射
  - `dispose()` 完整释放 WebGL 资源（geometry / material / composer）
- `SolarSystemCanvas.tsx` — React 组件，按 `solarSystemActive` 挂载/卸载
  - 订阅 `revolutionSpeed` 自动同步引擎速度
  - 卸载时调用 `engine.dispose()` + `renderer.dispose()` 避免内存泄漏
  - 通过 `React.lazy` 动态导入，Three.js 仅在切换到太阳系视图时加载

### `src/ui/`
- `TopBar.tsx` — 左上产品名 + 右上课程入口/声音/全屏
- `ToolDock.tsx` — 左下可折叠工具坞（视图/标注/天文/数据/测量）
- `CommandMenu.tsx` — 轻量可搜索课程命令菜单
- `SubtitleLayer.tsx` — 底部字幕 + 讲义层
- `Guidance.tsx` — 首次打开的轻引导文字（数秒淡出）
- `icons.tsx` — 统一线性 SVG 图标

## 4. 渲染引擎分工

| 引擎 | 职责 | 边界 |
|---|---|---|
| **CesiumJS** | 真实地球、全球地形、地图、影像、GeoJSON、CZML、镜头、空间标注 | 地理坐标系内的一切 |
| **Three.js** | 太阳系、行星轨道、脱离地理坐标系的特殊场景 | 太阳系视图（`solarSystemActive=true`）；真实地球仍归 Cesium |

### Scene Orchestrator

通过 `GeographySceneState.solarSystemActive` 单一布尔字段切换渲染引擎：

```
solarSystemActive=false（默认）  → CesiumCanvas + CesiumLayerSync
solarSystemActive=true           → SolarSystemCanvas（React.lazy 动态导入）
```

- 切换由 `view.showSolarSystem` / `view.showEarth` 命令触发，走统一 Command Bus
- TopBar 右上角 Sun/Globe 图标按钮也调用同一命令（按钮与 AI 共用 Bus）
- Three.js 通过 `React.lazy(() => import('./solar-system/SolarSystemCanvas'))` 动态导入，
  首次切换才加载 ~600 KB 的 Three.js chunk，地球视图首屏不负担该体积
- 两个引擎不同时挂载，切换时旧引擎完整卸载并释放资源

**迁移自旧版：** `src/engines/concept/solar-system.js`（legacy 参考），新版 `engine.ts` 修复了
旧版统一自转速度的缺陷，改用真实 `dayLength` 并支持逆向自转。

## 5. 数据流示例：用户说"打开等高线"

```
1. 用户按住空格 → PushToTalk.startRecording → ASR.start
2. 松开空格 → ASR.stop → "打开等高线"
3. LLM.chat(["打开等高线"]) → toolCalls: [{ name: 'layer.showContour', args: { spacing: 200 } }]
4. commandBus.execute({ name: 'layer.showContour', args: { spacing: 200 } })
5. validateToolCall 通过
6. handler 调用 cesiumController.showContour(200)
7. handler 调用 store.setTerrain({ contour: true })
8. Cesium globe.material = ElevationContour
9. TTS.speak("已显示等高线，间距 200 米")
10. React 组件根据 store 状态更新 UI
```

## 6. 性能策略

- Cesium `requestRenderMode: true` + `maximumRenderTimeChange: Infinity`
- `msaaSamples: 4` 抗锯齿
- 课程资源按需加载
- 图层实体正确销毁
- `manualChunks` 分离 cesium/react 供应商包
- **Three.js 动态导入**：`SolarSystemCanvas` 通过 `React.lazy` 懒加载，
  地球视图首屏不加载 Three.js（~600 KB），仅在切换到太阳系视图时按需加载
- **太阳系资源释放**：`SolarSystemEngine.dispose()` 遍历 group 释放所有 geometry/material，
  并调用 `composer.dispose()`；React 组件卸载时额外 `renderer.dispose()` 移除 WebGL 上下文
- **程序化纹理无外部依赖**：行星纹理由 Canvas 运行时生成，无网络请求，回退优先

## 7. 测试架构

| 层 | 工具 | 文件 | 覆盖 | 状态 |
|---|---|---|---|---|
| 单元 | Vitest + jsdom | `tests/schema.test.ts` | 工具 Schema 校验（23 例） | ✅ |
| 单元 | Vitest + jsdom | `tests/store.test.ts` | 状态管理（14 例） | ✅ |
| 单元 | Vitest + jsdom | `tests/voice.test.ts` | 意图解析 + 空格键安全 + 实时对话历史（37 例） | ✅ |
| 单元 | Vitest + jsdom | `tests/solarSystem.test.ts` | 行星数据/缩放/状态/命令（20 例） | ✅ |
| 单元 | Vitest + jsdom | `tests/geoReferencer.test.ts` | 地名/经纬度解析（9 例） | ✅ |
| 单元 | Vitest + jsdom | `tests/lessonRuntime.test.ts` | 课程状态机（12 例） | ✅ |
| 集成 | Vitest + jsdom | `tests/commandBus.test.ts` | 按钮与 AI 共用 Bus（29 例） | ✅ |
| E2E | Playwright | `e2e/01-page-open.spec.ts` | 页面打开、地球加载 | ✅ |
| E2E | Playwright | `e2e/02-tool-dock.spec.ts` | 工具坞收放 | ✅ |
| E2E | Playwright | `e2e/03-view-and-contour.spec.ts` | 二维三维切换、等高线 | ✅ |
| E2E | Playwright | `e2e/04-lesson-menu.spec.ts` | 课程菜单搜索与打开 | ✅ |
| E2E | Playwright | `e2e/05-push-to-talk.spec.ts` | 空格录音、输入框安全 | ✅ |
| E2E | Playwright | `e2e/06-solar-system.spec.ts` | 太阳系视图 | ✅ |
| E2E | Playwright | `e2e/07-layer-stability.spec.ts` | 图层稳定性、底图轮换、2D/3D 切换 | ✅ |
| 内容 | tsx 脚本 | `src/lessons/validate.ts` | 9 门课程的 Schema/字段/引用校验 | ✅ |

**运行命令：**
- 单元 + 集成：`npm test`（144 例全过）
- 类型检查：`npm run typecheck`
- 生产构建：`npm run build`
- 内容校验：`npm run validate:content`
- E2E：`npm run test:e2e`（17 例，需先 `npm run build && npm run preview`）

## 8. 图层同步机制

`CesiumLayerSync` 组件以 React 形式订阅 `useGeographyStore` 的图层开关，
在 Cesium Viewer 上添加/移除对应实体，统一管理生命周期。

| 图层 | 数据源 | 触发字段 | 同步方式 |
|---|---|---|---|
| 城市点 | 预置 `getCities()` | `annotations.cities` | 同步 |
| 河流线 | 预置 `getRivers()` | `annotations.rivers` | 同步 |
| 板块边界 | 预置 `getPlates()` | `annotations.plates` | 同步 |
| 经纬线 | 程序生成（30° 网格） | `annotations.graticule` | 同步 |
| 日界线 | 程序生成（180° 经线） | `annotations.dateLine` | 同步 |
| 实时天气 | Open-Meteo（失败回退） | `data.weather` | 异步 Promise.all |
| 地震数据 | USGS GeoJSON（失败空数组） | `data.earthquake` | 异步，震级映射点大小 |
| 自然事件 | NASA EONET（失败空数组） | `data.naturalEvents` | 异步，限 50 条 |

卸载时调用 `clearLayer` 清理所有实体，并通过 `*_Cancelled` 标志取消未完成的异步抓取，
避免组件卸载后写入 Cesium。
