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

declare global {
  interface Window {
    __layerManager?: { reportExternalError: (kind: string, err: Error) => void };
  }
}

function attachTileErrorListener(provider: Cesium.ImageryProvider, kind: string): void {
  if (typeof window === 'undefined') return;
  const errorEvent = (provider as any).errorEvent;
  if (!errorEvent || typeof errorEvent.addEventListener !== 'function') return;

  let reported = false;
  errorEvent.addEventListener((providerError: any) => {
    if (reported) return;
    reported = true;
    const layerManager = (window as any).__layerManager || null;
    const msg = `TileError(${kind}): ${providerError?.message || 'tile fetch failed'}`;
    console.warn('[TileError]', kind, msg);
    layerManager?.reportExternalError?.(kind, new Error(msg));
  });
}

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
    if (!AMAP_KEY && type.startsWith('amap')) {
      if (type === 'amapSatellite') {
        return [createFallbackBasemapProvider('satellite'), null];
      }
      if (type === 'amapPolitical' || type === 'amapRoad') {
        return [createFallbackBasemapProvider('political'), null];
      }
    }
    const keyQ = AMAP_KEY ? `&key=${encodeURIComponent(AMAP_KEY)}` : '';
    if (type === 'amapSatellite') {
      return [
        createAmapProvider(6, keyQ, 'amapSat'),
        createAmapProvider(8, keyQ, 'amapLabel'),
      ];
    }
    if (type === 'amapPolitical') {
      return [
        createAmapProvider(7, keyQ, 'amapRoad'),
        createAmapProvider(8, keyQ, 'amapLabel'),
      ];
    }
    return [createAmapProvider(7, keyQ, 'amapRoad'), null];
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

  const provider = new Cesium.WebMapTileServiceImageryProvider({
    url,
    layer: layer.split('_')[0],
    style: 'default',
    format: 'tiles',
    tileMatrixSetID: 'w',
    maximumLevel: maxLevel,
    credit: '国家地理信息公共服务平台 天地图',
  });
  attachTileErrorListener(provider, 'tianditu');
  return provider;
}

/**
 * 国际服务回退（无天地图 token 时）
 */
function createFallbackBasemapProvider(
  type: 'satellite' | 'political' | 'relief' | 'landform' | 'osm',
): Cesium.ImageryProvider {
  try {
    switch (type) {
      case 'satellite': {
        const provider = new Cesium.UrlTemplateImageryProvider({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          maximumLevel: 19,
          credit: 'Esri, Maxar, Earthstar Geographics',
        });
        attachTileErrorListener(provider, 'esriSat');
        return provider;
      }

      case 'relief': {
        const provider = new Cesium.UrlTemplateImageryProvider({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
          maximumLevel: 19,
          credit: 'Esri',
        });
        attachTileErrorListener(provider, 'esriStreet');
        return provider;
      }

      case 'landform': {
        const provider = new Cesium.UrlTemplateImageryProvider({
          url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}',
          maximumLevel: 18,
          credit: 'USGS',
        });
        attachTileErrorListener(provider, 'usgsRelief');
        return provider;
      }

      case 'political': {
        const provider = new Cesium.UrlTemplateImageryProvider({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
          maximumLevel: 19,
          credit: 'Esri',
        });
        attachTileErrorListener(provider, 'esriStreet');
        return provider;
      }

      case 'osm':
      default: {
        const provider = new Cesium.OpenStreetMapImageryProvider({
          url: 'https://tile.openstreetmap.org/',
          maximumLevel: 19,
        });
        attachTileErrorListener(provider, 'osm');
        return provider;
      }
    }
  } catch {
    return createOfflineNaturalEarthProvider();
  }
}

export function createOfflineNaturalEarthProvider(): Cesium.ImageryProvider {
  try {
    const provider = new Cesium.SingleTileImageryProvider({
      url: Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII'),
    });
    attachTileErrorListener(provider, 'offlineNE');
    return provider;
  } catch {
    try {
      const provider = new Cesium.OpenStreetMapImageryProvider({
        url: 'offline placeholder',
        maximumLevel: 0,
      });
      attachTileErrorListener(provider, 'offlineNE');
      return provider;
    } catch {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#1a5276';
        ctx.fillRect(0, 0, 1, 1);
      }
      const provider = new Cesium.SingleTileImageryProvider({
        url: canvas.toDataURL(),
      });
      attachTileErrorListener(provider, 'offlineNE');
      return provider;
    }
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

  const provider = new Cesium.WebMapTileServiceImageryProvider({
    url,
    layer: 'cva',
    style: 'default',
    format: 'tiles',
    tileMatrixSetID: 'w',
    maximumLevel: 19,
    credit: '天地图标注',
  });
  attachTileErrorListener(provider, 'tianditu');
  return provider;
}

// ============ AWS Terrarium Terrain Provider ============

/**
 * AWS Terrarium Terrain Tiles（CC0 Public Domain）
 *
 * URL: https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png
 * 编码: height = r * 256 + g + b / 256 - 32768
 * 覆盖: 全球，z ≤ 15（约 1km 网格），但高 zoom 可以取 z=15 级别的 tile
 *
 * 使用 CustomHeightmapTerrainProvider（Cesium 1.107+）解码 Terrarium PNG 为高度图。
 * 无需 AWS 账户，匿名 GET，中国大陆访问稳定（S3 公开桶）。
 */
export async function createTerrariumTerrainProvider(): Promise<Cesium.TerrainProvider> {
  return createCustomTerrainProvider(
    'https://elevation-tiles-prod.s3.amazonaws.com/terrarium',
    15,
  );
}

// ============ MapLibre DEM30 Terrain Provider ============

/**
 * MapLibre DEM30 —— 高清全球地形（CC0 Public Domain）
 *
 * URL: https://dem.maplibre.com/data/dem-30/{z}/{x}/{y}.png
 * 编码: height = r * 256 + g + b / 256 - 32768（与 Terrarium 相同）
 * 覆盖: 全球，30m 分辨率（z≈20），提供街景级地形细节
 *
 * MapLibre DEM30 基于 Copernicus GLO-90、SRTM、ALOS 等多个公开 DEM 源融合，
 * 是目前公开可用的最高精度全球地形之一。
 */
export async function createMapLibreTerrainProvider(): Promise<Cesium.TerrainProvider> {
  return createCustomTerrainProvider(
    'https://dem.maplibre.com/data/dem-30',
    20,
  );
}

/**
 * 通用 CustomHeightmapTerrainProvider 工厂
 * 解码 Terrarium/MapLibre 编码格式的 PNG 高度图
 */
async function createCustomTerrainProvider(
  urlTemplate: string,
  maxLevel: number,
): Promise<Cesium.TerrainProvider> {
  const width = 64;
  const height = 64;

  return new Cesium.CustomHeightmapTerrainProvider({
    width,
    height,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    callback: async (x: number, y: number, level: number) => {
      const effectiveLevel = Math.min(level, maxLevel);
      const scale = Math.pow(2, level - effectiveLevel);
      const scaledX = Math.floor(x / scale);
      const scaledY = Math.floor(y / scale);

      const url = `${urlTemplate}/${effectiveLevel}/${scaledX}/${scaledY}.png`;

      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');

        ctx.drawImage(bitmap, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);

        // Terrarium/MapLibre encoding: height = r * 256 + g + b / 256 - 32768
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
        return new Float32Array(width * height);
      }
    },
  });
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
function createAmapProvider(style: 6 | 7 | 8, keySuf = '', kind: 'amapSat' | 'amapRoad' | 'amapLabel' = 'amapRoad'): Cesium.ImageryProvider {
  const hostPrefix = style === 7 ? 'webrd0' : 'webst0';
  const subdomains = ['1', '2', '3', '4'];
  const url =
    `https://${hostPrefix}{s}.is.autonavi.com/appmaptile` +
    `?lang=zh_cn&size=1&scale=1&style=${style}&x={x}&y={y}&z={z}${keySuf}`;
  const provider = new Cesium.UrlTemplateImageryProvider({
    url,
    subdomains,
    maximumLevel: 20,
    minimumLevel: 0,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    credit: '© 高德地图 AutoNavi',
  });
  attachTileErrorListener(provider, kind);
  return provider;
}

/**
 * 检查是否有 ion token
 */
export function hasIonToken(): boolean {
  return !!ION_TOKEN;
}

export async function createIonWorldTerrainProvider(): Promise<Cesium.TerrainProvider> {
  try {
    Cesium.Ion.defaultAccessToken = ION_TOKEN!;
    return await Cesium.createWorldTerrainAsync();
  } catch (err: any) {
    throw new Error('CesiumIonAuthFailed: ' + (err?.message || String(err)));
  }
}

export function createEllipsoidTerrainProvider(): Promise<Cesium.TerrainProvider> {
  return Promise.resolve(new Cesium.EllipsoidTerrainProvider());
}

export async function createBestTerrainProvider(): Promise<{
  provider: Cesium.TerrainProvider;
  source: 'ion' | 'maplibre' | 'terrarium' | 'ellipsoid';
  warning?: string;
}> {
  if (ION_TOKEN) {
    try {
      const provider = await createIonWorldTerrainProvider();
      return { provider, source: 'ion' };
    } catch (err: any) {
      // fall through to MapLibre
    }
  }
  // 优先尝试 MapLibre DEM30（30m 高清地形，远优于 Terrarium 的 1km 分辨率）
  try {
    const provider = await createMapLibreTerrainProvider();
    return { provider, source: 'maplibre' };
  } catch (err: any) {
    // fall through to Terrarium
  }
  // 回退到 AWS Terrarium（1km 地形）
  try {
    const provider = await createTerrariumTerrainProvider();
    return { provider, source: 'terrarium' };
  } catch (err: any) {
    const provider = await createEllipsoidTerrainProvider();
    return { provider, source: 'ellipsoid', warning: 'All terrain sources failed' };
  }
}
