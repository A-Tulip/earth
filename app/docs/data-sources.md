# 数据源

## 1. 原则

- 真实地理数据优先选择**获取门槛低、标准开放、来源权威**的数据
- 所有数据源封装成 Provider，课程只引用稳定的内部数据标识
- 第三方服务不可用时使用**缓存、预置数据或简化教学图层**
- 课堂不会因单个接口失败而完全中断

## 2. 数据源清单

| ID | 名称 | 来源 | 许可 | 网络 | 回退 |
|---|---|---|---|---|---|
| `weather` | 实时天气 | Open-Meteo | CC BY 4.0 | 是 | 离线默认值 |
| `earthquake` | 地震数据 | USGS | Public Domain | 是 | 空数据 |
| `natural-events` | 自然事件 | NASA EONET | Public Domain | 是 | 空数据 |
| `cities` | 城市数据 | 预置 | 内部 | 否 | — |
| 地形 | Cesium World Terrain | Cesium ion | ion token（可选） | 是 | 椭球地形 |
| 底图 | OpenStreetMap | OSM | CC BY 4.0 | 是 | 内置纹理 |
| 矢量 | Natural Earth | Natural Earth | Public Domain | 否（已下载） | — |
| `planet-textures` | 太阳系纹理 | Solar System Scope | CC BY 4.0 | 否（已下载） | 程序化 Canvas 纹理 |

## 3. 接口详情

### 3.1 Open-Meteo（天气）
- **URL**：`https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,weather_code&timezone=auto`
- **许可**：CC BY 4.0，免费，无需 key
- **CORS**：允许
- **配额**：每日 10000 次免费
- **回退**：返回 `{ temp: 25, weather: '离线', weatherCode: -1 }`

### 3.2 USGS Earthquake（地震）
- **URL**：`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/{minMagnitude}_month.geojson`
- **许可**：Public Domain
- **CORS**：允许
- **回退**：返回空数组

### 3.3 NASA EONET（自然事件）
- **URL**：`https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50`
- **许可**：Public Domain
- **CORS**：允许
- **回退**：返回空数组

### 3.4 Cesium World Terrain
- **接入**：`Cesium.Terrain.fromWorldTerrain()`（需 ion token）
- **回退**：`EllipsoidTerrainProvider`（无地形起伏，但课堂不中断）

### 3.5 OpenStreetMap 底图
- **接入**：`OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' })`
- **许可**：CC BY 4.0
- **回退**：`SingleTileImageryProvider`（Cesium 内置 Natural Earth 纹理）

### 3.6 Natural Earth 矢量
- **位置**：`data/natural-earth/ne_10m_admin_0_countries.{shp,dbf,...}`
- **许可**：Public Domain
- **用途**：国界、行政边界
- **回退**：无需回退（本地文件）

### 3.7 太阳系行星纹理
- **来源**：Solar System Scope（https://www.solarsystemscope.com/textures/）
- **许可**：CC BY 4.0 International（可商用、可修改、可分发，需署名）
- **数据基础**：NASA 影像与高程数据（Messenger、Viking、Cassini、Hubble）
- **位置**：`app/public/textures/planets/`（12 个文件，2K 分辨率，共 ~6 MB）
- **下载**：`npm run download:textures`（跳过已存在文件）
- **回退**：程序化 Canvas 噪声纹理（`SolarSystemEngine.createPlanetTexture`），
  纹理缺失时课堂不中断
- **加载策略**：`texture-loader.ts` 异步加载真实纹理，不阻塞首屏；
  先用程序化纹理渲染，真实纹理加载完成后替换

## 4. Provider 实现（`src/data/providers.ts`）

### 预置城市（10 个）
北京、上海、广州、东京、纽约、伦敦、巴黎、悉尼、莫斯科、新德里——含经纬度、国家、人口、时区。

### 函数签名

```typescript
getCities(): CityData[]                              // 同步，预置
fetchWeather(city: CityData): Promise<WeatherData>   // 异步，带回退
fetchEarthquakes(minMagnitude?): Promise<EarthquakeData[]>
fetchNaturalEvents(): Promise<NaturalEventData[]>
```

所有异步函数**失败不抛异常**，返回回退数据。

## 5. 待扩展数据源

| ID | 来源 | 状态 |
|---|---|---|
| `gdp` | World Bank / Natural Earth | 待接入 |
| `population` | WorldPop / Natural Earth | 待接入 |
| `temperature` | Open-Meteo 历史气候 | 待接入 |
| `precipitation` | Open-Meteo 历史气候 | 待接入 |
| `plates` | USGS Plate Boundaries | 待接入 |
| `rivers` | Natural Earth Rivers | 待接入 |

## 6. 署名

公共产品需在合适位置显示数据来源署名（如"地图 © OpenStreetMap 贡献者"）。Cesium 默认的 attribution 控件已处理底图署名。
