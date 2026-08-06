# AGENTS.md — 地球探索者 AI 开发规范

> 本文件是 AI 协作开发与人类贡献者的统一规范。任何 agent 在修改本仓库前必须先读完本文件。

## 1. 项目目标

把 `A-Tulip/earth` 从一个功能堆叠的 Three.js 地球演示页面，重构成**打开即用、无登录、AI 语音驱动的初高中地理互动教学平台**（"AI 地理画布"）。

**产品核心（不可妥协）：**

1. 无登录、无注册、无欢迎流程、无 API 配置——打开即看到完整地球
2. 地球与地貌是页面核心画布，AI 能理解当前地点、镜头、图层、选中对象和教学状态
3. 手动按钮与 AI 语音指令共用同一个 `Geography Command Bus`
4. 工具按需收起，界面容器数量极少，不长期存在课程时间轴/聊天面板/机器人头像
5. 时间控件只服务真正的时序课程（自转、公转、锋面、台风等）
6. 课程内容独立于代码，可扩展、可校验
7. 真实地理数据与教学增强结合，第三方服务不可用时课堂不中断

## 2. 产品边界

| 范畴 | 说明 |
|---|---|
| **公共产品** | `app/` 下的单页应用，无登录，打开即用 |
| **教师本地工具** | `Studio`（默认关闭，环境变量开启），课程生成与审核，不出现在公共首页 |
| **不在范围内** | 多智能体头像、复杂模型设置、幻灯片工作台、通用课堂页面、账户系统、供应商选择 UI |

## 3. 目录职责

```
earth/
├── app/                        # 新主线应用（AI 地理画布）
│   ├── src/
│   │   ├── cesium/             # Cesium 运行时（controller + canvas）
│   │   ├── commands/           # Command Bus + 工具协议 Schema
│   │   ├── state/              # GeographySceneState + Zustand store
│   │   ├── voice/              # ASR/TTS/LLM 适配层 + Push-to-Talk
│   │   ├── lessons/            # 课程运行时 + Schema + 目录
│   │   ├── data/               # 数据源 Provider 封装 + 行星数据
│   │   ├── solar-system/       # Three.js 太阳系引擎（懒加载）
│   │   ├── ui/                 # React 组件（TopBar/ToolDock/CommandMenu...）
│   │   └── App.tsx             # 应用根组件
│   ├── content/                # 课程内容包（独立于代码）
│   │   └── contour-lines/      # 等高线样板课程
│   ├── public/textures/planets # 太阳系真实纹理（CC BY 4.0，npm run download:textures）
│   ├── tests/                  # 单元 + 集成测试
│   ├── e2e/                    # Playwright 端到端测试
│   ├── docs/                   # 内部开发文档（architecture/ui-system/...）
│   ├── .env.example            # 环境变量模板
│   └── package.json
├── src/                        # 旧版 Three.js 地球演示（legacy 参考）
│   ├── earth.html              # 旧主线（不再扩展）
│   ├── earth-optimization.js   # 优化脚本（算法参考）
│   └── legacy/                 # 明确归档的旧页面
├── research/                   # 调研报告
├── data/                       # 原始地理数据（Natural Earth 等）
├── assets/                     # 静态图片资源
└── AGENTS.md                   # 本文件
```

**关键原则：** 新产品不继续围绕单一 `earth.html` 扩展。旧 `src/` 仅作算法参考。

## 4. 技术栈

- **TypeScript + React 18** — 类型安全的前端
- **Cesium ^1.143** — 真实地球、地形、影像、GeoJSON、CZML、镜头
- **Three.js ^0.160** — 太阳系、行星轨道等脱离地理坐标系的特殊场景（通过 `React.lazy` 动态导入，地球视图首屏不加载）
- **Zustand** — 集中式场景状态
- **Vite 5** — 构建工具
- **Tailwind CSS 3** — 样式
- **Vitest** — 单元/集成测试
- **Playwright** — 端到端测试

## 5. 代码规范

### 5.1 模块边界

- React 组件**不直接**调用 Cesium API，必须通过 `CesiumController` 或 `commandBus`
- AI、课程播放器、按钮、地图点击都只修改 `GeographySceneState` 或向 Command Bus 发送命令
- 数据源全部封装为 Provider，课程只引用稳定的内部数据标识

### 5.2 命令协议

- 所有工具调用必须通过 `commandBus.execute({ name, args })`
- 工具名称必须在 `TOOL_NAMES` 白名单中
- 所有参数通过 `TOOL_SCHEMAS` 校验（类型、范围、枚举）
- 返回统一的 `ToolResult`（成功/失败/加载中/撤销）

### 5.3 状态管理

- 单一 `GeographySceneState`，包含视图、图层、地形、测量、镜头、语音、课程、UI 等
- Zustand store 提供细粒度 setter（`setViewMode`、`toggleAnnotation` 等）
- `reset()` 恢复初始状态

### 5.4 TypeScript 规范

- `strict: true`
- 禁止 `any`（必要时用 `unknown` + 类型守卫）
- 公共接口必须有显式类型
- 测试中允许 `as never` 等窄化

## 6. AI 开发规则

1. **先读后写**：修改前必须读完相关文件，理解现有代码
2. **外科手术式修改**：只动必须动的行，不"顺手优化"邻近代码
3. **不创建多余文件**：优先编辑现有文件
4. **不写文档除非要求**：不主动创建 `*.md`，除非用户明确要求或本规范要求
5. **迁移而非删除**：旧功能先建接口再迁视觉，迁移完写对照表
6. **回退优先**：任何外部服务失败都要有回退，课堂不中断
7. **密钥不入前端**：所有密钥走服务端代理，不进构建产物、localStorage、公开仓库

## 7. 数据来源规则

| 数据源 | 用途 | 许可 | 回退 |
|---|---|---|---|
| Cesium World Terrain | 全球地形 | ion token（可选） | 椭球地形 |
| OpenStreetMap | 底图 | CC BY 4.0 | 内置纹理 |
| Natural Earth | 矢量数据 | Public Domain | 预置 GeoJSON |
| Open-Meteo | 天气 | CC BY 4.0 | 离线默认值 |
| USGS Earthquake | 地震 | Public Domain | 空数据 |
| NASA EONET | 自然事件 | Public Domain | 空数据 |
| Solar System Scope | 太阳系行星纹理 | CC BY 4.0 | 程序化 Canvas 纹理 |

**原则：** 第三方服务不可用时使用缓存、预置数据或简化教学图层。

## 8. 课程 Schema

每个课程包位于 `content/<lesson-id>/`，包含：

```
content/<lesson-id>/
├── lesson.ts (或 lesson.mdx)   # 课程正文 + 步骤
├── scene.json (可选)           # 场景配置
├── questions.json (可选)       # 问题
├── references.yaml (可选)      # 来源
├── regions.geojson (可选)      # 空间区域
├── simulation.czml (可选)      # 动画
└── assets/ (可选)              # 资源
```

**校验项：** 字段完整性、工具名称合法、地点经纬度合法、GeoJSON/CZML 语法、引用存在。

**课标对齐：**
- 初中：义务教育地理课程标准（2022 年版）
- 高中：普通高中地理课程标准（2017 年版 2020 年修订）

## 9. 命令协议

见 `app/src/commands/schema.ts`。工具白名单分 9 类：

1. 课程控制（`lesson.*`）
2. 镜头（`camera.*`）
3. 视图模式（`view.*`）
4. 图层（`layer.*`）
5. 地形分析（`terrain.*`）
6. 测量（`measure.*`）
7. 标注（`annotate.*`）
8. 动画（`animation.*`）
9. 问题与解释（`question.*`、`explain.*`）

## 10. 测试要求

- **单元测试**：命令 Schema、课程状态机、地点解析、地形参数、语音快捷键
- **集成测试**：手动按钮与 AI 命令调用同一个 Command Bus
- **E2E（Playwright）**：页面打开、地球加载、工具坞收放、空格录音、二维三维切换、等高线、课程打开
- **运行命令**：`npm test`（单元）、`npm run test:e2e`（E2E）

## 11. 提交规范

- Conventional Commits：`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`
- 小而清楚的 commit，不批量堆砌
- 不提交：`.env`、`node_modules/`、`dist/`、测试产物、真实密钥

## 12. 环境变量

见 `app/.env.example`。关键点：

- `VITE_CESIUM_ION_TOKEN`（可选，不填用 OSM + 椭球回退）
- `VITE_ASR_PROVIDER` / `VITE_TTS_PROVIDER` / `VITE_LLM_PROVIDER`（可选，默认浏览器/关键词回退）
- 不带 `VITE_` 前缀的变量仅服务端可见，不进前端构建

## 13. 性能策略

- Cesium `requestRenderMode: true`（静态场景降低 80%+ CPU）
- 课程资源按需加载，非当前模拟延迟加载
- 图层和实体正确销毁，避免内存泄漏
- 镜头移动期间控制标签密度
- 低性能设备降低阴影、粒子、分辨率、地形细节
- 公共产品默认隐藏开发性能面板

## 14. 异常体验

界面**不能显示虚假成功状态**。所有失败必须有具体错误和恢复操作：

- 地形加载失败 → 椭球或缓存地形
- 影像失败 → 基础底图
- 语音权限失败 → 文本命令入口
- ASR/TTS 失败 → 保留字幕
- 模型失败 → 仍可使用手动工具
- 课程资源缺失 → 显示具体错误和恢复操作
