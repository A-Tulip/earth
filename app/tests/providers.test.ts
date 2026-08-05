import { describe, expect, it } from 'vitest';
import { searchCities, getCities } from '../src/data/providers';

describe('城市搜索（issue #12 修复）', () => {
  it('返回预置城市列表', () => {
    expect(getCities().length).toBeGreaterThan(0);
    expect(getCities().some((c) => c.name === '北京')).toBe(true);
  });

  it('模糊匹配返回结果', () => {
    const hits = searchCities('北');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].name).toBe('北京');
  });

  it('能搜索到南昌（此前缺失导致 issue #12）', () => {
    const hits = searchCities('南昌');
    expect(hits.length).toBe(1);
    expect(hits[0].name).toBe('南昌');
    expect(hits[0].lon).toBeCloseTo(115.9, 1);
    expect(hits[0].lat).toBeCloseTo(28.7, 1);
  });

  it('空查询返回空数组', () => {
    expect(searchCities('   ')).toEqual([]);
  });
});