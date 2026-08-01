/**
 * 行星纹理加载器 —— 真实纹理优先，程序化纹理回退
 *
 * 数据源：Solar System Scope（CC BY 4.0，基于 NASA 影像）
 * 下载地址：https://www.solarsystemscope.com/textures/
 *
 * 回退策略（符合 AGENTS.md "回退优先"原则）：
 * 1. 尝试从 /textures/planets/<id>.jpg 加载真实纹理
 * 2. 加载失败（文件不存在/网络错误）→ 程序化 Canvas 纹理
 * 3. 课堂不因纹理缺失而中断
 */

import * as THREE from 'three';
import { PlanetData } from '../data/planets';

/** 纹理文件基础路径（Vite public 目录） */
const TEXTURE_BASE = '/textures/planets/';

/** 行星 id → 纹理文件名映射（Solar System Scope 命名） */
const TEXTURE_FILES: Record<string, string> = {
  mercury: '2k_mercury.jpg',
  venus: '2k_venus_surface.jpg',
  earth: '2k_earth_daymap.jpg',
  mars: '2k_mars.jpg',
  jupiter: '2k_jupiter.jpg',
  saturn: '2k_saturn.jpg',
  uranus: '2k_uranus.jpg',
  neptune: '2k_neptune.jpg',
};

/** 太阳纹理 */
const SUN_TEXTURE = '2k_sun.jpg';

/** 月球纹理 */
const MOON_TEXTURE = '2k_moon.jpg';

/** 土星环纹理（带 alpha） */
const SATURN_RING_TEXTURE = '2k_saturn_ring_alpha.png';

/** 星空背景纹理 */
const STARS_TEXTURE = '2k_stars.jpg';

const textureLoader = new THREE.TextureLoader();

/**
 * 尝试加载真实行星纹理，失败回退到程序化纹理
 *
 * @param planet 行星数据（用于程序化回退）
 * @param fallback 程序化纹理生成函数
 */
export async function loadPlanetTexture(
  planet: PlanetData,
  fallback: (planet: PlanetData) => THREE.Texture,
): Promise<THREE.Texture> {
  const filename = TEXTURE_FILES[planet.id];
  if (!filename) {
    return fallback(planet);
  }
  try {
    const texture = await textureLoader.loadAsync(TEXTURE_BASE + filename);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  } catch {
    // 纹理文件不存在或加载失败 → 程序化回退
    return fallback(planet);
  }
}

/** 加载太阳纹理，失败回退到纯色 */
export async function loadSunTexture(
  fallbackColor: number,
): Promise<THREE.Texture> {
  try {
    const texture = await textureLoader.loadAsync(TEXTURE_BASE + SUN_TEXTURE);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  } catch {
    // 回退：1x1 像素纯色纹理
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = `#${fallbackColor.toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, 1, 1);
    return new THREE.CanvasTexture(canvas);
  }
}

/** 加载月球纹理，失败回退到程序化 */
export async function loadMoonTexture(): Promise<THREE.Texture | null> {
  try {
    const texture = await textureLoader.loadAsync(TEXTURE_BASE + MOON_TEXTURE);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  } catch {
    return null; // 回退：不显示月球或用程序化
  }
}

/** 加载土星环纹理，失败回退到程序化 */
export async function loadSaturnRingTexture(
  fallback: () => THREE.Texture,
): Promise<THREE.Texture> {
  try {
    const texture = await textureLoader.loadAsync(TEXTURE_BASE + SATURN_RING_TEXTURE);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  } catch {
    return fallback();
  }
}

/** 加载星空背景纹理，失败返回 null（用纯色背景） */
export async function loadStarsTexture(): Promise<THREE.Texture | null> {
  try {
    const texture = await textureLoader.loadAsync(TEXTURE_BASE + STARS_TEXTURE);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.mapping = THREE.EquirectangularReflectionMapping;
    return texture;
  } catch {
    return null;
  }
}
