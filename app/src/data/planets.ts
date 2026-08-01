/**
 * Planet Data —— 太阳系行星真实天文数据
 *
 * 数据来源：NASA Planetary Fact Sheet（公开领域）
 * 距离单位：天文单位 AU（1 AU ≈ 1.496×10^8 km）
 * 半径单位：公里
 * 质量单位：千克
 * 公转周期：年（地球年）
 * 自转周期：天（地球天，负值表示逆向自转）
 * 偏心率：椭圆轨道离心率
 * 倾角：自转轴倾角（度）
 *
 * 迁移自 src/engines/concept/solar-system.js，补充质量字段。
 */

export type PlanetType = 'rocky' | 'gas' | 'ice';

export interface PlanetData {
  id: string;
  name: string;
  /** 赤道半径（公里） */
  radius: number;
  /** 质量（千克） */
  mass: number;
  /** 半长轴（AU） */
  distance: number;
  /** 公转周期（年） */
  period: number;
  /** 自转周期（天，负值表示逆向自转） */
  dayLength: number;
  /** 轨道偏心率 */
  eccentricity: number;
  /** 自转轴倾角（度） */
  tilt: number;
  /** 主色调（十六进制） */
  color: number;
  /** 行星类型 */
  type: PlanetType;
  /** 气态行星条纹 */
  bands?: boolean;
  /** 土星环 */
  rings?: boolean;
}

/**
 * 八大行星真实数据
 * 质量数据来源：NASA Planetary Fact Sheet
 */
export const PLANET_DATA: PlanetData[] = [
  { id: 'mercury', name: '水星', radius: 2440,  mass: 3.30e23, distance: 0.39,  period: 0.24,   dayLength: 58.6,  eccentricity: 0.206, tilt: 0.03, color: 0x9c8b7a, type: 'rocky' },
  { id: 'venus',   name: '金星', radius: 6052,  mass: 4.87e24, distance: 0.72,  period: 0.62,   dayLength: -243,  eccentricity: 0.007, tilt: 177,  color: 0xe6c87a, type: 'rocky' },
  { id: 'earth',   name: '地球', radius: 6371,  mass: 5.97e24, distance: 1.00,  period: 1.00,   dayLength: 1.00,  eccentricity: 0.017, tilt: 23.5, color: 0x2a6fb8, type: 'rocky' },
  { id: 'mars',    name: '火星', radius: 3390,  mass: 6.42e23, distance: 1.52,  period: 1.88,   dayLength: 1.03,  eccentricity: 0.093, tilt: 25.2, color: 0xc1440e, type: 'rocky' },
  { id: 'jupiter', name: '木星', radius: 69911, mass: 1.90e27, distance: 5.20,  period: 11.86,  dayLength: 0.41,  eccentricity: 0.048, tilt: 3.1,  color: 0xd4a574, type: 'gas', bands: true },
  { id: 'saturn',  name: '土星', radius: 58232, mass: 5.68e26, distance: 9.58,  period: 29.46,  dayLength: 0.45,  eccentricity: 0.054, tilt: 26.7, color: 0xf4d59e, type: 'gas', rings: true },
  { id: 'uranus',  name: '天王星', radius: 25362, mass: 8.68e25, distance: 19.22, period: 84.01,  dayLength: -0.72, eccentricity: 0.047, tilt: 97.8, color: 0x9fd3d3, type: 'ice' },
  { id: 'neptune', name: '海王星', radius: 24622, mass: 1.02e26, distance: 30.05, period: 164.8,  dayLength: 0.67,  eccentricity: 0.009, tilt: 28.3, color: 0x4a67c6, type: 'ice' },
];

/** 太阳数据 */
export const SUN_DATA = {
  id: 'sun',
  name: '太阳',
  /** 半径（公里） */
  radius: 696340,
  /** 质量（千克） */
  mass: 1.989e30,
  /** 表面温度（K） */
  surfaceTemp: 5778,
} as const;

/** 缩放参数：行星半径开方压缩（保证可见性），距离线性缩放 */
export const SCALE_FACTORS = {
  SUN_SCALE: 4,
  DISTANCE_SCALE: 6,
  RADIUS_SCALE: 0.0008,
} as const;

/** 根据真实数据计算场景中缩放后的行星半径 */
export function scaledRadius(radiusKm: number): number {
  return Math.max(0.3, Math.sqrt(radiusKm * SCALE_FACTORS.RADIUS_SCALE));
}

/** 根据真实数据计算场景中缩放后的轨道半长轴 */
export function scaledDistance(distanceAU: number): number {
  return distanceAU * SCALE_FACTORS.DISTANCE_SCALE + SCALE_FACTORS.SUN_SCALE + 2;
}

/** 根据 id 查询行星 */
export function getPlanetById(id: string): PlanetData | undefined {
  return PLANET_DATA.find((p) => p.id === id);
}
