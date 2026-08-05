/**
 * Data Providers —— 数据源封装层
 *
 * 真实地理数据封装成 Provider，课程只引用稳定的内部数据标识。
 * 第三方服务不可用时使用缓存、预置数据或简化教学图层。
 *
 * 性能优化（issue #18 限流 429/400）：
 *   所有 fetch* 函数通过 apiCache（CachedFetcher）访问：
 *   - TTL 内存缓存（按数据更新频率：10m / 1h / 24h）
 *   - 并发请求去重（同 URL 的并发请求共享 Promise）
 *   - 单域名并发 ≤ 3，请求间隔 ≥ 100ms
 *   - 429/4xx/5xx 错误进入静默期，60s 内不再重复请求
 */

import { apiCache, TTL_10M, TTL_1H, TTL_24H } from '../state/CachedFetcher';

// ============ 数据源标识 ============

export type DataProviderId =
  | 'weather'
  | 'earthquake'
  | 'natural-events'
  | 'gdp'
  | 'population'
  | 'temperature'
  | 'precipitation'
  | 'cities'
  | 'plates'
  | 'rivers'
  | 'geocoding'; // Q4 Nominatim 反向地理编码

// ============ 城市数据（预置，回退用） ============

export interface CityData {
  name: string;
  lon: number;
  lat: number;
  country: string;
  population?: string;
  timezone?: string;
}

const PRESET_CITIES: CityData[] = [
  { name: '北京', lon: 116.4, lat: 39.9, country: '中国', population: '2189万', timezone: 'UTC+8' },
  { name: '上海', lon: 121.5, lat: 31.2, country: '中国', population: '2487万', timezone: 'UTC+8' },
  { name: '广州', lon: 113.3, lat: 23.1, country: '中国', population: '1881万', timezone: 'UTC+8' },
  { name: '东京', lon: 139.7, lat: 35.7, country: '日本', population: '1396万', timezone: 'UTC+9' },
  { name: '纽约', lon: -74.0, lat: 40.7, country: '美国', population: '839万', timezone: 'UTC-5' },
  { name: '伦敦', lon: -0.1, lat: 51.5, country: '英国', population: '898万', timezone: 'UTC+0' },
  { name: '巴黎', lon: 2.3, lat: 48.9, country: '法国', population: '214万', timezone: 'UTC+1' },
  { name: '悉尼', lon: 151.2, lat: -33.9, country: '澳大利亚', population: '533万', timezone: 'UTC+11' },
  { name: '莫斯科', lon: 37.6, lat: 55.8, country: '俄罗斯', population: '1264万', timezone: 'UTC+3' },
  { name: '新德里', lon: 77.2, lat: 28.6, country: '印度', population: '3290万', timezone: 'UTC+5:30' },
];

export function getCities(): CityData[] {
  return PRESET_CITIES;
}

/** 扩展城市库（搜索用，含更多国内外城市） */
const EXTENDED_CITIES: CityData[] = [
  ...PRESET_CITIES,
  { name: '深圳', lon: 114.1, lat: 22.5, country: '中国', population: '1756万', timezone: 'UTC+8' },
  { name: '成都', lon: 104.1, lat: 30.7, country: '中国', population: '2094万', timezone: 'UTC+8' },
  { name: '重庆', lon: 106.5, lat: 29.5, country: '中国', population: '3205万', timezone: 'UTC+8' },
  { name: '武汉', lon: 114.3, lat: 30.6, country: '中国', population: '1365万', timezone: 'UTC+8' },
  { name: '西安', lon: 108.9, lat: 34.3, country: '中国', population: '1300万', timezone: 'UTC+8' },
  { name: '杭州', lon: 120.2, lat: 30.3, country: '中国', population: '1220万', timezone: 'UTC+8' },
  { name: '南京', lon: 118.8, lat: 32.1, country: '中国', population: '932万', timezone: 'UTC+8' },
  { name: '天津', lon: 117.2, lat: 39.1, country: '中国', population: '1387万', timezone: 'UTC+8' },
  { name: '哈尔滨', lon: 126.5, lat: 45.8, country: '中国', population: '1009万', timezone: 'UTC+8' },
  { name: '昆明', lon: 102.7, lat: 25.0, country: '中国', population: '846万', timezone: 'UTC+8' },
  { name: '拉萨', lon: 91.1, lat: 29.7, country: '中国', population: '87万', timezone: 'UTC+8' },
  { name: '乌鲁木齐', lon: 87.6, lat: 43.8, country: '中国', population: '405万', timezone: 'UTC+8' },
  { name: '香港', lon: 114.2, lat: 22.3, country: '中国', population: '748万', timezone: 'UTC+8' },
  { name: '首尔', lon: 127.0, lat: 37.6, country: '韩国', population: '977万', timezone: 'UTC+9' },
  { name: '新加坡', lon: 103.8, lat: 1.4, country: '新加坡', population: '591万', timezone: 'UTC+8' },
  { name: '曼谷', lon: 100.5, lat: 13.8, country: '泰国', population: '1053万', timezone: 'UTC+7' },
  { name: '迪拜', lon: 55.3, lat: 25.3, country: '阿联酋', population: '333万', timezone: 'UTC+4' },
  { name: '开罗', lon: 31.2, lat: 30.0, country: '埃及', population: '2090万', timezone: 'UTC+2' },
  { name: '约翰内斯堡', lon: 28.0, lat: -26.2, country: '南非', population: '563万', timezone: 'UTC+2' },
  { name: '里约热内卢', lon: -43.2, lat: -22.9, country: '巴西', population: '673万', timezone: 'UTC-3' },
  { name: '布宜诺斯艾利斯', lon: -58.4, lat: -34.6, country: '阿根廷', population: '307万', timezone: 'UTC-3' },
  { name: '墨西哥城', lon: -99.1, lat: 19.4, country: '墨西哥', population: '921万', timezone: 'UTC-6' },
  { name: '洛杉矶', lon: -118.2, lat: 34.1, country: '美国', population: '398万', timezone: 'UTC-8' },
  { name: '芝加哥', lon: -87.6, lat: 41.9, country: '美国', population: '271万', timezone: 'UTC-6' },
  { name: '多伦多', lon: -79.4, lat: 43.7, country: '加拿大', population: '293万', timezone: 'UTC-5' },
  { name: '柏林', lon: 13.4, lat: 52.5, country: '德国', population: '364万', timezone: 'UTC+1' },
  { name: '罗马', lon: 12.5, lat: 41.9, country: '意大利', population: '287万', timezone: 'UTC+1' },
  { name: '马德里', lon: -3.7, lat: 40.4, country: '西班牙', population: '330万', timezone: 'UTC+1' },
  { name: '莫斯科', lon: 37.6, lat: 55.8, country: '俄罗斯', population: '1264万', timezone: 'UTC+3' },
  { name: '伊斯坦布尔', lon: 29.0, lat: 41.0, country: '土耳其', population: '1546万', timezone: 'UTC+3' },
];

/** 搜索城市：名称模糊匹配，返回前 N 条 */
export function searchCities(query: string, limit = 8): CityData[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return EXTENDED_CITIES
    .filter((c) => c.name.toLowerCase().includes(q) || c.country.toLowerCase().includes(q))
    .slice(0, limit);
}

// ============ 天气数据（Open-Meteo 免费接口） ============

export type OfflineMarker = { _offline?: boolean };

export interface WeatherData extends OfflineMarker {
  city: string;
  lon: number;
  lat: number;
  temp: number;
  weather: string;
  weatherCode: number;
  // Q4 扩展：按坐标取天气时返回风/湿度/气压（保持向后兼容，全部可选）
  wind?: number;       // km/h
  humidity?: number;   // %
  pressure?: number;   // hPa
}

export async function fetchWeather(city: CityData): Promise<WeatherData> {
  return fetchWeatherByCoord(city.lon, city.lat, city.name);
}

/** 按经纬度取天气（镜头中心/点击位置/任意坐标），可选指定显示名 */
export async function fetchWeatherByCoord(lon: number, lat: number, displayName = ''): Promise<WeatherData> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m,pressure_msl&timezone=auto`;
    const data = await apiCache.fetch<any>(url, { customTtlMs: TTL_10M });
    const temp = Math.round(data.current?.temperature_2m ?? 25);
    const code = data.current?.weather_code ?? 0;
    const result: WeatherData = {
      city: displayName || `${lon.toFixed(1)}, ${lat.toFixed(1)}`,
      lon,
      lat,
      temp,
      weather: weatherCodeToString(code),
      weatherCode: code,
    };
    const wind = data.current?.wind_speed_10m;
    const humidity = data.current?.relative_humidity_2m;
    const pressure = data.current?.pressure_msl;
    if (typeof wind === 'number') result.wind = Math.round(wind);
    if (typeof humidity === 'number') result.humidity = Math.round(humidity);
    if (typeof pressure === 'number') result.pressure = Math.round(pressure);
    return result;
  } catch {
    console.warn('[DataProvider] fetchWeatherByCoord failed');
    return {
      city: displayName || `${lon.toFixed(1)}, ${lat.toFixed(1)}`,
      lon,
      lat,
      temp: 25,
      weather: '离线',
      weatherCode: -1,
      _offline: true,
    };
  }
}

function weatherCodeToString(code: number): string {
  if (code === 0) return '晴';
  if (code >= 1 && code <= 3) return '多云';
  if (code === 45 || code === 48) return '雾';
  if (code >= 51 && code <= 57) return '毛毛雨';
  if (code >= 61 && code <= 67) return '雨';
  if (code >= 71 && code <= 77) return '雪';
  if (code >= 80 && code <= 82) return '阵雨';
  if (code >= 85 && code <= 86) return '阵雪';
  if (code >= 95) return '雷阵雨';
  return '晴';
}

// ============ 地震数据（USGS GeoJSON） ============

export interface EarthquakeData {
  id: string;
  lon: number;
  lat: number;
  depth: number;
  magnitude: number;
  place: string;
  time: string;
}

export async function fetchEarthquakes(minMagnitude = 4.5): Promise<EarthquakeData[]> {
  try {
    const url = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${minMagnitude}_month.geojson`;
    // 使用缓存：地震数据 1 小时 TTL
    const data = await apiCache.fetch<any>(url, { customTtlMs: TTL_1H });
    return (data.features ?? []).map((f: any) => ({
      id: f.id,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      depth: f.geometry.coordinates[2],
      magnitude: f.properties.mag,
      place: f.properties.place,
      time: new Date(f.properties.time).toISOString(),
    }));
  } catch {
    console.warn('[DataProvider] fetchEarthquakes failed');
    throw new Error('EarthquakeDataUnavailable');
  }
}

// ============ 自然事件（NASA EONET） ============

export interface NaturalEventData {
  id: string;
  title: string;
  category: string;
  lon: number;
  lat: number;
  date: string;
}

export async function fetchNaturalEvents(): Promise<NaturalEventData[]> {
  try {
    const url = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50';
    // 使用缓存：自然事件 1 小时 TTL
    const data = await apiCache.fetch<any>(url, { customTtlMs: TTL_1H });
    return (data.events ?? []).flatMap((e: any) => {
      const geometries = e.geometry ?? [];
      return geometries.map((g: any) => ({
        id: e.id,
        title: e.title,
        category: e.categories?.[0]?.title ?? '未知',
        lon: g.coordinates[0],
        lat: g.coordinates[1],
        date: g.date ?? e.id,
      }));
    });
  } catch {
    console.warn('[DataProvider] fetchNaturalEvents failed');
    throw new Error('NaturalEventsUnavailable');
  }
}

// ============ 数据源元信息 ============

export interface DataProviderInfo {
  id: DataProviderId;
  name: string;
  source: string;
  license: string;
  requiresNetwork: boolean;
  hasFallback: boolean;
}

export const DATA_PROVIDERS: DataProviderInfo[] = [
  { id: 'weather', name: '实时天气', source: 'Open-Meteo', license: 'CC BY 4.0', requiresNetwork: true, hasFallback: true },
  { id: 'earthquake', name: '地震数据', source: 'USGS', license: 'Public Domain', requiresNetwork: true, hasFallback: true },
  { id: 'natural-events', name: '自然事件', source: 'NASA EONET', license: 'Public Domain', requiresNetwork: true, hasFallback: true },
  { id: 'geocoding', name: '地名查询（经纬度→国家/城市）', source: 'Nominatim (OpenStreetMap)', license: 'ODbL 1.0', requiresNetwork: true, hasFallback: true },
  { id: 'cities', name: '城市数据', source: '预置', license: '内部', requiresNetwork: false, hasFallback: true },
  { id: 'gdp', name: 'GDP 数据', source: 'World Bank / 预置', license: 'CC BY 4.0', requiresNetwork: false, hasFallback: true },
  { id: 'population', name: '人口数据', source: '预置', license: '内部', requiresNetwork: false, hasFallback: true },
  { id: 'temperature', name: '温度数据', source: 'Open-Meteo Climate', license: 'CC BY 4.0', requiresNetwork: true, hasFallback: true },
  { id: 'precipitation', name: '降水数据', source: 'Open-Meteo Climate', license: 'CC BY 4.0', requiresNetwork: true, hasFallback: true },
  { id: 'plates', name: '板块边界', source: 'USGS / 预置', license: 'Public Domain', requiresNetwork: false, hasFallback: true },
  { id: 'rivers', name: '河流数据', source: 'Natural Earth / 预置', license: 'Public Domain', requiresNetwork: false, hasFallback: true },
];

// ============ GDP 数据（预置，回退用） ============

export interface GdpData {
  country: string;
  iso3: string;
  gdp: number;          // 万亿美元
  gdpPerCapita: number; // 万美元
}

const PRESET_GDP: GdpData[] = [
  { country: '中国', iso3: 'CHN', gdp: 17.96, gdpPerCapita: 1.27 },
  { country: '美国', iso3: 'USA', gdp: 27.36, gdpPerCapita: 8.16 },
  { country: '日本', iso3: 'JPN', gdp: 4.21, gdpPerCapita: 3.38 },
  { country: '德国', iso3: 'DEU', gdp: 4.46, gdpPerCapita: 5.27 },
  { country: '印度', iso3: 'IND', gdp: 3.55, gdpPerCapita: 0.25 },
  { country: '英国', iso3: 'GBR', gdp: 3.34, gdpPerCapita: 4.91 },
  { country: '法国', iso3: 'FRA', gdp: 3.03, gdpPerCapita: 4.44 },
  { country: '巴西', iso3: 'BRA', gdp: 2.17, gdpPerCapita: 1.00 },
  { country: '俄罗斯', iso3: 'RUS', gdp: 2.06, gdpPerCapita: 1.40 },
  { country: '澳大利亚', iso3: 'AUS', gdp: 1.69, gdpPerCapita: 6.45 },
];

export function getGdp(): GdpData[] {
  return PRESET_GDP;
}

// ============ 人口数据（预置） ============

export interface PopulationData {
  country: string;
  iso3: string;
  population: number; // 亿
  density: number;    // 人/平方公里
}

const PRESET_POPULATION: PopulationData[] = [
  { country: '中国', iso3: 'CHN', population: 14.1, density: 149 },
  { country: '印度', iso3: 'IND', population: 14.3, density: 481 },
  { country: '美国', iso3: 'USA', population: 3.34, density: 37 },
  { country: '印度尼西亚', iso3: 'IDN', population: 2.78, density: 151 },
  { country: '巴基斯坦', iso3: 'PAK', population: 2.40, density: 312 },
  { country: '尼日利亚', iso3: 'NGA', population: 2.23, density: 245 },
  { country: '巴西', iso3: 'BRA', population: 2.16, density: 25 },
  { country: '孟加拉国', iso3: 'BGD', population: 1.73, density: 1329 },
  { country: '俄罗斯', iso3: 'RUS', population: 1.44, density: 9 },
  { country: '日本', iso3: 'JPN', population: 1.24, density: 330 },
];

export function getPopulation(): PopulationData[] {
  return PRESET_POPULATION;
}

// ============ 温度数据（Open-Meteo Climate API） ============

export interface TemperatureData extends OfflineMarker {
  city: string;
  lon: number;
  lat: number;
  annualAvg: number;   // 年均温（℃）
  monthly: number[];   // 12 个月均温
}

export async function fetchTemperature(city: CityData): Promise<TemperatureData> {
  try {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${city.lat}&longitude=${city.lon}&start_date=2023-01-01&end_date=2023-12-31&monthly=temperature_2m_mean`;
    // 使用缓存：历史气温 24 小时 TTL（2023 年数据不变）
    const data = await apiCache.fetch<any>(url, { customTtlMs: TTL_24H });
    const monthly: number[] = data.monthly?.temperature_2m_mean ?? [];
    const valid = monthly.filter((v: number) => v != null && !isNaN(v));
    const avg = valid.length > 0 ? valid.reduce((a: number, b: number) => a + b, 0) / valid.length : 15;
    return {
      city: city.name, lon: city.lon, lat: city.lat,
      annualAvg: Math.round(avg * 10) / 10,
      monthly: monthly.map((v: number) => (v == null || isNaN(v) ? 0 : Math.round(v * 10) / 10)),
    };
  } catch {
    return { city: city.name, lon: city.lon, lat: city.lat, annualAvg: 15, monthly: [], _offline: true };
  }
}

// ============ 降水数据（Open-Meteo Climate API） ============

export interface PrecipitationData extends OfflineMarker {
  city: string;
  lon: number;
  lat: number;
  annualTotal: number; // 年降水（mm）
  monthly: number[];   // 12 个月降水
}

export async function fetchPrecipitation(city: CityData): Promise<PrecipitationData> {
  try {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${city.lat}&longitude=${city.lon}&start_date=2023-01-01&end_date=2023-12-31&monthly=precipitation_sum`;
    // 使用缓存：历史降水 24 小时 TTL（2023 年数据不变）
    const data = await apiCache.fetch<any>(url, { customTtlMs: TTL_24H });
    const monthly: number[] = data.monthly?.precipitation_sum ?? [];
    const total = monthly.filter((v: number) => v != null && !isNaN(v)).reduce((a: number, b: number) => a + b, 0);
    return {
      city: city.name, lon: city.lon, lat: city.lat,
      annualTotal: Math.round(total),
      monthly: monthly.map((v: number) => (v == null || isNaN(v) ? 0 : Math.round(v))),
    };
  } catch {
    return { city: city.name, lon: city.lon, lat: city.lat, annualTotal: 800, monthly: [], _offline: true };
  }
}

// ============ 板块边界数据（预置简化版） ============

export interface PlateBoundary {
  name: string;
  type: 'convergent' | 'divergent' | 'transform';
  coordinates: [number, number][]; // [lon, lat][]
}

/** 简化版六大板块边界（教学用，非精确地质数据） */
const PRESET_PLATES: PlateBoundary[] = [
  {
    name: '太平洋板块-欧亚板块',
    type: 'convergent',
    coordinates: [[140, 45], [145, 40], [148, 35], [145, 30], [140, 25], [130, 20]],
  },
  {
    name: '印度洋板块-欧亚板块',
    type: 'convergent',
    coordinates: [[60, 25], [70, 28], [80, 30], [90, 28], [100, 25]],
  },
  {
    name: '美洲板块-非洲板块（大西洋中脊）',
    type: 'divergent',
    coordinates: [[-30, 60], [-30, 50], [-30, 40], [-30, 30], [-25, 20], [-15, 10]],
  },
  {
    name: '太平洋板块-北美板块（圣安德烈斯断层）',
    type: 'transform',
    coordinates: [[-122, 38], [-120, 35], [-118, 33], [-115, 30]],
  },
  {
    name: '纳斯卡板块-南美板块',
    type: 'convergent',
    coordinates: [[-80, -5], [-78, -10], [-75, -15], [-72, -20], [-70, -25]],
  },
  {
    name: '非洲板块-欧亚板块（地中海）',
    type: 'convergent',
    coordinates: [[-5, 35], [5, 37], [15, 38], [25, 36], [35, 35]],
  },
];

export function getPlates(): PlateBoundary[] {
  return PRESET_PLATES;
}

// ============ 河流数据（预置简化版） ============

export interface RiverData {
  name: string;
  length: number;       // 公里
  basin: string;        // 流域
  coordinates: [number, number][]; // 简化流向
}

const PRESET_RIVERS: RiverData[] = [
  {
    name: '长江',
    length: 6300,
    basin: '长江流域',
    coordinates: [[91, 33], [100, 32], [110, 30], [115, 30], [121, 31]],
  },
  {
    name: '黄河',
    length: 5464,
    basin: '黄河流域',
    coordinates: [[96, 35], [103, 36], [110, 40], [115, 38], [119, 38]],
  },
  {
    name: '尼罗河',
    length: 6650,
    basin: '尼罗河流域',
    coordinates: [[29, -3], [31, 5], [32, 15], [31, 25], [31, 31]],
  },
  {
    name: '亚马逊河',
    length: 6400,
    basin: '亚马逊流域',
    coordinates: [[-75, -10], [-70, -5], [-65, -3], [-55, -2], [-50, 0]],
  },
  {
    name: '密西西比河',
    length: 3730,
    basin: '密西西比流域',
    coordinates: [[-93, 30], [-90, 33], [-90, 37], [-90, 41], [-92, 45]],
  },
];

export function getRivers(): RiverData[] {
  return PRESET_RIVERS;
}

// ============ 气候带数据（教学简化版） ============

export interface ClimateZone {
  name: string;
  minLat: number;
  maxLat: number;
  color: [number, number, number]; // RGB
  description: string;
}

/** 纬度气候带（教学简化，南北对称）
 *
 * 注意：寒带 maxLat 设为 89.9 而非 90，避免极点处所有经度重合导致
 * Cesium EllipsoidGeodesic 构造抛出 DeveloperError（夹角 < 0.0125 弧度）。
 * 视觉上 0.1° 差异不可感知。
 */
const PRESET_CLIMATE_ZONES: ClimateZone[] = [
  { name: '热带', minLat: -23.5, maxLat: 23.5, color: [239, 68, 68], description: '年均温 >20℃' },
  { name: '副热带', minLat: 23.5, maxLat: 35, color: [251, 146, 60], description: '夏热冬温' },
  { name: '温带', minLat: 35, maxLat: 55, color: [132, 204, 22], description: '四季分明' },
  { name: '亚寒带', minLat: 55, maxLat: 66.5, color: [56, 189, 248], description: '冬长夏短' },
  { name: '寒带', minLat: 66.5, maxLat: 89.9, color: [219, 234, 254], description: '终年低温' },
];

export function getClimateZones(): ClimateZone[] {
  // 返回南北半球对称的气候带
  const south = PRESET_CLIMATE_ZONES.map((z) => ({
    ...z,
    minLat: -z.maxLat,
    maxLat: -z.minLat,
  }));
  return [...PRESET_CLIMATE_ZONES, ...south];
}

// ============ 山脉数据（预置） ============

export interface MountainData {
  name: string;
  lon: number;
  lat: number;
  elevation: number; // 米
  range?: string;
}

const PRESET_MOUNTAINS: MountainData[] = [
  { name: '珠穆朗玛峰', lon: 86.9, lat: 27.9, elevation: 8849, range: '喜马拉雅山脉' },
  { name: '乔戈里峰', lon: 76.5, lat: 35.9, elevation: 8611, range: '喀喇昆仑山脉' },
  { name: '干城章嘉峰', lon: 88.1, lat: 27.7, elevation: 8586, range: '喜马拉雅山脉' },
  { name: '勃朗峰', lon: 6.9, lat: 45.8, elevation: 4810, range: '阿尔卑斯山脉' },
  { name: '马特洪峰', lon: 7.7, lat: 45.98, elevation: 4478, range: '阿尔卑斯山脉' },
  { name: '阿空加瓜山', lon: -70.0, lat: -32.7, elevation: 6961, range: '安第斯山脉' },
  { name: '钦博拉索山', lon: -78.8, lat: -1.5, elevation: 6263, range: '安第斯山脉' },
  { name: '麦金利山', lon: -151.0, lat: 63.1, elevation: 6190, range: '阿拉斯加山脉' },
  { name: '乞力马扎罗山', lon: 37.4, lat: -3.1, elevation: 5895, range: '东非高原' },
  { name: '富士山', lon: 138.7, lat: 35.4, elevation: 3776, range: '富士山' },
  { name: '玉山', lon: 120.9, lat: 23.5, elevation: 3952, range: '中央山脉' },
  { name: '贡嘎山', lon: 101.9, lat: 29.6, elevation: 7556, range: '横断山脉' },
  { name: '慕士塔格峰', lon: 75.1, lat: 38.3, elevation: 7546, range: '帕米尔高原' },
  { name: '汉科乌马峰', lon: -68.3, lat: -15.3, elevation: 6542, range: '安第斯山脉' },
];

export function getMountains(): MountainData[] {
  return PRESET_MOUNTAINS;
}

// ============ 洋流数据（预置简化版） ============

export interface OceanCurrentData {
  name: string;
  type: 'warm' | 'cold'; // 暖流 / 寒流
  coordinates: [number, number][]; // [lon, lat][]
  description: string;
}

const PRESET_OCEAN_CURRENTS: OceanCurrentData[] = [
  {
    name: '黑潮（日本暖流）',
    type: 'warm',
    coordinates: [[12, 14], [20, 22], [28, 30], [35, 33], [40, 35], [45, 40], [50, 45]],
    description: '北太平洋西部强暖流',
  },
  {
    name: '北太平洋暖流',
    type: 'warm',
    coordinates: [[50, 45], [140, 45], [180, 45], [-130, 48], [-125, 50]],
    description: '北太平洋中高纬暖流',
  },
  {
    name: '加利福尼亚寒流',
    type: 'cold',
    coordinates: [[-125, 50], [-125, 40], [-120, 35], [-115, 30], [-110, 25]],
    description: '北美西海岸寒流',
  },
  {
    name: '秘鲁寒流',
    type: 'cold',
    coordinates: [[-80, 5], [-80, -10], [-80, -25], [-80, -40], [-78, -50]],
    description: '南美西海岸寒流',
  },
  {
    name: '北大西洋暖流',
    type: 'warm',
    coordinates: [[-45, 40], [-30, 45], [-15, 50], [0, 55], [10, 60], [20, 65]],
    description: '欧洲西部温带海洋性气候成因',
  },
  {
    name: '墨西哥湾暖流',
    type: 'warm',
    coordinates: [[-85, 25], [-80, 30], [-70, 35], [-60, 38], [-50, 40]],
    description: '北大西洋西部强暖流',
  },
  {
    name: '拉布拉多寒流',
    type: 'cold',
    coordinates: [[-55, 60], [-55, 55], [-55, 50], [-50, 45]],
    description: '北大西洋西部寒流',
  },
  {
    name: '本格拉寒流',
    type: 'cold',
    coordinates: [[10, -5], [10, -15], [10, -25], [10, -35]],
    description: '非洲西海岸寒流',
  },
  {
    name: '巴西暖流',
    type: 'warm',
    coordinates: [[-40, -5], [-38, -15], [-38, -30], [-40, -40]],
    description: '南大西洋西部暖流',
  },
  {
    name: '莫桑比克暖流',
    type: 'warm',
    coordinates: [[40, -10], [40, -20], [40, -30], [42, -35]],
    description: '非洲东海岸暖流',
  },
  {
    name: '西风漂流',
    type: 'cold',
    coordinates: [[-60, -55], [-120, -55], [180, -55], [60, -55], [0, -55]],
    description: '南半球中高纬度寒流',
  },
  {
    name: '东澳大利亚暖流',
    type: 'warm',
    coordinates: [[155, -10], [155, -20], [155, -30], [158, -38]],
    description: '澳洲东海岸暖流',
  },
];

export function getOceanCurrents(): OceanCurrentData[] {
  return PRESET_OCEAN_CURRENTS;
}

// ============ 季风风向数据（预置） ============

export interface MonsoonWind {
  name: string;
  season: 'winter' | 'summer';
  coordinates: [number, number][]; // 风向路径 [lon, lat]
  description: string;
}

const PRESET_MONSOON_WINDS: MonsoonWind[] = [
  {
    name: '冬季风（西北季风）',
    season: 'winter',
    coordinates: [[110, 40], [115, 30], [118, 22]],
    description: '亚洲大陆→太平洋，干冷',
  },
  {
    name: '夏季风（东南季风）',
    season: 'summer',
    coordinates: [[140, 15], [130, 22], [120, 28], [115, 32]],
    description: '太平洋→亚洲大陆，暖湿',
  },
  {
    name: '西南季风',
    season: 'summer',
    coordinates: [[50, -10], [65, 5], [75, 15], [85, 22]],
    description: '印度洋→亚洲大陆，暖湿',
  },
  {
    name: '东北季风（南亚）',
    season: 'winter',
    coordinates: [[80, 30], [75, 18], [70, 8]],
    description: '亚洲大陆→印度洋，干冷',
  },
];

export function getMonsoonWinds(): MonsoonWind[] {
  return PRESET_MONSOON_WINDS;
}

// ============ 行政边界数据（预置简化版） ============

export interface AdminBoundary {
  name: string;
  coordinates: [number, number][]; // 简化边界
}

/** 主要国家简化边界（教学用，非精确国界） */
const PRESET_ADMIN_BOUNDS: AdminBoundary[] = [
  {
    name: '中国',
    coordinates: [[73, 39], [82, 45], [95, 48], [110, 50], [125, 48], [135, 45], [125, 40], [122, 35], [120, 30], [115, 22], [108, 18], [100, 22], [92, 28], [80, 30], [73, 39]],
  },
  {
    name: '美国',
    coordinates: [[-125, 48], [-120, 49], [-95, 49], [-83, 46], [-67, 45], [-75, 35], [-83, 30], [-95, 28], [-100, 26], [-115, 32], [-125, 40], [-125, 48]],
  },
  {
    name: '俄罗斯',
    coordinates: [[30, 60], [40, 65], [60, 70], [90, 72], [130, 72], [160, 68], [175, 65], [160, 60], [140, 58], [120, 55], [100, 55], [60, 55], [40, 55], [30, 60]],
  },
  {
    name: '印度',
    coordinates: [[68, 24], [72, 20], [78, 10], [82, 8], [88, 20], [92, 22], [88, 27], [82, 28], [76, 28], [70, 26], [68, 24]],
  },
  {
    name: '巴西',
    coordinates: [[-73, 5], [-60, 5], [-50, 0], [-35, -8], [-35, -22], [-50, -33], [-58, -33], [-65, -22], [-70, -10], [-73, 5]],
  },
  {
    name: '澳大利亚',
    coordinates: [[114, -22], [125, -14], [135, -12], [145, -15], [153, -25], [150, -35], [140, -38], [130, -32], [118, -34], [114, -22]],
  },
];

export function getAdminBounds(): AdminBoundary[] {
  return PRESET_ADMIN_BOUNDS;
}

// ============ Nominatim 反向地理编码（OSM 免费服务，CC0 + ODbL 回退） ============

export interface ReverseGeocodeResult {
  country: string;
  state?: string;
  county?: string;
  city?: string;
  suburb?: string;
  village?: string;
  postcode?: string;
  timezone: string;
  displayName: string;
  /** 是否命中离线回退（预置城市），方便 UI 打标 */
  fallback: boolean;
}

/**
 * 反向地理编码：经纬度 → 国家/州/城市 + 时区
 * 调用链（3 层降级，确保课堂不中断）：
 *   Layer 1: 本地 FastAPI /api/geocoding/reverse（128-entry × 300s TTL + Nominatim 代理，推荐）
 *   Layer 2: 直连 Nominatim OpenStreetMap（公开 CORS，1rps 限流）
 *   Layer 3: EXTENDED_CITIES 内最近的城市（Haversine 最近邻，完全离线）
 */
export async function reverseGeocode(lon: number, lat: number): Promise<ReverseGeocodeResult> {
  // ---- Layer 1: FastAPI 同源代理（优先：带缓存 + 不限流 + 中文友好）----
  try {
    const url = `/api/geocoding/reverse?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}&lang=zh-CN&zoom=14`;
    const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(4000) });
    if (resp.ok) {
      const data = await resp.json();
      if (data?.ok && (data.name || data.display_name || data.address)) {
        const addr: Record<string, string> = (data.address as Record<string, string>) || {};
        const displayName: string = data.display_name || data.name || '';
        const country = addr.country || '';
        const timezone = (() => {
          const hours = Math.round(lon / 15);
          const sign = hours >= 0 ? '+' : '';
          return `UTC${sign}${hours}`;
        })();
        return {
          country,
          state: addr.state,
          county: addr.county || addr.district,
          city: addr.city || addr.town || addr.municipality,
          suburb: addr.suburb || addr.district,
          village: addr.village || addr.hamlet,
          postcode: addr.road ? undefined : (addr.postcode || undefined),
          timezone,
          displayName,
          fallback: false,
        };
      }
    }
  } catch {
    // Layer 1 失败（FastAPI 未启动 / 网络不通）→ 静默进入 Layer 2
  }

  // ---- Layer 2: 直连 Nominatim OpenStreetMap ----
  try {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      format: 'jsonv2',
      zoom: '10',
      addressdetails: '1',
      accept_language: 'zh-CN,en;q=0.5',
    });
    const url = `https://nominatim.openstreetmap.org/reverse?${params.toString()}`;
    const data = await apiCache.fetch<any>(url, { customTtlMs: TTL_24H });
    const addr: Record<string, string> = data?.address ?? {};
    const displayName: string = data?.display_name ?? '';

    const country =
      addr.country ||
      addr['ISO3166-2-lvl4']?.split('-')[0] ||
      '';
    const timezone = (() => {
      const hours = Math.round(lon / 15);
      const sign = hours >= 0 ? '+' : '';
      return `UTC${sign}${hours}`;
    })();

    return {
      country,
      state: addr.state,
      county: addr.county,
      city: addr.city || addr.town || addr.municipality,
      suburb: addr.suburb || addr.neighbourhood,
      village: addr.village || addr.hamlet,
      postcode: addr.postcode,
      timezone,
      displayName,
      fallback: false,
    };
  } catch {
    // ---- Layer 3: 离线最近邻城市（Haversine）----
    const fallback = findNearestCity(lon, lat);
    return {
      country: fallback.country,
      city: fallback.name,
      timezone: fallback.timezone ?? 'UTC+0',
      displayName: `${fallback.name}, ${fallback.country}（离线最近邻）`,
      fallback: true,
    };
  }
}

function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function findNearestCity(lon: number, lat: number): CityData {
  let best = EXTENDED_CITIES[0];
  let bestD = Number.POSITIVE_INFINITY;
  for (const c of EXTENDED_CITIES) {
    const d = haversineKm(lon, lat, c.lon, c.lat);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}
