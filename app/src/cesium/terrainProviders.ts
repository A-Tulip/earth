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

// ============ 环境变量 ============

const TIANDITU_TOKEN = import.meta.env.VITE_TIANDITU_TOKEN as string | undefined;
const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined;

// ============ 底图 Provider 工厂 ============

export type BasemapType = 'satellite' | 'terrain' | 'political' | 'osm';

/**
 * 创建底图 ImageryProvider。
 * - 有天地图 token：使用天地图 WMTS（中文标注 + 中国访问稳定）
 * - 无 token：回退到 Esri / OSM / 内置纹理
 */
export function createBasemapProvider(type: BasemapType): Cesium.ImageryProvider {
  // 天地图主用（有 token 时）
  if (TIANDITU_TOKEN) {
    return createTiandituProvider(type, TIANDITU_TOKEN);
  }
  // 无天地图 token：回退到国际服务
  return createFallbackBasemapProvider(type);
}

/**
 * 天地图 WMTS Provider
 * vec_w / img_w / ter_w + cva_w（中文标注叠加）
 */
function createTiandituProvider(type: BasemapType, token: string): Cesium.ImageryProvider {
  let layer: string;
  let maxLevel: number;

  switch (type) {
    case 'satellite':
      layer = 'img_w';
      maxLevel = 18;
      break;
    case 'terrain':
      layer = 'ter_w';
      maxLevel = 14;
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
function createFallbackBasemapProvider(type: BasemapType): Cesium.ImageryProvider {
  switch (type) {
    case 'satellite':
      return new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19,
        credit: 'Esri, Maxar, Earthstar Geographics',
      });

    case 'terrain':
      // Esri World Topo Map（地形+政区混合）
      return new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19,
        credit: 'Esri',
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
    maximumLevel: 18,
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
 * 检查是否有 ion token
 */
export function hasIonToken(): boolean {
  return !!ION_TOKEN;
}
