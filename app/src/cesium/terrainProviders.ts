/**
 * terrainProviders —— 底图与地形 Provider 工厂
 *
 * 底图优先级：
 *   1. 天地图 WMTS（若有 VITE_TIANDITU_TOKEN）—— 政区/影像/地形 + 中文标注
 *   2. Esri World Imagery / Street Map（无 token 回退）
 *   3. 内置 NaturalEarthII.jpg（完全离线）
 *
 * 地形优先级：
 *   1. Cesium ion World Terrain（若有 VITE_CESIUM_ION_TOKEN）
 *   2. AWS Terrarium Tiles（CC0，无需注册，z≤15）
 *   3. 椭球（最终回退，地形分析功能不可用）
 *
 * 数据源与许可见 AGENTS.md §7。
 */

import * as Cesium from 'cesium';
import type { BasemapType as SceneBasemapType } from '../state/sceneState';

// ============ 环境变量 ============

const TIANDITU_TOKEN = import.meta.env.VITE_TIANDITU_TOKEN as string | undefined;
const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined;
// Q7：高德 Web 瓦片（卫星/路网/注记）—— key 作为 query param 可选附加以提升配额
const AMAP_KEY = import.meta.env.VITE_AMAP_KEY as string | undefined;

// ============ 底图 Provider 工厂 ============

// Re-export 保证单一定义源（sceneState.ts 是 SSOT，避免双写类型漂移）
export type BasemapType = SceneBasemapType;

/**
 * 返回一个 [基底, 标注] ImageryProvider 对：
 * - 非 osm/political/relief/landform/satellite 优先加中文注记层（天地图 cva_w）
 * - osm 纯英文，不加中文注记层
 * - contour：基底=政区底图，由 controller 再叠加 globe.material=ElevationContour
 * - amap*：使用 style=6（卫星）/ style=7（路网矢量）/ style=8（注记叠加）
 * - tianditu*：强制走天地图 WMTS（即使有天地图 token 也可直接选；无 token 时自动回退到国际 Esri 系列）
 */
export function createBasemapProvider(
  type: BasemapType,
): [base: Cesium.ImageryProvider, label: Cesium.ImageryProvider | null] {
  // -------- Q3: tianditu* 显式指定走天地图 --------
  if (type === 'tiandituSatellite' || type === 'tiandituPolitical' || type === 'tiandituRelief') {
    const tKind: 'satellite' | 'political' | 'relief' =
      type === 'tiandituSatellite' ? 'satellite'
        : type === 'tiandituPolitical' ? 'political'
          : 'relief';
    if (TIANDITU_TOKEN) {
      const base = createTiandituProvider(tKind, TIANDITU_TOKEN);
      const label = createLabelOverlayProvider(); // 天地图中文注记 cva_w
      return [base, label];
    }
    // 无 token → 回退到国际回退底图，不加中文注记（天地图中文注记需要 tk）
    return [createFallbackBasemapProvider(tKind), null];
  }

  // -------- Q7 高德优先（若有 AMAP_KEY 或用户直接选 amap*）--------
  if (type === 'amapSatellite' || type === 'amapPolitical' || type === 'amapRoad') {
    const keyQ = AMAP_KEY ? `&key=${encodeURIComponent(AMAP_KEY)}` : '';
    if (type === 'amapSatellite') {
      // 卫星底 + 注记层（style=8）
      return [
        createAmapProvider(6, keyQ),
        createAmapProvider(8, keyQ),
      ];
    }
    if (type === 'amapPolitical') {
      // 路网矢量底（style=7）+ 注记层（style=8）
      return [
        createAmapProvider(7, keyQ),
        createAmapProvider(8, keyQ),
      ];
    }
    // amapRoad：仅路网矢量（不叠注记，供调试/组合）
    return [createAmapProvider(7, keyQ), null];
  }

  // -------- 历史别名 terrain → relief，避免 baseKind 类型漂移 --------
  const normalized: Exclude<BasemapType, 'amapSatellite' | 'amapPolitical' | 'amapRoad' | 'terrain' | 'tiandituSatellite' | 'tiandituPolitical' | 'tiandituRelief'> =
    type === 'terrain' ? 'relief' : (type as Exclude<BasemapType, 'amapSatellite' | 'amapPolitical' | 'amapRoad' | 'terrain' | 'tiandituSatellite' | 'tiandituPolitical' | 'tiandituRelief'>);

  const baseKind: 'satellite' | 'political' | 'relief' | 'landform' | 'osm' =
    normalized === 'contour' ? 'political' : normalized;

  const base = TIANDITU_TOKEN
    ? createTiandituProvider(baseKind, TIANDITU_TOKEN)
    : createFallbackBasemapProvider(baseKind);

  const addChineseLabel = normalized !== 'osm';
  const label = addChineseLabel ? createLabelOverlayProvider() : null;
  return [base, label];
}

/**
 * 天地图 WMTS Provider
 * vec_w / img_w / ter_w + cva_w（中文标注叠加）
 */
function createTiandituProvider(
  type: 'satellite' | 'political' | 'relief' | 'landform' | 'osm',
  token: string,
): Cesium.ImageryProvider {
  let layer: string;
  let maxLevel: number;

  switch (type) {
    case 'satellite':
      // 天地图 img=卫星影像；含云量时回退到 Esri
      layer = 'img_w';
      // Q8: 17→18 允许放大
      maxLevel = 18;
      break;
    case 'relief':
      // 天地图 terrain=地形晕渲（地势图）
      layer = 'ter_w';
      // Q8: 14→16
      maxLevel = 16;
      break;
    case 'landform':
      // 地貌：天地图地形晕渲 + 后续 globe.material 分层设色；此处先给 ter_w
      layer = 'ter_w';
      // Q8: 14→16
      maxLevel = 16;
      break;
    case 'political':
    case 'osm':
    default:
      layer = 'vec_w';
      maxLevel = 18;
      break;
  }

  // 天地图 WMTS URL 模板（t0~t7 负载均衡，这里用 t0）
  const url =
    `https://t0.tianditu.gov.cn/${layer}/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0` +
    `&LAYER=${layer.split('_')[0]}&TILEMATRIXSET=w&FORMAT=tiles` +
    `&TILECOL={x}&TILEROW={y}&TILEMATRIX={z}&tk=${token}`;

  return new Cesium.WebMapTileServiceImageryProvider({
    url,
    layer: layer.split('_')[0],
    style: 'default',
    format: 'tiles',
    tileMatrixSetID: 'w',
    maximumLevel: maxLevel,
    credit: '国家地理信息公共服务平台 天地图',
  });
}

/**
 * 国际服务回退（无天地图 token 时）
 */
function createFallbackBasemapProvider(
  type: 'satellite' | 'political' | 'relief' | 'landform' | 'osm',
): Cesium.ImageryProvider {
  switch (type) {
    case 'satellite':
      return new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19,
        credit: 'Esri, Maxar, Earthstar Geographics',
      });

    case 'relief':
      // Esri World Topo Map（地形晕渲+注记，地势图）
      return new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19,
        credit: 'Esri',
      });

    case 'landform':
      // 地貌：USGS World Shaded Relief（分层设色质感）
      return new Cesium.UrlTemplateImageryProvider({
        url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}',
        // Q8: 16→18，允许拉伸缩放
        maximumLevel: 18,
        credit: 'USGS',
      });

    case 'political':
      // Esri World Street Map（政区图）
      return new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19,
        credit: 'Esri',
      });

    case 'osm':
    default:
      return new Cesium.OpenStreetMapImageryProvider({
        url: 'https://tile.openstreetmap.org/',
        maximumLevel: 19,
      });
  }
}

/**
 * 创建中文标注叠加层（仅天地图模式）
 * 返回 null 表示不叠加（无天地图 token 时）
 */
export function createLabelOverlayProvider(): Cesium.ImageryProvider | null {
  if (!TIANDITU_TOKEN) return null;
  const url =
    `https://t0.tianditu.gov.cn/cva_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0` +
    `&LAYER=cva&TILEMATRIXSET=w&FORMAT=tiles` +
    `&TILECOL={x}&TILEROW={y}&TILEMATRIX={z}&tk=${TIANDITU_TOKEN}`;

  return new Cesium.WebMapTileServiceImageryProvider({
    url,
    layer: 'cva',
    style: 'default',
    format: 'tiles',
    tileMatrixSetID: 'w',
    // Q8: 18→19
    maximumLevel: 19,
    credit: '天地图标注',
  });
}

// ============ AWS Terrarium 地形 Provider ============

/**
 * AWS Terrarium Terrain Tiles（CC0 Public Domain）
 *
 * URL: https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png
 * 编码: height = r * 256 + g + b / 256 - 32768
 * 覆盖: 全球，z ≤ 15（约 1km 网格）
 *
 * 使用 CustomHeightmapTerrainProvider（Cesium 1.107+）解码 Terrarium PNG 为高度图。
 * 无需 AWS 账户，匿名 GET，中国大陆访问稳定（S3 公开桶）。
 */
export async function createTerrariumTerrainProvider(): Promise<Cesium.TerrainProvider> {
  // CustomHeightmapTerrainProvider 需要 width/height 和 geometry 回调
  // 这里用 64x64 高度图（每个 terrain tile 切分为 64x64 采样点）
  const width = 64;
  const height = 64;

  const provider = new Cesium.CustomHeightmapTerrainProvider({
    width,
    height,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    callback: async (x: number, y: number, level: number) => {
      // Terrarium tiles 最高 z=15，超出时降级到 z=15
      const terrariumLevel = Math.min(level, 15);
      const terrariumX = x >> (level - terrariumLevel > 0 ? level - terrariumLevel : 0);
      const terrariumY = y >> (level - terrariumLevel > 0 ? level - terrariumLevel : 0);

      const url = `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${terrariumLevel}/${terrariumX}/${terrariumY}.png`;

      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);

        // 创建 canvas 采样像素
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context 不可用');

        ctx.drawImage(bitmap, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);

        // 解码 Terrarium: height = r * 256 + g + b / 256 - 32768
        const heights = new Float32Array(width * height);
        for (let i = 0; i < width * height; i++) {
          const r = imageData.data[i * 4];
          const g = imageData.data[i * 4 + 1];
          const b = imageData.data[i * 4 + 2];
          heights[i] = r * 256 + g + b / 256 - 32768;
        }

        bitmap.close();
        return heights;
      } catch {
        // 网络失败：返回全 0 高度（海平面），terrain.available 已为 false
        return new Float32Array(width * height);
      }
    },
  });

  return provider;
}

// ============ 工具函数 ============

/**
 * 检查地形是否可用（非椭球）
 */
export function isTerrainAvailable(provider: Cesium.TerrainProvider): boolean {
  return !(provider instanceof Cesium.EllipsoidTerrainProvider);
}

/**
 * 检查是否有天地图 token
 */
export function hasTiandituToken(): boolean {
  return !!TIANDITU_TOKEN;
}

/**
 * 检查是否有高德 key
 */
export function hasAmapKey(): boolean {
  return !!AMAP_KEY;
}

// ============ Q7 高德 Web 瓦片 ============

/**
 * 高德地图瓦片 style：
 *   6 = 卫星影像
 *   7 = 路网矢量（暗色描边+填色，适合教学政区）
 *   8 = 中文注记（道路名+POI） —— 通常叠加在 6 / 7 之上
 *
 * 子域 webst0{1..4}.is.autonavi.com / webrd0{1..4}.is.autonavi.com（负载均衡）
 * 瓦片是 Web Mercator（Google 瓦片），直接兼容 Cesium.UrlTemplateImageryProvider 默认切片方案
 * maximumLevel=20 支持街景级（19 = 约 0.3m / px，满足放大到街景）
 * keySuf 为 &key=xxx 后缀（可空，提升配额/防止 403）
 */
function createAmapProvider(style: 6 | 7 | 8, keySuf = ''): Cesium.ImageryProvider {
  // 高德 style=7 用 webrd 服务器；其余用 webst
  const hostPrefix = style === 7 ? 'webrd0' : 'webst0';
  const subdomains = ['1', '2', '3', '4'];
  const url =
    `https://${hostPrefix}{s}.is.autonavi.com/appmaptile` +
    `?lang=zh_cn&size=1&scale=1&style=${style}&x={x}&y={y}&z={z}${keySuf}`;
  return new Cesium.UrlTemplateImageryProvider({
    url,
    subdomains,
    // Q8: maximumLevel=20，支持深度放大到街景级
    maximumLevel: 20,
    minimumLevel: 0,
    // 高德 Web 默认为 Web Mercator，与 Cesium 默认一致
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    credit: '© 高德地图 AutoNavi',
  });
}

/**
 * 检查是否有 ion token
 */
export function hasIonToken(): boolean {
  return !!ION_TOKEN;
}
