/**
 * PushToTalk —— 空格键语音控制
 *
 * 两种交互模式（用户反馈：「空格是快捷启动语音」—— 不再默认按住录）：
 *   1. toggle     : 单击空格 → 开始录音；再按一次空格 → 停止并提交（默认，适合教学场景单手操作）
 *   2. pushToTalk : 按住空格录音、松开提交（旧行为，适合精确控制录音时长）
 *
 * 安全处理：
 * - event.repeat 防止重复触发
 * - 输入框/文本域/contenteditable 中空格正常输入
 * - 窗口失焦/页面隐藏时安全结束录音
 * - 语音权限拒绝时提供文本命令入口
 */

import { useEffect, useCallback, useRef } from 'react';
import { ASRAdapter, TTSAdapter, LLMAdapter, LLMMessage } from './adapters';
import { commandBus } from '../commands/bus';
import { useGeographyStore } from '../state/store';
import { LESSON_CATALOG } from '../lessons/catalog';

export type VoiceInteractionMode = 'toggle' | 'pushToTalk';

interface PushToTalkOptions {
  asr: ASRAdapter;
  tts: TTSAdapter;
  llm: LLMAdapter;
  enabled?: boolean;
  /**
   * 空格键语音交互模式（默认 toggle）：
   *   - 'toggle'     : 单击空格开始、再按一次停止（用户要的「快捷启动语音」）
   *   - 'pushToTalk' : 按住开始、松开停止（PushToTalk 经典行为）
   */
  mode?: VoiceInteractionMode;
}

/** 判断元素是否可编辑（空格应正常输入） */
export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  // isContentEditable 在某些环境（如 jsdom）不一定反映 attribute，叠加 attribute 检查更稳健
  if (target.isContentEditable) return true;
  const attr = target.getAttribute('contenteditable');
  return attr === 'true' || attr === '';
}

export function usePushToTalk({ asr, tts, llm, enabled = true, mode = 'toggle' }: PushToTalkOptions) {
  const isRecordingRef = useRef(false);
  const store = useGeographyStore;
  const errorClearTimerRef = useRef<number | null>(null);
  // ✅ ISSUE-2：对话历史累积（PushToTalk 会话级）
  //   - 每次交互都把 user/assistant 追加进历史，让 LLM 能记住上下文（"解释一下刚才的等高线""上一步讲的是什么"）
  //   - 保留最多 20 条消息（≈10 轮对话），超出时删除最早的 user+assistant 对
  //   - 新课程打开 / 当前课程关闭 时自动清空历史，避免跨课污染
  const historyRef = useRef<LLMMessage[]>([]);
  const lastLessonIdRef = useRef<string | null>(null);

  /** 历史过长时，删除最老的 user+assistant 对，总长度 ≤ 20 */
  const trimHistory = useCallback(() => {
    const MAX = 20;
    while (historyRef.current.length > MAX) {
      // 优先删除最早的非 system 消息：一次删 2 条（1 user + 1 assistant）
      const firstNonSysIdx = historyRef.current.findIndex((m) => m.role !== 'system');
      if (firstNonSysIdx < 0) {
        historyRef.current.splice(0, 1); // 兜底：只删 1 条
      } else {
        const end = Math.min(firstNonSysIdx + 2, historyRef.current.length);
        historyRef.current.splice(firstNonSysIdx, end - firstNonSysIdx);
      }
    }
  }, []);

  /** 清空对话历史（课程切换 / 用户显式重置） */
  const clearHistory = useCallback(() => {
    historyRef.current = [];
  }, []);

  /** 显示错误（8 秒后自动清除，避免错误常驻 UI 干扰课堂） */
  const showError = useCallback((message: string) => {
    store.getState().setVoice({ error: message });
    if (errorClearTimerRef.current != null) window.clearTimeout(errorClearTimerRef.current);
    errorClearTimerRef.current = window.setTimeout(() => {
      const cur = store.getState().voice;
      if (cur.error === message) store.getState().setVoice({ error: null });
      errorClearTimerRef.current = null;
    }, 8000);
  }, [store]);

  /** 开始录音 */
  const startRecording = useCallback(async () => {
    // ✅ ISSUE-3 根因修复：不要再检查 isRecordingRef.current！
    //   onKeyDown 在调用 startRecording() 前 **先把 isRecordingRef=true**，这是故意的（防止极短按键 Tap 时 onKeyUp 先触发但 isRecording=false 导致 stopRecording 空退出）。
    //   真正需要检查的是 ASR 是否已经在录音（asr.isListening()），而不是"我们想录"这个标记。
    console.error('[PUSH2TALK_DEBUG] startRecording called, isListening=', asr.isListening(), 'muted=', store.getState().voice.muted);
    if (asr.isListening()) return;

    // Q3-5 静音状态：给明确提示，不要静默失败（用户常按了空格没反应）
    if (store.getState().voice.muted) {
      showError('语音已静音：请在工具坞左下角点击"🔇 静音"按钮，或切换为文本命令。');
      // 但先回滚 isRecordingRef=true，否则下次按空格前它一直保持 true，stopRecording 会在用户没录音时乱执行
      isRecordingRef.current = false;
      return;
    }

    try {
      store.getState().setVoice({ listening: true, error: null, transcript: '', partialText: '' });
      // 绑定 partial 回调 —— 用户说话时实时更新 partial 文本
      asr.setOnPartial?.((text: string) => {
        store.getState().setVoice({ partialText: text });
      });
      await asr.start();
      store.getState().setVoice({ asrStreaming: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : '录音启动失败';
      store.getState().setVoice({
        listening: false,
        asrStreaming: false,
        transcript: '',
        partialText: '',
      });
      isRecordingRef.current = false;
      showError(`语音权限失败：${message}。可使用文本输入或工具坞操作。`);
    }
  }, [asr, store, showError]);

  /** 停止录音并处理 */
  const stopRecording = useCallback(async () => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;

    try {
      store.getState().setVoice({ listening: false, processing: true, asrStreaming: false });
      const result = await asr.stop();

      if (!result.text.trim()) {
        store.getState().setVoice({ processing: false, transcript: '', partialText: '' });
        return;
      }

      store.getState().setVoice({ transcript: result.text, partialText: '' });

      // ✅ ISSUE-2：拼接上下文 —— 系统提示 + 历史（去重后带场景快照）+ 当前用户消息
      const state = store.getState();
      const sceneContext: string[] = [];
      // 课程上下文：从 LESSON_CATALOG 按 activeLessonId 查找（不直接访问私有 LessonRuntime.currentLesson）
      if (state.lesson.activeLessonId) {
        const meta = LESSON_CATALOG.find((c) => c.id === state.lesson.activeLessonId);
        if (meta) {
          const levelStr = meta.level === 'junior' ? '初中' : '高中';
          const categoryMap: Record<string, string> = {
            natural: '自然地理',
            human: '人文地理',
            regional: '区域地理',
            'earth-map': '地球与地图',
          };
          const categoryStr = categoryMap[meta.category] ?? meta.category;
          sceneContext.push(`正在上课：${meta.title}（${meta.grade} ${levelStr} · ${categoryStr}）`);
        }
        const stepIdx = state.lesson.currentStep;
        sceneContext.push(`当前步骤 ${stepIdx + 1}/${state.lesson.totalSteps}：${state.lesson.stepTitle || '未命名步骤'}`);
      }
      // 镜头 / 选中对象
      const cam = state.camera;
      sceneContext.push(`镜头坐标：经度 ${cam.longitude.toFixed(1)}°，纬度 ${cam.latitude.toFixed(1)}°，高度 ${Math.round(cam.height)}m`);
      if (state.selected?.name) sceneContext.push(`选中对象：${state.selected.kind}「${state.selected.name}」`);
      // 图层：收集 annotations / astronomy / data 中状态为 true 的 key 名
      const activeLayers: string[] = [];
      for (const [k, v] of Object.entries(state.annotations)) if (v === true) activeLayers.push(k);
      for (const [k, v] of Object.entries(state.astronomy)) if (v === true) activeLayers.push(k);
      for (const [k, v] of Object.entries(state.data)) if (v === true) activeLayers.push(k);
      if (activeLayers.length) sceneContext.push(`已开图层：${activeLayers.join('、')}`);
      sceneContext.push(`视图模式：${state.viewMode}，底图：${state.basemap}`);
      // 地形分析：等高线/坡度/坡向/海拔分层
      const terrain = state.terrain;
      if (terrain.contour) sceneContext.push(`分析层：等高线（间距 ${terrain.contourSpacing}m）`);
      else if (terrain.elevationRamp) sceneContext.push(`分析层：高程分层设色`);
      else if (terrain.slope) sceneContext.push(`分析层：坡度图`);
      else if (terrain.aspect) sceneContext.push(`分析层：坡向图`);
      if (terrain.exaggeration !== 1) sceneContext.push(`地形夸张：${terrain.exaggeration}×`);

      const systemPrompt = `你是初高中地理 AI 教学助手（"地理画布"平台）。请用简洁、准确、符合课标的中文回答学生。
角色规则：
- 你能看到当前地球画布的状态（镜头、图层、课程进度），作为回答上下文。
- 当学生指令可通过地理工具完成时（等高线、图层切换、飞行定位、二维三维切换、地形夸张、课程控制、测量标注、动画控制等），使用 toolCalls 返回；否则直接用 text 回答。
- 可用工具清单：等高线、高程分层、二维三维切换、飞行定位、图层开关（osm/卫星/天地图矢量/国家基础地理信息中心影像/高德卫星/EsriOcean/地形/国界/地震/天气/GDP/人口/气温/降水/城市/板块/水系/经纬网）、地形夸张、课程打开、课程下一步/上一步、动画播放/暂停/重置、问题出题、解释概念、测量、标注。
- 回答不能编造虚假地理数据；不确定的给出边界并建议学生查阅对应课标章节。
${sceneContext.length ? `\n【当前画布上下文】\n${sceneContext.join('\n')}` : ''}
${historyRef.current.length ? `\n【已进行 ${Math.floor(historyRef.current.length / 2)} 轮对话，学生可能会追问上一轮问题】` : ''}`;

      // 组装消息：system prompt + 历史对话 + 当前用户消息
      const messages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        ...historyRef.current,
        { role: 'user', content: result.text },
      ];

      const response = await llm.chat(messages);

      // ✅ ISSUE-2：把本次 user/assistant 对话追加进历史，供后续轮次引用
      historyRef.current.push({ role: 'user', content: result.text });
      historyRef.current.push({
        role: 'assistant',
        content: response.text || '',
        toolCalls: response.toolCalls,
      });
      trimHistory();

      // 执行工具调用
      let executed = 0;
      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const call of response.toolCalls) {
          try {
            await commandBus.execute({ name: call.name as never, args: call.args });
            executed++;
          } catch (toolErr) {
            console.warn('[PushToTalk] 工具执行失败:', call.name, toolErr);
          }
        }
      }

      // 如果云端 LLM 返回空工具调用（代理不可达时），但浏览器关键词回退（KeywordIntentLLM）
      // 已经在 adapters 层返回 toolCalls —— 所以到这里应当有。若还是空，给友好提示
      if (!response.toolCalls || response.toolCalls.length === 0) {
        if (!response.text.trim()) {
          showError(`未识别指令："${result.text.slice(0, 15)}..."。可尝试"打开等高线""切换高德卫星图""跳到北京"等。`);
        }
      } else if (executed === 0) {
        showError('工具执行失败：请稍后重试或直接使用工具坞按钮。');
      }

      // TTS 朗读回复（静音或没文本时跳过；失败不影响主流程，回滚 speaking 状态）
      if (response.text && !store.getState().voice.muted) {
        store.getState().setVoice({ speaking: true, response: response.text });
        try {
          await tts.speak(response.text);
        } catch (ttsErr) {
          const m = ttsErr instanceof Error ? ttsErr.message : String(ttsErr);
          console.warn('[PushToTalk] TTS 失败:', m);
          showError(`语音播放失败：${m}。字幕仍可查看下方回复。`);
        } finally {
          store.getState().setVoice({ speaking: false });
        }
      }

      store.getState().setVoice({ processing: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : '语音处理失败';
      // 异常时回滚所有正在进行的状态
      store.getState().setVoice({
        processing: false,
        listening: false,
        asrStreaming: false,
        speaking: false,
        partialText: '',
      });
      showError(message);
    }
  }, [asr, llm, tts, store, showError, trimHistory]);

  /** 键盘事件处理 */
  useEffect(() => {
    if (!enabled) return;

    // 空格键判定：同时兼容 e.code（推荐，IDE/浏览器规范）、e.key 与 e.keyCode（keyCode=32 兜底，
    // 覆盖个别环境 code/key 为空但 keyCode 仍是 32 的情况，如部分浏览器自动化/输入法预编辑）
    const isSpaceKey = (e: KeyboardEvent): boolean =>
      e.code === 'Space' || e.key === ' ' || e.key === 'Space' || (e as unknown as { keyCode?: number }).keyCode === 32;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isSpaceKey(e)) return;
      console.error('[PUSH2TALK_DEBUG] space keydown, repeat=', e.repeat, 'isRecordingRef=', isRecordingRef.current, 'muted=', store.getState().voice.muted, 'showAIChat=', store.getState().ui.showAIChat);
      if (e.repeat) return; // 防重复（OS/浏览器长按产生重复 keydown）

      // 🔥 toggle 模式且正在录音：第二次空格 = 停止并提交，优先级最高。
      //   原因：AI 面板打开后会自动聚焦输入框（AIChatPanel 的 useEffect），此时 focus 在 textarea，
      //   若先走 isEditable 判断，第二次空格会被当成"输入空格"而无法停止录音 → 用户感觉"按了没法继续"。
      //   所以只要 "正在录音"，无论焦点在哪，空格都用来停止录音。
      if (mode === 'toggle' && isRecordingRef.current) {
        e.preventDefault();
        isRecordingRef.current = false;
        void stopRecording();
        return;
      }

      if (isEditable(e.target)) {
        // ✅ 空格键唤起语音：焦点在 AI 对话输入框（自动聚焦）时，若尚未输入任何内容，
        //   空格仍用于"唤起/停止语音"，而不是被当成"输入一个空格"拦截。
        //   只有输入框里已有内容（学生正在打字）才放行空格作为正常输入。
        const el = e.target as HTMLElement;
        const hasTypedContent =
          (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)
            ? el.value.length > 0
            : el.isContentEditable && (el.textContent ?? '').length > 0;
        if (hasTypedContent) return; // 正在输入 → 正常输入空格
      }

      if (store.getState().voice.muted) {
        e.preventDefault();
        showError('语音已静音：请先在工具坞左下角取消静音。');
        return;
      }

      // ✅ 空格键只负责「快捷启动/停止语音」，不再强制打开 AI 对话面板。
      //   语音过程中的 聆听/识别/回复/错误 反馈由底部 SubtitleLayer 独立展示，
      //   无需依赖 AI 面板可见性，避免空格键"顺带弹出聊天界面"干扰课堂。
      e.preventDefault();
      // ---------------- 模式分支 ----------------
      if (mode === 'toggle') {
        // 🔥 toggle 模式：单击切换
        //   - 没在录 → 开始（设 flag + startRecording）
        //   - 正在录 → 停止并提交（清 flag + stopRecording）
        const currentlyRecording = isRecordingRef.current;
        if (!currentlyRecording) {
          isRecordingRef.current = true;
          void startRecording();
        } else {
          isRecordingRef.current = false;
          void stopRecording();
        }
      } else {
        // pushToTalk 模式：按住才录（历史行为）
        isRecordingRef.current = true;
        void startRecording();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!isSpaceKey(e)) return;
      if (isEditable(e.target)) return;

      // toggle 模式：keyup 什么都不做（切换只在 keydown 触发）
      if (mode === 'toggle') return;

      // pushToTalk 模式：松开结束
      e.preventDefault();
      if (isRecordingRef.current) {
        isRecordingRef.current = false;
        void stopRecording();
      }
    };

    /** 窗口失焦时安全结束录音 */
    const onBlur = () => {
      if (isRecordingRef.current) {
        isRecordingRef.current = false;
        try { asr.abort(); } catch (e) { console.warn('[EmptyCatch] voice/PushToTalk.ts:350', (e as any)?.message ?? e); }
        store.getState().setVoice({ listening: false, asrStreaming: false });
      }
    };

    /** 页面隐藏时安全结束录音 */
    const onVisibilityChange = () => {
      if (document.hidden && isRecordingRef.current) {
        isRecordingRef.current = false;
        try { asr.abort(); } catch (e) { console.warn('[EmptyCatch] voice/PushToTalk.ts:359', (e as any)?.message ?? e); }
        store.getState().setVoice({ listening: false, asrStreaming: false });
      }
    };

    window.addEventListener('keydown', onKeyDown, /* 捕获阶段：必须在 Cesium canvas 之前命中空格，
      否则 Cesium 默认的 Space=重置相机会 stopPropagation，导致 PushToTalk 有时触发不到 */ true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (errorClearTimerRef.current != null) window.clearTimeout(errorClearTimerRef.current);
    };
  }, [enabled, mode, startRecording, stopRecording, asr, store, showError]);

  // ✅ ISSUE-2：课程切换时自动清空语音对话历史
  //   - 避免上一节课的"等高线是什么"影响到下一节课"锋面气旋"的回答
  //   - 通过 Zustand subscribe 监听 lesson.activeLessonId 变化，切换时 reset history
  useEffect(() => {
    return store.subscribe(
      (s) => s.lesson.activeLessonId,
      (newId) => {
        if (newId !== lastLessonIdRef.current) {
          clearHistory();
          lastLessonIdRef.current = newId;
        }
      },
      { fireImmediately: true },
    );
  }, [store, clearHistory]);

  /** 触摸设备：麦克风按钮 */
  const toggleRecording = useCallback(() => {
    if (isRecordingRef.current) {
      void stopRecording();
    } else {
      isRecordingRef.current = true;
      void startRecording();
    }
  }, [startRecording, stopRecording]);

  /** 打断当前旁白 */
  const interrupt = useCallback(() => {
    try { tts.stop(); } catch (e) { console.warn('[EmptyCatch] voice/PushToTalk.ts:407', (e as any)?.message ?? e); }
    store.getState().setVoice({ speaking: false });
  }, [tts, store]);

  return { toggleRecording, interrupt, clearHistory };
}
