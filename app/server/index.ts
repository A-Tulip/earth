/**
 * 轻量服务端代理 —— 火山引擎 LLM / ASR / TTS + 实时流式语音
 *
 * 设计目标（遵循 AGENTS.md §6.7）：
 * - 密钥从 process.env 读取，绝不进入前端构建产物
 * - 前端只调用同源 /api/* 或 /ws/* 端点，不直接持有 API Key
 * - 实时流式 ASR：浏览器 → WebSocket → 服务端 → 火山引擎流式 WebSocket
 * - 失败时返回明确错误码，前端可降级到浏览器回退
 *
 * 启动：
 *   npm run voice:proxy
 *
 * 配置文件读取顺序（首个存在的文件生效）：
 *   1. app/server/.env    （推荐，服务端专用，不进入前端）
 *   2. app/.env.local     （回退，但注意 VITE_ 前缀变量不应放在这里）
 *   3. 进程环境变量       （部署环境注入，优先级最高）
 *
 * 环境变量（服务端可见，不带 VITE_ 前缀）：
 *   PORT=8787
 *   VOLC_ARK_API_KEY=sk-...
 *   VOLC_ARK_MODEL=doubao-seed-1.6-250615
 *   VOLC_ASR_APP_ID=...
 *   VOLC_ASR_ACCESS_KEY=...
 *   VOLC_ASR_RESOURCE_ID=volc.bigasr.sauc.duration
 *   VOLC_TTS_APP_ID=...
 *   VOLC_TTS_ACCESS_KEY=...
 *   VOLC_TTS_VOICE_TYPE=zh_female_qingxin
 */
import http from 'node:http';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ============ 加载 .env 文件（轻量实现，不依赖 dotenv） ============
const __dirname = dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  resolve(__dirname, '.env'),           // app/server/.env（推荐）
  resolve(__dirname, '..', '.env.local'), // app/.env.local（回退）
];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx < 0) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();
        // 去除引号
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        // 不覆盖已有的环境变量（进程环境变量优先级最高）
        if (!(key in process.env)) {
          process.env[key] = value;
        }
      }
      // eslint-disable-next-line no-console
      console.log(`[voice-proxy] 已加载配置: ${envPath}`);
      break;
    } catch {
      // 读取失败，继续尝试下一个
    }
  }
}

const PORT = Number(process.env.PORT ?? 8787);

// ============ 火山引擎端点 ============
const ARK_CHAT_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
const TTS_HTTP_URL = 'https://sami.bytedance.com/api/v1/invoke';
const ASR_WS_URL = 'wss://openspeech.bytedance.com/api/v2/asr';

// ============ 工具函数 ============

interface RouteHandler {
  (req: http.IncomingMessage, body: Buffer): Promise<{ status: number; body: unknown }>;
}

const routes: Record<string, RouteHandler> = {};

function json(status: number, body: unknown) {
  return { status, body };
}

function jsonError(status: number, code: string, message: string) {
  return json(status, { ok: false, code, error: message });
}

// ============ /api/llm/chat —— 方舟大模型 ============
routes['/api/llm/chat'] = async (req, body) => {
  const apiKey = process.env.VOLC_ARK_API_KEY;
  if (!apiKey) return jsonError(503, 'PROVIDER_NOT_CONFIGURED', '服务端未配置 VOLC_ARK_API_KEY');

  const model = process.env.VOLC_ARK_MODEL || 'doubao-seed-1.6-250615';
  const payload = JSON.parse(body.toString('utf8'));

  const upstream = await fetch(ARK_CHAT_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...payload, model }),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return jsonError(upstream.status, 'UPSTREAM_ERROR', `方舟调用失败: ${errText.slice(0, 500)}`);
  }

  const isStream = payload.stream === true;
  const text = await upstream.text();

  if (isStream) {
    return { status: 200, body: text };
  }

  try {
    const data = JSON.parse(text);
    return json(200, data);
  } catch {
    return json(200, text);
  }
};

// ============ /api/tts/synthesize —— 语音合成 ============
routes['/api/tts/synthesize'] = async (req, body) => {
  const appId = process.env.VOLC_TTS_APP_ID;
  const accessKey = process.env.VOLC_TTS_ACCESS_KEY;
  if (!appId || !accessKey) {
    return jsonError(503, 'PROVIDER_NOT_CONFIGURED', '服务端未配置 VOLC_TTS_APP_ID / VOLC_TTS_ACCESS_KEY');
  }

  const { text, voiceType, format, speed } = JSON.parse(body.toString('utf8'));
  if (!text) return jsonError(400, 'INVALID_ARGS', 'text 必填');

  const speaker = voiceType || process.env.VOLC_TTS_VOICE_TYPE || 'zh_female_qingxin';
  const audioFormat = format || 'mp3';

  const payloadObj = {
    speaker,
    text,
    audio_config: {
      format: audioFormat,
      sample_rate: 24000,
      speech_rate: typeof speed === 'number' ? speed : 0,
    },
  };
  const url = `${TTS_HTTP_URL}?version=v4&token=${encodeURIComponent(accessKey)}&appkey=${encodeURIComponent(appId)}&namespace=TTS`;
  const upstream = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: JSON.stringify(payloadObj) }),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return jsonError(upstream.status, 'UPSTREAM_ERROR', `火山 TTS 失败: ${errText.slice(0, 500)}`);
  }

  const data = await upstream.json() as { data?: string; status_code?: number; status_text?: string };
  if (data.status_code !== 20000000 || !data.data) {
    return jsonError(502, 'UPSTREAM_ERROR', `火山 TTS 业务错误: ${data.status_text ?? data.status_code}`);
  }

  return json(200, { ok: true, audio: data.data, format: audioFormat });
};

// ============ /api/asr/recognition —— 一句话识别（HTTP 非流式，备用） ============
routes['/api/asr/recognition'] = async (req, body) => {
  const appId = process.env.VOLC_ASR_APP_ID;
  const accessKey = process.env.VOLC_ASR_ACCESS_KEY;
  if (!appId || !accessKey) {
    return jsonError(503, 'PROVIDER_NOT_CONFIGURED', '服务端未配置 VOLC_ASR_APP_ID / VOLC_ASR_ACCESS_KEY');
  }

  const resourceId = process.env.VOLC_ASR_RESOURCE_ID || 'volc.bigasr.sauc.duration';

  // 火山引擎一句话识别（HTTP POST）
  // 参考: https://www.volcengine.com/docs/6561/1354868
  const url = 'https://openspeech.bytedance.com/api/v1/asr';
  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer;${accessKey}`,
      'X-Api-App-Id': appId,
      'X-Api-Resource-Id': resourceId,
    },
    body: JSON.stringify({
      audio: body.toString('base64'),
      audio_format: 'wav',
      user: 'earth-explorer',
    }),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return jsonError(upstream.status, 'UPSTREAM_ERROR', `火山 ASR 失败: ${errText.slice(0, 500)}`);
  }

  const data = await upstream.json() as { code?: number; data?: { text?: string[] } };
  if (data.code !== 3000 || !data.data) {
    return jsonError(502, 'UPSTREAM_ERROR', `火山 ASR 错误: code=${data.code}`);
  }

  return json(200, { ok: true, text: (data.data.text ?? []).join('') });
};

// ============ /api/health —— 健康检查 ============
routes['/api/health'] = async () => {
  return json(200, {
    ok: true,
    llm: !!process.env.VOLC_ARK_API_KEY,
    tts: !!process.env.VOLC_TTS_APP_ID && !!process.env.VOLC_TTS_ACCESS_KEY,
    asr: !!process.env.VOLC_ASR_APP_ID && !!process.env.VOLC_ASR_ACCESS_KEY,
    rtc: !!process.env.VOLC_RTC_APP_ID && !!process.env.VOLC_RTC_APP_KEY,
  });
};

// ============ /api/rtc/token —— 火山引擎 RTC Token（未来升级路径） ============
//
// 当前实现：方案 B（WebSocket 流式 ASR + VAD）已满足教学场景需求。
// 本端点为未来升级到火山引擎 rtc_conversational_ai（方案 A）预留：
//   1. 前端通过 WebRTC 接入 RTC 房间
//   2. 服务端调用 StartVoiceChat API 启动智能体
//   3. 智能体在 RTC 房间内进行全双工语音对话
//
// 升级条件：
//   - 需要火山引擎 RTC 账号和 AppID
//   - 需要配置 VOLC_RTC_APP_ID / VOLC_RTC_APP_KEY
//   - 需要前端引入 @volcengine/rtc SDK（~200KB）
//
// 详见 docs/voice-agent.md §6 实时对话模式
routes['/api/rtc/token'] = async () => {
  const appId = process.env.VOLC_RTC_APP_ID;
  const appKey = process.env.VOLC_RTC_APP_KEY;

  if (!appId || !appKey) {
    return jsonError(503, 'RTC_NOT_CONFIGURED', '未配置 VOLC_RTC_APP_ID / VOLC_RTC_APP_KEY。当前使用方案 B（WebSocket 流式 ASR + VAD）');
  }

  // TODO: 未来升级时实现
  // 1. 生成 RTC RoomID + UserID + Token
  // 2. 调用 StartVoiceChat API 启动智能体
  // 3. 返回 Token + RoomID 给前端
  return jsonError(501, 'NOT_IMPLEMENTED', 'RTC 方案 A 尚未实现，当前使用方案 B');
};

// ============ HTTP Server ============
const server = http.createServer(async (req, res) => {
  try {
    const url = req.url?.split('?')[0] ?? '';
    const handler = routes[url];

    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks);

    const result = await handler(req, body);

    if (typeof result.body === 'string') {
      res.writeHead(result.status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(result.body);
    } else {
      res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result.body));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, code: 'INTERNAL', error: message }));
  }
});

// ============ WebSocket 服务器 —— 实时流式 ASR ============
// 浏览器 ──ws──► 服务端 ──ws──► 火山引擎流式 ASR
// 支持: partial text 实时回传 + final text 最终结果
const wss = new WebSocketServer({ server, path: '/ws/asr' });

/** 生成火山引擎 WebSocket 鉴权 URL */
function buildAsrWsUrl(): string {
  const appId = process.env.VOLC_ASR_APP_ID;
  const accessKey = process.env.VOLC_ASR_ACCESS_KEY;
  const resourceId = process.env.VOLC_ASR_RESOURCE_ID || 'volc.bigasr.sauc.duration';

  if (!appId || !accessKey) {
    throw new Error('ASR_NOT_CONFIGURED');
  }

  const params = new URLSearchParams({
    appid: appId,
    token: accessKey,
    resource: resourceId,
  });
  return `${ASR_WS_URL}?${params.toString()}`;
}

wss.on('connection', (clientWs: WebSocket) => {
  let upstreamWs: WebSocket | null = null;
  let sessionOpen = false;
  let audioQueue: Buffer[] = [];
  let upstreamReady = false;

  const sendToClient = (obj: Record<string, unknown>) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(obj));
    }
  };

  const sendError = (code: string, message: string) => {
    sendToClient({ type: 'error', code, message });
  };

  // 1. 浏览器 → 服务端：接收音频数据或控制命令
  clientWs.on('message', (data: WebSocket.Data) => {
    try {
      const msg = JSON.parse(data.toString()) as { type: string; data?: string };

      if (msg.type === 'start') {
        // 开始新会话
        startSession();
      } else if (msg.type === 'end') {
        // 结束会话
        endSession();
      } else if (msg.type === 'audio') {
        // 音频数据（base64 编码的 PCM16 音频）
        const audioBytes = Buffer.from(msg.data ?? '', 'base64');
        audioQueue.push(audioBytes);
        flushAudioQueue();
      }
    } catch {
      // 非 JSON 消息，可能是二进制音频（直接透传）
      if (Buffer.isBuffer(data)) {
        audioQueue.push(data);
        flushAudioQueue();
      }
    }
  });

  clientWs.on('close', () => {
    cleanup();
  });

  clientWs.on('error', () => {
    cleanup();
  });

  /** 启动会话：连接火山引擎 */
  function startSession() {
    const appId = process.env.VOLC_ASR_APP_ID;
    const accessKey = process.env.VOLC_ASR_ACCESS_KEY;
    if (!appId || !accessKey) {
      sendError('ASR_NOT_CONFIGURED', '服务端未配置 VOLC_ASR_APP_ID / VOLC_ASR_ACCESS_KEY');
      sendToClient({ type: 'ready', asr: false });
      return;
    }

    try {
      const upstreamUrl = buildAsrWsUrl();
      upstreamWs = new WebSocket(upstreamUrl);

      upstreamWs.on('open', () => {
        upstreamReady = true;
        sessionOpen = true;
        sendToClient({ type: 'ready', asr: true });

        // 发送初始化消息
        upstreamWs!.send(JSON.stringify({
          user: { uid: 'earth-explorer' },
          audio: {
            format: 'pcm',
            codec: 'raw',
            rate: 16000,
            bits: 16,
            channel: 1,
          },
          request: {
            mode: '2pass',
            result_type: 'full',
            language: 'zh_cn',
          },
        }));

        // 刷新积压的音频
        flushAudioQueue();
      });

      upstreamWs.on('message', (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString()) as {
            code?: number;
            message?: string;
            data?: {
              text?: string;
              mode?: 'replace' | 'append';
              is_final?: boolean;
            };
            // 火山引擎流式 ASR 响应格式
            // code=3000 表示成功
            if (msg.code === 3000 && msg.data) {
              const isFinal = msg.data.is_final ?? msg.data.mode === 'append';
              sendToClient({
                type: isFinal ? 'final' : 'partial',
                text: msg.data.text ?? '',
              });
            } else if (msg.code !== 3000) {
              sendError('UPSTREAM_ERROR', `火山 ASR 错误: code=${msg.code} ${msg.message ?? ''}`);
            }
          } catch {
            // 忽略非 JSON 消息
          }
        });

        upstreamWs.on('close', () => {
          upstreamReady = false;
          sendToClient({ type: 'upstream_closed' });
        });

        upstreamWs.on('error', () => {
          upstreamReady = false;
          sendError('UPSTREAM_ERROR', '火山引擎 WebSocket 连接错误');
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendError('ASR_CONNECT_FAILED', `连接火山引擎失败: ${msg}`);
      }
    }

    /** 刷新音频队列 */
    function flushAudioQueue() {
      if (!upstreamReady || !upstreamWs || audioQueue.length === 0) return;
      while (audioQueue.length > 0) {
        const chunk = audioQueue.shift()!;
        if (upstreamReady && upstreamWs.readyState === WebSocket.OPEN) {
          upstreamWs.send(chunk);
        }
      }
    }

    /** 结束会话 */
    function endSession() {
      sessionOpen = false;
      if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
        // 发送结束信号
        upstreamWs.send(JSON.stringify({
          user: { uid: 'earth-explorer' },
          audio: { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 },
          request: { mode: '2pass', result_type: 'full', language: 'zh_cn', is_final: true },
        }));
        // 等待一小段时间后关闭
        setTimeout(() => {
          upstreamWs?.close();
        }, 500);
      } else {
        upstreamWs?.close();
      }
    }

    /** 清理 */
    function cleanup() {
      sessionOpen = false;
      audioQueue = [];
      if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
        upstreamWs.close();
      }
      upstreamWs = null;
    }
  });

// ============ 启动 ============
server.listen(PORT, () => {
  const enabled = [
    process.env.VOLC_ARK_API_KEY ? 'llm' : null,
    process.env.VOLC_TTS_APP_ID ? 'tts' : null,
    process.env.VOLC_ASR_APP_ID ? 'asr' : null,
  ].filter(Boolean);
  // eslint-disable-next-line no-console
  console.log(`[voice-proxy] listening on http://localhost:${PORT} (enabled: ${enabled.join(', ') || 'none'})`);
});

export { server };
