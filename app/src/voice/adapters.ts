/**
 * 语音适配层 —— ASR / TTS / LLM 供应商抽象
 *
 * 设计目标：
 * - 供应商可替换（开发回退用浏览器 Web Speech API，生产用云端流式服务）
 * - 所有密钥通过环境变量配置，不进入前端构建产物
 * - 支持流式处理
 * - 支持取消、超时、错误分类
 *
 * 生产部署时，密钥应通过服务端代理使用，前端不直接持有 API Key。
 * 开发环境可用浏览器 Web Speech API 作为回退。
 */

import { safeJSONParse } from '../ui/sanitize';
// GEOGRAPHY_TOOLS 由 commands/schema.ts 从 TOOL_SCHEMAS 程序化生成，
// 让 LLM 能调用整个教学 API 面（此前手写数组只覆盖子集，导致 agent 无法调用大部分工具）。
import { GEOGRAPHY_TOOLS } from '../commands/schema';

/**
 * 从 FastAPI 返回的错误 JSON 中抽取可读错误消息。
 * FastAPI HTTPException(detail=_err_json(...)) 把业务错误包在 {detail: {error, code}} 里；
 * 也可能是 {ok:false, error: "..."} 或直接 {error: "..."}；
 * 或 Fetch 层解析失败时只有 statusText。这里全部兜底。
 */
export function extractApiError(errJson: unknown, fallback?: string): string {
  if (errJson == null) return fallback ?? '网络或服务未响应';
  if (typeof errJson === 'string') return errJson || (fallback ?? '未知错误');
  if (typeof errJson === 'number' || typeof errJson === 'boolean') return String(errJson);
  const o = errJson as Record<string, unknown>;
  // 路径 1：HTTPException(detail={ok:false, code, error})
  const d = o.detail as Record<string, unknown> | undefined;
  if (d && typeof d === 'object') {
    const de = d.error ?? d.message ?? d.code;
    if (typeof de === 'string' && de) return de;
  }
  // 路径 2：{ok:false, error, code} 或 {error} 直接返回
  const e = o.error ?? o.message ?? o.code;
  if (typeof e === 'string' && e) return e;
  if (typeof e === 'number') return `错误码:${e}`;
  // 路径 3：把整个对象 JSON 化兜底（避免展示 undefined）
  try {
    const s = JSON.stringify(o);
    if (s && s.length < 240) return s;
  } catch (e) { console.warn('[EmptyCatch] voice/adapters.ts:44', (e as any)?.message ?? e); }
  return fallback ?? '服务调用失败（未知错误）';
}

// ============ ASR ============

export interface ASRResult {
  text: string;
  isFinal: boolean;
}

export interface ASRAdapter {
  start(): Promise<void>;
  stop(): Promise<ASRResult>;
  /** 取消当前识别 */
  abort(): void;
  /** 是否正在识别 */
  isListening(): boolean;
  /** 设置实时 partial 文本回调（可选，流式 ASR 使用） */
  setOnPartial?(cb: (text: string) => void): void;
}

/** 浏览器 Web Speech API 回退（开发用，中文识别质量有限） */
export class BrowserSpeechASR implements ASRAdapter {
  private recognition: SpeechRecognition | null = null;
  private listening = false;
  private started = false;
  private finalText = '';
  private interimText = '';
  private lastErr: Error | null = null;
  private onPartialCb: ((text: string) => void) | null = null;
  private startResolve: (() => void) | null = null;
  private startReject: ((e: Error) => void) | null = null;
  private stopResolve: ((r: ASRResult) => void) | null = null;

  setOnPartial(cb: (text: string) => void): void {
    this.onPartialCb = cb;
  }

  private flushPartial(): void {
    const combined = this.finalText + (this.interimText ? (this.finalText ? ' ' : '') + this.interimText : '');
    try { this.onPartialCb?.(combined); } catch (e) { console.warn('[EmptyCatch] voice/adapters.ts:85', (e as any)?.message ?? e); }
  }

  async start(): Promise<void> {
    const SpeechRecognitionClass =
      (window as unknown as { SpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      throw new Error('浏览器不支持语音识别，请使用 Chrome/Edge 或 Safari 14.1+');
    }
    if (this.listening) return;

    this.finalText = '';
    this.interimText = '';
    this.lastErr = null;
    this.started = false;

    return new Promise((resolve, reject) => {
      this.startResolve = () => { this.startResolve = null; this.startReject = null; resolve(); };
      this.startReject = (e: Error) => { this.startResolve = null; this.startReject = null; this.cleanupRecognition(); reject(e); };

      const recognition = new SpeechRecognitionClass();
      this.recognition = recognition;
      recognition.lang = 'zh-CN';
      recognition.continuous = true;
      recognition.interimResults = true;
      // Chrome 上 maxAlternatives 太大影响响应速度，1 就够
      recognition.maxAlternatives = 1;

      // onstart：浏览器真正开始录音时才标志成功（之前设置 listening=true 过早会导致
      // 用户按空格太短就 stop，recognition.stop() 抛 invalid-state）
      recognition.onstart = () => {
        this.started = true;
        this.listening = true;
        this.startResolve?.();
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const transcript = res[0]?.transcript ?? '';
          if (res.isFinal) {
            this.finalText += (this.finalText && transcript ? ' ' : '') + transcript;
            this.interimText = '';
          } else {
            this.interimText = transcript;
          }
        }
        this.flushPartial();
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        const code = event.error;
        // no-speech / aborted 不视为致命失败，仅结束
        if (code === 'no-speech') {
          this.listening = false;
          // 如果 start 阶段还没 resolve，直接当成功（只是没说话）
          this.startResolve?.();
          this.stopResolve?.({ text: this.finalText, isFinal: true });
          return;
        }
        if (code === 'aborted') {
          this.listening = false;
          this.stopResolve?.({ text: this.finalText, isFinal: true });
          return;
        }
        const msgMap: Record<string, string> = {
          'not-allowed': '麦克风权限被拒绝，请在浏览器设置中允许麦克风访问',
          'service-not-allowed': '浏览器禁用了语音识别，请使用 Chrome/Edge',
          'audio-capture': '找不到麦克风设备',
          'network': '网络异常，云端语音识别无法连接',
          'bad-grammar': '语法配置错误',
          'language-not-supported': '不支持中文识别',
        };
        const message = msgMap[code] || `语音识别错误: ${code}`;
        const err = new Error(message);
        this.lastErr = err;
        // 启动阶段报错 → reject start
        if (!this.started && this.startReject) {
          this.startReject(err);
          return;
        }
        // 识别中途报错 → 把已累积的 finalText 当 stop 结果
        this.listening = false;
        this.stopResolve?.({ text: this.finalText, isFinal: true });
      };

      recognition.onend = () => {
        this.listening = false;
        // 若 stop 等待中则返回结果
        this.stopResolve?.({ text: this.finalText + (this.interimText ? (this.finalText ? ' ' : '') + this.interimText : ''), isFinal: true });
        // 若 start 还没 resolve（Safari 有时 onstart 不触发，直接 onend）
        this.startResolve?.();
      };

      try {
        recognition.start();
      } catch (e) {
        // start 同步抛：通常是 start 调用过于频繁
        const err = e instanceof Error ? e : new Error(String(e));
        this.startReject?.(err);
      }
    });
  }

  async stop(): Promise<ASRResult> {
    return new Promise((resolve) => {
      if (!this.recognition || !this.listening) {
        resolve({ text: this.finalText, isFinal: true });
        return;
      }
      this.stopResolve = (r) => {
        this.stopResolve = null;
        this.cleanupRecognition();
        resolve(r);
      };
      try {
        this.recognition.stop();
        // 兜底：3 秒内如果 onend 一直不来，强制返回已收集文本
        // （Firefox/Safari 某些情况下 recognition.stop() 不会触发 onend）
        window.setTimeout(() => {
          const text = this.finalText + (this.interimText ? (this.finalText ? ' ' : '') + this.interimText : '');
          this.stopResolve?.({ text, isFinal: true });
        }, 3000);
      } catch {
        // invalid-state：说明 recognition 还没 start 就 stop 了
        this.stopResolve?.({ text: this.finalText, isFinal: true });
      }
    });
  }

  private cleanupRecognition(): void {
    if (!this.recognition) return;
    try { this.recognition.abort(); } catch (e) { console.warn('[EmptyCatch] voice/adapters.ts:218', (e as any)?.message ?? e); }
    this.recognition.onstart = null;
    this.recognition.onresult = null;
    this.recognition.onerror = null;
    this.recognition.onend = null;
    this.recognition = null;
    this.listening = false;
    this.started = false;
  }

  abort(): void {
    this.stopResolve?.({ text: '', isFinal: true });
    this.cleanupRecognition();
    try { this.onPartialCb?.(''); } catch (e) { console.warn('[EmptyCatch] voice/adapters.ts:231', (e as any)?.message ?? e); }
  }

  isListening(): boolean {
    return this.listening;
  }
}

// ============ TTS ============

export interface TTSAdapter {
  speak(text: string): Promise<void>;
  /** 停止当前播放 */
  stop(): void;
  /** 是否正在播放 */
  isSpeaking(): boolean;
}

/** 浏览器 SpeechSynthesis 回退
 *
 *  Q3 AI 故障重点修复：
 *  1. getVoices() 首次调用是空的，voices 异步加载，必须在 voiceschanged 事件后重新选中文语音
 *  2. Chrome 有时 utterance.onend 不触发（长文本、切换标签页后），加 500ms 轮询兜底
 *  3. speak() 之前先 cancel 之前排队的 utterance，避免排队叠加
 */
export class BrowserSpeechTTS implements TTSAdapter {
  private speaking = false;
  private utterance: SpeechSynthesisUtterance | null = null;
  private voicesCached: SpeechSynthesisVoice[] = [];
  private voicesReady = false;
  private pollTimer: number | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.voicesCached = window.speechSynthesis.getVoices();
      if (this.voicesCached.length > 0) this.voicesReady = true;
      window.speechSynthesis.onvoiceschanged = () => {
        this.voicesCached = window.speechSynthesis.getVoices();
        this.voicesReady = true;
      };
    }
  }

  private pickZhVoice(): SpeechSynthesisVoice | undefined {
    if (this.voicesCached.length === 0) return undefined;
    // 优先：zh-CN、zh、zh-*；其次 Google 中文、Microsoft Huihui/Yao 等
    const zhCN = this.voicesCached.find((v) => v.lang.toLowerCase() === 'zh-cn');
    if (zhCN) return zhCN;
    const zhPrefixed = this.voicesCached.find((v) => v.lang.toLowerCase().startsWith('zh'));
    if (zhPrefixed) return zhPrefixed;
    // Chrome macOS 上中文常叫 "Google 普通话（中国大陆）" / voice.localService=true
    const zhByName = this.voicesCached.find((v) => /(?:Chinese|中文|普通话|Tingting|Meijia|Huihui|Yao|Xiaoxiao|Yunxi)/i.test(v.name));
    return zhByName;
  }

  async speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        resolve();
        return;
      }
      if (!text.trim()) { resolve(); return; }

      const synth = window.speechSynthesis;
      // 先清空队列，避免上一条还在讲
      try { synth.cancel(); } catch (e) { console.warn('[EmptyCatch] voice/adapters.ts:296', (e as any)?.message ?? e); }
      this.clearPoll();

      const utter = new SpeechSynthesisUtterance(text);
      this.utterance = utter;
      utter.lang = 'zh-CN';
      utter.rate = 1.0;
      utter.pitch = 1.0;
      utter.volume = 1.0;

      // voices 已就绪就直接选，否则 voiceschanged 触发后会再次填充（Chrome 会在 speak() 时重新读）
      const v = this.pickZhVoice();
      if (v) utter.voice = v;

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.speaking = false;
        this.clearPoll();
        resolve();
      };

      utter.onstart = () => {
        this.speaking = true;
        // 如果 voices 还没加载好，Chrome/Edge 在 speak() 后可能刚加载完成——再重新设一次 voice
        if (!v) {
          const v2 = this.pickZhVoice();
          if (v2) try { utter.voice = v2; } catch (e) { console.warn('[EmptyCatch] voice/adapters.ts:324', (e as any)?.message ?? e); }
        }
        this.startPoll(finish);
      };
      utter.onend = finish;
      utter.onerror = (e) => {
        // interrupted / canceled 也算正常结束
        if (e.error === 'canceled' || e.error === 'interrupted') { finish(); return; }
        finish();
      };
      utter.onpause = () => { /* noop */ };
      utter.onresume = () => { /* noop */ };
      utter.onmark = () => { /* noop */ };
      utter.onboundary = () => { /* noop */ };

      try {
        synth.speak(utter);
        // 再兜底：如果 utter 立刻抛 silent error，3 秒后强制结束
        // （某些 Android WebView 上 speak 后 onstart/onend 都不触发）
        window.setTimeout(() => {
          if (!settled && !synth.speaking && !synth.pending) finish();
        }, 3000);
      } catch {
        finish();
      }
    });
  }

  private startPoll(onStableStopped: () => void): void {
    this.clearPoll();
    // Chrome 长文本常见 bug：onend 不触发、synth.speaking 一直 true（15s~无穷）
    // 做法：连续 2 次轮询都 !speaking 且 !pending 则视为结束
    let stopCount = 0;
    this.pollTimer = window.setInterval(() => {
      try {
        const synth = window.speechSynthesis;
        if (!synth.speaking && !synth.pending) {
          stopCount++;
          if (stopCount >= 2) { onStableStopped(); }
        } else {
          stopCount = 0;
        }
      } catch (e) { console.warn('[EmptyCatch] voice/adapters.ts:366', (e as any)?.message ?? e); }
    }, 500);
  }

  private clearPoll(): void {
    if (this.pollTimer != null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  stop(): void {
    if ('speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch (e) { console.warn('[EmptyCatch] voice/adapters.ts:379', (e as any)?.message ?? e); }
    }
    this.speaking = false;
    this.clearPoll();
  }

  isSpeaking(): boolean {
    return this.speaking;
  }
}

// ============ LLM ============

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
}

export interface LLMResponse {
  text: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
}

export interface LLMAdapter {
  /** 流式或非流式对话。model：'main'=主模型、'fast'=快速模型、或直接传自定义模型 ID/endpoint_id */
  chat(messages: LLMMessage[], options?: { signal?: AbortSignal; model?: 'main' | 'fast' | string }): Promise<LLMResponse>;
}

export interface IntentResult {
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  replyText: string;
}

export interface IntentChatLLM {
  /** 给定一条最新用户消息，返回 (1) 要调用的工具调用列表；(2) 可直接展示的自然语言回复（如"我没理解…"）*/
  runIntent(userText: string, options?: { signal?: AbortSignal }): Promise<IntentResult>;
}

/** 在前端（adapters 层）判断一条话术属于「快速工具指令」还是「需要深度讲解/计算」，用于双模型路由 */
const FAST_INTENT_REGEX = /(?:定位|飞到|跳转|切到|切换到|打开|关闭|开启|关掉|显示|隐藏|启动|停止|开始|暂停|重置|清除|测量|测距|画|标出|设为|改成|设置|镜头.*(?:缩小|放大|拉远|拉近|旋转|俯视|平视))|(?:2D|3D|二维|三维|地图模式|地球模式|地形模式|卫星图|政区图|影像图)|(?:等高线|等高距|坡度|坡向|高程分层|夸张|图层|图层组)/i;

/**
 * 意图理解适配器 —— 将自然语言转为工具调用
 *
 * 生产环境应使用云端 LLM（如智谱 GLM、通义千问）通过服务端代理。
 * 开发回退：基于关键词匹配的简单意图解析。
 */
export class KeywordIntentLLM implements LLMAdapter, IntentChatLLM {
  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const userMessage = messages.findLast((m) => m.role === 'user');
    const text = userMessage?.content ?? '';

    const toolCalls = this.parseIntent(text);
    return {
      text: toolCalls.length > 0 ? '正在执行...' : '抱歉，我没有理解您的指令。',
      toolCalls,
    };
  }

  /** 实现 IntentChatLLM 接口：Q9 AI 对话界面使用，避免重复 chat 消息数组包装 */
  async runIntent(userText: string, _options?: { signal?: AbortSignal }): Promise<IntentResult> {
    // P2-2 闲聊 / 问候优先匹配：命中时不调用 parseIntent，返回温暖回复 + 0 条工具调用
    const greeting = this.matchGreeting(userText);
    if (greeting) return greeting;

    const toolCalls = this.parseIntent(userText);
    if (toolCalls.length === 0) {
      return {
        toolCalls: [],
        replyText:
          '我还没有理解这条指令。可以试试：\n• 飞到北京\n• 切换卫星图/等高线\n• 打开经纬线\n• 讲一下这里的位置（先点地图选点）\n• 开/关 AI 对话面板',
      };
    }
    const labels = toolCalls
      .slice(0, 6)
      .map((tc) => `\`${tc.name}\``)
      .join('、');
    const more = toolCalls.length > 6 ? ` … 共 ${toolCalls.length} 条` : '';
    return {
      toolCalls,
      replyText: `好的，我将执行 ${labels}${more}。如果某条命令失败会在下方单独提示。`,
    };
  }

  /** 匹配问候 / 闲聊类语句，命中时直接返回友好文字，不调任何工具 */
  private matchGreeting(text: string): IntentResult | null {
    const t = text.trim().toLowerCase();
    // 去掉标点、换行，让"你好！"、"你好？"、"你好 ：）"都命中
    const clean = t.replace(/[\s\u3000\u00a0.,!?？！。，、：:;；""''（）()\[\]【】\-—_/\\~@#$%^&*+=<>《》·`]+/g, '');
    const GREET = new Set([
      '你好', '您好', 'hi', 'hello', '嗨', '嗨嗨', '在吗', '在不在', '有人吗',
      '老师好', '助教好', '大家好', '你好呀', '您好呀',
      '早', '早上好', '早安', '上午好',
      '中午好', '午安',
      '下午好',
      '晚上好', '晚安',
      '嘿', '喂', '哈喽',
    ]);
    const THANKS = new Set([
      '谢谢', '感谢', '多谢', '谢谢啦', '谢谢你', '感谢你', 'thx', 'thanks', 'thankyou', '3q',
    ]);
    const BYE = new Set([
      '再见', '拜拜', '拜拜啦', 'bye', 'byebye', 'goodbye', '晚安', '回头见', '下次见',
    ]);
    const HELP = /^(帮助|help|怎么用|怎么操作|你会什么|能做什么|能帮我做什么|功能介绍|使用说明|教我用)$/.test(clean);

    if (GREET.has(clean)) {
      return {
        toolCalls: [],
        replyText:
          '你好呀👋 我是 AI 地理助教。单击空格键就能用语音和我说话（再按一次结束），也可以直接在这里打字。试试说：\n\n•「飞到北京」「去青藏高原」\n•「切换等高线」「打开经纬线」「切二维地图」\n•「讲一讲这里」（先在地球点一个位置）\n•「打开等高线课程」「退出课程」',
      };
    }
    if (THANKS.has(clean)) {
      return {
        toolCalls: [],
        replyText: '不客气🙂 想继续探索就单击空格键说话，或点顶部「AI 对话」随时回到这里。',
      };
    }
    if (BYE.has(clean)) {
      return {
        toolCalls: [],
        replyText: '好的，下次见🌍 你可以点「AI 对话」随时把我叫回来。',
      };
    }
    if (HELP) {
      return {
        toolCalls: [],
        replyText:
          '快捷键一览：\n• 单击空格：开始/结束语音说话（再按一次自动提交）\n• Cmd+K（Ctrl+K）：打开课程/命令菜单\n• ? 键：查看完整帮助\n• 点地图上的位置：选点后再说「讲一讲这里」会结合该点回答\n\n常用示例：\n1. 「等高线间距 500」\n2. 「打开行政边界」「切底图为卫星图」\n3. 「什么是晨昏线」（我会直接解释并切到相应图层）',
      };
    }
    return null;
  }

  /** 基于关键词的意图解析（开发回退） */
  private parseIntent(text: string): Array<{ name: string; args: Record<string, unknown> }> {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

    // ===== 底图切换（Q3-3 扩展：覆盖通用 + 高德共 12 种）=====
    const bm = matchBasemap(text);
    if (bm) calls.push({ name: 'view.setBasemap', args: { basemap: bm } });

    // ===== 视图重置 / 2D 3D / 地球太阳系 =====
    if (/重置视图|回到初始|初始化视图|视角重置|恢复视图|镜头复位/.test(text)) {
      calls.push({ name: 'camera.resetView', args: {} });
    }
    if (/二维|2d|平面图|平面地图/.test(text)) {
      calls.push({ name: 'view.setMode', args: { mode: '2d' } });
    }
    if (/三维|3d|立体|地球|球体/.test(text) && !bm) {
      // 如果命中底图关键词（如"3D卫星"），已经通过 bm 覆盖；这里只保留纯三维切换
      calls.push({ name: 'view.setMode', args: { mode: '3d' } });
    }
    if (/俯视图|鸟瞰|顶视图|正射|垂直向下/.test(text)) {
      // Q5 fix: schema 枚举只有 '2d'|'3d'|'columbus'；"俯视图"语义改为 3D + camera.lookDown，避免 TOOL_NOT_AVAILABLE
      calls.push({ name: 'view.setMode', args: { mode: '3d' } });
      calls.push({ name: 'camera.lookDown', args: {} });
    }
    if (/倾斜|斜视图|斜视|45度|四十五度/.test(text)) {
      calls.push({ name: 'view.setMode', args: { mode: '3d' } });
      calls.push({ name: 'camera.lookDown', args: { angle: 45 } });
    }
    if (/太阳系|行星|宇宙|九大行星|八大行星/.test(text)) {
      const back = /返回|回地球|退出太阳系|离开太阳系/.test(text);
      calls.push({ name: back ? 'view.showEarth' : 'view.showSolarSystem', args: {} });
    } else if (/返回地球|回地球|回到地球/.test(text)) {
      calls.push({ name: 'view.showEarth', args: {} });
    }

    // ===== 截图 =====
    if (/截图|保存画面|保存当前|导出图片|拍照/.test(text)) {
      calls.push({ name: 'camera.screenshot', args: {} });
    }

    // ===== 飞行到某地（扩展至 30+ 城市，含省会/直辖市/世界首都）=====
    const flyMatch = text.match(/(?:飞到|飞往|定位到|去|前往|定位|跳转|走到|看一下|看看)([\u4e00-\u9fa5A-Za-z·]{2,20})/);
    if (flyMatch) {
      const cityCoords: Record<string, [number, number, number?]> = {
        // 中国省会 + 直辖市 + 主要城市 (lon, lat, [heightKm])
        北京: [116.407, 39.904, 200], 上海: [121.474, 31.230, 150], 广州: [113.264, 23.129, 150],
        深圳: [114.086, 22.547, 80], 杭州: [120.153, 30.287, 150], 成都: [104.066, 30.572, 200],
        重庆: [106.551, 29.563, 200], 武汉: [114.305, 30.592, 150], 西安: [108.940, 34.341, 200],
        南京: [118.796, 32.060, 150], 天津: [117.190, 39.125, 150], 苏州: [120.585, 31.299, 80],
        长沙: [112.938, 28.228, 150], 青岛: [120.383, 36.067, 100], 郑州: [113.625, 34.746, 150],
        大连: [121.615, 38.914, 80], 厦门: [118.089, 24.479, 50], 昆明: [102.833, 24.880, 200],
        哈尔滨: [126.642, 45.756, 250], 乌鲁木齐: [87.617, 43.825, 300], 拉萨: [91.132, 29.660, 300],
        三亚: [109.512, 18.257, 80], 海口: [110.199, 20.044, 100], 香港: [114.169, 22.319, 50],
        澳门: [113.543, 22.198, 30], 台北: [121.565, 25.033, 100],
        珠穆朗玛峰: [86.925, 27.988, 20], 珠峰: [86.925, 27.988, 20],
        泰山: [117.103, 36.253, 20], 黄山: [118.170, 30.130, 20], 长江三峡: [110.460, 30.830, 50],
        // 世界主要城市
        东京: [139.692, 35.689, 200], 首尔: [126.978, 37.566, 200], 新加坡: [103.820, 1.352, 100],
        曼谷: [100.501, 13.756, 150], 新德里: [77.209, 28.614, 250], 迪拜: [55.270, 25.204, 100],
        莫斯科: [37.617, 55.755, 300], 伦敦: [-0.127, 51.507, 250], 巴黎: [2.352, 48.856, 200],
        柏林: [13.405, 52.520, 250], 罗马: [12.496, 41.902, 200], 纽约: [-74.006, 40.712, 200],
        洛杉矶: [-118.243, 34.052, 200], 旧金山: [-122.419, 37.774, 150], 华盛顿: [-77.036, 38.907, 200],
        悉尼: [151.209, -33.868, 250], 里约热内卢: [-43.172, -22.906, 200], 开罗: [31.235, 30.044, 200],
        开普敦: [18.424, -33.924, 200], 布宜诺斯艾利斯: [-58.381, -34.603, 250],
      };
      const raw = flyMatch[1];
      const key = (Object.keys(cityCoords).find((k) => raw.includes(k))) ?? '';
      const coords = key ? cityCoords[key] : undefined;
      if (coords) {
        calls.push({
          name: 'camera.flyTo',
          args: {
            longitude: coords[0],
            latitude: coords[1],
            height: (coords[2] ?? 300) * 1000,
            duration: 2.5,
          },
        });
      }
    }

    // ===== 地形分析（等高线、高程分层、坡度、坡向）=====
    if (/等高线|地形图/.test(text)) {
      const spacingMatch = text.match(/(?:等高线|间距).{0,4}?(\d+(?:\.\d+)?)\s*米/);
      const spacing = spacingMatch ? parseFloat(spacingMatch[1]) : 200;
      calls.push({ name: 'layer.showContour', args: { spacing } });
    }
    if (/高程|分层|分层设色|地势分带|海拔分色|高程分带/.test(text)) {
      calls.push({ name: 'layer.showElevationRamp', args: {} });
    }
    // Q5 fix: 不存在 terrain.showSlope / terrain.showAspect；真实命令名是 layer.showSlope / layer.showAspect
    if (/坡度|坡度图/.test(text)) {
      calls.push({ name: 'layer.showSlope', args: {} });
    }
    if (/坡向|坡向图/.test(text)) {
      calls.push({ name: 'layer.showAspect', args: {} });
    }
    if (/剖面图|地形剖面/.test(text)) {
      // Q5 fix: 不存在 terrain.drawProfile；真实命令是 terrain.profile（需路径点），这里先不加，避免 TOOL_NOT_AVAILABLE
      // 未来若在 TopBar/ToolDock 增加"启动剖面绘制工具"按钮，再映射到对应命令
    }
    // Q5 fix: remove inundation / viewshed（不实现，避免虚假状态）
    // if (/淹没分析|洪水|海平面上升/.test(text)) { ... }
    // if (/通视分析|可视域|视线分析/.test(text)) { ... }

    // ===== 图层开关（Q5 fix：全部必须在 layer.toggle enum 里，否则 validateToolCall 拒绝）=====
    const layerMap: Record<string, string> = {
      城市: 'cities', 经纬线: 'graticule', 晨昏线: 'twilight', 昼夜: 'twilight',
      气候带: 'climateZones', 气候类型: 'climateZones',
      板块: 'plates', 板块边界: 'plates', 构造板块: 'plates',
      日界线: 'dateLine', 国际日期变更线: 'dateLine',
      河流: 'rivers', 主要河流: 'rivers', 长江: 'rivers', 黄河: 'rivers', 尼罗河: 'rivers', 亚马孙河: 'rivers',
      山脉: 'mountains', 山系: 'mountains', 喜马拉雅: 'mountains', 阿尔卑斯: 'mountains', 落基山: 'mountains',
      行政边界: 'adminBounds', 国界: 'adminBounds', 国家边界: 'adminBounds', 省界: 'adminBounds',
      洋流: 'oceanCurrents', 海流: 'oceanCurrents', 暖流: 'oceanCurrents', 寒流: 'oceanCurrents',
      季风: 'monsoonWinds', 冬季风: 'monsoonWinds', 夏季风: 'monsoonWinds',
      地震: 'earthquake', 火山: 'naturalEvents', 自然事件: 'naturalEvents', 野火: 'naturalEvents', 风暴: 'naturalEvents',
      天气: 'weather', 云图: 'weather', 卫星云图: 'weather',
      人口: 'population', 人口密度: 'population',
      GDP: 'gdp', 经济: 'gdp',
      温度: 'temperature', 气温: 'temperature',
      降水: 'precipitation', 降雨量: 'precipitation',
    };

    Object.entries(layerMap).forEach(([kw, layer]) => {
      const re = new RegExp(`(?:显示|打开|开启|加上|标出|添加|启用)\\s*(?:.*?)${kw}|(?:^|\\s|[，。])${kw}(?:\\s*(?:层|图层|线|图|带))?\\s*(?:显示|打开|开启|标出|启用)`);
      const reHide = new RegExp(`(?:隐藏|关闭|关掉|去掉|移除|禁用|取消)\\s*(?:.*?)${kw}|(?:^|\\s|[，。])${kw}(?:\\s*(?:层|图层|线|图|带))?\\s*(?:隐藏|关闭|关掉|去掉|移除)`);
      if (reHide.test(text)) {
        // 先关再开，避免重复 push
        if (!calls.find((c) => c.name === 'layer.toggle' && (c.args as Record<string, unknown>).layer === layer && !(c.args as Record<string, unknown>).visible)) {
          calls.push({ name: 'layer.toggle', args: { layer, visible: false } });
        }
      } else if (re.test(text)) {
        if (!calls.find((c) => c.name === 'layer.toggle' && (c.args as Record<string, unknown>).layer === layer && (c.args as Record<string, unknown>).visible)) {
          calls.push({ name: 'layer.toggle', args: { layer, visible: true } });
        }
      }
    });

    // 快速：清除所有标注/图层
    if (/清除所有|清空标注|重置标注|全部清除|移除所有/.test(text)) {
      calls.push({ name: 'annotate.clearAll', args: {} });
    }

    // ===== 动画 =====
    if (/自转|地球.*转|旋转.*地球|停止转动|暂停转动/.test(text)) {
      if (/停止|暂停|关闭|不要|取消/.test(text)) {
        calls.push({ name: 'animation.pause', args: {} });
      } else {
        calls.push({ name: 'animation.play', args: {} });
      }
    }
    // 动画速度
    const speedMatch = text.match(/(?:自转|旋转|转动|地球)?.{0,4}(?:速度|倍).{0,4}(\d+(?:\.\d+)?)\s*倍?/);
    if (speedMatch && /自转|旋转|地球|转动/.test(text)) {
      const speed = parseFloat(speedMatch[1]);
      if (!isNaN(speed)) {
        calls.push({ name: 'animation.setSpeed', args: { speed } });
      }
    }
    // 时间跳转
    const timeMatch = text.match(/(?:时间|日期|跳到|跳转|设置为).{0,6}(\d{4})[年\-\/](\d{1,2})[月\-\/](\d{1,2})/);
    if (timeMatch) {
      const y = parseInt(timeMatch[1], 10);
      const mo = parseInt(timeMatch[2], 10);
      const d = parseInt(timeMatch[3], 10);
      if (!isNaN(y) && !isNaN(mo) && !isNaN(d)) {
        calls.push({ name: 'animation.setDate', args: { date: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` } });
      }
    }

    // ===== 地形夸张 / 轴倾角 / 太阳高度 / 公转 =====
    const exaggerateMatch = text.match(/(?:地形)?夸张.{0,4}(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*倍.{0,4}(?:地形|夸张|抬高)/);
    if (exaggerateMatch) {
      const val = parseFloat(exaggerateMatch[1] || exaggerateMatch[2]);
      if (!isNaN(val)) {
        calls.push({ name: 'terrain.setExaggeration', args: { value: val } });
      }
    }
    const tiltMatch = text.match(/(?:轴倾角|倾角|地轴|黄赤交角).{0,4}(-?\d+(?:\.\d+)?)/);
    if (tiltMatch) {
      const val = parseFloat(tiltMatch[1]);
      if (!isNaN(val)) {
        calls.push({ name: 'astronomy.setAxisTilt', args: { value: val } });
      }
    }
    const sunMatch = text.match(/(?:太阳高度|太阳高|直射点).{0,4}(-?\d+(?:\.\d+)?)/);
    if (sunMatch) {
      const val = parseFloat(sunMatch[1]);
      if (!isNaN(val)) {
        calls.push({ name: 'astronomy.setSunHeight', args: { value: val } });
      }
    }
    const revMatch = text.match(/(?:公转速度|公转).{0,4}(\d+(?:\.\d+)?)\s*倍/);
    if (revMatch) {
      const val = parseFloat(revMatch[1]);
      if (!isNaN(val)) {
        calls.push({ name: 'astronomy.setRevolutionSpeed', args: { speed: val } });
      }
    }

    // ===== 测量 / 标注 =====
    if (/测距离|距离|测距|两点.*距|测量距离/.test(text)) {
      calls.push({ name: 'measure.start', args: { mode: 'distance' } });
    }
    if (/测面积|面积|量算面积/.test(text)) {
      calls.push({ name: 'measure.start', args: { mode: 'area' } });
    }
    if (/测量高度|高度|海拔|高程查询/.test(text)) {
      calls.push({ name: 'measure.start', args: { mode: 'height' } });
    }
    if (/方位角|方向角|测方位/.test(text)) {
      calls.push({ name: 'measure.start', args: { mode: 'angle' } });
    }
    // 清除标注
    if (/清除标注|清除测量|清除画线|移除标注|移除测量/.test(text)) {
      calls.push({ name: 'measure.clear', args: {} });
    }

    // ===== 课程（Q3-3 扩展：支持退出课程 + 新增 10+ 课程 ID）=====
    if (/退出课程|关闭课程|结束课程|停止课程|退出学习|返回主界面/.test(text)) {
      calls.push({ name: 'lesson.close', args: {} });
    }
    if (/上一步|上一节|上一个|回到上一步|后退/.test(text)) {
      calls.push({ name: 'lesson.prevStep', args: {} });
    }
    if (/下一步|下一节|继续|下一步骤|前进/.test(text)) {
      calls.push({ name: 'lesson.nextStep', args: {} });
    }
    if (/重播|重放|再讲一次|再读一遍|重复/.test(text)) {
      calls.push({ name: 'lesson.replayStep', args: {} });
    }

    const lessonMatch = text.match(/(?:开始|打开|进入|启动|上|学|学习|教|讲|讲解|演示).{0,6}?(等高线|自转|公转|板块|板块构造|冷锋|暖锋|锋面|季风|洋流|地势|中国地势|五带|地球五带|气候类型|长江|黄河|水资源|土地资源|农业|工业|交通运输|聚落|人口|人种|宗教|语言|天气与气候|天气预报|台风|地质作用|外力作用|内力作用|褶皱|断层|土壤|自然带|地域分异|整体性|水循环|水平衡|岩石圈|大气环流|三圈环流|气压带|风带|热力环流|季风环流|海陆分布|天气系统|气旋|反气旋|全球变暖|臭氧|可持续发展|区域发展|西气东输|南水北调|西电东送|产业转移|城市化|环境问题|流域综合治理|大江大河|治理|自然灾害|防灾减灾|RS|GIS|GPS|3S技术|区域地理|乡土地理|中国地理|世界地理|极地地区|中东|欧洲西部|撒哈拉以南非洲|拉丁美洲|北美|东南亚|南亚|中亚|西亚|北非|南极|北极)课程?/);
    if (lessonMatch) {
      const lessonMap: Record<string, string> = {
        等高线: 'contour-lines', 自转: 'earth-rotation', 公转: 'earth-revolution',
        板块: 'plate-tectonics', 板块构造: 'plate-tectonics',
        冷锋: 'cold-front', 暖锋: 'warm-front', 锋面: 'fronts',
        季风: 'monsoon', 洋流: 'ocean-currents',
        地势: 'china-terrain', 中国地势: 'china-terrain',
        五带: 'five-zones', 地球五带: 'five-zones',
        气候类型: 'climate-types',
        长江: 'yangtze-river', 黄河: 'yellow-river',
        水资源: 'water-resources', 土地资源: 'land-resources',
        农业: 'agriculture', 工业: 'industry', 交通运输: 'transportation',
        聚落: 'settlements', 人口: 'population', 人种: 'human-races',
        宗教: 'religions', 语言: 'languages',
        天气与气候: 'weather-climate', 天气预报: 'weather-forecast',
        台风: 'typhoon-lesson', 地质作用: 'geological-processes',
        外力作用: 'exogenic-forces', 内力作用: 'endogenic-forces',
        褶皱: 'folds', 断层: 'faults',
        土壤: 'soils', 自然带: 'natural-belts',
        地域分异: 'regional-differentiation', 整体性: 'geosphere-integrity',
        水循环: 'water-cycle', 水平衡: 'water-balance',
        岩石圈: 'lithosphere-cycle', 大气环流: 'atmospheric-circulation',
        三圈环流: 'triple-cell-circulation', 气压带: 'pressure-wind-belts',
        风带: 'pressure-wind-belts', 热力环流: 'thermal-circulation',
        季风环流: 'monsoon-circulation', 海陆分布: 'land-sea-distribution',
        天气系统: 'weather-systems', 气旋: 'cyclones', 反气旋: 'anticyclones',
        全球变暖: 'global-warming', 臭氧: 'ozone',
        可持续发展: 'sustainable-dev',
        区域发展: 'regional-dev',
        西气东输: 'west-east-gas', 南水北调: 'south-north-water',
        西电东送: 'west-east-power', 产业转移: 'industry-transfer',
        城市化: 'urbanization', 环境问题: 'environmental-issues',
        流域综合治理: 'river-basin', 大江大河: 'river-basin',
        治理: 'river-basin',
        自然灾害: 'natural-disasters', 防灾减灾: 'disaster-prevention',
        RS: 'rs-gis-gps', GIS: 'rs-gis-gps', GPS: 'rs-gis-gps', '3S技术': 'rs-gis-gps',
        区域地理: 'regional-geography', 乡土地理: 'local-geography',
        中国地理: 'china-geography', 世界地理: 'world-geography',
        极地地区: 'polar-regions', 中东: 'middle-east',
        欧洲西部: 'western-europe', 撒哈拉以南非洲: 'sub-saharan-africa',
        拉丁美洲: 'latin-america', 北美: 'north-america',
        东南亚: 'southeast-asia', 南亚: 'south-asia',
        中亚: 'central-asia', 西亚: 'west-asia', 北非: 'north-africa',
        南极: 'antarctica', 北极: 'arctic',
      };
      const lessonId = lessonMap[lessonMatch[1]];
      if (lessonId) {
        calls.push({ name: 'lesson.open', args: { lessonId } });
      }
    }

    // ===== 问题 & 解释 =====
    if (/这是哪里|这里是什么地方|这是哪儿|识别地点|识别位置/.test(text)) {
      // 映射到 explain.location（使用当前相机坐标）
      calls.push({ name: 'explain.location', args: {} });
    }
    if (/现在.*时间|当前.*时间|几点|日期是什么|今天几号/.test(text)) {
      // 无直接命令 → 用 explain.location 带出时间信息，或者不添加工具调用
      // 这里不 push 命令，让 AI 用自然语言回复当前时间
    }
    const whyMatch = text.match(/(?:为什么|讲解|解释|说明|介绍).{0,20}/);
    if (whyMatch && calls.length === 0 && !bm) {
      // 映射到 explain.terrain 或 explain.location，优先用当前位置解释
      calls.push({ name: 'explain.location', args: {} });
    }

    // ===== UI 控制：打开/关闭 AI 对话面板、工具坞、点击按钮（让本地回退也能控制界面）=====
    if (/(打开|开启|显示|弹出|唤起|打开).*AI|打开.*对话|打开.*面板|显示.*对话|唤起.*助教|ai.*面板|ai.*对话/i.test(text) && !/关闭|关掉|隐藏|收起/.test(text)) {
      calls.push({ name: 'aiChat.open', args: {} });
    }
    if (/(关闭|关掉|收起|隐藏|最小化).*AI|关闭.*对话|关闭.*面板|收起.*对话|隐藏.*对话|收起.*面板/i.test(text)) {
      calls.push({ name: 'aiChat.close', args: {} });
    }
    if (/(清空|清除|删除).*对话|清空.*历史|清除.*历史|重新开始.*对话/i.test(text)) {
      calls.push({ name: 'aiChat.clear', args: {} });
    }
    // 工具坞控制
    if (/(打开|展开|显示).*工具坞|展开.*工具|显示.*工具/i.test(text) && !/关闭|收起|隐藏/.test(text)) {
      calls.push({ name: 'ui.clickButton', args: { buttonId: 'dock.expand' } });
    }
    if (/(收起|折叠|隐藏|关闭).*工具坞|收起.*工具|折叠.*工具/i.test(text)) {
      calls.push({ name: 'ui.clickButton', args: { buttonId: 'dock.collapse' } });
    }
    // 打开工具坞某面板（视图/标注/天文/数据/测量）
    const dockPanelMatch = text.match(/(?:打开|展开|显示|看).*?(视图|标注|天文|数据|测量).*?(?:面板|菜单|工具)?/);
    if (dockPanelMatch) {
      const map: Record<string, string> = { '视图': 'dock.view', '标注': 'dock.annotation', '天文': 'dock.astronomy', '数据': 'dock.data', '测量': 'dock.measure' };
      const bid = map[dockPanelMatch[1]];
      if (bid) calls.push({ name: 'ui.clickButton', args: { buttonId: bid } });
    }
    // 太阳系视图按钮
    if (/太阳系.*视图|切换.*太阳系|进入.*太阳系|行星.*视图/i.test(text)) {
      calls.push({ name: 'ui.clickButton', args: { buttonId: 'astronomy.toggleSolarSystem' } });
    }

    return calls;
  }
}

/** 关键词匹配底图（返回 BasemapType 字符串；null=未命中） */
function matchBasemap(text: string): string | null {
  // 优先匹配更长词，避免"卫星"先匹配到 satellite 再把"高德卫星"当同义词
  if (/高德.*卫星|高德影像|amap.*(卫星|satellite|影像)/i.test(text)) return 'amapSatellite';
  if (/高德.*路网|高德.*行政|高德.*政区|高德.*中文|amap.*(road|路网|政区|行政)/i.test(text)) return 'amapPolitical';
  if (/高德.*纯路|高德.*道路|amap.*(?:pure|plain).*road/i.test(text)) return 'amapRoad';
  if (/高德地图|高德/i.test(text)) {
    // 未指定具体层：默认卫星图（教学场景优先）
    return 'amapSatellite';
  }
  if (/卫星|影像|birdview|航拍|遥感/i.test(text)) return 'satellite';
  if (/政区|行政|政治|political|国家.*地图/i.test(text)) return 'political';
  if (/地形|晕渲|relief|shaded/i.test(text)) return 'relief';
  if (/地貌|landform/i.test(text)) return 'landform';
  if (/轮廓|淡色|浅色|底图|minimal|outline/i.test(text)) return 'contour';
  if (/OSM|openstreetmap|开放街图|街道地图|街景|路网.*通用/i.test(text)) return 'osm';
  // 天地图系列（历史别名）
  if (/天地图.*影像|tianditu.*img/i.test(text)) return 'satellite';
  if (/天地图.*地形|tianditu.*ter/i.test(text)) return 'relief';
  return null;
}

// ============ 火山引擎适配器（生产，需服务端代理） ============
//
// 所有密钥由服务端代理持有，前端只调用同源 /api/* 端点。
// 服务端实现见 app/server/index.ts。
// 任何代理失败都抛错，由 PushToTalk 捕获并降级到浏览器回退。
// 详见 docs/voice-agent.md §5 密钥安全。

/** 火山方舟 LLM 适配器（OpenAI 兼容，支持 tools function calling） */
export class VolcengineArkLLM implements LLMAdapter, IntentChatLLM {
  private systemPrompt =
    '你是「AI 地理画布」的助教。用简洁的中文回答初高中地理问题。若用户说"飞到XX"、"切换XX图"、"打开XX图层"、"设置XX"等可操作的内容，通过 tool_calls 调用提供的工具，用自然语言给一句简短回复。你还能控制界面：用户说"打开/关闭 AI 对话面板"、"打开工具坞"、"收起工具坞"、"打开视图面板/标注面板/数据面板"等 UI 操作时，调用 aiChat.open/close 或 ui.clickButton 工具。闲聊/问候时只回复文字，不要调工具。若无法判断，优先返回文字解释 + 建议的操作示例。';

  async chat(messages: LLMMessage[], options?: { signal?: AbortSignal; model?: 'main' | 'fast' | string }): Promise<LLMResponse> {
    // 将内部 LLMMessage 转为方舟格式
    const arkMessages = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // 注入工具定义（与 TOOL_NAMES/SCHEMAS 对齐，由服务端代理透传）
    const tools = GEOGRAPHY_TOOLS;

    // 双模型路由：显式指定优先，否则按最后一条用户话术的关键词判断
    const lastUserText = messages.findLast((m) => m.role === 'user')?.content ?? '';
    const isFastIntent = !options?.model && FAST_INTENT_REGEX.test(lastUserText);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (options?.model) headers['X-Model'] = options.model;
    else if (isFastIntent) headers['X-Intent-Hint'] = 'fast';

    const res = await fetch('/api/llm/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: arkMessages,
        tools,
        tool_choice: 'auto',
        stream: false,
        temperature: 0.2,
      }),
      signal: options?.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`火山 LLM 调用失败: ${extractApiError(err, res.statusText)}`);
    }

    const rawText = await res.text();
    const data = safeJSONParse<{
      choices?: Array<{
        message?: {
          content?: string;
          tool_calls?: Array<{
            function?: { name: string; arguments: string };
          }>;
          reply?: string;
          commands?: Array<{ name: string; args: Record<string, unknown> }>;
        };
      }>;
      reply?: string;
      commands?: Array<{ name: string; args: Record<string, unknown> }>;
    }>(rawText) ?? {};

    const choice = data.choices?.[0];
    const message = choice?.message;
    const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

    // 槽位 1：OpenAI-style tool_calls (function.arguments)
    (message?.tool_calls ?? []).forEach((tc) => {
      try {
        const args = (safeJSONParse<Record<string, unknown>>(tc.function?.arguments ?? '{}') ?? {}) as Record<string, unknown>;
        const name = tc.function?.name ?? '';
        if (name) toolCalls.push({ name, args });
      } catch (e) { console.warn('[EmptyCatch] voice/adapters.ts:944', (e as any)?.message ?? e); }
    });

    // 槽位 2：服务端自定义 {reply, commands}（非流式 JSON）
    const commands = (message?.commands ?? data.commands ?? []) as Array<{ name: string; args: Record<string, unknown> }>;
    if (commands.length > 0) {
      for (const c of commands) if (c?.name) toolCalls.push(c);
    }

    // 回复文本：choices[0].message.content 优先，其次 .reply / data.reply
    const naturalText =
      message?.content?.trim() || message?.reply?.trim() || data.reply?.trim() || '';

    return {
      text: naturalText,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  /** 实现 IntentChatLLM 接口：Q9 AI 对话面板直接调用；失败自动回退到 KeywordIntentLLM */
  async runIntent(userText: string, options?: { signal?: AbortSignal }): Promise<IntentResult> {
    try {
      const messages: LLMMessage[] = [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: userText },
      ];
      const resp = await this.chat(messages, { signal: options?.signal });
      const tc = (resp.toolCalls ?? []) as Array<{ name: string; args: Record<string, unknown> }>;
      let replyText = (resp.text ?? '').trim();
      if (!replyText && tc.length > 0) {
        const labels = tc.slice(0, 4).map((x) => `\`${x.name}\``).join('、');
        const more = tc.length > 4 ? ` … 共 ${tc.length} 条` : '';
        replyText = `好的，我将执行 ${labels}${more}。如果某条命令失败会单独提示。`;
      }
      if (!replyText && tc.length === 0) {
        replyText = '（模型返回为空）试试说：飞到北京 / 切等高线 / 打开经纬线。';
      }
      return {
        toolCalls: tc,
        replyText,
      };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      // 云端调用失败 → 自动降级到本地关键词回退，不中断对话
      const fallback = new KeywordIntentLLM();
      const res = await fallback.runIntent(userText, options);

      // 分析错误类型，输出更清晰的排错提示
      let diagnosis = '';
      if (errMsg.includes('Failed to fetch') || errMsg.includes('fetch 调用失败') || errMsg.includes('502') || errMsg.includes('404')) {
        diagnosis =
          '\n\n⚠️ 云端未连接到语音代理服务。请在 app 目录下另起一个终端执行：\n    npm run voice:proxy\n   （代理启动后会监听 8787 端口，前端请求会自动通过同源代理调用火山引擎。）';
      } else if (errMsg.includes('PROVIDER_NOT_CONFIGURED')) {
        diagnosis =
          '\n\n⚠️ 服务端未检测到密钥。请检查 api/.env 里已填写 VOLC_ARK_API_KEY（不是 app/server/.env，现主线后端为 FastAPI 的 api/ 目录）。\n   推荐启动方式：\n    ① 仓库根： make api  \n    ② 仓库根： ./earth-api --reload  \n    ③ 仓库根（你原命令）： uvicorn main:app --host 127.0.0.1 --port 8787 --reload  \n   （仓库根 main.py 会自动代理到 api/main.py，不要再跑 npm run voice:proxy，已互斥废弃。）';
      } else if (errMsg.includes('UPSTREAM_ERROR') || errMsg.includes('方舟调用失败')) {
        diagnosis = `\n\n⚠️ 火山方舟调用被上游返回：${errMsg.slice(0, 120)}。请检查 VOLC_ARK_API_KEY / 模型 ID 是否正确，或在火山控制台查看配额。`;
      } else {
        diagnosis = `\n\n（出错细节：${errMsg}）`;
      }

      if (res.replyText && res.toolCalls.length === 0) {
        return {
          toolCalls: [],
          replyText:
            '云端模型暂时不可用，已切换到本地关键词解析：\n\n' + res.replyText + diagnosis,
        };
      }
      // 有工具调用 → 原样返回 + 头部加降级提示
      return {
        ...res,
        replyText: `云端模型不可用，已降级到本地关键词解析：\n\n${res.replyText}${diagnosis}`,
      };
    }
  }
}

/** 火山引擎 TTS 适配器（HTTP 非流式，返回 base64 音频） */
export class VolcengineTTS implements TTSAdapter {
  private speaking = false;
  private audio: HTMLAudioElement | null = null;

  async speak(text: string): Promise<void> {
    this.stop();
    if (!text.trim()) return;

    this.speaking = true;
    try {
      const res = await fetch('/api/tts/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(`火山 TTS 失败: ${extractApiError(err, res.statusText)}`);
      }

      const data = await res.json() as { ok: boolean; audio?: string; format?: string; error?: string };
      if (!data.ok || !data.audio) {
        throw new Error(data.error ?? 'TTS 返回无效');
      }

      const mime = data.format === 'wav' ? 'audio/wav' : `audio/${data.format ?? 'mp3'}`;
      const blob = new Blob([
        Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0)),
      ], { type: mime });
      const url = URL.createObjectURL(blob);

      this.audio = new Audio(url);
      this.audio.onended = () => {
        this.speaking = false;
        URL.revokeObjectURL(url);
      };
      this.audio.onerror = () => {
        this.speaking = false;
        URL.revokeObjectURL(url);
      };

      await this.audio.play();
    } catch (err) {
      this.speaking = false;
      throw err;
    }
  }

  stop(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
    this.speaking = false;
  }

  isSpeaking(): boolean {
    return this.speaking;
  }
}

// ============ 重采样 + 音频工具（线性插值，满足教学场景 8kHz 语音带宽）============

/** 线性插值重采样器：任意 inputSR → targetSR（16kHz），单通道 Float32 */
function createLinearResampler(inputSR: number, targetSR: number): {
  push(chunk: Float32Array): Float32Array;
} {
  if (inputSR <= 0 || targetSR <= 0) throw new Error('sampleRate invalid');
  if (inputSR === targetSR) {
    return { push: (c) => c.slice() };
  }
  const ratio = inputSR / targetSR;
  let tailSample = 0; // 上一帧最后一个 sample，用于帧边界插值
  let tailFrac = 0;   // 0..1 表示下一个输出 sample 距离 tailSample 的分数位置
  return {
    push(chunk: Float32Array): Float32Array {
      if (chunk.length === 0) return new Float32Array(0);
      // 预估输出长度
      const outLen = Math.max(0, Math.floor((chunk.length + tailFrac) / ratio));
      if (outLen === 0) {
        // 输入还不够凑一个输出 sample
        tailFrac += chunk.length;
        tailSample = chunk[chunk.length - 1];
        return new Float32Array(0);
      }
      const out = new Float32Array(outLen);
      let inIdx = -tailFrac;  // 距离当前 chunk 起点的浮点索引（可以为负：表示用 tailSample）
      for (let o = 0; o < outLen; o++) {
        const iFloor = Math.floor(inIdx);
        const frac = inIdx - iFloor;
        const a = iFloor < 0 ? tailSample : chunk[iFloor];
        const b = iFloor + 1 < 0 ? tailSample : (iFloor + 1 >= chunk.length ? chunk[chunk.length - 1] : chunk[iFloor + 1]);
        out[o] = a + (b - a) * frac;
        inIdx += ratio;
      }
      // 记录帧尾状态
      const lastOutIdx = outLen - 1;
      const lastInFloat = -tailFrac + lastOutIdx * ratio + ratio; // 最后一个输出 sample 后下一个位置
      tailFrac = chunk.length - lastInFloat;
      if (tailFrac < 0) tailFrac = 0;
      tailSample = chunk[chunk.length - 1];
      return out;
    },
  };
}

/** Float32 [-1,1] → Int16 PCM 小端 */
function float32ToPcm16(src: Float32Array): Int16Array {
  const len = src.length;
  const out = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const s = src[i];
    // 截断 + 量化，避免 +/- overflow
    const x = s <= -1 ? -0x8000 : s >= 1 ? 0x7fff : Math.round(s * 0x7fff);
    out[i] = x;
  }
  return out;
}

/**
 * 流式 ASR 适配器 —— 基于 WebSocket + MediaRecorder 的实时语音识别
 *
 * 架构：
 * 浏览器 MediaRecorder → PCM16 chunks → WebSocket → 服务端 → 火山引擎流式 ASR
 * 服务端回传 partial / final 文本 → onPartial 回调 → UI 实时显示
 *
 * 特性：
 * - 实时 partial 文本回传（用户说话时即可看到识别结果）
 * - 说话结束后 final 文本直接可用，无需等待完整录音上传
 * - 自动降级：WebSocket 连接失败时回退到浏览器 Web Speech API
 */
export class StreamingASR implements ASRAdapter {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private listening = false;
  private finalText = '';
  private sampleRate = 16000;
  private onPartial: ((text: string) => void) | null = null;
  private aborted = false;
  /** §2.1 握手重试：3 次指数退避（400ms / 800ms / 1600ms） */
  private readonly handshakeAttempts = 3;
  /** §2.3 partial 文本节流（50ms），避免 UI 过度重绘 */
  private partialLastAt = 0;
  private partialThrottleMs = 50;
  /** partial 文本在写入 final 之前暂存，避免与 transcript 状态混淆 */
  private partialBuf = '';

  setOnPartial(cb: (text: string) => void) { this.onPartial = cb; }

  async start(): Promise<void> {
    this.aborted = false;
    this.finalText = '';
    this.partialBuf = '';
    this.partialLastAt = 0;

    let lastErr: Error | null = null;
    for (let attempt = 1; attempt <= this.handshakeAttempts; attempt++) {
      try {
        await this.connectHandshake();
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        console.warn('[StreamingASR] 握手失败', attempt, lastErr.message);
        if (attempt < this.handshakeAttempts) {
          // 指数退避
          const waitMs = 400 * Math.pow(2, attempt - 1);
          await new Promise<void>((r) => setTimeout(r, waitMs));
        }
      }
    }
    if (lastErr) {
      // 🔥 握手/录音全失败 → 抛错，由 VolcengineASR 降级到浏览器 Web Speech API。
      //   不再内部回退到已损坏的 MediaRecorder+HTTP 上传（该链路无法处理二进制帧，
      //   会造成"连上了但识别不了"的假象）。
      throw lastErr;
    }

    this.listening = true;
  }

  /** 单次 WebSocket 握手尝试（打开→ready/fail） */
  private connectHandshake(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // 生产：Vercel 只重写 /api/*，不代理 /ws/*（`/(.*)→/index.html` 会吞掉 WS 握手）。
      //   S2S 已通过 VITE_S2S_WS_URL 直连 Railway 后端，这里从同一 origin 推导 /ws/asr，
      //   让空格 PushToTalk 的流式 ASR 也走同一后端。
      // 开发：无 VITE_S2S_WS_URL 时回退同源，由 Vite 代理到 FastAPI:8787。
      const s2sConfig = (import.meta.env.VITE_S2S_WS_URL as string | undefined)?.trim();
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      let wsUrl: string;
      if (s2sConfig && s2sConfig.length > 0) {
        try {
          const u = new URL(s2sConfig);
          wsUrl = `${u.protocol}//${u.host}/ws/asr`;
        } catch {
          wsUrl = `${proto}//${window.location.host}/ws/asr`;
        }
      } else {
        wsUrl = `${proto}//${window.location.host}/ws/asr`;
      }
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      const timeout = setTimeout(() => reject(new Error('WebSocket 连接超时')), 3000);
      const cleanupAndResolve = () => { clearTimeout(timeout); resolve(); };
      const cleanupAndReject = (e: Error) => {
        clearTimeout(timeout);
        try { ws.close(); } catch (_e) { console.warn('[EmptyCatch] voice/adapters.ts:1219', (_e as any)?.message ?? _e); }
        reject(e);
      };

      ws.addEventListener('open', () => {
        // ✅ 告诉后端真实的音频格式：前端 ScriptProcessor 已完成「1ch Float32 → 线性插值重采样16kHz → PCM16 LE」，
        //   后端只需要做 LE→BE 字节序转换（火山要求大端），不需要再重采样。
        try {
          ws.send(JSON.stringify({
            type: 'start',
            audio: {
              format: 'pcm',
              codec: 'raw',
              rate: 16000,
              channels: 1,
              sample_width: 2,
              bits: 16,
              is_float: false,
              is_little_endian: true,  // JS Int16Array 总是系统字节序，macOS/Windows/ARM/Linux 都是 LE
            },
          }));
        } catch (_e) { console.warn('[EmptyCatch] voice/adapters.ts:1240', (_e as any)?.message ?? _e); }
      });

      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data) as { type: string; text?: string; asr?: boolean; code?: string; message?: string };
          if (msg.type === 'ready') {
            if (msg.asr) {
              // 服务端就绪 → 启动麦克风；麦克风失败则 reject，由 VolcengineASR 降级到浏览器 Web Speech API
              this.startMicrophone()
                .then(() => cleanupAndResolve())
                .catch((e) => cleanupAndReject(e instanceof Error ? e : new Error(String(e))));
            } else {
              // 服务端未配置 ASR → 抛错，由 VolcengineASR 降级到浏览器 Web Speech API（不再走损坏的 MediaRecorder+HTTP）
              cleanupAndReject(new Error('ASR 服务未配置，已切换到浏览器语音识别'));
            }
          } else if (msg.type === 'partial') {
            this.pushPartial(msg.text ?? '');
          } else if (msg.type === 'final') {
            this.finalText = msg.text ?? '';
            this.pushPartial(this.finalText, true);
          } else if (msg.type === 'error') {
            cleanupAndReject(new Error(msg.message ?? msg.code ?? 'ASR 错误'));
          }
        } catch {
          // 非 JSON 消息忽略
        }
      });

      ws.addEventListener('error', () => cleanupAndReject(new Error('WebSocket 连接失败')));
      ws.addEventListener('close', () => {
        if (!this.aborted) this.listening = false;
      });
    });
  }

  /** §2.3 partial 节流：间隔 <partialThrottleMs 则写入 buffer，稍后合并 */
  private pushPartial(text: string, force = false): void {
    this.partialBuf = text;
    const now = Date.now();
    if (!force && now - this.partialLastAt < this.partialThrottleMs) return;
    this.partialLastAt = now;
    this.onPartial?.(this.partialBuf);
  }


  /** 启动麦克风采集并转为 PCM16 16kHz 单声道（要求上游火山引擎流式 ASR 格式）
   *
   *  Q3 故障修复重点：
   *   1. AudioContext({ sampleRate: 16000 }) 在 Safari / Firefox / 部分 Windows Chrome 上会被
   *      忽略，实际返回 48000 / 44100 / 32000。必须检测 ctx.sampleRate，做 JS 端重采样到 16k。
   *   2. processorNode 不要再 connect(destination)（会产生"监听麦克风"噪音、回声、轻微爆音），
   *      只处理音频不上行到扬声器。
   *   3. 每帧 4096 samples @ 48k ≈ 85ms；压缩为 16k 后 1365 samples，直接发 ArrayBuffer 二进制
   *      （不用 JSON base64），减少 33% 带宽+序列化开销。
   */
  private async startMicrophone(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          // 不指定 sampleRate，浏览器会自动选设备支持的原生采样率
        },
        video: false,
      });
      const targetSR = this.sampleRate; // 16000
      // 不传 sampleRate，让浏览器用原生；之后在 JS 端重采样
      this.audioContext = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const actualSR = this.audioContext.sampleRate;
      const track = stream.getAudioTracks()[0];
      this.sourceNode = this.audioContext.createMediaStreamSource(stream);

      // 重采样器：linear interpolation 足够（教学语音 8~12kHz 带宽），避免 AudioWorklet 复杂 API
      const resampler = createLinearResampler(actualSR, targetSR);
      const frameSamples = 4096;

      this.processorNode = this.audioContext.createScriptProcessor(frameSamples, 1, 1);
      this.processorNode.onaudioprocess = (e) => {
        if (this.aborted || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);
        // 1) 重采样到 16k
        const resampled = resampler.push(input);
        if (resampled.length === 0) return;
        // 2) Float32 [-1,1] → Int16 PCM
        const pcm = float32ToPcm16(resampled);
        // 3) 发送二进制（服务端 /ws/asr 已支持 Buffer 直接透传: clientWs.on('message',Buffer.isBuffer(data))）
        try { this.ws.send(pcm.buffer as ArrayBuffer); } catch { /* ignore closed */ }
      };

      this.sourceNode.connect(this.processorNode);
      // 注意：不 connect(audioContext.destination)，避免扬声器回声
      void track;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 麦克风失败 → 抛错，由 VolcengineASR 降级到浏览器 Web Speech API（不再走损坏的 MediaRecorder+HTTP）
      throw new Error(`麦克风启动失败: ${message}`);
    }
  }

  async stop(): Promise<ASRResult> {
    this.listening = false;

    // 停止麦克风
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }

    // WebSocket 流式模式：发送结束信号，等待 final 响应
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'end' }));
    }

    // 等待服务端 final 响应
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 1500);
      const interval = setInterval(() => {
        if (this.finalText) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });

    // 关闭 WebSocket
    this.ws?.close();
    this.ws = null;

    return { text: this.finalText, isFinal: true };
  }

  abort(): void {
    this.aborted = true;
    this.listening = false;
    this.finalText = '';
    this.onPartial?.('');

    this.processorNode?.disconnect();
    this.sourceNode?.disconnect();
    this.audioContext?.close();
    this.ws?.close();
    this.ws = null;
  }

  isListening(): boolean {
    return this.listening;
  }
}

/**
 * 火山引擎 ASR 适配器 —— 使用实时流式 WebSocket
 *
 * 自动检查服务端 ASR 配置：
 * - 已配置：使用 StreamingASR（实时 partial 文本）
 * - 未配置：降级到浏览器 Web Speech API
 */
export class VolcengineASR implements ASRAdapter {
  private streaming: StreamingASR | null = null;
  private browser = new BrowserSpeechASR();
  private useStreaming = false;
  private _listening = false;
  private _partialCb: ((text: string) => void) | null = null;

  setOnPartial(cb: (text: string) => void) {
    this._partialCb = cb;
    // 若 StreamingASR 已初始化则直接绑定
    this.streaming?.setOnPartial(cb);
    // 浏览器降级路径也转发
    this.browser.setOnPartial?.(cb);
  }

  /**
   * 探测服务端是否可用流式 ASR（带 3s 超时），并把结果缓存 _ASR_HEALTH_TTL 秒。
   *
   * 为什么缓存：实时对话模式下，每个短句都会调用一次 start()。若每次都重新
   * fetch('/api/health')（含 3s 超时），会显著拖慢麦克风启动，导致"前几个字/整句
   * 还没开始录"就被 VAD 判定为静音而丢弃。60 秒内复用结果即可兼顾准确与响应。
   */
  private static _asrHealthCache: { ok: boolean; at: number } | null = null;
  private static readonly _ASR_HEALTH_TTL_MS = 60_000;

  private async probeAsrHealth(): Promise<boolean> {
    const cached = VolcengineASR._asrHealthCache;
    if (cached && Date.now() - cached.at < VolcengineASR._ASR_HEALTH_TTL_MS) {
      return cached.ok;
    }
    let ok = false;
    try {
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 3000);
      const health = await fetch('/api/health', { signal: ctrl.signal })
        .then((r) => r.json())
        .catch(() => null)
        .finally(() => window.clearTimeout(timer)) as { asr?: boolean } | null;
      ok = !!health?.asr;
    } catch {
      ok = false;
    }
    VolcengineASR._asrHealthCache = { ok, at: Date.now() };
    return ok;
  }

  async start(): Promise<void> {
    // 检查服务端是否配置 ASR（带缓存，避免实时对话每个短句都重新探测）
    try {
      if (await this.probeAsrHealth()) {
        this.useStreaming = true;
        this.streaming = new StreamingASR();
        // 将外部设置的回调传递给 StreamingASR
        if (this._partialCb) {
          this.streaming.setOnPartial(this._partialCb);
        }
        await this.streaming.start();
        this._listening = true;
        return;
      }
    } catch (err) {
      // 流式握手/录音启动失败 → 清理并降级到浏览器 Web Speech API
      //   （此前缺失此 fallback，导致"服务端报告 asr:true 但流式连不上"时语音直接报错不可用）
      console.warn('[VolcengineASR] 流式 ASR 启动失败，降级浏览器:', err instanceof Error ? err.message : String(err));
      this.streaming?.abort();
      this.streaming = null;
    }

    // 降级浏览器
    this.useStreaming = false;
    this.streaming = null;
    await this.browser.start();
    this._listening = true;
  }

  async stop(): Promise<ASRResult> {
    this._listening = false;
    if (this.useStreaming && this.streaming) {
      const result = await this.streaming.stop();
      this.streaming = null;
      return result;
    }
    return this.browser.stop();
  }

  abort(): void {
    this._listening = false;
    if (this.streaming) {
      this.streaming.abort();
      this.streaming = null;
    } else {
      this.browser.abort();
    }
  }

  isListening(): boolean {
    return this._listening;
  }
}
// ============ 适配器工厂 ============

export function createASRAdapter(): ASRAdapter {
  // 生产环境通过 VITE_ASR_PROVIDER 选择供应商
  const provider = import.meta.env.VITE_ASR_PROVIDER;
  if (provider === 'volcengine') {
    return new VolcengineASR();
  }
  if (provider && provider !== 'browser') {
    console.warn(`ASR provider ${provider} 未实现，回退到浏览器`);
  }
  return new BrowserSpeechASR();
}

export function createTTSAdapter(): TTSAdapter {
  const provider = import.meta.env.VITE_TTS_PROVIDER;
  if (provider === 'volcengine') {
    return new VolcengineTTS();
  }
  if (provider && provider !== 'browser') {
    console.warn(`TTS provider ${provider} 未实现，回退到浏览器`);
  }
  return new BrowserSpeechTTS();
}

export function createLLMAdapter(): LLMAdapter {
  const provider = import.meta.env.VITE_LLM_PROVIDER;
  if (provider === 'volcengine') {
    return new VolcengineArkLLM();
  }
  if (provider && provider !== 'keyword') {
    console.warn(`LLM provider ${provider} 未实现，回退到关键词解析`);
  }
  return new KeywordIntentLLM();
}

// ============================================================
// 端到端实时语音大模型（Realtime S2S）—— 单连接完成 ASR+LLM+TTS 全链路
//
// 协议要点（详见 ADR/豆包语音_端到端实时语音大模型API接入文档）：
//   - 端点：wss://openspeech.bytedance.com/api/v3/realtime/dialogue
//   - 鉴权：单 API Key 放 X-Api-Key 请求头（新版控制台），无需 AppID+AccessToken
//   - 二进制帧：4B header + optional + payloadSize(4B) + payload
//       header: b0=0x11(version1+4B头) b1=消息类型+flags b2=序列化+压缩 b3=0x00
//   - 事件帧(Full-client request 0b0001 + event 0b0100 + JSON)：b1=0x14,b2=0x10
//       = header + event(4B) + [sessionIdSize(4B)+sessionId] + payloadSize(4B) + payload
//   - 音频帧(Audio-only request 0b0010 + Raw)：b1=0x20,b2=0x00
//       = header + payloadSize(4B) + payload(PCM16LE)
//   - 客户端事件：1=StartConnection 100=StartSession 102=FinishSession 200=TaskRequest(音频)
//   - 服务端事件：50=ConnectionStarted 150=SessionStarted 352=TTSResponse(音频)
//                 451=ASRResponse(转写) 459=ASREnded 550=ChatResponse 599=DialogCommonError
// ============================================================

export interface S2SConfig {
  /** 人设 bot 名（O 版本生效，≤20 字符） */
  botName?: string;
  /** 背景人设（O 版本生效） */
  systemRole?: string;
  /** 对话风格（O 版本生效） */
  speakingStyle?: string;
  /** 端到端模型版本，官方枚举：O（默认）/ SC */
  model?: string;
  /** 音色：vv/xiaohe/yunzhou/xiaotian，对应 zh_*_jupiter_bigtts */
  speaker?: string;
  /** TTS 输出格式，默认 24000Hz，pcm_s16le */
  ttsFormat?: 'pcm' | 'pcm_s16le';
  /** ASR 结束静音窗口(ms)，官方默认 1500，合法范围 [500, 50000]；调小可显著降低端到端语音"说完→回复"延迟 */
  endSmoothWindowMs?: number;
}

export interface S2SCallbacks {
  onSessionStarted?: (dialogId: string) => void;
  /** 模型识别到用户说话的文本（is_interim=true 为实时过程，false 为稳态） */
  onASRResponse?: (text: string, isInterim: boolean) => void;
  onASREnded?: () => void;
  /** 模型回复的文本内容 */
  onChatResponse?: (text: string) => void;
  /** 返回的 TTS 音频（PCM16LE 24000Hz 单声道原始字节） */
  onTTSAudio?: (data: ArrayBuffer) => void;
  onTTSEnded?: () => void;
  onError?: (code: string, message: string) => void;
}

/** 随机 UUID（不带连接符则 32 字符，带连接符则 36 字符） */
function uuid32(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return hex;
}

/** 拼接若干 Uint8Array */
function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** 4 字节大端序 int32 */
function int32BE(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, n, false);
  return b;
}

/**
 * S2S 适配器：连接后端 /ws/s2s 透明代理，封装火山端到端实时语音大模型二进制协议。
 * 一次连接完成 ASR + LLM + TTS 全链路（语音进 → 语音出）。
 */
export class S2SAdapter {
  private ws: WebSocket | null = null;
  private ready = false;
  private sessionStarted = false;
  private readonly config: S2SConfig;
  private cb: S2SCallbacks;
  private readonly sessionId: string;

  constructor(config: S2SConfig = {}, cb: S2SCallbacks = {}) {
    this.config = {
      botName: '豆包',
      model: 'O', // 官方枚举：O（默认）/ SC
      speaker: 'zh_female_vv_jupiter_bigtts',
      ttsFormat: 'pcm_s16le',
      // 静音窗口 1500→800ms：官方合法范围 [500,50000]，调小可立即减少"说完→回复"的感知延迟约 700ms，
      // 且 800ms 仍高于 500ms 下限，足以避免正常说话中途停顿被误判为句末。
      endSmoothWindowMs: 800,
      ...config,
    };
    this.cb = cb;
    this.sessionId = uuid32();
  }

  get isConnected(): boolean {
    return !!this.ws && this.ready;
  }

  get hasSession(): boolean {
    return this.sessionStarted;
  }

  /** 动态设置/更换事件回调（hook 在启用时绑定） */
  setCallbacks(cb: S2SCallbacks): void {
    this.cb = cb;
  }

  /** 建立与后端 /ws/s2s 的连接
   *  - 开发环境：默认 `wss://${location.host}/ws/s2s`，由 Vite 代理到 FastAPI:8787
   *  - 生产环境：Vercel 无法代理 WebSocket，需通过 VITE_S2S_WS_URL 直连 Railway 后端
   */
  connect(): Promise<void> {
    if (this.ws) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const configured = (import.meta.env.VITE_S2S_WS_URL as string | undefined)?.trim();
      const url =
        configured && configured.length > 0
          ? configured
          : `${proto}://${location.host}/ws/s2s`;
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.binaryType = 'arraybuffer';

      ws.onmessage = (ev: MessageEvent) => {
        if (typeof ev.data === 'string') {
          let msg: { type?: string; s2s?: boolean; code?: string; message?: string };
          try {
            msg = JSON.parse(ev.data as string);
          } catch {
            return;
          }
          if (msg.type === 'ready') {
            if (msg.s2s) {
              this.ready = true;
              this.sendStartConnection();
              resolve();
            } else {
              this.fail(new Error(msg.message || '后端 S2S 未就绪'), msg.code, resolve, reject);
            }
          } else if (msg.type === 'error') {
            this.fail(new Error(msg.message || 'S2S 错误'), msg.code, resolve, reject);
          }
          return;
        }
        this.handleBinaryFrame(ev.data as ArrayBuffer);
      };

      ws.onerror = () => {
        this.fail(new Error('WebSocket 连接失败（后端未启动？运行 npm run api:dev）'), 'WS_ERROR', resolve, reject);
      };
      ws.onclose = () => {
        this.ready = false;
        this.sessionStarted = false;
        this.ws = null;
      };
    });
  }

  private fail(err: Error, code: string | undefined, resolve: () => void, reject: (e: Error) => void): void {
    this.cb.onError?.(code || 'S2S_ERROR', err.message);
    reject(err);
  }

  private sendRaw(data: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  /** 事件帧：header + event + [sessionIdSize+sessionId] + payloadSize + payload */
  private buildEventFrame(eventId: number, withSessionId: boolean, payload: Uint8Array): Uint8Array {
    const parts: Uint8Array[] = [
      new Uint8Array([0x11, 0x14, 0x10, 0x00]), // Full-client request + event + JSON
      int32BE(eventId),
    ];
    if (withSessionId) {
      const sid = new TextEncoder().encode(this.sessionId);
      parts.push(int32BE(sid.length), sid);
    }
    parts.push(int32BE(payload.length), payload);
    return concatBytes(parts);
  }

  /** StartConnection（事件 1）：声明创建连接 */
  private sendStartConnection(): void {
    const payload = new TextEncoder().encode('{}');
    this.sendRaw(this.buildEventFrame(1, false, payload));
  }

  /** StartSession（事件 100）：初始化会话，配置 ASR/TTS/dialog */
  startSession(): Promise<void> {
    if (!this.isConnected) return Promise.reject(new Error('S2S 未连接'));
    if (this.sessionStarted) return Promise.resolve();
    const c = this.config;
    const payloadObj: Record<string, unknown> = {
      asr: {
        extra: { end_smooth_window_ms: c.endSmoothWindowMs, enable_custom_vad: false },
      },
      tts: {
        audio_config: { channel: 1, format: c.ttsFormat, sample_rate: 24000 },
        speaker: c.speaker,
        extra: {},
      },
      dialog: {
        bot_name: c.botName,
        system_role: c.systemRole || '',
        speaking_style: c.speakingStyle || '',
        extra: { model: c.model },
      },
    };
    const payload = new TextEncoder().encode(JSON.stringify(payloadObj));
    this.sendRaw(this.buildEventFrame(100, true, payload));
    this.sessionStarted = true;
    return Promise.resolve();
  }

  /**
   * 上传音频（TaskRequest 200 / Audio-only request）：
   * PCM16LE 单声道 16k 字节。
   * 官方协议：Audio-only request(0b0010) + event flag(0b0100) + 事件200(TaskRequest) + sessionId + Raw payload。
   * 若不携带 event 与 sessionId，服务端会将其当作 JSON 解析而报 "unexpected end of JSON input"。
   */
  sendAudio(pcm16Bytes: Uint8Array): void {
    if (!this.isConnected || !this.sessionStarted) return;
    const sid = new TextEncoder().encode(this.sessionId);
    this.sendRaw(
      concatBytes([
        new Uint8Array([0x11, 0x24, 0x00, 0x00]), // Audio-only + event flag + Raw(无压缩)
        int32BE(200), // TaskRequest
        int32BE(sid.length),
        sid,
        int32BE(pcm16Bytes.length),
        pcm16Bytes,
      ])
    );
  }

  /** FinishSession（事件 102）：结束当前会话，连接可复用 */
  finishSession(): void {
    if (!this.isConnected || !this.sessionStarted) return;
    const payload = new TextEncoder().encode('{}');
    this.sendRaw(this.buildEventFrame(102, true, payload));
    this.sessionStarted = false;
  }

  /** 断开连接 */
  disconnect(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) { console.warn('[EmptyCatch] voice/adapters.ts:1780', (e as any)?.message ?? e); }
      this.ws = null;
    }
    this.ready = false;
    this.sessionStarted = false;
  }

  /** 解析服务端二进制帧并分发事件 */
  private handleBinaryFrame(buffer: ArrayBuffer): void {
    try {
      const bytes = new Uint8Array(buffer);
      if (bytes.length < 8) return;
      const b1 = bytes[1];
      const messageType = b1 >> 4;
      const flags = b1 & 0x0f;
      const serialization = bytes[2] >> 4;

      let offset = 4;
      const readInt32 = (): number => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset, false);

      // code（仅错误帧 0b1111）
      if (messageType === 0b1111) {
        offset += 4;
      }
      // sequence（flags 含 0b00xx）
      if (flags & 0b0011) {
        offset += 4;
      }
      // event（flags 含 0b0100）
      let eventId = -1;
      if (flags & 0b0100) {
        eventId = readInt32();
        offset += 4;
      }
      // 连接/会话 id：size + id
      if (offset + 4 <= bytes.length && (messageType === 0b1001 || messageType === 0b1011 || messageType === 0b1111)) {
        const idSize = readInt32();
        offset += 4;
        if (idSize > 0 && offset + idSize <= bytes.length) offset += idSize;
      }
      // payload
      if (offset + 4 > bytes.length) return;
      const payloadSize = readInt32();
      offset += 4;
      const payload = bytes.subarray(offset, offset + payloadSize);

      this.dispatchEvent(eventId, serialization, payload);
    } catch {
      /* 解析失败则忽略该帧 */
    }
  }

  private dispatchEvent(eventId: number, serialization: number, payload: Uint8Array): void {
    switch (eventId) {
      case 50: // ConnectionStarted
        break;
      case 150: {
        // SessionStarted → dialog_id
        const text = new TextDecoder().decode(payload);
        try {
          this.cb.onSessionStarted?.(JSON.parse(text).dialog_id || '');
        } catch (e) { console.warn('[EmptyCatch] voice/adapters.ts:1843', (e as any)?.message ?? e); }
        break;
      }
      case 451: {
        // ASRResponse：识别文本
        const text = new TextDecoder().decode(payload);
        try {
          const obj = JSON.parse(text) as { results?: Array<{ text: string; is_interim: boolean }> };
          const r = obj.results?.[0];
          if (r) this.cb.onASRResponse?.(r.text, r.is_interim);
        } catch (e) { console.warn('[EmptyCatch] voice/adapters.ts:1855', (e as any)?.message ?? e); }
        break;
      }
      case 459:
        this.cb.onASREnded?.();
        break;
      case 550: {
        // ChatResponse：模型文本回复
        const text = new TextDecoder().decode(payload);
        try {
          const obj = JSON.parse(text) as { content?: string };
          if (obj.content) this.cb.onChatResponse?.(obj.content);
        } catch (e) { console.warn('[EmptyCatch] voice/adapters.ts:1869', (e as any)?.message ?? e); }
        break;
      }
      case 352:
        // TTSResponse：音频数据（Raw payload）
        if (serialization === 0b0000) {
          this.cb.onTTSAudio?.(payload.slice().buffer as ArrayBuffer);
        }
        break;
      case 359:
        this.cb.onTTSEnded?.();
        break;
      case 599: {
        const text = new TextDecoder().decode(payload);
        this.cb.onError?.('S2S_DIALOG_ERROR', text);
        break;
      }
      default:
        break;
    }
  }
}

/** 创建 S2S 适配器（实时对话模式使用） */
export function createS2SAdapter(config?: S2SConfig, cb?: S2SCallbacks): S2SAdapter {
  return new S2SAdapter(config, cb);
}
