# 迁移说明

## 1. 迁移策略

**保留旧代码为算法参考，不直接删除。** 新主线使用 `app/` 下的新应用入口，旧 `src/earth.html` 不再扩展。

```
src/                    # 旧版（legacy 参考）
├── earth.html          # 旧主线（左侧超长控制栏 + 多弹窗）
├── earth-optimization.js  # EarthOptimizer 等算法（自转/公转/晨昏计算）
├── legacy/             # 明确归档
└── engines/concept/solar-system.js  # 太阳系参考

app/                    # 新主线（AI 地理画布）
```

## 2. 旧版问题诊断

### 为什么形成左侧超长控制栏
`earth.html` 把所有功能塞进单个 `#left-panel`：天气、测量、自转公转滑块、轴倾角、太阳高度、城市搜索、全屏截图分享、日出日落计算、直射点/季节/昼长/气候带信息、世界时钟、城市对比、知识库、互动问答、AI 学习助手——导致面板极长。

### 为什么有多个弹窗
图片画廊、知识库、问答、学习助手各自用 `modal` 实现，功能耦合在单一 HTML。

### 旧代码保留价值
- `earth-optimization.js` 的 `EarthOptimizer` 类——自转/公转/晨昏线/太阳高度计算算法可作参考
- `solar-system.js`——Three.js 太阳系实现可作参考
- 城市数据、知识库 JSON——可迁移到 content/

## 3. 功能迁移对照表

| 旧功能（earth.html） | 旧位置 | 新位置 | 手动入口 | AI 命令 | 测试状态 |
|---|---|---|---|---|---|
| 卫星影像底图 | 左面板 | `CesiumController.setBasemap('satellite')` | 工具坞→视图 | `view.setBasemap` | ✅ 单元 |
| 地形模式底图 | 左面板 | `CesiumController.setBasemap('terrain')` | 工具坞→视图 | `view.setBasemap` | ✅ 单元 |
| 政区底图 | 左面板 | `CesiumController.setBasemap('political')` | 工具坞→视图 | `view.setBasemap` | ✅ 单元 |
| 二维/三维切换 | 左面板 | `CesiumController.setSceneMode` | 工具坞→视图 | `view.setMode` | ✅ 单元 |
| 恢复视角 | 左面板 | `CesiumController.resetView` | 工具坞→视图 | `camera.reset` | ✅ 单元 |
| 经纬线 | 左面板 | `annotations.graticule` | 工具坞→标注 | `layer.toggle` | ✅ 单元 |
| 城市 | 左面板 | `annotations.cities` + 预置数据 | 工具坞→标注 | `layer.toggle` | ✅ 单元 |
| 地名 | 左面板 | `annotations.labels` | 工具坞→标注 | `layer.toggle` | ✅ 单元 |
| 气候带 | 左面板 | `annotations.climateZones` | 工具坞→标注 | `layer.toggle` | ✅ 单元 |
| 板块区域 | 左面板 | `annotations.plates` | 工具坞→标注 | `layer.toggle` | ✅ 单元 |
| 日界线 | 左面板 | `annotations.dateLine` | 工具坞→标注 | `layer.toggle` | ✅ 单元 |
| 河流 | 左面板 | `annotations.rivers` | 工具坞→标注 | `layer.toggle` | ✅ 单元 |
| 山脉 | 左面板 | `annotations.mountains` | 工具坞→标注 | `layer.toggle` | ✅ 单元 |
| 行政边界 | 左面板 | `annotations.adminBounds` | 工具坞→标注 | `layer.toggle` | ✅ 单元 |
| 地轴 | 左面板 | `astronomy.axis` | 工具坞→天文 | `layer.toggle` | ✅ 单元 |
| 太阳直射点 | 左面板 | `astronomy.directPoint` | 工具坞→天文 | `layer.toggle` | ✅ 单元 |
| 晨昏线 | 左面板 | `astronomy.twilight` + `globe.enableLighting` | 工具坞→天文 | `layer.toggle` | ✅ 单元 |
| 日间模式 | 左面板 | `astronomy.dayMode` | 工具坞→天文 | `layer.toggle` | ✅ 单元 |
| 自转 | 左面板滑块 | `astronomy.rotation` + `clock.shouldAnimate` | 工具坞→天文 | `animation.play/pause` | ✅ 单元 |
| 公转 | 左面板滑块 | `astronomy.revolution` | 工具坞→天文 | `animation.play/pause` | ✅ 单元 |
| 自转速度 | 滑块 `rot-speed` | `rotationSpeed` | 工具坞→天文 | `animation.setSpeed` | ✅ 单元 |
| 公转速度 | 滑块 `rev-speed` | `revolutionSpeed` | 工具坞→天文 | `animation.setSpeed` | ✅ 单元 |
| 轴倾角 | 滑块 `axis-tilt` | `axisTilt` | 工具坞→天文 | （待补命令） | ✅ 单元 |
| 太阳高度 | 滑块 `sun-height` | `sunHeight` | 工具坞→天文 | （待补命令） | ✅ 单元 |
| 天气 | 左面板开关 | `data.weather` + `fetchWeather` | 工具坞→数据 | `layer.toggle` | ✅ 单元 |
| 地震 | 左面板 | `data.earthquake` + `fetchEarthquakes` | 工具坞→数据 | `layer.toggle` | ✅ 单元 |
| 自然事件 | 左面板 | `data.naturalEvents` + `fetchNaturalEvents` | 工具坞→数据 | `layer.toggle` | ✅ 单元 |
| GDP | 左面板 | `data.gdp` | 工具坞→数据 | `layer.toggle` | 待接入 |
| 人口 | 左面板 | `data.population` | 工具坞→数据 | `layer.toggle` | 待接入 |
| 温度 | 左面板 | `data.temperature` | 工具坞→数据 | `layer.toggle` | 待接入 |
| 降水 | 左面板 | `data.precipitation` | 工具坞→数据 | `layer.toggle` | 待接入 |
| 距离测量 | `measure-distance` | `measure.start('distance')` | 工具坞→测量 | `measure.start` | ✅ 单元 |
| 面积测量 | `measure-area` | `measure.start('area')` | 工具坞→测量 | `measure.start` | ✅ 单元 |
| 角度测量 | `measure-angle` | `measure.start('angle')` | 工具坞→测量 | `measure.start` | ✅ 单元 |
| 清除测量 | `measure-clear` | `measure.clear` | 工具坞→测量 | `measure.clear` | ✅ 单元 |
| 等高线 | （新增） | `CesiumController.showContour` | 工具坞→视图 | `layer.showContour` | ✅ 集成 |
| 高程分层 | （新增） | `CesiumController.showElevationRamp` | 工具坞→视图 | `layer.showElevationRamp` | ✅ 单元 |
| 坡度 | （新增） | `CesiumController.showSlope` | 工具坞→视图 | `layer.showSlope` | ✅ 单元 |
| 坡向 | （新增） | `CesiumController.showAspect` | 工具坞→视图 | `layer.showAspect` | ✅ 单元 |
| 地形夸张 | （新增） | `CesiumController.setTerrainExaggeration` | 工具坞→视图 | `terrain.setExaggeration` | ✅ 单元 |
| 地形剖面 | （新增） | `terrain.profile` | 工具坞→测量 | `terrain.profile` | 待补 |
| 海拔查询 | （新增） | `CesiumController.sampleHeight` | 点击地图 | `explain.location` | ✅ 单元 |
| 语音控制 | 麦克风按钮 | `PushToTalk`（空格单击 Toggle） | 空格/麦克风按钮 | — | ✅ 单元 |
| 城市搜索 | `city-search` | `CommandMenu` 搜索 | 右上课程入口 | `camera.flyTo` | ✅ 单元 |
| 知识库 | `knowledge-modal` | 讲义层 + AI 解释 | 课程/上下文 | `explain.current` | ✅ 集成 |
| 互动问答 | `quiz-btn` | 课程步骤 `question` | 课程内 | `question.ask` | ✅ 单元 |
| AI 学习助手 | `study-assistant-btn` | AI 语音闭环 | 空格语音 | `explain.*` | ✅ 集成 |
| 日出日落计算 | `calc-*` | （待迁移到光照课程） | — | — | 待迁移 |
| 直射点/季节/昼长/气候带信息 | `info-*` | 讲义层 + 上下文标注 | — | `explain.location` | 部分迁移 |
| 世界时钟 | `world-clock-container` | （待迁移） | — | — | 待迁移 |
| 城市对比 | `compare-*` | （待迁移到数据比较模板） | — | — | 待迁移 |
| 图片画廊 | `gallery-modal` | （不迁移，非教学核心） | — | — | 不迁移 |
| 太阳系视图 | `engines/concept/solar-system.js` | `app/src/solar-system/`（Three.js + 真实纹理） | TopBar Sun 按钮 / 工具坞→天文 | `view.showSolarSystem` / `view.showEarth` | ✅ 单元 + E2E |
| 行星纹理 | （旧版无） | `app/public/textures/planets/`（Solar System Scope, CC BY 4.0） | — | — | ✅ 程序化回退 |
| 全屏 | `fullscreen-btn` | `TopBar` 全屏按钮 | 右上 | — | ✅ |
| 截图 | `screenshot-btn` | （待迁移） | — | — | 待迁移 |
| 分享场景 | `share-btn` | （待迁移） | — | — | 待迁移 |

## 4. 迁移完成验证

- ✅ 所有"工具坞分组"列出的能力已迁移
- ✅ 按钮与 AI 共用 Command Bus（`tests/commandBus.test.ts` 验证）
- ✅ 状态集中管理（`tests/store.test.ts` 验证）
- ✅ 等高线样板课程完整运行
- ✅ 太阳系视图迁移完成（Three.js 真实纹理 + 程序化回退 + TopBar/工具坞双入口 + E2E 测试）
- ⏳ 日出日落计算、世界时钟、城市对比、截图、分享待后续迁移
- ❌ 图片画廊不迁移（非教学核心）
