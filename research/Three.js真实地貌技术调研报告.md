# Three.js 真实地貌（类谷歌地球）技术调研报告

> 调研目的：评估在现有 Earth Explorer（基于 Three.js 单文件球面 + 单张纹理图实现）上升级为**真实地貌 + 多瓦片 LOD + 2D/3D 切换**的技术路径，覆盖数据源、编码格式、实现方案、相机切换、性能与集成。
> 调研时间：2026-07-29
> 关联文件：`src/earth.html`（当前实现）、`src/solar-system.js`（太阳系模块，需共存）、`src/earth-optimization.js`（已存在性能优化模块）、`地图API调研报告.md`（已覆盖 Cesium/Mapbox 引擎层对比，本报告聚焦 Three.js 原生路径）

---

## 目录

- [一、现状分析](#一现状分析)
- [二、真实地貌 DEM 数据源对比](#二真实地貌-dem-数据源对比)
- [三、卫星影像瓦片源对比](#三卫星影像瓦片源对比)
- [四、DEM 编码格式详解](#四dem-编码格式详解)
- [五、Three.js 真实地貌实现方案对比矩阵](#五threejs-真实地貌实现方案对比矩阵)
- [六、2D/3D 切换技术](#六2d3d-切换技术)
- [七、现有项目集成路径](#七现有项目集成路径)
- [八、性能预算](#八性能预算)
- [九、分阶段实施路径](#九分阶段实施路径)
- [十、伪代码示例](#十伪代码示例)
- [十一、参考开源项目](#十一参考开源项目)
- [十二、推荐方案与结论](#十二推荐方案与结论)

---

## 一、现状分析

### 1.1 当前 earth.html 实现（关键事实）

| 维度 | 现状 | 问题 |
|---|---|---|
| 几何 | `THREE.SphereGeometry(earthRadius, 64, 64)` | 64×64 段球面，无高程位移，无地形起伏 |
| 纹理 | `TextureLoader` 加载单张本地图（`world-color.jpg` 等） | 单张图分辨率有限，无 LOD，无瓦片 |
| 相机 | `THREE.PerspectiveCamera(60, aspect, 0.1, 1000)` | 仅透视，无 2D 模式 |
| 图层 | satellite / topo / political 三张整图切换 | 无瓦片、无 DEM、无地形 |
| 模块共存 | `solar-system.js` 用 `THREE.Group` 独立挂载 | 已有良好隔离，可共存 |
| 优化 | `earth-optimization.js` 已有资源预加载/内存管理 | 可复用缓存机制 |

### 1.2 升级目标（对标谷歌地球）

1. 球面 + 真实 DEM 顶点位移（山脉/海沟可见）
2. 多瓦片 LOD 影像贴图（缩放越高越清晰）
3. 平面 2D 地图 ↔ 3D 地球平滑切换
4. 与现有太阳系模块、城市标注、昼夜分界等共存

---

## 二、真实地貌 DEM 数据源对比

### 2.1 数据源对比表

| 数据源 | 精度 | 覆盖范围 | 格式 | 获取方式 | 授权 | 适用场景 |
|---|---|---|---|---|---|---|
| **SRTM1** | 30m（1 角秒） | 60°N–56°S | HGT / GeoTIFF | NASA Earthdata（LP DAAC） | 公共领域 | 美国境内最佳；中国境内仅 SRTM3 |
| **SRTM3** | 90m（3 角秒） | 60°N–56°S | HGT / GeoTIFF | NASA Earthdata / 中科院镜像 | 公共领域 | 全球基本可用，山区细节弱 |
| **ASTER GDEM v3** | 30m | 83°N–83°S（全球陆地） | GeoTIFF | NASA LP DAAC（`e4ftl01.cr.usgs.gov/ASTER...`） | 免费 | 全球高纬度补充，但噪声大、水体异常 |
| **ALOS World 3D (AW3D30)** | 30m（源自 5m DSM） | 83°N–83°S | GeoTIFF | JAXA（注册下载）/ GEE | 免费注册 | 精度优于 ASTER，DSM 含植被/建筑高度 |
| **Mapbox Terrain-DEM v1** | 5–10m（瓦片化） | 全球 | Terrain-RGB PNG 瓦片 | `mapbox://mapbox.mapbox-terrain-dem-v1` | 需 token | **Web 集成首选**，tileSize 512，maxzoom 14 |
| **Mapzen Terrain Tiles** | 5–30m | 全球 | Terrarium PNG 瓦片 | 已归档（可自托管 / AWS S3） | CC0 | 可离线自建，编码格式 Terrarium |
| **Copernicus DEM (GLO-30)** | 30m | 全球 | GeoTIFF | Copernicus / OpenTopography | 免费 | SRTM 升级替代品，质量高 |

### 2.2 下载地址与格式

| 数据源 | 下载入口 | 文件命名示例 |
|---|---|---|
| SRTM1/SRTM3 | https://search.earthdata.nasa.gov/ （需注册） | `N23E113.SRTMGL1.hgt.zip`（1°×1° 切块） |
| ASTER GDEM v3 | https://lpdaac.usgs.gov/products/astgtmv003/ | `ASTGTMV003_N23E113_dem.tif` |
| AW3D30 | https://www.eorc.jaxa.jp/ALOS/en/aw3d30/ （注册） | `N023E113.tar.gz` |
| Mapbox Terrain-DEM | https://docs.mapbox.com/data/tiledata/guides/access-terrain-data/ | XYZ 瓦片 `{z}/{x}/{y}.png` |
| Mapzen（归档） | https://registry.opendata.aws/terrain-tiles/ | XYZ 瓦片 `{z}/{x}/{y}.png` |
| OpenTopography | https://opentopography.org/ | 一键下载（含 SRTM/ALOS/Copernicus） |

### 2.3 选型建议

- **Web 端实时渲染**：Mapbox Terrain-DEM v1（瓦片化、开箱即用）或自托管 Terrarium（免 token、可离线）
- **离线/自建瓦片服务**：用 SRTM1/AW3D30 + `dem2terrain`（gitee.com/lzugis15/dem2terrain）切成本地 Terrain-RGB/Terrarium 瓦片金字塔
- **高纬度（如南极）**：ASTER GDEM v3 或 Copernicus DEM 补充

---

## 三、卫星影像瓦片源对比

### 3.1 瓦片源对比表

| 瓦片源 | URL 模板 | 最大层级 | 是否需 Key | 中国可访问 | 协议 | 备注 |
|---|---|---|---|---|---|---|
| **ESRI World Imagery** | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | ~19 | ❌ 无需 | ✅ 稳定 | 免费 | **推荐起步源**，全球覆盖好 |
| **Bing Maps Aerial** | `https://ecn.t{s}.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=14245`（s=0–7） | 19 | ✅ 需 Key | ⚠️ 需翻墙 | 免费（Key） | 使用 QuadKey 编码，需申请 Bing Maps Key |
| **Mapbox Satellite** | `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/512/{z}/{x}/{y}?access_token={TOKEN}` | 22 | ✅ 需 Token | ⚠️ 需翻墙 | 免费（配额） | 与 Mapbox Terrain-DEM 同源，集成最简 |
| **天地图影像** | `https://t{s}.tianditu.gov.cn/img_w/wmts?tk={KEY}&SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`（s=0–7） | 18 | ✅ 需 Key (tk) | ✅ 国内最佳 | 免费（Key） | **中国境内推荐**，需 WMTS 协议；图层：`img`(影像)/`vec`(矢量)/`ter`(地形晕渲) + `cia`/`cva`/`cta`(注记) |
| **高德影像** | `https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}`（s=1–4） | 18 | ⚠️ 灰色 | ✅ | 灰色 | 国内速度快，但无官方授权 |
| **Google 卫星** | `https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}`（s=0–3） | 21 | ⚠️ 灰色 | ⚠️ 需翻墙 | 灰色 | 清晰度最高但 ToS 受限 |

### 3.2 关键说明

- **坐标系**：上述瓦片均为 **Web Mercator (EPSG:3857)**，XYZ/TMS 混用需注意 Y 轴翻转（TMS `y_tms = 2^z - 1 - y_xyz`）。天地图 `img_w` 后缀 `_w` 即 Web Mercator。
- **2D/3D 一致性**：同一套 Web Mercator 瓦片可在 2D 平面地图和 3D 球面贴图上共用，只需在球面上做经纬度↔UV 重映射（见第六节）。
- **Bing QuadKey 转换**：`quadkey = 把 z 层级的 (x,y) 按位交错成二进制字符串`，与其他 XYZ 源不互通，需写适配器。

---

## 四、DEM 编码格式详解

Web 端 DEM 主要以 **PNG RGB 瓦片**形式分发，三种编码格式：

### 4.1 编码公式对比

| 编码格式 | 解码公式 | 精度 | 高程范围 | 使用方 |
|---|---|---|---|---|
| **Mapbox Terrain-RGB** | `height = -10000 + ((R*256*256 + G*256 + B) * 0.1)` | 0.1m | -10000m ~ +6777m | Mapbox Terrain-DEM v1 |
| **Terrarium** | `height = (R*256 + G + B/256) - 32768` | ~0.0039m | -32768m ~ +32767m | Mapzen / Tangram |
| **Quantized Mesh** | 二进制结构化（顶点 + 三角面 + 法线） | 原始浮点 | 不限 | Cesium ion terrain |

### 4.2 解码伪代码（Mapbox Terrain-RGB）

```js
// 从 PNG 像素 (r,g,b) 解码高程（米）
function decodeTerrainRGB(r, g, b) {
  return -10000 + ((r * 256 * 256 + g * 256 + b) * 0.1);
}
// 例：(256,256,256) → -10000 + (16777216 * 0.1) = 无效；实际像素已 clamp
//    (0,0,0) → -10000m；(180,180,180) ≈ 5395m
```

### 4.3 三种格式选型

- **Terrain-RGB**：Mapbox 官方，生态最完整，Mapbox GL JS / three-geo 均原生支持
- **Terrarium**：精度更高、动态范围更大，适合自托管离线瓦片
- **Quantized Mesh**：Cesium 专用，Three.js 需自行解析二进制（复杂度高）

---

## 五、Three.js 真实地貌实现方案对比矩阵

### 5.1 四方案对比矩阵

| 维度 | 方案A：Three.js 原生（球面+瓦片+DEM 位移） | 方案B：CesiumJS 集成 | 方案C：程序化地形（噪声） | 方案D：three-geo 库 |
|---|---|---|---|---|
| **真实地貌** | ✅ 真实 DEM | ✅ 真实 DEM（quantized-mesh） | ❌ 假地形（柏林噪声） | ✅ 真实 DEM（Mapbox terrain-rgb） |
| **全球球面** | ✅ 完整地球 | ✅ 完整地球（WGS84） | ✅ | ❌ **局部地形块**（按 lat/lng+radius），非全球 |
| **LOD 瓦片** | ⚠️ 需自研四叉树 | ✅ 内置 quadtree LOD | ❌ | ⚠️ 单 zoom 层级（11–17） |
| **2D/3D 切换** | ⚠️ 需自研（见第六节） | ✅ 原生 3D/2D/Columbus | ❌ | ❌ |
| **与现有代码共存** | ✅ **同源 Three.js，无缝** | ❌ 需双引擎并存（复杂） | ✅ | ✅ |
| **学习/实现成本** | 🔴 高（需自研瓦片调度+位移） | 🟢 低（开箱即用） | 🟡 中 | 🟡 中（API 简单） |
| **依赖** | 仅 three.js | + cesium.js（~2MB） | 仅 three.js | + three-geo + mapbox token |
| **token/授权** | 可选（自托管瓦片可免） | Cesium ion token（免费层） | 无 | **必填 Mapbox token** |
| **性能可控性** | ✅ 完全可控 | ⚠️ 黑盒 | ✅ | ⚠️ 依赖库实现 |
| **教学可定制** | ✅ 可暴露几何/纹理数组 | ⚠️ 封装深 | ✅ | ✅ 返回 THREE.Mesh |
| **能否复用现有 solar-system.js** | ✅ 完美复用 | ❌ 需重写 | ✅ | ✅ |
| **参考成熟度** | 🟡 需自研 | 🟢 工业级 | 🟢 | 🟢（v1.4.5） |

### 5.2 three-geo 详解（方案D）

- **仓库**：https://github.com/w3reality/three-geo（MIT，380 commits，最新提交 2025-02）
- **核心 API**：`getTerrainRgb([lat,lng], radiusKm, zoom)` 返回 `THREE.Group`
- **zoom 范围**：11–17（17 最高），固定单层级，**非全球球面**
- **数据源**：Mapbox Maps API（terrain-rgb + satellite raster），**必须 tokenMapbox**
- **适用**：局部区域（如珠峰、大峡谷）的 3D 地形展示，**不适合替代现有全球地球**
- **结论**：可作为"放大查看某地地形"的**子模块**，不能作为主地球

### 5.3 推荐方案

> **主推 方案A（Three.js 原生）** 作为主地球，**可选叠加 方案D（three-geo）** 作为"局部地形钻取"子功能。

**理由**：
1. 现有项目已深度基于 Three.js（earth.html + solar-system.js + earth-optimization.js），方案A 可零摩擦升级，保留所有现有功能（城市标注、昼夜、太阳系）
2. 教学场景需要暴露几何/纹理做 GIS 实验，方案A 完全可控
3. 避免引入 Cesium 双引擎并存的架构复杂度（方案B）
4. 程序化地形（方案C）无法满足"真实地貌"核心需求
5. three-geo（方案D）非全球球面，只能做局部钻取

---

## 六、2D/3D 切换技术

### 6.1 三种切换策略对比

| 策略 | 实现 | 优点 | 缺点 | 适用 |
|---|---|---|---|---|
| **① 单相机 FOV 动画** | PerspectiveCamera，FOV 60→2 接近正交 | 实现最简，无投影跳变 | 极小 FOV 有透视畸变 | Mapbox GL JS 风格（2.5D） |
| **② 双相机插值切换** | OrthographicCamera ↔ PerspectiveCamera，投影矩阵 lerp | 真正的正交 2D | 需手写投影矩阵插值，复杂 | 严格 2D/3D |
| **③ 几何形变（球↔面）** | 球面顶点动画展平为平面 | 视觉惊艳（谷歌地球风） | 实现最复杂，需重算 UV/法线 | 高端效果 |

### 6.2 推荐组合：策略①+③

- **2D 模式**：平面瓦片地图（Web Mercator）+ OrthographicCamera（俯视）
- **3D 模式**：球面地球 + PerspectiveCamera
- **切换动画**：球面顶点从"球"形变到"展开平面"（球面↔圆柱投影），同时相机从透视拉远到正交

### 6.3 投影转换（墨卡托 ↔ 球面）

```js
// 经纬度 → 球面顶点（3D 球面模式）
function latLngToSphere(lat, lng, radius) {
  const phi = (90 - lat) * Math.PI / 180;   // 极角
  const theta = (lng + 180) * Math.PI / 180; // 方位角
  return [
    -radius * Math.sin(phi) * Math.cos(theta),
     radius * Math.cos(phi),
     radius * Math.sin(phi) * Math.sin(theta)
  ];
}

// 经纬度 → Web Mercator 平面（2D 模式）
function latLngToMercator(lat, lng, zoom) {
  const n = Math.pow(2, zoom);
  const x = Math.floor((lng + 180) / 360 * n);
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1/Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x, y, z: zoom };
}
```

### 6.4 数据源一致性

> **同一套 Web Mercator XYZ 瓦片可在 2D 和 3D 双模式共用**，无需准备两套数据。

- **2D 模式**：直接把瓦片贴到 PlaneGeometry 分块
- **3D 模式**：把瓦片按经纬度范围重映射到球面 UV（球面分段，每段对应一组瓦片）
- **形变切换**：球面顶点位置 = `lerp(spherePos, planePos, t)`，UV 保持瓦片坐标

### 6.5 相机切换伪代码

```js
// 单相机方案：FOV + 角度动画（推荐起步）
function toggle2D3D(targetMode) {
  const from = { fov: camera.fov, pitch: currentPitch };
  const to = targetMode === '2d'
    ? { fov: 2, pitch: -90 }          // 俯视 + 极小 FOV 接近正交
    : { fov: 60, pitch: -30 };         // 透视 + 倾斜
  tween(from, to, 1200, (v) => {
    camera.fov = v.fov;
    camera.updateProjectionMatrix();
    camera.position.set(...computePos(v.pitch));
  });
}
```

---

## 七、现有项目集成路径

### 7.1 升级清单

| 现状 | 升级目标 | 改动范围 |
|---|---|---|
| `SphereGeometry(64,64)` 单球 | 球面分段 + DEM 顶点位移 | 改 `createEarth()` |
| 单张整图纹理 | XYZ 瓦片四叉树 LOD 调度器 | 新增 `TileLoader` 模块 |
| 仅 PerspectiveCamera | + OrthographicCamera 与切换 | 改相机管理 |
| 三张整图切换 | 瓦片图层源切换（ESRI/天地图/Mapbox） | 改 `layerUrls` |
| 太阳系模块 Group | 不变（已隔离） | 零改动 |

### 7.2 LOD 瓦片加载策略

1. **四叉树分块**：球面按 lat/lng 分段（如每 45°×45° 一块根瓦片），每块对应一棵 quadtree
2. **视锥剔除**：`THREE.Frustum.intersectsObject` 剔除不可见瓦片
3. **距离/屏幕空间误差**：瓦片在屏幕上的像素大小 < 阈值时不再细分
4. **LRU 缓存**：复用 `earth-optimization.js` 的 `resourceCache`，限制总瓦片数（如 256）
5. **占位纹理**：低层级瓦片先贴，高层级异步加载替换（mipmap 风格）
6. **请求合并**：同帧内瓦片请求批量化，避免并发数爆炸（限制 6–12 个并发）

### 7.3 与 solar-system.js 共存

- `solar-system.js` 通过 `new SolarSystem(scene, camera, renderer)` 注入，自身 `this.group` 独立
- 升级后地球仍挂在 `earthGroup`（独立 Group），与太阳系 `this.group` 互不干扰
- **唯一注意**：2D/3D 切换时太阳系模块应隐藏或冻结（避免在 2D 正交相机下渲染失调）

### 7.4 瓦片源适配器设计

```js
// 统一瓦片源接口，支持运行时切换
class TileSource {
  constructor(opts) { this.url = opts.url; this.maxZoom = opts.maxZoom; }
  getTileURL(z, x, y) { /* 子类实现 XYZ/QuadKey/WMTS 转换 */ }
}
class EsriSource extends TileSource {
  getTileURL(z, x, y) { return `.../World_Imagery/MapServer/tile/${z}/${y}/${x}`; }
}
class TiandituSource extends TileSource {
  getTileURL(z, x, y) { return `https://t${(x+y)%8}.tianditu.gov.cn/img_w/wmts?tk=${this.key}&...&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}`; }
}
class BingSource extends TileSource {
  getTileURL(z, x, y) { return `.../tiles/a${xyzToQuadKey(z,x,y)}.jpeg?g=14245`; }
}
```

---

## 八、性能预算

### 8.1 目标帧率与预算

| 场景 | 目标 FPS | 单帧预算 | 关键约束 |
|---|---|---|---|
| 桌面端（中端 GPU） | 60 fps | 16.6ms | 瓦片数 ≤ 128 |
| 移动端 / 集成显卡 | 30 fps | 33.3ms | 瓦片数 ≤ 48 |
| 2D 平面模式 | 60 fps | 16.6ms | 无 DEM 位移，开销小 |

### 8.2 性能预算分解（3D 球面 + LOD）

| 环节 | 预算 | 优化手段 |
|---|---|---|
| 瓦片纹理上传 | 4–6ms | `THREE.Texture` 复用、`generateMipmaps=true`、`anisotropy` 限制 |
| DEM 顶点位移（GPU） | 1–2ms | 用顶点着色器位移（displacement）而非 CPU 改 geometry |
| 球面三角面绘制 | 3–5ms | 根段 64，最高细分段 ≤ 256，frustum culling |
| 太阳系 + 其他 | 1–2ms | 共存模块按需 pause |
| 主线程 JS（瓦片调度） | 1–2ms | 调度放 requestIdleCallback，避免阻塞渲染 |

### 8.3 内存预算

| 资源 | 单份大小 | 上限 | 备注 |
|---|---|---|---|
| 影像瓦片 256×256 PNG | ~30KB | 256 张 ≈ 7.5MB | LRU 淘汰 |
| DEM 瓦片 512×512 PNG | ~50KB | 64 张 ≈ 3.2MB | 同区域共享 |
| 纹理 GPU 显存 | 256×256×4 = 256KB | 256 张 ≈ 64MB | 重点监控 |

### 8.4 优化清单

- DEM 位移在 GPU 顶点着色器完成（`#include<displacementmap_vertex>`），不修改 CPU geometry
- 瓦片纹理用 `THREE.LoopNormalMapWrapping` 防接缝，mipmap 防闪烁
- 球面背面剔除：`material.side = THREE.FrontSide`
- 瓦片加载用 `ImageBitmap`（比 `Image` 快）+ `createImageBitmap`
- 切换 2D/3D 时暂停太阳系/星空动画

---

## 九、分阶段实施路径

### 阶段 0：准备（0.5 天）
- 注册 Mapbox token（备用）/ 天地图 tk（国内）
- 验证 ESRI World Imagery 瓦片直链可访问
- 产出：`TileSource` 适配器（ESRI 起步）

### 阶段 1：瓦片贴图替换单张纹理（1–2 天）
- 目标：球面 + 多瓦片贴图（暂无 DEM 位移）
- 任务：球面按经纬度分段 → 每段挂瓦片 quad → LOD 加载 z=2/3/4 根瓦片
- 验证：缩放时瓦片动态加载，清晰度提升
- **保留**：现有 satellite/topo/political 三图层切换改为切换不同 TileSource

### 阶段 2：DEM 顶点位移（1–2 天）
- 目标：山脉/海沟可见
- 任务：加载 Mapbox Terrain-DEM 瓦片 → GPU 顶点着色器位移
- 验证：喜马拉雅、安第斯山脉有明显凸起

### 阶段 3：2D/3D 切换（1–2 天）
- 目标：平面地图 ↔ 3D 球面平滑切换
- 任务：球面↔平面顶点形变 + 相机 FOV 动画
- 验证：切换无跳变，瓦片共用

### 阶段 4：LOD 细化与性能（1–2 天）
- 目标：高缩放下细节清晰且 60fps
- 任务：四叉树细分、视锥剔除、LRU 缓存上限
- 验证：桌面 60fps / 移动 30fps

### 阶段 5（可选）：局部地形钻取（1 天）
- 目标：点击某地"放大查看真实 3D 地形"
- 任务：集成 three-geo，按需加载局部高精度地形块
- 验证：珠峰、大峡谷可点击查看

**总工期：5–9 天**

---

## 十、伪代码示例

### 10.1 瓦片化球面地球（核心）

```js
class TiledGlobe {
  constructor(scene, radius, tileSource) {
    this.scene = scene;
    this.radius = radius;
    this.source = tileSource;          // TileSource 实例
    this.tileTree = new Map();         // key: `${z}/${x}/${y}` → mesh
    this.maxScreenError = 2.0;         // 屏幕空间误差阈值
    this.buildRootTiles();             // z=2 的 16 个根瓦片
  }

  // 根瓦片：z=2，覆盖全球 16 块（4 列 × 4 行）
  buildRootTiles() {
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) {
        this.requestTile(2, x, y, null);
      }
    }
  }

  // 请求单个瓦片：球面分块 geometry + 瓦片纹理
  async requestTile(z, x, y, parent) {
    const bbox = tileBBox(z, x, y);    // [west, south, east, north]
    const geom = this.buildSphereSegment(this.radius, bbox, 32, 32);
    const mat = new THREE.MeshPhongMaterial({ color: 0x1e40af });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData = { z, x, y, bbox, loaded: false };
    this.tileTree.set(`${z}/${x}/${y}`, mesh);
    this.scene.add(mesh);

    // 异步加载影像纹理
    const url = this.source.getTileURL(z, x, y);
    const tex = await loadTexture(url);
    mat.map = tex; mat.needsUpdate = true;

    // 异步加载 DEM 瓦片做顶点位移（着色器层）
    const demUrl = this.demSource?.getTileURL(z, x, y);
    if (demUrl) {
      const demTex = await loadTexture(demUrl);
      mat.displacementMap = demTex;
      mat.displacementScale = 0.02;     // 地形夸张系数（教学可视化）
      mat.displacementBias = 0;
    }
    mesh.userData.loaded = true;
  }

  // 球面分块几何：按经纬度 bbox 切 SphereGeometry
  buildSphereSegment(radius, [w, s, e, n], widthSeg, heightSeg) {
    const phiStart = w * Math.PI / 180;
    const phiLength = (e - w) * Math.PI / 180;
    const thetaStart = (90 - n) * Math.PI / 180;
    const thetaLength = (n - s) * Math.PI / 180;
    return new THREE.SphereGeometry(
      radius, widthSeg, heightSeg, phiStart, phiLength, thetaStart, thetaLength
    );
  }

  // 每帧更新 LOD：根据相机距离决定细分/合并
  update(camera) {
    for (const [key, tile] of this.tileTree) {
      if (!tile.userData.loaded) continue;
      const screenError = this.computeScreenError(tile, camera);
      if (screenError > this.maxScreenError && tile.userData.z < 8) {
        this.subdivide(tile);           // 拆成 4 子瓦片
      } else if (screenError < this.maxScreenError * 0.5 && tile.userData.z > 2) {
        this.merge(tile);               // 合并回父瓦片
      }
    }
  }

  computeScreenError(tile, camera) {
    // 瓦片到相机距离 → 屏幕投影像素误差（简化版）
    const dist = camera.position.distanceTo(tile.position);
    return (this.radius * 0.1) / dist;  // 简化：实际需投影计算
  }
}
```

### 10.2 DEM 位移着色器（Mapbox Terrain-RGB 解码）

```glsl
// 顶点着色器：解码 Terrain-RGB 并位移
uniform sampler2D demMap;
uniform float displacementScale;
varying vec2 vUv;

void main() {
  vUv = uv;
  vec3 dem = texture2D(demMap, uv).rgb * 255.0;
  // Mapbox Terrain-RGB: height = -10000 + (R*65536 + G*256 + B) * 0.1
  float height = -10000.0 + (dem.r * 65536.0 + dem.g * 256.0 + dem.b) * 0.1;
  // 沿法线方向位移（夸张系数便于教学可视化）
  vec3 displaced = position + normal * height * displacementScale;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
```

### 10.3 2D/3D 球面↔平面形变

```js
class GlobeMapSwitch {
  constructor(globe) {
    this.globe = globe;
    this.mode = '3d';                  // '2d' | '3d'
    this.t = 0;                        // 形变进度 0(球)→1(平面)
  }

  // 球面顶点 ↔ 圆柱投影平面顶点
  morphVertex(spherePos, t) {
    // spherePos: (x,y,z) on sphere
    const lng = Math.atan2(spherePos.z, spherePos.x);   // -π~π
    const lat = Math.asin(spherePos.y / length(spherePos));
    // 平面坐标：经度→x，纬度→y（墨卡托近似）
    const planeX = lng * this.globe.radius;
    const planeY = Math.log(Math.tan(Math.PI/4 + lat/2)) * this.globe.radius;
    return lerp3(spherePos, [planeX, planeY, 0], t);
  }

  toggle() {
    const target = this.mode === '3d' ? 1 : 0;
    tween(this.t, target, 1500, (v) => {
      this.t = v;
      // 更新所有瓦片 geometry 顶点（或用着色器 uniform）
      this.globe.material.uniforms.morphT.value = v;
      // 相机同步：3D 透视 → 2D 正交俯视
      camera.fov = lerp(60, 3, v);
      camera.position.y = lerp(camera.position.y, this.globe.radius * 3, v);
      camera.updateProjectionMatrix();
    });
    this.mode = this.mode === '3d' ? '2d' : '3d';
  }
}
```

### 10.4 瓦片源运行时切换（复用现有图层切换 UI）

```js
const TILE_SOURCES = {
  satellite: new EsriSource({ maxZoom: 19 }),                      // ESRI 影像
  satellite_cn: new TiandituSource({ key: TIANDITU_KEY, layer: 'img' }), // 天地图影像
  topo: new TiandituSource({ key: TIANDITU_KEY, layer: 'ter' }),   // 天地图地形晕渲
  political: new TiandituSource({ key: TIANDITU_KEY, layer: 'vec' }) // 天地图矢量
};

// 替换原 loadLayer(layer)
function setLayer(layer) {
  globe.setSource(TILE_SOURCES[layer]);   // 自动重载可见瓦片
}
```

---

## 十一、参考开源项目

| 项目 | 地址 | 价值 | 集成方式 |
|---|---|---|---|
| **three-geo** | https://github.com/w3reality/three-geo | 局部真实地形（Mapbox terrain-rgb + satellite） | 可作"局部钻取"子模块 |
| **three-globe** | https://github.com/vasturiano/three-globe | 球面数据可视化（基于 Three.js） | 参考球面瓦片挂载思路 |
| **Mapbox GL JS** | https://docs.mapbox.com/mapbox-gl-js/ | Terrain-DEM + 3D 地形参考实现 | 参考其 LOD 与投影 |
| **CesiumJS** | https://cesium.com/learn/cesiumjs/ | 工业级 quantized-mesh terrain | 对照实现细节 |
| **Cesium OSM Buildings** | https://cesium.com/platform/cesium-ion/content/osm-buildings/ | 3D Tiles 建筑参考 | 建筑图层（非本报告重点） |
| **Google Maps + Three.js Layer** | https://github.com/googlemaps/three（社区） | Three.js 与地图引擎集成参考 | 相机同步思路 |
| **Mapzen terrain-tiles** | https://registry.opendata.aws/terrain-tiles/ | Terrarium 瓦片离线数据 | 自托管离线方案 |
| **dem2terrain** | https://gitee.com/lzugis15/dem2terrain | SRTM/ALOS → Terrain-RGB/Terrarium 切片工具 | 自建瓦片服务 |
| **MapLibre GL JS** | https://maplibre.org/ | Mapbox GL 开源分支，无 token | 2D 地图层替代品 |

---

## 十二、推荐方案与结论

### 12.1 最终推荐

> **主方案：Three.js 原生（方案A）+ 球面瓦片 LOD + Mapbox Terrain-DEM 顶点位移 + 球面↔平面形变 2D/3D 切换**

- **DEM 源**：Mapbox Terrain-DEM v1（在线，需 token）；**离线备选**：SRTM1/AW3D30 + dem2terrain 自切 Terrarium 瓦片
- **影像源**：国内用天地图 img_w（tk），全球用 ESRI World Imagery（无需 Key），高端用 Mapbox Satellite
- **2D/3D**：球面顶点形变 + 单相机 FOV 动画（起步），后续可升级双相机正交切换
- **共存**：太阳系模块、城市标注、昼夜分界等全部保留，零冲突

### 12.2 关键决策依据

1. **避免引入 Cesium**：现有项目 Three.js 投入已深，双引擎并存架构复杂、体积翻倍，且 Cesium ion token 有配额
2. **three-geo 不作主球**：它只做局部地形块，非全球球面，定位为"点击钻取"子功能
3. **同一套瓦片 2D/3D 共用**：Web Mercator XYZ 瓦片天然支持双模式，无需重复数据
4. **教学友好**：方案A 暴露 `THREE.Mesh` 几何/纹理，便于 K12 课程做等高线、分层设色等 GIS 实验

### 12.3 风险与缓解

| 风险 | 缓解 |
|---|---|
| 自研 LOD 四叉树复杂度高 | 先做固定 z=2/3/4 三级，验证后再上动态细分 |
| DEM 位移接缝 | 瓦片边界 1 像素 overlap，或在着色器内做边缘羽化 |
| 天地图国内限速 | LRU 缓存 + 瓦片预加载 + 子域名轮询 t0–t7 |
| 2D↔3D 形变 UV 错乱 | 形变只改顶点位置不改 UV，纹理映射保持一致 |
| 移动端性能 | 2D 模式关闭 DEM 位移，瓦片数上限 48 |

### 12.4 与现有报告的关系

本报告聚焦 **Three.js 原生真实地貌路径**与**2D/3D 切换**，是 `地图API调研报告.md`（Cesium/Mapbox 引擎层对比）的**技术实现层补充**。若后续决定放弃自研转用引擎，再参考该报告的 Cesium 方案。

---

## 附录：关键 URL 速查

```
# DEM 数据下载
NASA Earthdata:        https://search.earthdata.nasa.gov/
ASTER GDEM v3:         https://lpdaac.usgs.gov/products/astgtmv003/
AW3D30:                https://www.eorc.jaxa.jp/ALOS/en/aw3d30/
OpenTopography:        https://opentopography.org/

# 影像瓦片（XYZ）
ESRI World Imagery:    https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}
天地图影像:             https://t{s}.tianditu.gov.cn/img_w/wmts?tk={KEY}&...&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}
Mapbox Satellite:      https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/512/{z}/{x}/{y}?access_token={TOKEN}
Bing Aerial (QuadKey): https://ecn.t{s}.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=14245

# DEM 瓦片（Terrain-RGB）
Mapbox Terrain-DEM:    mapbox://mapbox.mapbox-terrain-dem-v1  (tileSize=512, maxzoom=14)
Mapzen Terrarium:      https://registry.opendata.aws/terrain-tiles/  (归档，可自托管)

# 开源工具
dem2terrain (切片):     https://gitee.com/lzugis15/dem2terrain
three-geo:             https://github.com/w3reality/three-geo
```
