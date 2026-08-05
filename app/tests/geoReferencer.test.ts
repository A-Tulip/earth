/**
 * geoReferencer 地名引用单元测试
 *
 * 验证：
 *  1. 典型地貌（丹霞/喀斯特/雅丹/峡谷/火山/冰川/三角洲）能被 findFirstMention 命中
 *  2. 别名命中（如"魔鬼城"→雅丹）
 *  3. 长名优先匹配，避免子串误命中
 *  4. lookupGeoName 直接查询
 */
import { describe, it, expect } from 'vitest';
import { findFirstMention, lookupGeoName, GEO_REFERENCES } from '../src/lessons/geoReferencer';

describe('geoReferencer 典型地貌', () => {
  it('包含足够的典型地貌词条（≥18 条 landform）', () => {
    const landforms = GEO_REFERENCES.filter((e) => e.kind === 'landform');
    expect(landforms.length).toBeGreaterThanOrEqual(18);
  });

  it('旁白提到"丹霞地貌"时命中丹霞山', () => {
    const hit = findFirstMention('今天我们看丹霞地貌的红色陡崖');
    expect(hit?.name).toBe('丹霞山');
    expect(hit?.kind).toBe('landform');
  });

  it('旁白提到"桂林喀斯特"时命中桂林（喀斯特地貌别名）', () => {
    const hit = findFirstMention('桂林喀斯特地貌的峰林与溶洞');
    expect(hit?.name).toBe('桂林');
  });

  it('旁白提到"魔鬼城"时命中雅丹地貌（别名）', () => {
    const hit = findFirstMention('新疆的魔鬼城是风力侵蚀形成的');
    expect(hit?.name).toBe('雅丹地貌');
  });

  it('旁白提到"雅鲁藏布大峡谷"时命中峡谷（不误命中科罗拉多）', () => {
    const hit = findFirstMention('雅鲁藏布大峡谷是世界最大峡谷');
    expect(hit?.name).toBe('雅鲁藏布大峡谷');
  });

  it('旁白提到"火山"对应长白山天池的"火山湖"别名', () => {
    const hit = findFirstMention('长白山天池是一座火山湖');
    expect(hit?.name).toBe('长白山天池');
  });

  it('旁白提到"绒布冰川"时命中冰川地貌', () => {
    const hit = findFirstMention('珠峰脚下的绒布冰川塑造了冰塔林');
    expect(hit?.name).toBe('珠穆朗玛绒布冰川');
  });

  it('长名优先：提到"长江三角洲"应命中"长三角"别名而非"长江"', () => {
    const hit = findFirstMention('长江三角洲是中国经济最发达的地区之一');
    // 长名优先：长江三角洲(5字) > 长江(2字)
    expect(hit?.name).toBe('长江三角洲');
  });

  it('lookupGeoName 直接按主名/别名查询', () => {
    expect(lookupGeoName('丹霞山')?.kind).toBe('landform');
    expect(lookupGeoName('魔鬼城')?.name).toBe('雅丹地貌');
    expect(lookupGeoName('不存在的名字')).toBeNull();
  });
});