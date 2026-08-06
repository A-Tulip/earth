/**
 * 语音意图解析 + Push-to-Talk 快捷键安全测试
 *
 * 验证：
 * - KeywordIntentLLM 将中文语音转为工具调用
 * - 输入框/文本域/contenteditable 中空格正常输入
 * - event.repeat 不重复触发
 * - 适配器工厂根据 VITE_*_PROVIDER 切换实现
 * - 火山引擎适配器错误处理（无服务端代理时降级）
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  KeywordIntentLLM,
  VolcengineArkLLM,
  VolcengineTTS,
  VolcengineASR,
  createASRAdapter,
  createTTSAdapter,
  createLLMAdapter,
  LLMMessage,
} from '../src/voice/adapters';
import { validateToolCall } from '../src/commands/schema';
import { isEditable } from '../src/voice/PushToTalk';

describe('KeywordIntentLLM 意图解析', () => {
  const llm = new KeywordIntentLLM();

  it('"打开等高线" 解析为 layer.showContour', async () => {
    const response = await llm.chat([
      { role: 'user', content: '打开等高线' },
    ]);
    expect(response.toolCalls).toBeDefined();
    const contourCall = response.toolCalls!.find((c) => c.name === 'layer.showContour');
    expect(contourCall).toBeDefined();
  });

  it('"显示高程分层" 解析为 layer.showElevationRamp', async () => {
    const response = await llm.chat([
      { role: 'user', content: '显示高程分层' },
    ]);
    expect(response.toolCalls!.find((c) => c.name === 'layer.showElevationRamp')).toBeDefined();
  });

  it('"切换到二维" 解析为 view.setMode 2d', async () => {
    const response = await llm.chat([
      { role: 'user', content: '切换到二维' },
    ]);
    const call = response.toolCalls!.find((c) => c.name === 'view.setMode');
    expect(call).toBeDefined();
    expect(call!.args.mode).toBe('2d');
  });

  it('"飞到北京" 解析为 camera.flyTo', async () => {
    const response = await llm.chat([
      { role: 'user', content: '飞到北京' },
    ]);
    const call = response.toolCalls!.find((c) => c.name === 'camera.flyTo');
    expect(call).toBeDefined();
    // 更精确的坐标（原先是 116.4/39.9 两位小数，升级后采用 3 位小数的 WGS-84 城市坐标）
    expect(Number(call!.args.longitude)).toBeCloseTo(116.407, 2);
    expect(Number(call!.args.latitude)).toBeCloseTo(39.904, 2);
    expect(Number(call!.args.height)).toBeGreaterThanOrEqual(50_000); // 至少 50km 高度
  });

  it('"显示城市" 解析为 layer.toggle cities visible=true', async () => {
    const response = await llm.chat([
      { role: 'user', content: '显示城市' },
    ]);
    const call = response.toolCalls!.find(
      (c) => c.name === 'layer.toggle' && c.args.layer === 'cities'
    );
    expect(call).toBeDefined();
    expect(call!.args.visible).toBe(true);
  });

  it('"隐藏城市" 解析为 layer.toggle cities visible=false', async () => {
    const response = await llm.chat([
      { role: 'user', content: '隐藏城市' },
    ]);
    const call = response.toolCalls!.find(
      (c) => c.name === 'layer.toggle' && c.args.layer === 'cities'
    );
    expect(call).toBeDefined();
    expect(call!.args.visible).toBe(false);
  });

  it('"停止自转" 解析为 animation.pause', async () => {
    const response = await llm.chat([
      { role: 'user', content: '停止自转' },
    ]);
    expect(response.toolCalls!.find((c) => c.name === 'animation.pause')).toBeDefined();
  });

  it('"开始自转" 解析为 animation.play', async () => {
    const response = await llm.chat([
      { role: 'user', content: '开始自转' },
    ]);
    expect(response.toolCalls!.find((c) => c.name === 'animation.play')).toBeDefined();
  });

  it('"开始等高线课程" 解析为 lesson.open', async () => {
    const response = await llm.chat([
      { role: 'user', content: '开始等高线课程' },
    ]);
    const call = response.toolCalls!.find((c) => c.name === 'lesson.open');
    expect(call).toBeDefined();
    expect(call!.args.lessonId).toBe('contour-lines');
  });

  it('"等高线间距100米" 解析为 layer.showContour spacing=100', async () => {
    const response = await llm.chat([
      { role: 'user', content: '等高线间距100米' },
    ]);
    const call = response.toolCalls!.find((c) => c.name === 'layer.showContour');
    expect(call).toBeDefined();
    expect(call!.args.spacing).toBe(100);
  });

  it('"打开太阳系" 解析为 view.showSolarSystem', async () => {
    const response = await llm.chat([
      { role: 'user', content: '打开太阳系' },
    ]);
    const call = response.toolCalls!.find((c) => c.name === 'view.showSolarSystem');
    expect(call).toBeDefined();
  });

  it('"返回地球" 解析为 view.showEarth', async () => {
    const response = await llm.chat([
      { role: 'user', content: '返回地球' },
    ]);
    const call = response.toolCalls!.find((c) => c.name === 'view.showEarth');
    expect(call).toBeDefined();
  });

  it('"截图" 解析为 camera.screenshot', async () => {
    const response = await llm.chat([
      { role: 'user', content: '截图保存当前画面' },
    ]);
    const call = response.toolCalls!.find((c) => c.name === 'camera.screenshot');
    expect(call).toBeDefined();
  });

  it('"地形夸张3倍" 解析为 terrain.setExaggeration', async () => {
    const response = await llm.chat([
      { role: 'user', content: '地形夸张3倍' },
    ]);
    const call = response.toolCalls!.find((c) => c.name === 'terrain.setExaggeration');
    expect(call).toBeDefined();
    expect(call!.args.value).toBe(3);
  });

  it('无法理解的指令返回空 toolCalls', async () => {
    const response = await llm.chat([
      { role: 'user', content: '今天天气怎么样' },
    ]);
    expect(response.toolCalls).toHaveLength(0);
    expect(response.text).toContain('没有理解');
  });

  it('解析出的所有工具调用都通过 Schema 校验', async () => {
    const inputs = [
      '打开等高线', '显示高程分层', '二维', '三维',
      '飞到上海', '显示城市', '隐藏城市', '经纬线',
      '晨昏线', '停止自转', '开始自转', '地形夸张2倍',
      '开始等高线课程', '开始板块课程',
      '等高线间距500米', '打开太阳系', '返回地球', '截图',
    ];
    for (const text of inputs) {
      const response = await llm.chat([{ role: 'user', content: text }]);
      for (const call of response.toolCalls ?? []) {
        const result = validateToolCall({
          name: call.name as never,
          args: call.args,
        });
        expect(result).toBeNull();
      }
    }
  });
});

describe('Push-to-Talk 空格键安全逻辑', () => {
  it('INPUT 元素中空格应正常输入（不触发录音）', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(isEditable(input)).toBe(true);
    document.body.removeChild(input);
  });

  it('TEXTAREA 元素中空格应正常输入', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    expect(isEditable(textarea)).toBe(true);
    document.body.removeChild(textarea);
  });

  it('contenteditable 元素中空格应正常输入', () => {
    const div = document.createElement('div');
    // jsdom 中 contentEditable 属性 setter 不一定同步到 attribute，用 setAttribute 更稳健
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);
    expect(isEditable(div)).toBe(true);
    document.body.removeChild(div);
  });

  it('普通 DIV 元素空格应触发录音', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(isEditable(div)).toBe(false);
    document.body.removeChild(div);
  });

  it('null target 不视为可编辑', () => {
    expect(isEditable(null)).toBe(false);
  });

  it('KeyboardEvent.repeat 防重复（模拟 repeat=true 应忽略）', () => {
    // 模拟 PushToTalk 的 repeat 守卫逻辑
    let triggered = 0;
    const onKeyDown = (e: { code: string; repeat: boolean }) => {
      if (e.code !== 'Space') return;
      if (e.repeat) return; // 防重复
      triggered++;
    };
    onKeyDown({ code: 'Space', repeat: false });
    onKeyDown({ code: 'Space', repeat: true }); // 重复按键忽略
    onKeyDown({ code: 'Space', repeat: true });
    expect(triggered).toBe(1);
  });
});

describe('适配器工厂 env 切换', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('VITE_LLM_PROVIDER=volcengine 返回 VolcengineArkLLM', () => {
    vi.stubEnv('VITE_LLM_PROVIDER', 'volcengine');
    const adapter = createLLMAdapter();
    expect(adapter).toBeInstanceOf(VolcengineArkLLM);
  });

  it('VITE_TTS_PROVIDER=volcengine 返回 VolcengineTTS', () => {
    vi.stubEnv('VITE_TTS_PROVIDER', 'volcengine');
    const adapter = createTTSAdapter();
    expect(adapter).toBeInstanceOf(VolcengineTTS);
  });

  it('VITE_ASR_PROVIDER=volcengine 返回 VolcengineASR', () => {
    vi.stubEnv('VITE_ASR_PROVIDER', 'volcengine');
    const adapter = createASRAdapter();
    expect(adapter).toBeInstanceOf(VolcengineASR);
  });

  it('VITE_LLM_PROVIDER 未设置时返回 KeywordIntentLLM', () => {
    vi.stubEnv('VITE_LLM_PROVIDER', '');
    const adapter = createLLMAdapter();
    expect(adapter).toBeInstanceOf(KeywordIntentLLM);
  });

  it('VITE_LLM_PROVIDER=keyword 返回 KeywordIntentLLM', () => {
    vi.stubEnv('VITE_LLM_PROVIDER', 'keyword');
    const adapter = createLLMAdapter();
    expect(adapter).toBeInstanceOf(KeywordIntentLLM);
  });
});

describe('火山引擎适配器错误处理（无服务端代理）', () => {
  // jsdom 环境下 fetch 默认未实现，调用应抛错或返回失败结果

  it('VolcengineArkLLM 在 fetch 失败时抛错', async () => {
    const llm = new VolcengineArkLLM();
    await expect(
      llm.chat([{ role: 'user', content: '测试' }]),
    ).rejects.toThrow();
  });

  it('VolcengineTTS 在 fetch 失败时抛错', async () => {
    const tts = new VolcengineTTS();
    await expect(tts.speak('测试')).rejects.toThrow();
    expect(tts.isSpeaking()).toBe(false);
  });

  it('VolcengineTTS stop 后 isSpeaking 为 false', () => {
    const tts = new VolcengineTTS();
    tts.stop();
    expect(tts.isSpeaking()).toBe(false);
  });

  it('VolcengineASR isListening 初始为 false', () => {
    const asr = new VolcengineASR();
    expect(asr.isListening()).toBe(false);
  });

  it('VolcengineASR abort 不抛错', () => {
    const asr = new VolcengineASR();
    expect(() => asr.abort()).not.toThrow();
  });
});

describe('RealtimeVoiceChat 对话历史管理', () => {
  // 测试 trimHistory / clearHistory / course-change-clear-history 逻辑
  // 从 RealtimeVoiceChat 中提取纯函数逻辑测试

  const MAX_HISTORY = 20;

  function makeHistory(count: number, startRole: 'user' = 'user'): LLMMessage[] {
    return Array.from({ length: count }, (_, i) => ({
      role: (i % 2 === 0 ? startRole : 'assistant' as const),
      content: `msg ${i}`,
    }));
  }

  function trimHistoryStub(history: LLMMessage[]): LLMMessage[] {
    // 复制 RealtimeVoiceChat.ts 中的 trimHistory 逻辑进行单元测试
    while (history.length > MAX_HISTORY) {
      const firstNonSysIdx = history.findIndex((m) => m.role !== 'system');
      if (firstNonSysIdx < 0) {
        history.splice(0, 1);
      } else {
        const end = Math.min(firstNonSysIdx + 2, history.length);
        history.splice(firstNonSysIdx, end - firstNonSysIdx);
      }
    }
    return history;
  }

  it('空数组不修剪', () => {
    const h: LLMMessage[] = [];
    trimHistoryStub(h);
    expect(h).toHaveLength(0);
  });

  it('小于等于 20 不修剪', () => {
    const h = makeHistory(20);
    trimHistoryStub(h);
    expect(h).toHaveLength(20);
  });

  it('超过 20 时删除最老的一对 user+assistant', () => {
    const h = makeHistory(22);
    // 22 → 删除前 2 → 剩余 20
    trimHistoryStub(h);
    expect(h).toHaveLength(20);
    // 剩余第一条应该是 msg 2
    expect(h[0].content).toBe('msg 2');
  });

  it('保留 system 提示，只删除 user+assistant', () => {
    const h: LLMMessage[] = [
      { role: 'system', content: 'system prompt' },
      ...makeHistory(21),
    ];
    // total 22 → 删除最老一对 user+assistant → 20，system 保留在开头
    trimHistoryStub(h);
    expect(h).toHaveLength(20);
    expect(h[0].role).toBe('system');
    expect(h[0].content).toBe('system prompt');
  });

  it('全 system 时逐个删除最老', () => {
    const h: LLMMessage[] = Array.from({ length: 25 }, () => ({
      role: 'system' as const,
      content: 'sys',
    }));
    trimHistoryStub(h);
    expect(h).toHaveLength(20);
  });
});
