# 地图 API 调研报告：百度 / 高德 / Cesium / Mapbox / Leaflet / Two.js

> 调研目的：评估主流地图 / 3D 地球引擎对 **K12 地理教学平台（Earth Explorer，当前基于 Three.js 单文件实现）** 的增强价值，重点覆盖真实地貌展示、3D 地形、热力图、2D/3D 切换与商用可行性。
> 调研时间：2026-07-29
> 关联文件：`K12地理课程调研报告.md`（已识别核心 3D 需求：等高线地形图、分层设色地形图、气温/降水热力图、板块运动、地球自转公转）

---

## 目录

- [一、能力矩阵对比总表](#一能力矩阵对比总表)
- [二、百度地图 JavaScript API（BMapGL / JSAPI 4.0）](#二百度地图-javascript-apibmapgl--jsapi-40)
- [三、高德地图 JavaScript API（JS API v2.0 + Loca）](#三高德地图-javascript-apijs-api-v20--loca)
- [四、Cesium.js](#四cesiumjs)
- [五、Mapbox GL JS](#五mapbox-gl-js)
- [六、Leaflet.js 与 Two.js](#六leafletjs-与-twojs)
- [七、配额与商用限制对比](#七配额与商用限制对比)
- [八、针对本项目（Three.js 地球）的集成方案](#八针对本项目threejs-地球的集成方案)
- [九、推荐方案与落地路径](#九推荐方案与落地路径)
- [十、集成代码示例（伪代码）](#十集成代码示例伪代码)
- [十一、文档与参考链接](#十一文档与参考链接)

---

## 一、能力矩阵对比总表

| 能力维度 | 百度 BMapGL | 高德 JS API v2.0 | Cesium.js | Mapbox GL JS | Leaflet | Two.js |
|---|---|---|---|---|---|---|
| **2D 地图** | ✅ | ✅ | ✅（2D 模式） | ✅ | ✅ | ❌（非地图库） |
| **3D 视角** | ✅ WebGL 倾斜 | ✅ 倾斜/旋转 | ✅ 原生 3D 地球 | ✅ 倾斜/pitch | ❌ 仅 2D | ❌ |
| **卫星图** | ✅ | ✅ | ✅（ion 影像） | ✅ | ✅（切片源） | ❌ |
| **真实 3D 地形（DEM）** | ❌ 无原生支持 | ❌ 无原生支持 | ✅ **核心优势** quantized-mesh | ✅ terrain DEM | ❌ | ❌ |
| **3D 建筑** | ⚠️ Prism 棱柱（非真实数据） | ✅ BuildingsLayer | ✅ 3D Tiles / OSM Buildings | ✅ fill-extrusion | ❌ | ❌ |
| **3D 地球（球体）** | ✅ 地球模式（无地形） | ❌（平面 3D） | ✅ **WGS84 真实球体** | ⚠️ Globe 视图（新特性） | ❌ | ❌ |
| **热力图** | ✅ | ✅ + Loca 3D 热力 | ⚠️ 需自定义 | ✅ heatmap layer | ✅ 插件 | ❌ |
| **覆盖物 marker/polygon** | ✅ | ✅ | ✅ Entity/Primitive | ✅ GeoJSON layer | ✅ | ❌ |
| **地理编码/逆地理** | ✅ | ✅ | ❌（需第三方） | ✅ Geocoding API | ⚠️ 插件 | ❌ |
| **POI 搜索（中国）** | ✅ 强 | ✅ **最强（中国）** | ❌ | ⚠️ 有限 | ❌ | ❌ |
| **路径规划（中国）** | ✅ 驾车/公交/步行 | ✅ 驾车/公交/步行/骑行/货车 | ❌ | ✅ Directions API | ❌ | ❌ |
| **2D/3D 运行时切换** | ⚠️ 有限 | ⚠️ 有限 | ✅ **3D/2D/Columbus 一键切换** | ✅ pitch 调节 | ❌ | ❌ |
| **离线/自托管** | ❌ | ❌ | ✅ 可自托管地形服务 | ⚠️ 需 token | ✅ 完全开源 | ✅ |
| **开源协议** | 专有（免费 Key） | 专有（免费 Key） | ✅ **Apache 2.0** | 专有（免费层） | ✅ BSD-2 | MIT |
| **教育/商用友好度** | ⚠️ 需商用授权 | ⚠️ 需商用授权 | ✅ **完全免费商用** | ⚠️ 免费层有限 | ✅ 完全免费 | ✅ 免费 |
| **与 Three.js 集成** | 中（独立引擎） | 中（独立引擎） | 高（同为 WebGL） | 中（可嵌 Three 层） | 低（2D） | — 同源 |

### 核心结论速览

> **真实地貌 / 等高线地形图 / 分层设色**：只有 **Cesium** 和 **Mapbox GL JS** 原生支持 DEM 高程数据。百度、高德的 JS API **均无原生 3D 地形**能力——它们的"地球模式"和"3D"只是倾斜视角的 2D 瓦片，不是真实高程。

> **中国 POI / 路径规划 / 地理编码**：**高德 > 百度**，Cesium/Mapbox 在中国行政与 POI 数据上偏弱。

> **K12 教学场景**：Cesium 在"真实地球 + 地形 + 3D 建筑 + 2D/3D 切换"上完胜，且 Apache 2.0 完全免费商用，是最匹配本项目的引擎。

---

## 二、百度地图 JavaScript API（BMapGL / JSAPI 4.0）

### 2.1 产品现状

- **当前推荐版本**：JSAPI 4.0（旧版 BMapGL/JSAPI GL 已转维护态，官方明确"不建议用于新项目"）
- **渲染技术**：WebGL
- **官方文档**：https://lbs.baidu.com/docs/jsapi?title=jsapi4/index

### 2.2 地图与图层能力

| 能力 | 支持情况 | 说明 |
|---|---|---|
| 2D 矢量图 | ✅ | 标准街道图 |
| 卫星图 | ✅ | `BMAP_SATELLITE_MAP` |
| 混合图（卫星+路网） | ✅ | `BMAP_HYBRID_MAP` |
| 3D 视角 | ✅ | `BMAP_PERSPECTIVE_MAP`，倾斜/旋转 |
| **地球模式（3D 球体）** | ✅ | `BMAP_EARTH_MAP`——**仅球体视角，无真实地形高程** |
| **DEM 地形高程** | ❌ | **不支持**。地球模式是平滑球体贴卫星影像，无山体起伏 |
| 个性化地图 | ✅ | 自定义样式 |
| 室内图 | ✅ | IndoorMap |
| 全景图 | ✅ | 街景 |
| 热力图 | ✅ | Heatmap |
| 交通流量图层 | ✅ | TrafficLayer |
| GeoJSON / MVT 图层 | ✅ | GeoJSONLayer / MVTLayer |

### 2.3 覆盖物

- Marker / Marker3D（带高度点）/ Label / InfoWindow / 自定义覆盖物
- Polygon / Polyline / **3D 棱柱 Prism**（非真实建筑数据，手动构造）
- 镂空面、地面叠加层

### 2.4 LBS 服务

- 正/逆地理编码
- 出行路线规划（驾车/公交/步行/骑行）
- POI 检索（周边/区域/详情）
- 定位（浏览器定位）
- 坐标转换（BD09 ↔ GCJ02 ↔ WGS84）

### 2.5 配额与商用

- **个人/非营利**：免费，需申请 ak（API Key）
- **商用**：需获取商用授权，按调用量计费（具体配额需工单咨询，公开文档未列明固定免费额度）
- **限制**：QPS 与日配额均有限制，超限需购买流量包
- 申请地址：https://lbsyun.baidu.com/apiconsole/key

### 2.6 对本项目的价值评估

| 维度 | 评价 |
|---|---|
| 真实地貌展示 | ❌ 无 DEM，无法做等高线地形/分层设色 |
| 概念地球演示 | ⚠️ 地球模式可做，但与现有 Three.js 重复 |
| 中国 POI/路径 | ✅ 有价值（如"查找学校周边地理景点"） |
| 教学热力图 | ✅ 可做人口/气温分布 |
| 推荐角色 | **仅作为 LBS 服务补充层**，不作主地图引擎 |

---

## 三、高德地图 JavaScript API（JS API v2.0 + Loca）

### 3.1 产品现状

- **当前版本**：JS API v2.0（v1.4 已停止维护）
- **数据可视化**：Loca 容器（v1.2）——独立的数据可视化引擎
- **官方文档**：https://lbs.amap.com/api/javascript-api/summary

### 3.2 地图与图层能力

| 能力 | 支持情况 | 说明 |
|---|---|---|
| 2D 矢量图 | ✅ | 标准图层 TileLayer |
| 卫星图 | ✅ | TileLayer.Satellite |
| 路网图层 | ✅ | TileLayer.RoadNet |
| 实时路况 | ✅ | TileLayer.Traffic |
| 3D 视角 | ✅ | pitch/rotation |
| **3D 地球（球体）** | ❌ | **不支持球体地球**，仅平面 3D |
| **DEM 地形高程** | ❌ | **不支持**。"地形图"仅指地形瓦片样式（等高线纸图），非 3D 高程 |
| **3D 建筑** | ✅ | BuildingsLayer（建筑楼块图层，城市级真实数据） |
| 3D 立体图形 | ✅ | Object3DLayer（Mesh / Prism / MeshLine） |
| 室内地图 | ✅ | IndoorMap |
| 热力图 | ✅ | JS API Heatmap + **Loca 3D 热力图** |
| WMS/WMTS/XYZ | ✅ | 三方标准图层 |

### 3.3 Loca 数据可视化容器

Loca 是高德的独立可视化引擎，能力突出：

- **3D 热力图**（高度+颜色双维度）
- **3D 棱柱图**
- **迁徙图 / OD 线**
- **粒子系统**
- **网格聚合 / 蜂窝图**

> 这对 K12 的"人口迁移""气温分布""降水分布"可视化非常有价值。

### 3.4 LBS 服务（中国数据最强）

- POI 搜索（关键字/周边/多边形/ID）——**中国数据最全**
- 路径规划：驾车 / 货车 / 步行 / 骑行 / 公交
- 地理编码 / 逆地理编码
- 行政区查询（含边界数据）
- 天气查询
- 坐标系转换（GPS/百度/图吧 → 高德 GCJ02）

### 3.5 配额与商用（官方定价，2024-07-16 执行）

| 服务类型 | 个人开发者日配额 | 企业（乘风计划） | 企业（商用服务） | 超限价格 |
|---|---|---|---|---|
| **基础 LBS**（路径/地理编码/测距/坐标转换/行政区/IP/静态图） | 5,000 次/日 | 100,000 次/日 | 300,000 次/日 | 30 元/万次 |
| **JS 地图图面初始化** | 50,000 次/日 | 1,000,000 次/日 | 3,000,000 次/日 | 3 元/万次 |
| **在线定位** | 50,000 次/日 | 1,000,000 次/日 | 3,000,000 次/日 | 3 元/万次 |
| **基础搜索**（关键字/周边/多边形/ID/输入提示） | **100 次/日** | 1,000 次/日 | 10,000 次/日 | 30 元/万次 |

- **非商业用途**：免费
- **商业用途**：需商用授权，按上表计费，量大有折扣（最低约 1.8 元/万次）
- QPS 限制：可购买 QPS 包（400~1500 元/月/10QPS）
- **注意**：个人开发者搜索配额仅 100 次/日，K12 课堂多用户场景极易超限

### 3.6 对本项目的价值评估

| 维度 | 评价 |
|---|---|
| 真实地貌展示 | ❌ 无 DEM，无球体地球 |
| 3D 建筑展示 | ✅ BuildingsLayer + Loca 可做城市聚落教学 |
| 中国 POI/路径 | ✅ **最强**，适合"中国地理"章节 |
| 教学热力图 | ✅ Loca 3D 热力图体验优秀 |
| 行政区边界 | ✅ 可做省份/大洲高亮 |
| 推荐角色 | **作为 2D 中国地理教学面板 + LBS 服务**，与 3D 地球互补 |

---

## 四、Cesium.js

### 4.1 产品现状

- **协议**：**Apache 2.0**（商业与非商业均完全免费）
- **定位**：专业级 3D 地理空间可视化引擎，WebGL 原生
- **官方文档**：https://cesium.com/platform/cesiumjs/
- **数据平台**：Cesium ion（提供地形/影像/3D Tiles 托管，免费账户可用）

### 4.2 核心能力（本项目最关注）

| 能力 | 支持情况 | 说明 |
|---|---|---|
| **WGS84 真实 3D 地球** | ✅ **核心** | 高精度椭球体，非贴图球 |
| **真实 3D 地形（DEM）** | ✅ **核心优势** | World Terrain（quantized-mesh），全球高程 |
| 卫星影像 | ✅ | ion 影像 / Bing / 自定义 |
| **3D 建筑** | ✅ | Cesium OSM Buildings（全球）/ 3D Tiles |
| 3D 模型 | ✅ | glTF 原生支持 |
| **2D/3D/2.5D 切换** | ✅ **运行时一键切换** | 3D / 2D / Columbus 视图 |
| 矢量/几何体 | ✅ | KML / GeoJSON / CZML / API 绘制 |
| 时间动态可视化 | ✅ **核心** | CZML 4D 演示（如板块运动、洋流） |
| 地形分析 | ✅ | 坡度/坡向/等高线（需 ion SDK 或自定义） |
| 热力图 | ⚠️ 需自定义 | 无内置，可用 Primitive 实现 |

### 4.3 Cesium ion 免费额度

- **免费账户**：注册即得，提供 access token
- **免费额度**：包含一定量的地形/影像/3D Tiles 加载（非商业用途下足够教学演示）
- **资产托管**：免费账户可上传自有数据（如本地 GeoJSON、terrain 数据）
- **离线方案**：可完全自托管地形服务（`CesiumTerrainProvider` 指向自建 quantized-mesh 服务），**无需 ion 也可运行**
- 第三方地形服务可用（如超图、自建 terrain-server）

### 4.4 对本项目的价值评估

| 维度 | 评价 |
|---|---|
| 真实地貌展示 | ✅ **唯一能做等高线地形/分层设色的免费方案** |
| 3D 地球 | ✅ 远超 Three.js 贴图球（真实地形起伏） |
| 2D/3D 切换 | ✅ 原生支持，无需重写 |
| 板块运动动画 | ✅ 时间动态 + glTF 模型 |
| 商用友好 | ✅ Apache 2.0，无配额焦虑 |
| 推荐角色 | **主 3D 地理引擎**，承载地形/地貌/真实地球场景 |

---

## 五、Mapbox GL JS

### 5.1 产品现状

- **协议**：专有，免费层 + 按量计费
- **定位**：矢量瓦片地图引擎，性能与样式自由度顶尖
- **官方文档**：https://docs.mapbox.com/mapbox-gl-js/

### 5.2 核心能力

| 能力 | 支持情况 | 说明 |
|---|---|---|
| 2D 矢量图 | ✅ | 矢量瓦片，样式实时切换 |
| 卫星图 | ✅ | Satellite 样式 |
| **3D 地形（DEM）** | ✅ | `terrain` 属性 + DEM source（Mapbox Terrain） |
| **3D 建筑** | ✅ | `fill-extrusion`，基于 OSM 数据 |
| 3D 视角 | ✅ | pitch / bearing / 3D 倾斜 |
| Globe 视图 | ✅（新） | 球体视图（v2.0+） |
| 热力图 | ✅ | 内置 heatmap layer |
| 矢量图形 | ✅ | GeoJSON / 几何体 |
| 地理编码/路径 | ✅ | Geocoding / Directions API |
| 自定义图层 | ✅ | 可嵌入 Three.js 场景（`customLayer`） |

### 5.3 配额（Mapbox GL JS - Web Map Loads）

| 月加载量 | 价格 |
|---|---|
| 0 - 50,000 | **免费** |
| 50,001 - 100,000 | $5.00 / 1,000 次 |
| 100,001 - 200,000 | $4.00 / 1,000 次 |
| 200,001+ | $3.00 / 1,000 次 |

- 其他 API（Geocoding / Directions）独立计费，各有免费层
- **教育友好**：5 万次/月免费，单 classroom 规模足够

### 5.4 对本项目的价值评估

| 维度 | 评价 |
|---|---|
| 真实地貌展示 | ✅ terrain DEM 优秀 |
| 样式自由度 | ✅ 最佳，适合教学主题定制 |
| 与 Three.js 集成 | ✅ **官方支持 customLayer 嵌入 Three.js** |
| 商用 | ⚠️ 需 token，超量收费 |
| 中国数据 | ⚠️ POI/路径不如高德 |
| 推荐角色 | **备选方案**——若需矢量样式自由度或与 Three.js 深度融合 |

---

## 六、Leaflet.js 与 Two.js

### 6.1 Leaflet.js

- **协议**：BSD-2，完全免费开源
- **定位**：轻量级 2D 地图库（约 40KB）
- **3D 能力**：❌ 无原生 3D，无地形，无球体
- **优势**：极简、插件生态丰富（leaflet-elevation 等高线插件、heatmap 热力图）、可加载任意切片源
- **教育价值**：适合做"地图三要素""比例尺"等纯 2D 概念教学
- **与 Three.js**：无直接集成，仅 2D
- **结论**：可作为 2D 地理概念辅助面板，无法承担 3D 地貌任务

### 6.2 Two.js

- **定位**：2D 绘图库（SVG/Canvas/WebGL），**非地图库**
- **地理能力**：❌ 无坐标系、无瓦片、无地理投影
- **结论**：**不适用**于地图/地理场景。若用于绘制示意图（如地球内部圈层示意），现有 Three.js 已覆盖

---

## 七、配额与商用限制对比

| 平台 | 个人免费额度 | 商用费用 | 开源协议 | 教学场景够用？ |
|---|---|---|---|---|
| **百度 BMapGL** | 免费非营利（额度未公开固定值） | 需商用授权，按量计费 | 专有 | ⚠️ 非营利教学可，商用产品需授权 |
| **高德 JS API** | LBS 5,000/日，搜索 100/日，图面 50,000/日 | LBS 30元/万次，图面 3元/万次 | 专有 | ⚠️ 搜索配额低，多课堂易超限 |
| **Cesium.js** | **Apache 2.0 完全免费**；ion 免费账户有限额 | **引擎本身免费商用**；ion 超量按量 | ✅ Apache 2.0 | ✅ **最友好**，可完全离线自托管 |
| **Mapbox GL JS** | 50,000 次地图加载/月 | $5/1000 次（超量） | 专有 | ✅ 单校规模足够 |
| **Leaflet** | 完全免费 | 完全免费 | BSD-2 | ✅ 完全免费 |

---

## 八、针对本项目（Three.js 地球）的集成方案

### 8.1 现状分析

当前 `earth.html` 是 **Three.js 单文件实现**：
- 深空主题（cyan/purple 配色），星空背景
- 贴图球体地球（无真实地形）
- 擅长：地球自转/公转、昼夜交替、五带划分、板块运动等**抽象概念演示**
- **短板**：无法做等高线地形图、分层设色地形图、真实卫星地貌——这些是 K12 报告中标注"适合 + 高难度"的核心知识点

### 8.2 方案对比

#### 方案 A：Three.js + 高德/百度 JS API 双视图（不推荐）

- 左侧 Three.js 3D 地球（概念演示），右侧高德/百度 2D 地图（真实地理）
- **问题**：高德/百度**无 DEM 地形**，"等高线地形图"这一核心需求仍无法满足，只是多了 2D 平面图
- 价值有限，两个引擎职责重叠

#### 方案 B：直接用 Cesium 替换 Three.js（部分推荐）

- 用 Cesium 重写整个地球场景
- **优点**：真实地形、3D/2D 切换、3D 建筑、时间动态一次性解决
- **缺点**：丢失现有 Three.js 的"抽象概念"演示能力（地轴倾斜示意、太阳-地球系统、板块漂移动画等用 Cesium 做反而笨重）；重写成本高；Cesium 的"示意性"不如 Three.js 灵活（如半透明地壳剖切）

#### 方案 C：Three.js（概念层）+ Cesium（真实地理层）双引擎（⭐ 推荐）

- **保留 Three.js**：承载抽象/概念演示——地球自转公转、昼夜晨昏线、五带、板块运动示意、地轴倾斜、太阳直射点移动
- **引入 Cesium**：承载真实地理演示——等高线地形图、分层设色、真实卫星地貌、3D 城市建筑、河流山脉实景
- **按教学模块切换**，而非同屏叠加
- **可选补充高德 JS API**：仅用于"中国地理"章节的 POI 搜索/路径规划/行政区边界（轻量 iframe 或组件嵌入）

### 8.3 2D / 3D 切换最佳路径

| 切换需求 | 实现路径 |
|---|---|
| Cesium 内部 2D/3D 切换 | `viewer.scene.mode = Cesium.SceneMode.SCENE3D / SCENE2D / COLUMBUS` **一行代码**，原生支持 |
| Three.js ↔ Cesium 引擎切换 | 路由级切换（两个独立页面/组件），按教学知识点进入对应引擎 |
| 高德 2D ↔ 3D | `map.setPitch(60)` + `map.setFeatures(['3D'])`，但无地形 |

> **结论**：2D/3D 切换的"最佳实现"是 Cesium 原生能力，无需自研。Three.js 侧无需 2D/3D 切换（它本就是 3D 概念演示）。

---

## 九、推荐方案与落地路径

### 9.1 最终推荐

> **方案 C：Three.js（概念层）+ Cesium（真实地理层）双引擎，按教学模块切换。**
> 高德/百度 JS API 仅作为可选的"中国 LBS 服务"补充，不作为主地图引擎。

### 9.2 理由

1. **核心教学需求匹配**：K12 报告中"等高线地形图""分层设色地形图"标注为"适合 + 高难度"，**只有 Cesium 的 DEM 能真正解决**，百度/高德无能为力
2. **成本最优**：Cesium Apache 2.0 完全免费商用，无配额焦虑；高德商用需付费且搜索配额极低
3. **复用现有资产**：Three.js 已实现的"自转/公转/昼夜/板块运动"等概念演示不丢弃
4. **2D/3D 切换零成本**：Cesium 原生支持
5. **离线/自托管可行**：Cesium 可完全脱离 ion 运行，适合校园内网部署

### 9.3 落地路径（建议优先级）

| 优先级 | 任务 | 对应 K12 知识点 |
|---|---|---|
| P0 | 引入 Cesium，搭建基础 3D 地球 + 地形 + 卫星影像 | 地球形状、海陆分布 |
| P0 | Cesium 等高线地形演示模块（3D 地形 ↔ 等高线投影联动） | **等高线地形图**（初中核心难点） |
| P1 | Cesium 分层设色（按高程自动着色） | 分层设色地形图 |
| P1 | Three.js ↔ Cesium 模块切换框架 | 平台架构 |
| P2 | Cesium 3D 建筑演示（城市聚落） | 聚落与城市 |
| P2 | 高德 JS API 嵌入（中国 POI/行政区） | 中国地理章节 |
| P3 | Cesium 时间动态（板块运动、洋流） | 板块构造、洋流 |

---

## 十、集成代码示例（伪代码）

### 10.1 引擎切换框架（Three.js ↔ Cesium）

```js
// engine-switcher.js —— 按教学模块路由到对应引擎
class EarthExplorer {
  constructor() {
    this.currentEngine = null;
    this.threeApp = null;   // 现有 Three.js 地球
    this.cesiumApp = null;  // 新增 Cesium 真实地球
  }

  // 进入"概念演示"模块（自转/公转/昼夜/五带）
  loadConceptModule(topic) {
    this.unmountCesium();
    if (!this.threeApp) this.threeApp = new ThreeEarthApp('three-container');
    this.threeApp.loadTopic(topic); // e.g. 'earth-rotation', 'seasons'
    this.currentEngine = 'three';
  }

  // 进入"真实地貌"模块（等高线/分层设色/3D建筑）
  loadTerrainModule(topic) {
    this.unmountThree();
    if (!this.cesiumApp) this.cesiumApp = new CesiumEarthApp('cesium-container');
    this.cesiumApp.loadTopic(topic); // e.g. 'contour', 'hypsometric', 'buildings'
    this.currentEngine = 'cesium';
  }

  unmountThree()  { /* 隐藏 three-container，暂停 RAF */ }
  unmountCesium() { /* 隐藏 cesium-container，暂停渲染循环 */ }
}
```

### 10.2 Cesium 基础地球 + DEM 地形 + 2D/3D 切换

```js
// cesium-earth-app.js
class CesiumEarthApp {
  constructor(containerId) {
    Cesium.Ion.defaultAccessToken = 'YOUR_ION_TOKEN'; // 免费注册获取

    this.viewer = new Cesium.Viewer(containerId, {
      terrainProvider: Cesium.createWorldTerrain(),   // ✅ 真实 DEM 高程
      imageryProvider: new Cesium.IonImageryProvider({ assetId: 2 }), // Bing 卫星
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      timeline: false,
      animation: false,
    });

    // 隐藏 Cesium 默认 UI，贴合现有深空主题
    this.viewer.scene.skyBox.show = true;
    this.viewer.scene.globe.enableLighting = true;    // 昼夜光照
  }

  // 一键 2D/3D/Columbus 切换 —— K12 教学核心能力
  setViewMode(mode) {
    const map = {
      '3d':       Cesium.SceneMode.SCENE3D,
      '2d':       Cesium.SceneMode.SCENE2D,
      'columbus': Cesium.SceneMode.COLUMBUS,
    };
    this.viewer.scene.mode = map[mode];
  }

  // 飞行到指定地点（经纬度），如"飞到喜马拉雅山脉看地形"
  flyTo(lng, lat, height = 5000) {
    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lng, lat, height),
      orientation: { pitch: Cesium.Math.toRadians(-35) },
      duration: 2.5,
    });
  }
}
```

### 10.3 等高线地形演示（Cesium + 自定义等高线）

```js
// 等高线：利用 Cesium 地形高程 + 自定义着色器绘制等高线
loadContourDemo() {
  this.flyTo(86.92, 27.98, 8000); // 珠峰

  // 方案1：用分层设色材质（按高程自动着色）—— 对应"分层设色地形图"
  const material = Cesium.Material.fromType('ElevationContour');
  material.uniforms = {
    spacing: 200,                  // 等高距 200m
    color: Cesium.Color.fromCssColorString('#00f5ff'),
    backgroundColor: Cesium.Color.fromCssColorString('#0a0a0f'),
  };
  this.viewer.scene.globe.material = material;
}

// 分层设色（绿-黄-棕-白，对应海拔）
loadHypsometricDemo() {
  // 用 Cesium GlobeMaterial 或自定义 rampTexture
  // 0-200m 绿 / 200-500 浅绿 / 500-1000 黄 / 1000-2000 棕 / 2000+ 白
  this.viewer.scene.globe.material = createHypsometricRampMaterial();
}
```

### 10.4 Three.js 侧保持不变（概念演示）

```js
// 现有 Three.js 地球继续用于：自转/公转/昼夜/五带/板块运动示意
// 无需改动，仅作为"概念层"被引擎切换器调用
```

### 10.5 可选：高德 JS API 作为"中国地理"补充面板

```js
// amap-panel.js —— 仅在"中国地理"章节加载
class AMapPanel {
  constructor(containerId) {
    AMapLoader.load({
      key: 'YOUR_AMAP_KEY',
      version: '2.0',
      plugins: ['AMap.PlaceSearch', 'AMap.Geocoder', 'AMap.DistrictSearch'],
    }).then((AMap) => {
      this.map = new AMap.Map(containerId, {
        zoom: 4,
        viewMode: '3D',
        mapStyle: 'amap://styles/dark',  // 贴合深空主题
      });
    });
  }

  // 行政区高亮（省份边界）—— 中国地理教学
  highlightProvince(name) {
    new AMap.DistrictSearch({ level: 'province' }).search(name, (status, res) => {
      const polygon = new AMap.Polygon({
        path: res.districtList[0].boundaries,
        fillColor: '#00f5ff', fillOpacity: 0.3,
        strokeColor: '#00f5ff', strokeWeight: 2,
      });
      this.map.add(polygon);
    });
  }
}
```

### 10.6 离线/自托管方案（校园内网部署）

```js
// 若校园无外网，Cesium 可完全自托管，不依赖 ion
const viewer = new Cesium.Viewer('cesium-container', {
  // 自建地形服务（quantized-mesh），用 cesium-terrain-builder 生成
  terrainProvider: new Cesium.CesiumTerrainProvider({
    url: 'http://localhost:8080/terrain/',
  }),
  // 自建影像服务（本地瓦片）
  imageryProvider: new Cesium.UrlTemplateImageryProvider({
    url: 'http://localhost:8080/imagery/{z}/{x}/{y}.png',
  }),
  // 关闭 ion 依赖
  baseLayerPicker: false,
});
// 此时无需 token，完全离线运行
```

---

## 十一、文档与参考链接

### 百度地图
- JSAPI 4.0 文档：https://lbs.baidu.com/docs/jsapi?title=jsapi4/index
- 旧版 BMapGL（维护态）：https://lbsyun.baidu.com/index.php?title=jspopularGL
- Key 申请：https://lbsyun.baidu.com/apiconsole/key
- 使用须知：https://lbsyun.baidu.com/index.php?title=open/question

### 高德地图
- JS API v2.0 概述：https://lbs.amap.com/api/javascript-api/summary
- Loca 数据可视化：https://lbs.amap.com/api/loca-v2/
- 定价与配额：https://lbs.amap.com/upgrade#price
- 流量限制说明：https://lbs.amap.com/api/webservice/guide/tools/flowlevel
- 示例中心：https://lbs.amap.com/demo-center/js-api

### Cesium
- CesiumJS 官网：https://cesium.com/platform/cesiumjs/
- 学习入门：https://cesium.com/learn/
- Sandcastle 示例：https://sandcastle.cesium.com/
- Cesium ion：https://cesium.com/ion/
- GitHub（Apache 2.0）：https://github.com/CesiumGS/cesium
- 地形格式文档：https://cesium.com/learn/cesiumjs/ref-doc/CesiumTerrainProvider.html

### Mapbox
- Mapbox GL JS 文档：https://docs.mapbox.com/mapbox-gl-js/
- 定价：https://www.mapbox.com/pricing
- 3D Terrain 教程：https://docs.mapbox.com/help/tutorials/use-terrain-3d-data/
- 自定义图层（Three.js 集成）：https://docs.mapbox.com/mapbox-gl-js/example/custom-layer/

### Leaflet
- 官网：https://leafletjs.com/
- 插件库：https://leafletjs.cn/plugins.html

---

## 总结一句话

> **不要用百度/高德做 3D 地貌**（它们无 DEM）；**用 Cesium 补齐真实地形短板**（Apache 2.0 免费、原生 2D/3D 切换、支持离线自托管），与现有 Three.js 形成"概念层 + 真实地理层"双引擎；高德 JS API 仅在"中国地理"章节作为 LBS 补充。这是 K12 地理教学平台性价比最高、配额风险最低、教学覆盖最全的方案。
