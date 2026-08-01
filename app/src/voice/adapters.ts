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
  private finalText = '';

  async start(): Promise<void> {
    const SpeechRecognitionClass =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      throw new Error('浏览器不支持语音识别，请使用 Chrome/Edge');
    }

    this.recognition = new SpeechRecognitionClass();
    this.recognition.lang = 'zh-CN';
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.finalText = '';

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          this.finalText += event.results[i][0].transcript;
        }
      }
    };

    this.listening = true;
    this.recognition.start();
  }

  async stop(): Promise<ASRResult> {
    return new Promise((resolve) => {
      if (!this.recognition || !this.listening) {
        resolve({ text: this.finalText, isFinal: true });
        return;
      }

      this.recognition.onend = () => {
        this.listening = false;
        resolve({ text: this.finalText, isFinal: true });
      };

      this.recognition.stop();
    });
  }

  abort(): void {
    if (this.recognition && this.listening) {
      this.recognition.abort();
      this.listening = false;
    }
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

/** 浏览器 SpeechSynthesis 回退 */
export class BrowserSpeechTTS implements TTSAdapter {
  private speaking = false;
  private utterance: SpeechSynthesisUtterance | null = null;

  async speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) {
        resolve();
        return;
      }

      window.speechSynthesis.cancel();

      this.utterance = new SpeechSynthesisUtterance(text);
      this.utterance.lang = 'zh-CN';
      this.utterance.rate = 1.0;
      this.utterance.pitch = 1.0;

      // 尝试选择中文语音
      const voices = window.speechSynthesis.getVoices();
      const zhVoice = voices.find((v) => v.lang.startsWith('zh'));
      if (zhVoice) this.utterance.voice = zhVoice;

      this.utterance.onstart = () => { this.speaking = true; };
      this.utterance.onend = () => {
        this.speaking = false;
        resolve();
      };
      this.utterance.onerror = () => {
        this.speaking = false;
        resolve();
      };

      window.speechSynthesis.speak(this.utterance);
    });
  }

  stop(): void {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.speaking = false;
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

/** 在前端（adapters 层）判断一条话术属于「快速工具指令」还是「需要深度讲解/计算」，用于双模型路由 */
const FAST_INTENT_REGEX = /(?:定位|飞到|跳转|切到|切换到|打开|关闭|开启|关掉|显示|隐藏|启动|停止|开始|暂停|重置|清除|测量|测距|画|标出|设为|改成|设置|镜头.*(?:缩小|放大|拉远|拉近|旋转|俯视|平视))|(?:2D|3D|二维|三维|地图模式|地球模式|地形模式|卫星图|政区图|影像图)|(?:等高线|等高距|坡度|坡向|高程分层|夸张|图层|图层组)/i;

/**
 * 意图理解适配器 —— 将自然语言转为工具调用
 *
 * 生产环境应使用云端 LLM（如智谱 GLM、通义千问）通过服务端代理。
 * 开发回退：基于关键词匹配的简单意图解析。
 */
export class KeywordIntentLLM implements LLMAdapter {
  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const userMessage = messages.findLast((m) => m.role === 'user');
    const text = userMessage?.content ?? '';

    const toolCalls = this.parseIntent(text);
    return {
      text: toolCalls.length > 0 ? '正在执行...' : '抱歉，我没有理解您的指令。',
      toolCalls,
    };
  }

  /** 基于关键词的意图解析（开发回退） */
  private parseIntent(text: string): Array<{ name: string; args: Record<string, unknown> }> {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

    // 等高线（支持自定义间距）
    if (/等高线|地形图/.test(text)) {
      const spacingMatch = text.match(/(?:等高线|间距).{0,4}?(\d+(?:\.\d+)?)/);
      const spacing = spacingMatch ? parseFloat(spacingMatch[1]) : 200;
      calls.push({ name: 'layer.showContour', args: { spacing } });
    }

    // 高程分层
    if (/高程|分层/.test(text)) {
      calls.push({ name: 'layer.showElevationRamp', args: {} });
    }

    // 二维/三维切换
    if (/二维|2d|平面图/.test(text)) {
      calls.push({ name: 'view.setMode', args: { mode: '2d' } });
    }
    if (/三维|3d|立体/.test(text)) {
      calls.push({ name: 'view.setMode', args: { mode: '3d' } });
    }

    // 太阳系/地球视图切换
    if (/太阳系|行星|宇宙/.test(text)) {
      const back = /返回|回地球|退出太阳系/.test(text);
      calls.push({ name: back ? 'view.showEarth' : 'view.showSolarSystem', args: {} });
    } else if (/返回地球|回地球/.test(text)) {
      calls.push({ name: 'view.showEarth', args: {} });
    }

    // 截图
    if (/截图|保存画面|保存当前/.test(text)) {
      calls.push({ name: 'camera.screenshot', args: {} });
    }

    // 飞行到某地
    const flyMatch = text.match(/(?:飞到|飞往|定位到|去|前往)(北京|上海|广州|东京|纽约|伦敦|巴黎)/);
    if (flyMatch) {
      const cityCoords: Record<string, [number, number]> = {
        北京: [116.4, 39.9], 上海: [121.5, 31.2], 广州: [113.3, 23.1],
        东京: [139.7, 35.7], 纽约: [-74.0, 40.7], 伦敦: [-0.1, 51.5], 巴黎: [2.3, 48.9],
      };
      const coords = cityCoords[flyMatch[1]];
      if (coords) {
        calls.push({
          name: 'camera.flyTo',
          args: { longitude: coords[0], latitude: coords[1], height: 500000, duration: 2.5 },
        });
      }
    }

    // 显示/隐藏图层
    if (/显示.*城市|打开.*城市/.test(text)) {
      calls.push({ name: 'layer.toggle', args: { layer: 'cities', visible: true } });
    }
    if (/隐藏.*城市|关闭.*城市/.test(text)) {
      calls.push({ name: 'layer.toggle', args: { layer: 'cities', visible: false } });
    }
    if (/经纬线/.test(text)) {
      const visible = /显示|打开|开启/.test(text);
      calls.push({ name: 'layer.toggle', args: { layer: 'graticule', visible } });
    }
    if (/晨昏线/.test(text)) {
      const visible = /显示|打开|开启/.test(text);
      calls.push({ name: 'layer.toggle', args: { layer: 'twilight', visible } });
    }

    // 自转
    if (/自转|停止转动|暂停/.test(text)) {
      if (/停止|暂停|关闭/.test(text)) {
        calls.push({ name: 'animation.pause', args: {} });
      } else {
        calls.push({ name: 'animation.play', args: {} });
      }
    }

    // 地形夸张
    const exaggerateMatch = text.match(/夸张.*?(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*倍/);
    if (exaggerateMatch) {
      const val = parseFloat(exaggerateMatch[1] || exaggerateMatch[2]);
      if (!isNaN(val)) {
        calls.push({ name: 'terrain.setExaggeration', args: { value: val } });
      }
    }

    // 地轴倾角
    const tiltMatch = text.match(/(?:轴倾角|倾角|地轴).{0,4}(\d+(?:\.\d+)?)/);
    if (tiltMatch) {
      const val = parseFloat(tiltMatch[1]);
      if (!isNaN(val)) {
        calls.push({ name: 'astronomy.setAxisTilt', args: { value: val } });
      }
    }

    // 太阳高度
    const sunMatch = text.match(/(?:太阳高度|太阳高).{0,4}(-?\d+(?:\.\d+)?)/);
    if (sunMatch) {
      const val = parseFloat(sunMatch[1]);
      if (!isNaN(val)) {
        calls.push({ name: 'astronomy.setSunHeight', args: { value: val } });
      }
    }

    // 公转速度
    const revMatch = text.match(/公转速度.{0,4}(\d+(?:\.\d+)?)/);
    if (revMatch) {
      const val = parseFloat(revMatch[1]);
      if (!isNaN(val)) {
        calls.push({ name: 'astronomy.setRevolutionSpeed', args: { speed: val } });
      }
    }

    // 课程
    const lessonMatch = text.match(/(?:开始|打开|进入).*?(等高线|自转|公转|板块|冷锋|季风|洋流|地势)课程?/);
    if (lessonMatch) {
      const lessonMap: Record<string, string> = {
        等高线: 'contour-lines',
        自转: 'earth-rotation',
        公转: 'earth-revolution',
        板块: 'plate-tectonics',
        冷锋: 'cold-front',
        季风: 'monsoon',
        洋流: 'ocean-currents',
        地势: 'china-terrain',
      };
      const lessonId = lessonMap[lessonMatch[1]];
      if (lessonId) {
        calls.push({ name: 'lesson.open', args: { lessonId } });
      }
    }

    return calls;
  }
}

// ============ 火山引擎适配器（生产，需服务端代理） ============
//
// 所有密钥由服务端代理持有，前端只调用同源 /api/* 端点。
// 服务端实现见 app/server/index.ts。
// 任何代理失败都抛错，由 PushToTalk 捕获并降级到浏览器回退。
// 详见 docs/voice-agent.md §5 密钥安全。

/** 火山方舟 LLM 适配器（OpenAI 兼容，支持 tools function calling） */
export class VolcengineArkLLM implements LLMAdapter {
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
      throw new Error(`火山 LLM 调用失败: ${(err as { error?: string }).error ?? res.status}`);
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
      } catch { /* noop */ }
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
        throw new Error(`火山 TTS 失败: ${(err as { error?: string }).error ?? res.status}`);
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
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private listening = false;
  private finalText = '';
  private sampleRate = 16000;
  private onPartial: ((text: string) => void) | null = null;
  private onReady: ((asrAvailable: boolean) => void) | null = null;
  private aborted = false;
  private useStreamingWs = true;  // true=实时流式(WebSocket), false=浏览器回退(MediaRecorder)
  /** §2.1 握手重试：3 次指数退避（400ms / 800ms / 1600ms） */
  private readonly handshakeAttempts = 3;
  /** §2.3 partial 文本节流（50ms），避免 UI 过度重绘 */
  private partialLastAt = 0;
  private partialThrottleMs = 50;
  /** partial 文本在写入 final 之前暂存，避免与 transcript 状态混淆 */
  private partialBuf = '';

  setOnPartial(cb: (text: string) => void) { this.onPartial = cb; }
  setOnReady(cb: (asrAvailable: boolean) => void) { this.onReady = cb; }

  async start(): Promise<void> {
    this.aborted = false;
    this.finalText = '';
    this.partialBuf = '';
    this.partialLastAt = 0;
    this.useStreamingWs = true;

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
      // 握手全失败 → 降级浏览器
      console.warn('[StreamingASR] 降级浏览器回退:', lastErr.message);
      this.useStreamingWs = false;
      await this.startBrowserFallback();
    }

    this.listening = true;
  }

  /** 单次 WebSocket 握手尝试（打开→ready/fail） */
  private connectHandshake(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws/asr`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      const timeout = setTimeout(() => reject(new Error('WebSocket 连接超时')), 3000);
      const cleanupAndResolve = () => { clearTimeout(timeout); resolve(); };
      const cleanupAndReject = (e: Error) => {
        clearTimeout(timeout);
        try { ws.close(); } catch (_e) { /* noop */ }
        reject(e);
      };

      ws.addEventListener('open', () => {
        try { ws.send(JSON.stringify({ type: 'start' })); } catch (_e) { /* noop */ }
      });

      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data) as { type: string; text?: string; asr?: boolean; code?: string; message?: string };
          if (msg.type === 'ready') {
            if (msg.asr) void this.startMicrophone();
            else { this.useStreamingWs = false; void this.startBrowserFallback(); }
            cleanupAndResolve();
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


  /** 启动麦克风采集并转为 PCM16 */
  private async startMicrophone(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
      const track = stream.getAudioTracks()[0];
      this.sourceNode = this.audioContext.createMediaStreamSource(stream);

      // 使用 ScriptProcessorNode 转 PCM16
      this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.processorNode.onaudioprocess = (e) => {
        if (this.aborted || !this.ws) return;
        const input = e.inputBuffer.getChannelData(0);
        // Float32 → Int16 PCM
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        // 转 base64 发送
        const base64 = this.arrayBufferToBase64(pcm.buffer);
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'audio', data: base64 }));
        }
      };

      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 麦克风权限失败，降级浏览器
      console.warn('[StreamingASR] 麦克风权限失败，降级浏览器:', message);
      this.onReady?.(false);
      await this.startBrowserFallback();
    }
  }

  /** 浏览器回退（MediaRecorder + HTTP 上传） */
  private async startBrowserFallback(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      const chunks: Blob[] = [];

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      this.mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/wav' });
        const buffer = await blob.arrayBuffer();
        // 上传到 /api/asr/recognition
        try {
          const res = await fetch('/api/asr/recognition', {
            method: 'POST',
            headers: { 'Content-Type': 'audio/wav' },
            body: buffer,
          });
          if (res.ok) {
            const data = await res.json() as { text?: string };
            this.finalText = data.text ?? '';
            this.onPartial?.(this.finalText);
          }
        } catch {
          // 最终仍失败
        }
      };

      this.mediaRecorder.start(100); // 每 100ms 一个 chunk
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`麦克风权限失败: ${message}。请使用 Chrome/Edge 并允许麦克风权限。`);
    }
  }

  /** Float32Array → PCM16 Int16Array → base64 */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk) as number[]);
    }
    return btoa(binary);
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

    if (!this.useStreamingWs) {
      // 浏览器回退模式：停止 MediaRecorder，等待上传完成
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
        // 等待 onstop 回调中的上传完成（最多 3 秒）
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 3000);
          const check = setInterval(() => {
            if (this.finalText) {
              clearTimeout(timeout);
              clearInterval(check);
              resolve();
            }
          }, 50);
        });
      }
      return { text: this.finalText, isFinal: true };
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
    this.mediaRecorder?.state !== 'inactive' && this.mediaRecorder?.stop();
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
  }

  async start(): Promise<void> {
    // 检查服务端是否配置 ASR
    try {
      const health = await fetch('/api/health').then((r) => r.json()).catch(() => null) as { asr?: boolean } | null;
      if (health?.asr) {
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
    } catch {
      // 健康检查失败，使用浏览器回退
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

/** 地理工具定义（与 commands/schema.ts TOOL_NAMES 对齐，供 LLM function calling） */
const GEOGRAPHY_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'camera.flyTo',
      description: '飞行到指定经纬度地点',
      parameters: {
        type: 'object',
        properties: {
          longitude: { type: 'number', description: '经度 -180~180' },
          latitude: { type: 'number', description: '纬度 -90~90' },
          height: { type: 'number', description: '视点高度（米）' },
        },
        required: ['longitude', 'latitude'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'camera.reset',
      description: '恢复初始视角',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'camera.screenshot',
      description: '截图保存当前画面',
      parameters: {
        type: 'object',
        properties: { filename: { type: 'string' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'view.setMode',
      description: '切换二维/三维视图',
      parameters: {
        type: 'object',
        properties: { mode: { type: 'string', enum: ['2d', '3d'] } },
        required: ['mode'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'view.setBasemap',
      description: '切换底图',
      parameters: {
        type: 'object',
        properties: { basemap: { type: 'string', enum: ['satellite', 'terrain', 'political', 'osm'] } },
        required: ['basemap'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'view.showSolarSystem',
      description: '切换到太阳系视图',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'view.showEarth',
      description: '从太阳系返回地球视图',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'layer.showContour',
      description: '显示等高线',
      parameters: {
        type: 'object',
        properties: { spacing: { type: 'number', description: '等高线间距（米）' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'layer.toggle',
      description: '显示或隐藏图层',
      parameters: {
        type: 'object',
        properties: {
          layer: { type: 'string', description: 'cities/graticule/twilight/rivers/mountains...' },
          visible: { type: 'boolean' },
        },
        required: ['layer'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'terrain.setExaggeration',
      description: '设置地形夸张系数',
      parameters: {
        type: 'object',
        properties: { value: { type: 'number', description: '0.5~5' } },
        required: ['value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'animation.play',
      description: '播放动画（自转/公转等）',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'animation.pause',
      description: '暂停动画',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'animation.setSpeed',
      description: '设置动画速度',
      parameters: {
        type: 'object',
        properties: { speed: { type: 'number' } },
        required: ['speed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lesson.open',
      description: '打开课程',
      parameters: {
        type: 'object',
        properties: { lessonId: { type: 'string' } },
        required: ['lessonId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'measure.start',
      description: '开始测量',
      parameters: {
        type: 'object',
        properties: { mode: { type: 'string', enum: ['distance', 'area', 'angle', 'height', 'profile'] } },
        required: ['mode'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'measure.clear',
      description: '清除测量结果',
      parameters: { type: 'object', properties: {} },
    },
  },
] as const;

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
