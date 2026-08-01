/**
 * 太阳系模块测试
 *
 * 覆盖：
 * 1. 行星数据完整性（NASA Planetary Fact Sheet 来源校验）
 * 2. 缩放函数（scaledRadius / scaledDistance）边界
 * 3. solarSystemActive 状态管理
 * 4. view.showSolarSystem / view.showEarth 命令经统一 Command Bus
 * 5. Scene Orchestrator 不变量：solarSystemActive 为单一布尔字段
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  PLANET_DATA,
  SUN_DATA,
  SCALE_FACTORS,
  scaledRadius,
  scaledDistance,
  getPlanetById,
} from '../src/data/planets';
import { useGeographyStore } from '../src/state/store';
import { commandBus, registerCommandHandlers } from '../src/commands/bus';
import { TOOL_NAMES } from '../src/commands/schema';

describe('行星数据完整性', () => {
  it('包含 8 大行星', () => {
    expect(PLANET_DATA).toHaveLength(8);
    const ids = PLANET_DATA.map((p) => p.id);
    expect(ids).toEqual([
      'mercury', 'venus', 'earth', 'mars',
      'jupiter', 'saturn', 'uranus', 'neptune',
    ]);
  });

  it('每颗行星都有完整必填字段', () => {
    for (const p of PLANET_DATA) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.radius).toBeGreaterThan(1000);
      expect(p.mass).toBeGreaterThan(1e22);
      expect(p.distance).toBeGreaterThan(0);
      expect(p.period).toBeGreaterThan(0);
      expect(p.dayLength).not.toBe(0);
      expect(p.eccentricity).toBeGreaterThanOrEqual(0);
      expect(p.eccentricity).toBeLessThan(1);
      expect(p.tilt).toBeGreaterThanOrEqual(0);
      expect(p.color).toBeGreaterThan(0);
    }
  });

  it('金星和天王星逆向自转（dayLength 为负）', () => {
    const venus = getPlanetById('venus')!;
    const uranus = getPlanetById('uranus')!;
    expect(venus.dayLength).toBeLessThan(0);
    expect(uranus.dayLength).toBeLessThan(0);
  });

  it('地球数据与 NASA Fact Sheet 一致', () => {
    const earth = getPlanetById('earth')!;
    expect(earth.radius).toBe(6371);
    expect(earth.distance).toBe(1.0);
    expect(earth.period).toBe(1.0);
    expect(earth.dayLength).toBe(1.0);
    expect(earth.tilt).toBeCloseTo(23.5);
    expect(earth.eccentricity).toBeCloseTo(0.017, 3);
  });

  it('土星有环标记，木星有条纹标记', () => {
    expect(getPlanetById('saturn')!.rings).toBe(true);
    expect(getPlanetById('jupiter')!.bands).toBe(true);
  });

  it('太阳数据完整', () => {
    expect(SUN_DATA.id).toBe('sun');
    expect(SUN_DATA.radius).toBe(696340);
    expect(SUN_DATA.mass).toBeCloseTo(1.989e30);
    expect(SUN_DATA.surfaceTemp).toBe(5778);
  });

  it('公转周期随距离递增（开普勒第三定律近似）', () => {
    for (let i = 1; i < PLANET_DATA.length; i++) {
      const prev = PLANET_DATA[i - 1];
      const curr = PLANET_DATA[i];
      expect(curr.distance).toBeGreaterThan(prev.distance);
      expect(curr.period).toBeGreaterThan(prev.period);
    }
  });
});

describe('缩放函数', () => {
  it('scaledRadius 不小于下限 0.3', () => {
    expect(scaledRadius(1)).toBe(0.3);
    expect(scaledRadius(2440)).toBeGreaterThanOrEqual(0.3);
  });

  it('scaledRadius 开方压缩：大行星不会过大', () => {
    const mercury = scaledRadius(2440);
    const jupiter = scaledRadius(69911);
    // 木星实际半径约 28.6 倍水星，开方压缩后差距应显著缩小
    expect(jupiter / mercury).toBeLessThan(6);
  });

  it('scaledDistance 线性缩放 + 太阳半径偏移', () => {
    const d = scaledDistance(1.0); // 地球 1 AU
    expect(d).toBe(1.0 * SCALE_FACTORS.DISTANCE_SCALE + SCALE_FACTORS.SUN_SCALE + 2);
  });

  it('scaledDistance 随 AU 递增', () => {
    const earth = scaledDistance(1.0);
    const neptune = scaledDistance(30.05);
    expect(neptune).toBeGreaterThan(earth);
  });

  it('getPlanetById 返回 undefined 表示未找到', () => {
    expect(getPlanetById('pluto')).toBeUndefined();
  });
});

describe('solarSystemActive 状态', () => {
  beforeEach(() => {
    useGeographyStore.getState().reset();
  });

  it('初始为 false（地球视图）', () => {
    expect(useGeographyStore.getState().solarSystemActive).toBe(false);
  });

  it('setSolarSystemActive 切换状态', () => {
    useGeographyStore.getState().setSolarSystemActive(true);
    expect(useGeographyStore.getState().solarSystemActive).toBe(true);
    useGeographyStore.getState().setSolarSystemActive(false);
    expect(useGeographyStore.getState().solarSystemActive).toBe(false);
  });

  it('reset 恢复为 false', () => {
    useGeographyStore.getState().setSolarSystemActive(true);
    useGeographyStore.getState().reset();
    expect(useGeographyStore.getState().solarSystemActive).toBe(false);
  });
});

describe('太阳系命令经统一 Command Bus', () => {
  beforeEach(() => {
    useGeographyStore.getState().reset();
    registerCommandHandlers();
  });

  it('view.showSolarSystem 和 view.showEarth 在工具白名单中', () => {
    expect(TOOL_NAMES).toContain('view.showSolarSystem');
    expect(TOOL_NAMES).toContain('view.showEarth');
  });

  it('view.showSolarSystem 设置 solarSystemActive=true', async () => {
    expect(useGeographyStore.getState().solarSystemActive).toBe(false);
    const result = await commandBus.execute({
      name: 'view.showSolarSystem',
      args: {},
    });
    expect(result.ok).toBe(true);
    expect(useGeographyStore.getState().solarSystemActive).toBe(true);
  });

  it('view.showEarth 设置 solarSystemActive=false', async () => {
    // 先激活太阳系
    useGeographyStore.getState().setSolarSystemActive(true);
    const result = await commandBus.execute({
      name: 'view.showEarth',
      args: {},
    });
    expect(result.ok).toBe(true);
    expect(useGeographyStore.getState().solarSystemActive).toBe(false);
  });

  it('切换命令返回成功消息', async () => {
    const r1 = await commandBus.execute({ name: 'view.showSolarSystem', args: {} });
    if (r1.ok) {
      expect(r1.message).toContain('太阳系');
    }
    const r2 = await commandBus.execute({ name: 'view.showEarth', args: {} });
    if (r2.ok) {
      expect(r2.message).toContain('地球');
    }
  });

  it('按钮点击与 AI 调用同一命令更新同一状态（单一总线）', async () => {
    // 模拟按钮点击
    await commandBus.execute({ name: 'view.showSolarSystem', args: {} });
    expect(useGeographyStore.getState().solarSystemActive).toBe(true);

    useGeographyStore.getState().setSolarSystemActive(false);

    // 模拟 AI 语音指令（经 LLM 解析后调用同一命令）
    await commandBus.execute({ name: 'view.showSolarSystem', args: {} });
    expect(useGeographyStore.getState().solarSystemActive).toBe(true);
  });
});
