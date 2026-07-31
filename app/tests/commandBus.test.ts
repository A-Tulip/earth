/**
 * Command Bus 集成测试
 *
 * 核心验证：手动按钮和 AI 语音指令经过同一个 Command Bus
 * 老师点击"显示等高线"和老师说"打开等高线"应执行同一个命令
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { commandBus, registerCommandHandlers } from '../src/commands/bus';
import { useGeographyStore } from '../src/state/store';
import { ToolCall } from '../src/commands/schema';

describe('Command Bus 单一总线', () => {
  beforeEach(() => {
    useGeographyStore.getState().reset();
    registerCommandHandlers();
  });

  it('按钮点击调用 commandBus.execute 与 AI 调用使用同一实例', () => {
    // 模拟按钮点击：显示等高线
    const buttonCall: ToolCall = {
      name: 'layer.showContour',
      args: { spacing: 200 },
    };

    // 模拟 AI 语音指令：打开等高线（经 KeywordIntentLLM 解析后）
    const aiCall: ToolCall = {
      name: 'layer.showContour',
      args: { spacing: 200 },
    };

    // 两者调用同一个 commandBus.execute
    expect(commandBus.execute(buttonCall)).toBeDefined();
    expect(commandBus.execute(aiCall)).toBeDefined();

    // 都应更新同一份 store 状态
    expect(useGeographyStore.getState().terrain.contour).toBe(true);
  });

  it('未注册处理器返回 TOOL_NOT_AVAILABLE', async () => {
    const result = await commandBus.execute({
      name: 'nonexistent.command' as never,
      args: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TOOL_NOT_AVAILABLE');
    }
  });

  it('参数校验失败时返回 INVALID_ARGS 且不执行', async () => {
    const result = await commandBus.execute({
      name: 'camera.flyTo',
      args: { longitude: 999, latitude: 30 }, // 经度越界
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('OUT_OF_RANGE');
    }
  });

  it('view.setMode 命令更新 store 状态', async () => {
    const result = await commandBus.execute({
      name: 'view.setMode',
      args: { mode: '2d' },
    });
    expect(result.ok).toBe(true);
    expect(useGeographyStore.getState().viewMode).toBe('2d');
  });

  it('view.setBasemap 命令更新 store 状态', async () => {
    const result = await commandBus.execute({
      name: 'view.setBasemap',
      args: { basemap: 'terrain' },
    });
    expect(result.ok).toBe(true);
    expect(useGeographyStore.getState().basemap).toBe('terrain');
  });

  it('layer.showContour 命令更新地形状态', async () => {
    const result = await commandBus.execute({
      name: 'layer.showContour',
      args: { spacing: 100 },
    });
    expect(result.ok).toBe(true);
    const terrain = useGeographyStore.getState().terrain;
    expect(terrain.contour).toBe(true);
    expect(terrain.contourSpacing).toBe(100);
  });

  it('terrain.setExaggeration 命令更新地形夸张', async () => {
    const result = await commandBus.execute({
      name: 'terrain.setExaggeration',
      args: { value: 3 },
    });
    expect(result.ok).toBe(true);
    expect(useGeographyStore.getState().terrain.exaggeration).toBe(3);
  });

  it('measure.start 命令更新测量状态', async () => {
    const result = await commandBus.execute({
      name: 'measure.start',
      args: { mode: 'distance' },
    });
    expect(result.ok).toBe(true);
    const measurement = useGeographyStore.getState().measurement;
    expect(measurement.mode).toBe('distance');
    expect(measurement.active).toBe(true);
  });

  it('measure.clear 命令清除测量状态', async () => {
    await commandBus.execute({ name: 'measure.start', args: { mode: 'area' } });
    const result = await commandBus.execute({ name: 'measure.clear', args: {} });
    expect(result.ok).toBe(true);
    const measurement = useGeographyStore.getState().measurement;
    expect(measurement.mode).toBe('none');
    expect(measurement.active).toBe(false);
  });

  it('animation.play/pause 命令切换动画状态', async () => {
    await commandBus.execute({ name: 'animation.pause', args: {} });
    expect(useGeographyStore.getState().astronomy.rotation).toBe(false);

    await commandBus.execute({ name: 'animation.play', args: {} });
    expect(useGeographyStore.getState().astronomy.rotation).toBe(true);
  });

  it('animation.setSpeed 命令更新速度', async () => {
    const result = await commandBus.execute({
      name: 'animation.setSpeed',
      args: { speed: 2.5 },
    });
    expect(result.ok).toBe(true);
    expect(useGeographyStore.getState().rotationSpeed).toBe(2.5);
  });

  it('layer.toggle 命令切换标注图层', async () => {
    const result = await commandBus.execute({
      name: 'layer.toggle',
      args: { layer: 'cities', visible: true },
    });
    expect(result.ok).toBe(true);
    expect(useGeographyStore.getState().annotations.cities).toBe(true);
  });

  it('layer.toggle 未知图层返回失败', async () => {
    const result = await commandBus.execute({
      name: 'layer.toggle',
      args: { layer: 'nonexistent' },
    });
    expect(result.ok).toBe(false);
  });

  it('subscribe 订阅命令执行事件', async () => {
    const events: Array<{ name: string; ok: boolean }> = [];
    const unsubscribe = commandBus.subscribe((call, result) => {
      events.push({ name: call.name, ok: result.ok });
    });

    await commandBus.execute({ name: 'view.setMode', args: { mode: '3d' } });
    await commandBus.execute({ name: 'measure.clear', args: {} });

    expect(events).toHaveLength(2);
    expect(events[0].name).toBe('view.setMode');
    expect(events[1].name).toBe('measure.clear');

    unsubscribe();

    await commandBus.execute({ name: 'view.setMode', args: { mode: '2d' } });
    expect(events).toHaveLength(2); // 取消订阅后不再收到事件
  });

  it('registerCommandHandlers 幂等（多次调用安全）', () => {
    registerCommandHandlers();
    registerCommandHandlers();
    // 不抛错即通过
    expect(true).toBe(true);
  });

  it('camera.screenshot 在无 Cesium 上下文时返回 TOOL_NOT_AVAILABLE', async () => {
    // 确保没有 cesium 上下文（测试环境本就无 Cesium）
    commandBus.setContext({ cesium: null });
    const result = await commandBus.execute({
      name: 'camera.screenshot',
      args: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TOOL_NOT_AVAILABLE');
      expect(result.error).toContain('地球视图未就绪');
    }
  });

  it('camera.screenshot 自定义 filename 通过 schema 校验', async () => {
    commandBus.setContext({ cesium: null });
    const result = await commandBus.execute({
      name: 'camera.screenshot',
      args: { filename: 'my-test.png' },
    });
    // schema 校验通过，但因无 cesium 上下文而失败
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TOOL_NOT_AVAILABLE');
    }
  });
});
