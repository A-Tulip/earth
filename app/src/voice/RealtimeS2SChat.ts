/**
 * RealtimeS2SChat —— 豆包端到端实时语音（RealtimeAPI）全双工客户端
 *
 * 与三段式（ASR→LLM→TTS）不同，RealtimeAPI 通过一次 WebSocket 连接完成
 * 「语音进 → 语音出」的端到端对话，天然支持打断（barge-in）与低延迟。
 *
 * 链路：
 *   麦克风 → PCM16 16k LE → Audio-only 帧 → /ws/s2s 代理 → 火山 RealtimeAPI
 *   火山 RealtimeAPI → TTSResponse 音频帧 → /ws/s2s 代理 → 前端播放
 *
 * 二进制帧协议（官方文档 6561/1594356，帧头 4 字节）：
 *   Byte0: 高4bit=Protocol Version(0b0001) 低4bit=Header Size(0b0001→4字节)
 *   Byte1: 高4bit=Message Type 低4bit=Message type specific flags
 *   Byte2: 高4bit=Serialization 低4bit=Compression
 *   Byte3: Reserved=0
 *
 *   Message Type：
 *     0b0001 Full-client request（客户端文本事件）
 *     0b1001 Full-server response（服务端文本事件）
 *     0b0010 Audio-only request（客户端音频）
 *     0b1011 Audio-only response（服务端音频）
 *     0b1111 Error information
 *
 *   Flags（低4bit）：
 *     0b0100 携带 event（4 字节事件 ID）
 *     0b0001 后接正 sequence；0b0010 最后无序号包；0b0011 最后负包
 *     0b1111 错误包携带 code
 *
 *   事件帧排版：header(4) + event(4) + [connect/session id] + payload_size(4) + payload
 *   音频帧排版：header(4) + payload_size(4) + PCM 字节
 *
 * 客户端事件 ID：1=StartConnection, 2=FinishConnection, 100=StartSession,
 *               102=FinishSession, 200=TaskRequest, 300=SayHello,
 *               500=ChatTTSText, 501=ChatTextQuery, 502=ChatRAGText
 * 服务端事件 ID：50 ConnectionStarted, 150 SessionStarted, 152 SessionFinished,
 *               153 SessionFailed, 154 Usage, 350 TTSResponse(文本), 351 TTS句首,
 *               359 TTS结束, 450 ASRInfo, 451 ASRResponse(转写), 459 ASREnded,
 *               550 ModelStream(模型流式文本), 553 问题开始, 559 回复结束
 *
 * 注意：TTS 音频不通过事件携带，而是独立 MSG_AUDIO_RESP(0b1011) 帧下发。
 *
 * 鉴权由后端 /ws/s2s 代理完成，前端只做透明二进制双向转发。
 */

// ============ 协议常量 ============
const MSG_FULL_CLIENT = 0b0001;   // 客户端文本事件
const MSG_FULL_SERVER = 0b1001;   // 服务端文本事件
const MSG_AUDIO_REQ = 0b0010;     // 客户端音频
const MSG_AUDIO_RESP = 0b1011;    // 服务端音频
const MSG_ERROR = 0b1111;         // 错误

const FLAG_EVENT = 0b0100;        // 携带 event ID
const FLAG_SEQ_POS = 0b0001;      // 正 sequence
const FLAG_LAST = 0b0010;         // 最后无序号包
const FLAG_LAST_NEG = 0b0011;     // 最后负包
const FLAG_CODE = 0b1111;         // 错误码

const SERIAL_RAW = 0b0000;
const SERIAL_JSON = 0b0001;

// 客户端事件
export const S2S_EVT_START_CONNECTION = 1;
export const S2S_EVT_FINISH_CONNECTION = 2;
export const S2S_EVT_START_SESSION = 100;
export const S2S_EVT_FINISH_SESSION = 102;
export const S2S_EVT_TASK_REQUEST = 200;
export const S2S_EVT_CHAT_TTS_TEXT = 500;
export const S2S_EVT_CHAT_TEXT_QUERY = 501;

// 服务端事件
const S2S_SRV_CONNECTION_STARTED = 50;
const S2S_SRV_CONNECTION_FAILED = 51;
const S2S_SRV_SESSION_STARTED = 150;
const S2S_SRV_SESSION_FINISHED = 152;
const S2S_SRV_SESSION_FAILED = 153;
const S2S_SRV_TTS_RESPONSE = 350;   // 文本事件（payload.text 为 TTS 朗读文本）
const S2S_SRV_TTS_SENTENCE = 351;   // TTS 句首信息
const S2S_SRV_ASR_INFO = 450;
const S2S_SRV_ASR_RESPONSE = 451;
const S2S_SRV_ASR_ENDED = 459;
const S2S_SRV_MODEL_STREAM = 550;   // 模型流式回复文本（payload.content 逐段）
const S2S_SRV_QUESTION_STARTED = 553;
const S2S_SRV_REPLY_ENDED = 559;

/** 会话状态机 */
export type S2SSessionState = 'idle' | 'connecting' | 'session_starting' | 'active' | 'error' | 'closed';

export interface S2SCallbacks {
  onStateChange?(state: S2SSessionState, detail?: string): void;
  /** ASR 转写（用户说话内容） */
  onTranscript?(text: string): void;
  /** 模型最终回复文本 */
  onReply?(text: string): void;
  onError?(message: string): void;
  /** 音频播放开始/结束（用于 UI 展示 speaking 状态） */
  onSpeakingChange?(speaking: boolean): void;
}

export interface RealtimeS2SChatOptions {
  /** StartSession 的 dialog.system_role 人设 */
  systemRole?: string;
  /** 端到端模型版本：O / SC */
  model?: 'O' | 'SC';
  /** 采样专用：是否请求 PCM 输出（true 返回 24k s16le，false 返回 OGG Opus） */
  pcmOutput?: boolean;
  /** TTS 音色（O 版：zh_female_vv_jupiter_bigtts 等） */
  speaker?: string;
  /** VAD 句末静音判定（默认 1500ms，范围 [500, 50000]） */
  endSmoothWindowMs?: number;
  callbacks?: S2SCallbacks;
}

/** 从 DataView 读大端 uint32 */
function readU32(dv: DataView, offset: number): number {
  return dv.getUint32(offset, false);
}

/** 从 DataView 读大端 uint16 */
function readU16(dv: DataView, offset: number): number {
  return dv.getUint16(offset, false);
}

/** 把 PCM 大端 int16 字节转成 Float32 [-1,1]（用于播放） */
function pcmLeToFloat32(buf: ArrayBuffer): Float32Array {
  const dv = new DataView(buf);
  const n = Math.floor(buf.byteLength / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = dv.getInt16(i * 2, true) / 0x7fff;
  }
  return out;
}

/** 简单线性插值重采样：任意 sourceSR → targetSR，单声道 Float32 */
function createLinearResampler(sourceSR: number, targetSR: number) {
  if (targetSR <= 0 || sourceSR <= 0) throw new Error('sampleRate invalid');
  if (sourceSR === targetSR) return { push: (c: Float32Array) => c.slice() };
  const ratio = sourceSR / targetSR;
  let tailSample = 0;
  let tailFrac = 0;
  return {
    push(chunk: Float32Array): Float32Array {
      if (chunk.length === 0) return new Float32Array(0);
      const outLen = Math.max(0, Math.floor((chunk.length + tailFrac) / ratio));
      if (outLen === 0) {
        tailFrac += chunk.length;
        tailSample = chunk[chunk.length - 1];
        return new Float32Array(0);
      }
      const out = new Float32Array(outLen);
      let inIdx = -tailFrac;
      for (let o = 0; o < outLen; o++) {
        const iFloor = Math.floor(inIdx);
        const frac = inIdx - iFloor;
        const a = iFloor < 0 ? tailSample : chunk[iFloor];
        const b = iFloor + 1 < 0 ? tailSample : (iFloor + 1 >= chunk.length ? chunk[chunk.length - 1] : chunk[iFloor + 1]);
        out[o] = a + (b - a) * frac;
        inIdx += ratio;
      }
      const lastInFloat = -tailFrac + (outLen - 1) * ratio + ratio;
      tailFrac = chunk.length - lastInFloat;
      if (tailFrac < 0) tailFrac = 0;
      tailSample = chunk[chunk.length - 1];
      return out;
    },
  };
}

/** 熔断/降级：S2S 不可用时由调用方切回三段式 */
export class S2SUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'S2SUnavailableError';
  }
}

/**
 * 全双工 S2S 客户端（类，非 React Hook，便于测试与复用）
 */
export class RealtimeS2SChat {
  private ws: WebSocket | null = null;
  private sessionId = '';
  private connectId = '';
  private seq = 0;
  private state: S2SSessionState = 'idle';

  // 音频采集
  private micStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private micResampler: { push(c: Float32Array): Float32Array } | null = null;

  // 音频播放（PCM 24k 输出）
  private playbackCtx: AudioContext | null = null;
  private playbackResampler: { push(c: Float32Array): Float32Array } | null = null;
  private playbackQueue: { buffer: AudioBuffer; start: number }[] = [];
  private nextPlayTime = 0;
  private speaking = false;
  private pcmOutput = false;

  private opts: RealtimeS2SChatOptions;
  private setRef: (partial: {
    listening?: boolean;
    processing?: boolean;
    speaking?: boolean;
    asrStreaming?: boolean;
    transcript?: string;
    partialText?: string;
    response?: string;
    error?: string | null;
  }) => void;
  private setStateRef: (next: S2SSessionState, detail?: string) => void;

  constructor(
    opts: RealtimeS2SChatOptions & {
      setVoice: (partial: {
        listening?: boolean;
        processing?: boolean;
        speaking?: boolean;
        asrStreaming?: boolean;
        transcript?: string;
        partialText?: string;
        response?: string;
        error?: string | null;
      }) => void;
    },
  ) {
    this.opts = opts;
    this.pcmOutput = opts.pcmOutput ?? true;
    this.setRef = opts.setVoice;
    // 内部状态 → 外部状态机（受控）
    this.setStateRef = (next, detail) => {
      this.state = next;
      opts.callbacks?.onStateChange?.(next, detail);
    };
  }

  get currentState(): S2SSessionState {
    return this.state;
  }

  /** 建立连接并启动会话（StartConnection → StartSession） */
  async start(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    this.setStateRef('connecting', 'connecting');
    // 生产：从 VITE_S2S_WS_URL 的 origin 推导同源 /ws/s2s，直连 Railway 后端
    const s2sConfig = (import.meta.env.VITE_S2S_WS_URL as string | undefined)?.trim();
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl: string;
    if (s2sConfig && s2sConfig.length > 0) {
      try {
        const u = new URL(s2sConfig);
        wsUrl = `${u.protocol}//${u.host}/ws/s2s`;
      } catch {
        wsUrl = `${proto}//${window.location.host}/ws/s2s`;
      }
    } else {
      wsUrl = `${proto}//${window.location.host}/ws/s2s`;
    }
    console.debug('[S2S] start() connecting wsUrl=', wsUrl);

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    const ready = await new Promise<boolean>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new S2SUnavailableError('S2S 连接超时')), 8000);
      ws.addEventListener('open', () => {
        console.debug('[S2S] ws open, sending StartConnection');
        // 就绪后发 StartConnection
        try {
          this.sendEvent(S2S_EVT_START_CONNECTION, '{}');
        } catch (_e) { /* noop */ }
      });
      ws.addEventListener('message', (ev) => {
        try {
          const str = typeof ev.data === 'string' ? ev.data : '';
          const msg = JSON.parse(str) as { type?: string; s2s?: boolean; connect_id?: string; error?: string };
          console.debug('[S2S] handshake msg type=', msg.type, 's2s=', msg.s2s, 'dataType=', typeof ev.data);
          if (msg.type === 'ready') {
            clearTimeout(timeout);
            if (msg.s2s) {
              this.connectId = msg.connect_id ?? '';
              resolve(true);
            } else {
              reject(new S2SUnavailableError(msg.error ?? 'S2S 后端未配置'));
            }
          } else if (msg.type === 'error') {
            clearTimeout(timeout);
            reject(new S2SUnavailableError(msg.error ?? 'S2S 连接错误'));
          }
        } catch {
          // 非 JSON 消息（二进制帧）在握手阶段不会出现，忽略
        }
      });
      ws.addEventListener('error', () => {
        console.debug('[S2S] ws error event');
        clearTimeout(timeout);
        reject(new S2SUnavailableError('S2S WebSocket 连接失败'));
      });
      ws.addEventListener('close', () => {
        console.debug('[S2S] ws close event');
        clearTimeout(timeout);
        reject(new S2SUnavailableError('S2S WebSocket 提前关闭'));
      });
    });

    if (!ready) {
      this.setStateRef('error', 'S2S 未就绪');
      throw new S2SUnavailableError('S2S 未就绪');
    }

    // 注册数据处理
    ws.addEventListener('message', (ev) => this.handleServerData(ev.data));
    ws.addEventListener('close', () => {
      this.teardownAudio();
      this.setStateRef('closed', 'connection closed');
    });

    // StartSession
    await this.startSession();
    this.setStateRef('active', 'session started');
  }

  /** 发送 StartSession 事件 */
  private async startSession(): Promise<void> {
    const systemRole =
      this.opts.systemRole ??
      '你是「AI 地理画布」的助教，用简洁、准确、符合课标的中文回答初高中地理问题。回答要简短、口语化，适合语音朗读。';

    const payload: Record<string, unknown> = {
      asr: {
        extra: {
          end_smooth_window_ms: this.opts.endSmoothWindowMs ?? 1500,
          enable_custom_vad: true,
          enable_asr_twopass: false,
        },
      },
      dialog: {
        bot_name: '地理助教',
        system_role: systemRole,
        speaking_style: '简洁、亲切、口语化',
        extra: {
          model: this.opts.model ?? 'O',
          strict_audit: false,
        },
      },
    };

    if (this.pcmOutput) {
      (payload as Record<string, unknown>).tts = {
        audio_config: { channel: 1, format: 'pcm_s16le', sample_rate: 24000 },
      };
    } else if (this.opts.speaker) {
      (payload as Record<string, unknown>).tts = { speaker: this.opts.speaker };
    }

    // 生成 session id
    this.sessionId = this.newId();
    this.sendEvent(S2S_EVT_START_SESSION, JSON.stringify(payload), this.sessionId);
  }

  /** 发送一条客户端事件帧（Full-client request + event + JSON） */
  private sendEvent(eventId: number, jsonPayload: string, sessionId?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const payloadBytes = new TextEncoder().encode(jsonPayload);

    // header
    const b0 = (0b0001 & 0x0f) << 4 | (0b0001 & 0x0f); // version=1, headerSize=1
    const b1 = (MSG_FULL_CLIENT << 4) | FLAG_EVENT;     // full-client + event
    const b2 = (SERIAL_JSON << 4) | 0;                  // JSON + 无压缩
    const header = new Uint8Array([b0, b1, b2, 0x00]);

    // 组帧：header + event(4) + [session_id_size(4)+session_id] + payload_size(4) + payload
    const eventBytes = new Uint8Array(4);
    new DataView(eventBytes.buffer).setUint32(0, eventId, false);

    const sidBytes = sessionId ? new TextEncoder().encode(sessionId) : null;
    const payloadSizeBytes = new Uint8Array(4);
    new DataView(payloadSizeBytes.buffer).setUint32(0, payloadBytes.length, false);

    const parts: Uint8Array[] = [header, eventBytes];
    if (sidBytes) {
      const sidSizeBytes = new Uint8Array(4);
      new DataView(sidSizeBytes.buffer).setUint32(0, sidBytes.length, false);
      parts.push(sidSizeBytes, sidBytes);
    }
    parts.push(payloadSizeBytes, payloadBytes);

    const total = parts.reduce((n, p) => n + p.length, 0);
    const frame = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      frame.set(p, off);
      off += p.length;
    }
    this.ws.send(frame);
  }

  /** 发送一帧音频（Audio-only request 0b0010 + Raw：header + payload_size + PCM） */
  private sendAudio(pcm16Le: ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const b0 = (0b0001 & 0x0f) << 4 | (0b0001 & 0x0f);
    const b1 = (MSG_AUDIO_REQ << 4) | 0; // audio + 无 flags
    const b2 = (SERIAL_RAW << 4) | 0;    // raw + 无压缩
    const header = new Uint8Array([b0, b1, b2, 0x00]);
    const size = new Uint8Array(4);
    new DataView(size.buffer).setUint32(0, pcm16Le.byteLength, false);
    const frame = new Uint8Array(4 + 4 + pcm16Le.byteLength);
    frame.set(header, 0);
    frame.set(size, 4);
    frame.set(new Uint8Array(pcm16Le), 8);
    this.ws.send(frame);
  }

  /** 发送结束会话事件 */
  private sendFinishSession(): void {
    this.sendEvent(S2S_EVT_FINISH_SESSION, '{}', this.sessionId || undefined);
  }

  private newId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /** 解析服务端二进制帧并分发 */
  private handleServerData(data: unknown): void {
    if (typeof data === 'string') {
      // 文本事件（后端转发火山文本事件）
      try {
        const msg = JSON.parse(data) as { type?: string; error?: string };
        if (msg.type === 'error') {
          this.setStateRef('error', msg.error ?? 'S2S 错误');
          this.opts.callbacks?.onError?.(msg.error ?? 'S2S 错误');
        }
      } catch { /* noop */ }
      return;
    }

    if (!(data instanceof ArrayBuffer)) return;
    const bytes = new Uint8Array(data);
    if (bytes.length < 4) return;
    const b0 = bytes[0];
    const b1 = bytes[1];
    const b2 = bytes[2];
    const msgType = (b1 >> 4) & 0x0f;
    const flags = b1 & 0x0f;
    // const serial = (b2 >> 4) & 0x0f;

    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 4;

    if (msgType === MSG_ERROR) {
      // 错误帧：code(4) + payload_size(4) + {error}
      if (flags & FLAG_CODE) offset += 4;
      const size = readU32(dv, offset);
      offset += 4;
      const errText = new TextDecoder().decode(bytes.subarray(offset, offset + size));
      this.setStateRef('error', errText);
      this.opts.callbacks?.onError?.(errText);
      return;
    }

    if (msgType === MSG_FULL_SERVER) {
      // 文本事件帧排版（已按火山官方字节数组验证）：
      //   header(4) + [event(4)] + [sequence(4)] + session_id_size(4) + session_id + payload_size(4) + payload
      let eventId = 0;
      if (flags & FLAG_EVENT) {
        eventId = readU32(dv, offset);
        offset += 4;
      } else if (flags & FLAG_SEQ_POS || flags === FLAG_LAST || flags === FLAG_LAST_NEG) {
        offset += 4; // sequence 字段
      }
      // 服务器会话事件必带 session_id：先读 size 再跳过对应字节
      if (offset + 4 <= bytes.length) {
        const sidSize = readU32(dv, offset);
        offset += 4 + sidSize;
      }
      if (offset + 4 > bytes.length) return;
      const size = readU32(dv, offset);
      offset += 4;
      if (offset + size > bytes.length) return;
      // 注意：TTS 音频不在此（事件 350 是 JSON 文本）；音频走 MSG_AUDIO_RESP 帧。
      let jsonStr = '';
      try {
        jsonStr = new TextDecoder().decode(bytes.subarray(offset, offset + size));
      } catch { return; }
      this.handleServerEvent(eventId, jsonStr);
      return;
    }

    if (msgType === MSG_AUDIO_RESP) {
      // 服务端音频：header + [sequence] + payload_size(4) + PCM/Opus
      if (flags & FLAG_SEQ_POS || flags === FLAG_LAST || flags === FLAG_LAST_NEG) {
        offset += 4;
      }
      const size = readU32(dv, offset);
      offset += 4;
      if (offset + size > bytes.length) return;
      const audioBuf = bytes.slice(offset, offset + size);
      this.onServerAudio(audioBuf);
      return;
    }
  }

  private handleServerEvent(eventId: number, jsonStr: string): void {
    let payload: Record<string, unknown> | null = null;
    try {
      payload = jsonStr ? (JSON.parse(jsonStr) as Record<string, unknown>) : null;
    } catch {
      payload = null;
    }
    switch (eventId) {
      case S2S_SRV_CONNECTION_STARTED:
        break;
      case S2S_SRV_SESSION_STARTED:
        this.setStateRef('active', 'session started');
        this.opts.callbacks?.onStateChange?.('active', 'session started');
        break;
      case S2S_SRV_SESSION_FAILED: {
        const err = (payload?.error as string) ?? '会话失败';
        this.setStateRef('error', err);
        this.opts.callbacks?.onError?.(err);
        break;
      }
      case S2S_SRV_ASR_RESPONSE: {
        const text = (payload?.result as string) ?? (payload?.text as string) ?? '';
        if (text) {
          this.setRef({ partialText: text });
          this.opts.callbacks?.onTranscript?.(text);
        }
        break;
      }
      case S2S_SRV_ASR_ENDED: {
        const text = (payload?.result as string) ?? (payload?.text as string) ?? '';
        if (text) {
          this.setRef({ transcript: text, partialText: '' });
          this.opts.callbacks?.onTranscript?.(text);
        }
        break;
      }
      case S2S_SRV_TTS_RESPONSE: {
        // 350：TTS 文本事件（payload.text 为该句要朗读的文本）
        const text = (payload?.text as string) ?? '';
        if (text) {
          this.setRef({ response: text });
          this.opts.callbacks?.onReply?.(text);
        }
        break;
      }
      case S2S_SRV_MODEL_STREAM: {
        // 550：模型流式回复文本（payload.content 为逐段文本）
        const content = (payload?.content as string) ?? '';
        if (content) {
          this.setRef({ response: content });
          this.opts.callbacks?.onReply?.(content);
        }
        break;
      }
      case S2S_SRV_QUESTION_STARTED:
      case S2S_SRV_TTS_SENTENCE:
      case S2S_SRV_REPLY_ENDED:
      case 359: // TTS 结束
        // 无文本负载，仅用于时序标记，忽略
        break;
      case S2S_SRV_SESSION_FINISHED:
        this.setStateRef('idle', 'session finished');
        break;
      default:
        break;
    }
  }

  /** 服务端音频帧 → 播放 */
  private onServerAudio(audioBuf: Uint8Array): void {
    if (audioBuf.length === 0) return;
    const arrayBuffer = audioBuf.buffer.slice(
      audioBuf.byteOffset,
      audioBuf.byteOffset + audioBuf.byteLength,
    ) as ArrayBuffer;
    if (this.pcmOutput) {
      this.playPcm(arrayBuffer);
    } else {
      // Opus/OGG 未在本端解码，交由调用方通过 onReply 文本自行 TTS（此处降级为空）
      // 业务上我们默认 pcmOutput=true，走 PCM 播放。
      this.opts.callbacks?.onSpeakingChange?.(true);
    }
  }

  /** 播放 PCM 24k s16le 流（分片排程，支持打断） */
  private playPcm(arrayBuffer: ArrayBuffer): void {
    if (!this.playbackCtx) {
      this.playbackCtx = new AudioContext();
      this.nextPlayTime = 0;
    }
    const ctx = this.playbackCtx;
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => undefined);
    }
    const audioSR = 24000;
    const outSR = ctx.sampleRate;
    if (!this.playbackResampler) {
      this.playbackResampler = createLinearResampler(audioSR, outSR);
    }
    const float = pcmLeToFloat32(arrayBuffer);
    const resampled = this.playbackResampler.push(float);
    if (resampled.length === 0) return;

    const buffer = ctx.createBuffer(1, resampled.length, outSR);
    buffer.copyToChannel(resampled as Float32Array<ArrayBuffer>, 0);

    if (this.playbackQueue.length === 0) {
      this.nextPlayTime = Math.max(ctx.currentTime + 0.02, this.nextPlayTime);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(this.nextPlayTime);
    this.playbackQueue.push({ buffer, start: this.nextPlayTime });
    this.nextPlayTime += buffer.duration;

    // 清理已播放节点
    source.onended = () => {
      this.playbackQueue = this.playbackQueue.filter((q) => q.buffer !== buffer);
      if (this.playbackQueue.length === 0) {
        this.setSpeaking(false);
      }
    };
    this.setSpeaking(true);
  }

  private setSpeaking(speaking: boolean): void {
    if (this.speaking === speaking) return;
    this.speaking = speaking;
    this.setRef({ speaking });
    this.opts.callbacks?.onSpeakingChange?.(speaking);
  }

  /** 用户开始说话时打断 TTS 播报 */
  interruptPlayback(): void {
    if (this.playbackCtx) {
      void this.playbackCtx.close().catch(() => undefined);
      this.playbackCtx = null;
    }
    this.playbackQueue = [];
    this.playbackResampler = null;
    this.nextPlayTime = 0;
    this.setSpeaking(false);
  }

  /** 采集麦克风并通过 Audio-only 帧持续上传 */
  async startMic(energyThreshold = 0.012): Promise<{ stop(): Promise<void> }> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });
    this.micStream = stream;
    const ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => undefined);
    }
    this.audioContext = ctx;
    this.sourceNode = ctx.createMediaStreamSource(stream);
    const micSR = ctx.sampleRate;
    const targetSR = 16000;
    this.micResampler = createLinearResampler(micSR, targetSR);

    const processor = ctx.createScriptProcessor(4096, 1, 1);
    this.processorNode = processor;
    processor.onaudioprocess = (e) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);
      const resampled = this.micResampler!.push(input);
      if (resampled.length === 0) return;
      // Float32 → Int16 小端
      const pcm = new DataView(new ArrayBuffer(resampled.length * 2));
      for (let i = 0; i < resampled.length; i++) {
        const s = resampled[i];
        const x = s <= -1 ? -0x8000 : s >= 1 ? 0x7fff : Math.round(s * 0x7fff);
        pcm.setInt16(i * 2, x, true);
      }
      this.sendAudio(pcm.buffer);
    };
    this.sourceNode.connect(processor);

    return {
      stop: async () => {
        this.teardownAudio();
      },
    };
  }

  private teardownAudio(): void {
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.audioContext) {
      void this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    this.interruptPlayback();
  }

  /** 结束会话并关闭连接 */
  async stop(): Promise<void> {
    try {
      this.sendFinishSession();
    } catch { /* noop */ }
    this.teardownAudio();
    if (this.ws) {
      try {
        this.ws.close();
      } catch { /* noop */ }
      this.ws = null;
    }
    this.setStateRef('idle');
  }

  /** 发送文本 query（可选，用于无麦克风场景） */
  sendTextQuery(text: string): void {
    this.sendEvent(S2S_EVT_CHAT_TEXT_QUERY, JSON.stringify({ content: text }), this.sessionId || undefined);
  }
}