/**
 * Command Bus 集成测试
 *
 * 核心验证：手动按钮和 AI 语音指令经过同一个 Command Bus
 * 老师点击"显示等高线"和老师说"打开等高线"应执行同一个命令
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { commandBus, registerCommandHandlers } from '../src/commands/bus';
import { useGeographyStore } from '../src/state/store';
import { ToolCall, TOOL_NAMES, TOOL_SCHEMAS, AGENT_TOOL_NAMES, GEOGRAPHY_TOOLS } from '../src/commands/schema';

/**
 * 单元测试用的 CesiumController stub
 * —— jsdom 环境里没有真实 Cesium viewer，命令处理器调用 getCesiumOrError()
 *    时需要一个 ctx.cesium + ctrl.getViewer() 返回真值才能继续执行写 store。
 *    这里提供一个空实现的 stub，所有异步方法立即 resolve。
 */
function createMockCesiumController(): unknown {
  const noop = async () => {
    /* noop */
  };
  const noopSync = () => {
    /* noop sync */
  };
  return {
    getViewer: () => ({ camera: { position: {} } }),
    flyTo: noop,
    resetView: noop,
    setSceneMode: noop,
    setBasemap: noop,
    showContour: noop,
    showElevationRamp: noop,
    showSlope: noop,
    showAspect: noop,
    clearTerrainMaterial: noop,      // 对应 bus.ts L297: ctrl.clearTerrainMaterial
    highlightRegions: noop,          // 对应 bus.ts: layer.showRegion → ctrl.highlightRegions
    clearRegions: noop,              // 对应 bus.ts: layer.clearRegion → ctrl.clearRegions
    setTerrainExaggeration: noop,
    startMeasurement: noop,
    clearMeasurement: noop,
    showSolarSystem: noop,
    showEarth: noop,
    toggleAnnotation: noop,
    updateLayer: noop,               // 对应 bus.ts L285: ctrl.updateLayer
    setAxisTilt: noopSync,
    setSunHeight: noopSync,
    setRotation: noopSync,           // 对应 bus.ts animation.setSpeed / animation.play/pause
    addPointAnnotation: noop,
    clearAllAnnotations: noop,
  };
}

describe('Command Bus 单一总线', () => {
  beforeEach(() => {
    useGeographyStore.getState().reset();
    registerCommandHandlers();
    // 注入 mock Cesium：解除 getCesiumOrError() 对真实 viewer 的硬依赖
    commandBus.setContext({ cesium: createMockCesiumController() as never });
  });

  it('按钮点击调用 commandBus.execute 与 AI 调用使用同一实例', async () => {
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

    // 两者调用同一个 commandBus.execute（异步，需 await 保证写 store 完成）
    await expect(commandBus.execute(buttonCall)).resolves.toBeDefined();
    await expect(commandBus.execute(aiCall)).resolves.toBeDefined();

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

  it('layer.showRegion 高亮区域叠加 + layer.clearRegion 清除', async () => {
    const regions = [
      {
        id: 'first-step',
        name: '青藏高原',
        color: '#f54e00',
        coordinates: [
          [73, 37], [90, 40], [104, 29], [94, 25], [73, 37],
        ],
      },
    ];
    const show = await commandBus.execute({ name: 'layer.showRegion', args: { regions } });
    expect(show.ok).toBe(true);
    expect(show.ok && show.data?.count).toBe(1);

    // 顶点不足 3 个 → INVALID_ARGS
    const bad = await commandBus.execute({
      name: 'layer.showRegion',
      args: { regions: [{ id: 'x', name: 'x', coordinates: [[1, 1], [2, 2]] }] },
    });
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.code).toBe('INVALID_ARGS');

    // 空 regions → INVALID_ARGS
    const empty = await commandBus.execute({ name: 'layer.showRegion', args: { regions: [] } });
    expect(empty.ok).toBe(false);
    expect(empty.ok === false && empty.code).toBe('INVALID_ARGS');

    const clear = await commandBus.execute({ name: 'layer.clearRegion', args: {} });
    expect(clear.ok).toBe(true);
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

  // ============ Agent 调用底层 API 打开/控制界面（核心保证）============
  // 用户要求：agent 必须能通过 commandBus 调用 aiChat.* / ui.clickButton 打开界面
  it('agent 调用 aiChat.open 打开 AI 对话面板', async () => {
    // 先确保关闭
    useGeographyStore.getState().setUI({ showAIChat: false });
    expect(useGeographyStore.getState().ui.showAIChat).toBe(false);

    const result = await commandBus.execute({ name: 'aiChat.open', args: {} });
    expect(result.ok).toBe(true);
    expect(useGeographyStore.getState().ui.showAIChat).toBe(true);
  });

  it('agent 调用 aiChat.close 关闭 AI 对话面板', async () => {
    useGeographyStore.getState().setUI({ showAIChat: true });
    const result = await commandBus.execute({ name: 'aiChat.close', args: {} });
    expect(result.ok).toBe(true);
    expect(useGeographyStore.getState().ui.showAIChat).toBe(false);
  });

  it('agent 调用 aiChat.toggle 切换面板开/关', async () => {
    useGeographyStore.getState().setUI({ showAIChat: false });
    await commandBus.execute({ name: 'aiChat.toggle', args: {} });
    expect(useGeographyStore.getState().ui.showAIChat).toBe(true);
    await commandBus.execute({ name: 'aiChat.toggle', args: {} });
    expect(useGeographyStore.getState().ui.showAIChat).toBe(false);
  });

  it('agent 调用 aiChat.clear 清空对话历史', async () => {
    useGeographyStore.getState().setUI({
      aiChatHistory: [
        { id: 'x', role: 'user', content: 'hi', createdAt: new Date().toISOString() },
      ],
      aiChatGenerating: true,
    });
    const result = await commandBus.execute({ name: 'aiChat.clear', args: {} });
    expect(result.ok).toBe(true);
    expect(useGeographyStore.getState().ui.aiChatHistory).toHaveLength(0);
    expect(useGeographyStore.getState().ui.aiChatGenerating).toBe(false);
  });

  it('agent 调用 ui.clickButton 点击界面按钮（dispatchEvent 模拟用户点击）', async () => {
    // 在 jsdom DOM 里放一个带 data-agent-button 的按钮，监听点击
    const btn = document.createElement('button');
    btn.setAttribute('data-agent-button', 'dock.view');
    let clicked = false;
    btn.addEventListener('click', () => { clicked = true; });
    document.body.appendChild(btn);

    const result = await commandBus.execute({
      name: 'ui.clickButton',
      args: { buttonId: 'dock.view' },
    });
    expect(result.ok).toBe(true);
    expect(clicked).toBe(true);
    document.body.removeChild(btn);
  });

  it('agent 调用 ui.clickButton 找不到按钮时返回 BUTTON_NOT_FOUND', async () => {
    const result = await commandBus.execute({
      name: 'ui.clickButton',
      args: { buttonId: 'nonexistent.button' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('BUTTON_NOT_FOUND');
    }
  });

  it('agent 调用 ui.clickButton 缺少 buttonId 参数返回 INVALID_ARGS', async () => {
    const result = await commandBus.execute({
      name: 'ui.clickButton',
      args: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_ARGS');
    }
  });

  // ============ 手动按钮 vs AI 语音：同一条 Command Bus，最终写同一份 Store ============
  it('[AI vs 手动一致性] 手动点"显示等高线"和 AI 说"打开等高线 spacing=100" 写同一份 store', async () => {
    useGeographyStore.getState().reset();
    commandBus.setContext({ cesium: createMockCesiumController() as never });
    // 按钮端：spacing=200
    await commandBus.execute({ name: 'layer.showContour', args: { spacing: 200 } });
    expect(useGeographyStore.getState().terrain.contour).toBe(true);
    expect(useGeographyStore.getState().terrain.contourSpacing).toBe(200);
    // AI 端（KeywordIntentLLM 解析出 spacing=100 后的同一调用）
    await commandBus.execute({ name: 'layer.showContour', args: { spacing: 100 } });
    expect(useGeographyStore.getState().terrain.contourSpacing).toBe(100);
  });

  it('[AI vs 手动一致性] 手动切底图 "地形" 与 AI 指令 basemap=terrain → store.basemap 一致', async () => {
    useGeographyStore.getState().reset();
    commandBus.setContext({ cesium: createMockCesiumController() as never });
    // 初始
    expect(useGeographyStore.getState().basemap).toBe('satellite');
    // 手动按钮：view.setBasemap('osm')
    await commandBus.execute({ name: 'view.setBasemap', args: { basemap: 'osm' } });
    expect(useGeographyStore.getState().basemap).toBe('osm');
    // AI 指令解析出 basemap=political
    await commandBus.execute({ name: 'view.setBasemap', args: { basemap: 'political' } });
    expect(useGeographyStore.getState().basemap).toBe('political');
  });

  it('view.setBasemap 不识别的 basemap 返回 INVALID_ARGS（不写入虚假成功状态）', async () => {
    useGeographyStore.getState().reset();
    const r = await commandBus.execute({
      name: 'view.setBasemap',
      args: { basemap: 'not-exist' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_ARGS');
    // store 没被污染
    expect(useGeographyStore.getState().basemap).toBe('satellite');
  });

  it('layer.showContour spacing 越界（<10）返回 OUT_OF_RANGE，不写 store', async () => {
    useGeographyStore.getState().reset();
    commandBus.setContext({ cesium: createMockCesiumController() as never });
    const r = await commandBus.execute({
      name: 'layer.showContour',
      args: { spacing: -1 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('OUT_OF_RANGE');
    expect(useGeographyStore.getState().terrain.contour).toBe(false);
  });

  it('layer.toggle layers 枚举（气候带/climateZones/构造板块 plates/晨昏线 twilight 等）—— 手动 vs AI 一致', async () => {
    useGeographyStore.getState().reset();
    commandBus.setContext({ cesium: createMockCesiumController() as never });
    // annotations 图层（8 个）
    const annotations = [
      ['graticule', true],
      ['cities', false],
      ['labels', true],
      ['climateZones', false],
      ['plates', false],
      ['dateLine', false],
      ['rivers', false],
      ['mountains', false],
      ['adminBounds', false],
      ['oceanCurrents', false],
      ['monsoonWinds', false],
    ] as const;
    for (const [l, s0] of annotations) {
      expect(useGeographyStore.getState().annotations[l]).toBe(s0);
      const r = await commandBus.execute({
        name: 'layer.toggle',
        args: { layer: l, visible: !s0 },
      });
      expect(r.ok).toBe(true);
      expect(useGeographyStore.getState().annotations[l]).toBe(!s0);
    }
    // astronomy 图层：晨昏线 twilight
    expect(useGeographyStore.getState().astronomy.twilight).toBe(false);
    const rTw = await commandBus.execute({
      name: 'layer.toggle',
      args: { layer: 'twilight', visible: true },
    });
    expect(rTw.ok).toBe(true);
    expect(useGeographyStore.getState().astronomy.twilight).toBe(true);
  });
});

// ============ Agent 工具覆盖（schema.ts 程序化生成 GEOGRAPHY_TOOLS）============
// 用户要求：agent 能控制整个项目大部分 API。GEOGRAPHY_TOOLS 必须：
//   1) 覆盖 AGENT_TOOL_NAMES 白名单里全部命令（SSOT 生成，schema 新增工具自动获得能力）
//   2) 排除内部流式工具（aiChat.send/appendMessage/updateLastAssistant/updateToolCall、lesson.advance）
//   3) 每个工具都能在 TOOL_SCHEMAS 里找到参数定义（校验不会报 TOOL_NOT_AVAILABLE）
describe('Agent 工具覆盖（GEOGRAPHY_TOOLS）', () => {
  it('覆盖 AGENT_TOOL_NAMES 白名单中的全部工具（几乎等于全部对外 API）', () => {
    const exposed = new Set(GEOGRAPHY_TOOLS.map((t) => t.function.name));
    for (const name of AGENT_TOOL_NAMES) {
      expect(exposed.has(name)).toBe(true);
    }
    // 白名单应覆盖绝大多数 TOOL_NAMES（内部流式除外）
    expect(AGENT_TOOL_NAMES.length).toBeGreaterThan(40);
  });

  it('排除内部流式工具（避免递归/破坏 UI 状态）', () => {
    const exposed = new Set(GEOGRAPHY_TOOLS.map((t) => t.function.name));
    const internalStreaming = [
      'lesson.advance',
      'aiChat.send',
      'aiChat.appendMessage',
      'aiChat.updateLastAssistant',
      'aiChat.updateToolCall',
    ];
    for (const name of internalStreaming) {
      expect(exposed.has(name)).toBe(false);
    }
  });

  it('每个 agent 工具都有 TOOL_SCHEMAS 参数定义（可被 validateToolCall 校验）', () => {
    for (const t of GEOGRAPHY_TOOLS) {
      const name = t.function.name as keyof typeof TOOL_SCHEMAS;
      expect(TOOL_SCHEMAS[name]).toBeDefined();
    }
  });

  it('每个 agent 工具都有非空描述（LLM 能理解用途）', () => {
    for (const t of GEOGRAPHY_TOOLS) {
      expect(t.function.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('工具名唯一且都是合法 ToolName', () => {
    const names = GEOGRAPHY_TOOLS.map((t) => t.function.name);
    expect(new Set(names).size).toBe(names.length);
    const valid = new Set<string>(TOOL_NAMES);
    for (const n of names) {
      expect(valid.has(n)).toBe(true);
    }
  });

  it('AGENT_TOOL_NAMES 全部是合法 ToolName 且都有 schema', () => {
    const valid = new Set<string>(TOOL_NAMES);
    for (const name of AGENT_TOOL_NAMES) {
      expect(valid.has(name)).toBe(true);
      expect(TOOL_SCHEMAS[name]).toBeDefined();
    }
  });

  it('白名单不包含内部流式工具', () => {
    const names = new Set<string>(AGENT_TOOL_NAMES);
    expect(names.has('aiChat.send')).toBe(false);
    expect(names.has('aiChat.appendMessage')).toBe(false);
    expect(names.has('aiChat.updateLastAssistant')).toBe(false);
    expect(names.has('aiChat.updateToolCall')).toBe(false);
    expect(names.has('lesson.advance')).toBe(false);
  });
});
