/**
 * 命令 Schema 校验单元测试
 *
 * 验证：AI 工具调用的白名单协议、参数类型、数值范围、枚举值校验
 */
import { describe, it, expect } from 'vitest';
import { validateToolCall, TOOL_NAMES, TOOL_SCHEMAS, ToolName } from '../src/commands/schema';

describe('TOOL_NAMES 白名单', () => {
  it('应包含课程控制、镜头、视图、图层、测量、动画、问题、解释、撤销等命令', () => {
    const required = [
      'lesson.open', 'lesson.advance', 'lesson.pause', 'lesson.resume',
      'camera.flyTo', 'camera.reset', 'camera.orbit',
      'view.setMode', 'view.setBasemap',
      'layer.toggle', 'layer.showContour', 'layer.showElevationRamp',
      'measure.start', 'measure.clear',
      'animation.play', 'animation.pause', 'animation.setSpeed',
      'undo',
    ];
    for (const name of required) {
      expect(TOOL_NAMES).toContain(name);
    }
  });

  it('每个工具都有对应的 Schema 定义', () => {
    for (const name of TOOL_NAMES) {
      expect(TOOL_SCHEMAS[name]).toBeDefined();
    }
  });
});

describe('validateToolCall 参数校验', () => {
  it('未知工具返回 TOOL_NOT_AVAILABLE', () => {
    const result = validateToolCall({
      name: 'unknown.tool' as ToolName,
      args: {},
    });
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (!result!.ok) {
      expect(result!.code).toBe('TOOL_NOT_AVAILABLE');
    }
  });

  it('camera.flyTo 缺少必填参数 longitude 返回 INVALID_ARGS', () => {
    const result = validateToolCall({
      name: 'camera.flyTo',
      args: { latitude: 30 },
    });
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (!result!.ok) {
      expect(result!.code).toBe('INVALID_ARGS');
      expect(result!.error).toContain('longitude');
    }
  });

  it('camera.flyTo 经度越界返回 OUT_OF_RANGE', () => {
    const result = validateToolCall({
      name: 'camera.flyTo',
      args: { longitude: 200, latitude: 30, height: 1000000 },
    });
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (!result!.ok) {
      expect(result!.code).toBe('OUT_OF_RANGE');
    }
  });

  it('camera.flyTo 纬度小于 -90 返回 OUT_OF_RANGE', () => {
    const result = validateToolCall({
      name: 'camera.flyTo',
      args: { longitude: 116, latitude: -95, height: 1000000 },
    });
    expect(result!.ok).toBe(false);
    if (!result!.ok) {
      expect(result!.code).toBe('OUT_OF_RANGE');
    }
  });

  it('camera.flyTo 合法参数返回 null（通过）', () => {
    const result = validateToolCall({
      name: 'camera.flyTo',
      args: { longitude: 116.4, latitude: 39.9, height: 500000, duration: 2.5 },
    });
    expect(result).toBeNull();
  });

  it('view.setMode 非法枚举值返回 INVALID_ARGS', () => {
    const result = validateToolCall({
      name: 'view.setMode',
      args: { mode: '4d' },
    });
    expect(result!.ok).toBe(false);
    if (!result!.ok) {
      expect(result!.code).toBe('INVALID_ARGS');
    }
  });

  it('view.setMode 合法枚举 2d/3d/columbus 通过', () => {
    for (const mode of ['2d', '3d', 'columbus'] as const) {
      const result = validateToolCall({
        name: 'view.setMode',
        args: { mode },
      });
      expect(result).toBeNull();
    }
  });

  it('terrain.setExaggeration 倍数超出范围返回 OUT_OF_RANGE', () => {
    expect(validateToolCall({ name: 'terrain.setExaggeration', args: { value: 0.1 } })!.ok).toBe(false);
    expect(validateToolCall({ name: 'terrain.setExaggeration', args: { value: 20 } })!.ok).toBe(false);
  });

  it('terrain.setExaggeration 合法倍数通过', () => {
    expect(validateToolCall({ name: 'terrain.setExaggeration', args: { value: 2 } })).toBeNull();
    expect(validateToolCall({ name: 'terrain.setExaggeration', args: { value: 5 } })).toBeNull();
  });

  it('layer.toggle 图层名不在枚举中返回 INVALID_ARGS', () => {
    const result = validateToolCall({
      name: 'layer.toggle',
      args: { layer: 'nonexistent' },
    });
    expect(result!.ok).toBe(false);
    if (!result!.ok) {
      expect(result!.code).toBe('INVALID_ARGS');
    }
  });

  it('layer.toggle 合法图层名通过', () => {
    const result = validateToolCall({
      name: 'layer.toggle',
      args: { layer: 'graticule', visible: true },
    });
    expect(result).toBeNull();
  });

  it('lesson.open 缺少 lessonId 返回 INVALID_ARGS', () => {
    const result = validateToolCall({ name: 'lesson.open', args: {} });
    expect(result!.ok).toBe(false);
    if (!result!.ok) {
      expect(result!.code).toBe('INVALID_ARGS');
    }
  });

  it('参数类型错误（number 传 string）返回 INVALID_ARGS', () => {
    const result = validateToolCall({
      name: 'camera.flyTo',
      args: { longitude: '116', latitude: 39.9 },
    });
    expect(result!.ok).toBe(false);
    if (!result!.ok) {
      expect(result!.code).toBe('INVALID_ARGS');
    }
  });

  it('camera.screenshot 无参数通过（filename 可选）', () => {
    expect(validateToolCall({ name: 'camera.screenshot', args: {} })).toBeNull();
  });

  it('camera.screenshot 带 filename 通过', () => {
    expect(validateToolCall({ name: 'camera.screenshot', args: { filename: 'lesson-1.png' } })).toBeNull();
  });

  it('camera.screenshot filename 类型错误返回 INVALID_ARGS', () => {
    const result = validateToolCall({
      name: 'camera.screenshot',
      args: { filename: 123 },
    });
    expect(result!.ok).toBe(false);
    if (!result!.ok) {
      expect(result!.code).toBe('INVALID_ARGS');
    }
  });

  it('camera.screenshot 已加入 TOOL_NAMES 白名单', () => {
    expect(TOOL_NAMES).toContain('camera.screenshot');
  });
});

describe('safeJSONParse 三级容错（sanitize.ts)', () => {
  it('L1 标准 JSON 直接解析', async () => {
    const { safeJSONParse } = await import('../src/ui/sanitize');
    expect(safeJSONParse<{ reply: string }>('{"reply":"你好"}')?.reply).toBe('你好');
  });
  it('L2 被多余 prose 包裹的片段抽取', async () => {
    const { safeJSONParse } = await import('../src/ui/sanitize');
    const txt = '好的，回复你  { "reply": "收到" , "commands": [{"name":"camera.flyTo"}]  } 完毕';
    const r = safeJSONParse<{ reply?: string; commands?: unknown[] }>(txt);
    expect(r?.reply).toBe('收到');
    expect(r?.commands ?? []).toHaveLength(1);
  });
  it('L3 仅 reply 字段抽取兜底', async () => {
    const { safeJSONParse } = await import('../src/ui/sanitize');
    const txt = '这不是json 但是有"reply":"只看见这个就行"xxx';
    const r = safeJSONParse<{ reply?: string; commands?: unknown[] }>(txt);
    expect(r?.reply).toBe('只看见这个就行');
    expect(r?.commands ?? []).toHaveLength(0);
  });
  it('完全无 JSON 无 reply 返回 null', async () => {
    const { safeJSONParse } = await import('../src/ui/sanitize');
    expect(safeJSONParse('hello world')).toBeNull();
    expect(safeJSONParse('')).toBeNull();
    expect(safeJSONParse(null)).toBeNull();
  });
});
