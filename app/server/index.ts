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
 *   VOLC_ARK_MODEL=doubao-seed-1.6-250615                （主模型；强烈建议改成控制台真实申请的 endpointId，形如 ep-xxxx）
 *   VOLC_ARK_MODEL_FAST=                                   （可选：短指令快速模型。留空=始终只走主模型；填写必须是控制台真实的 endpointId，**不可猜测模型名**，否则会 InvalidEndpointOrModel.NotFound）
 *   VOLC_ASR_APP_ID=...
 *   VOLC_ASR_ACCESS_TOKEN=...     （豆包语音官方命名：access_token；TOKEN 鉴权模式必需）
 *   VOLC_ASR_SECRET_KEY=...       （豆包语音官方命名：secret_key；SIGNATURE 鉴权模式必需，TOKEN 模式不用填）
 *   VOLC_ASR_AUTH_MODE=token      （token 或 signature；默认 token，填了 SECRET_KEY 可切到 signature）
 *   VOLC_ASR_RESOURCE_ID=volc.bigasr.sauc.duration
 *   VOLC_TTS_APP_ID=...
 *   VOLC_TTS_ACCESS_TOKEN=...     （TTS 在 sami.bytedance.com 的调用名是 token，和 access_token 是同一个值）
 *   VOLC_TTS_VOICE_TYPE=zh_female_qingxin
 */
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHmac } from 'node:crypto';
import { URL } from 'node:url';

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
const ARK_RESPONSES_URL = 'https://ark.cn-beijing.volces.com/api/v3/responses';
const TTS_HTTP_URL = 'https://sami.bytedance.com/api/v1/invoke';
const ASR_WS_URL = 'wss://openspeech.bytedance.com/api/v2/asr';

// ============ 工具函数 ============

interface RouteHandler {
  (req: http.IncomingMessage, body: Buffer): Promise<{ status: number; body: unknown }>;
}

const routes: Record<string, RouteHandler> = {};

/** 所有上游（火山引擎）调用的硬超时：25s 强制中断，避免课堂挂死 */
const UPSTREAM_TIMEOUT_MS = 25_000;

function json(status: number, body: unknown) {
  return { status, body };
}

function jsonError(status: number, code: string, message: string) {
  return json(status, { ok: false, code, error: message });
}

/**
 * 上游 fetch 封装：自动加 25s 超时（AbortController），避免火山引擎响应慢或 DNS 卡住时永远 pending。
 * 返回的 Response 与原生 fetch 完全一致。
 */
async function fetchWithTimeout(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') {
      throw new Error(`UPSTREAM_TIMEOUT: ${UPSTREAM_TIMEOUT_MS}ms 未响应，请稍后重试`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 请求 body 解析 + 必填字段校验：统一返回 400 INVALID_ARGS，杜绝每个路由手写 try/catch。
 * 用法： const payload = parseBody<{text:string}>(body, ['text']);
 */
function parseBody<T extends Record<string, unknown>>(body: Buffer, required: (keyof T)[] = []): T {
  let parsed: T;
  try {
    parsed = JSON.parse(body.toString('utf8')) as T;
  } catch {
    const err = new Error('请求体不是合法 JSON') as Error & { code?: string };
    err.code = 'INVALID_ARGS';
    throw err;
  }
  if (Array.isArray(required)) {
    for (const k of required) {
      const v = parsed[k];
      if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
        const err = new Error(`缺少必填参数: ${String(k)}`) as Error & { code?: string };
        err.code = 'INVALID_ARGS';
        throw err;
      }
    }
  }
  return parsed;
}

/**
 * 统一的路由外层包装：日志 + 耗时 + CORS + 统一错误码。
 * 用法： routes['/api/xxx'] = wrap('llm.chat', handler);
 */
function wrapHandler(tag: string, handler: RouteHandler): RouteHandler {
  return async (req, body) => {
    const startedAt = process.hrtime.bigint();
    const reqId = Math.random().toString(36).slice(2, 9);
    try {
      const result = await handler(req, body);
      const costMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
      const logLine = `[${reqId}] ${tag} ${result.status} ${costMs}ms`;
      if (result.status >= 400) console.warn(logLine, JSON.stringify(result.body).slice(0, 200));
      else console.log(logLine);
      return result;
    } catch (e) {
      const costMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
      const code = (e as Error & { code?: string })?.code || 'INTERNAL';
      const msg = (e instanceof Error ? e.message : String(e)) || 'Internal Server Error';
      console.warn(`[${reqId}] ${tag} FAIL ${code} ${costMs}ms ${msg.slice(0, 180)}`);
      const statusMap: Record<string, number> = {
        INVALID_ARGS: 400,
        UNAUTHORIZED: 401,
        PROVIDER_NOT_CONFIGURED: 503,
        UPSTREAM_TIMEOUT: 504,
        UPSTREAM_ERROR: 502,
        NOT_IMPLEMENTED: 501,
      };
      const status = statusMap[code] ?? (msg.includes('timeout') ? 504 : 500);
      return jsonError(status, code, msg);
    }
  };
}

/** CORS 响应头（用于非 Vite 代理直连部署，如生产环境） */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Model, X-Intent-Hint',
  'Access-Control-Max-Age': '86400',
};

/**
 * 计算火山引擎 ASR 的 signature 鉴权（HMAC-SHA256 + base64url）
 * 官方文档：https://www.volcengine.com/docs/6561/107789 §Signature 鉴权
 *   待签名原文 = 请求行 + "\n" + Host + "\n" + body（WebSocket 建连请求 body 可空）
 *   HMAC key = secret_key 的原始字节
 */
function computeVolcAsrSignature(
  method: string,
  requestPathAndQuery: string,
  host: string,
  secretKey: string,
  body = '',
): string {
  const requestLine = `${method} ${requestPathAndQuery} HTTP/1.1`;
  const canonical = `${requestLine}\n${host}\n${body}`;
  const hmac = createHmac('sha256', secretKey).update(canonical).digest();
  // base64url（按官方文档，= 填充可选，且把 +/ 换成 -_）
  return hmac
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/** 豆包语音 ASR 两种鉴权模式的统一工具：返回 { url, extraHeaders }
 *   - TOKEN 模式（简单，推荐）：URL 或 Header 里传 access_token
 *   - SIGNATURE 模式（更安全，需要 secret_key）：HMAC256 签名
 */
function buildAsrAuth(extraParams: Record<string, string> = {}): {
  authMode: 'token' | 'signature';
  token: string;
  secretKey?: string;
  extraParams: Record<string, string>;
} {
  const accessToken = process.env.VOLC_ASR_ACCESS_TOKEN ?? process.env.VOLC_ASR_ACCESS_KEY ?? '';
  const secretKey = process.env.VOLC_ASR_SECRET_KEY ?? '';
  const authModeEnv = (process.env.VOLC_ASR_AUTH_MODE ?? '').toLowerCase();
  const authMode: 'token' | 'signature' =
    authModeEnv === 'signature' ? 'signature' :
    (accessToken && secretKey && authModeEnv !== 'token' ? 'signature' : 'token');
  if (!accessToken) throw new Error('ASR_NOT_CONFIGURED');
  return { authMode, token: accessToken, secretKey: secretKey || undefined, extraParams };
}

// ============ /api/llm/chat —— 方舟大模型（Responses API） ============
routes['/api/llm/chat'] = wrapHandler('llm.chat', async (req, body) => {
  const apiKey = process.env.VOLC_ARK_API_KEY;
  if (!apiKey) return jsonError(503, 'PROVIDER_NOT_CONFIGURED', '服务端未配置 VOLC_ARK_API_KEY');

  const modelDefault = process.env.VOLC_ARK_MODEL || 'doubao-seed-1-6-251015';
  const modelFast = process.env.VOLC_ARK_MODEL_FAST;
  const payload = parseBody<Record<string, unknown>>(body);

  let model = modelDefault;
  const xModel = req.headers['x-model'];
  const intentHint = (req.headers['x-intent-hint'] as string) || '';
  if (typeof xModel === 'string' && xModel) {
    if (xModel === 'fast' && modelFast) model = modelFast;
    else if (xModel === 'main') model = modelDefault;
    else model = xModel;
  } else if (modelFast && intentHint === 'fast') {
    model = modelFast;
  }

  // —— 请求转换：chat/completions → responses 格式 ——
  const rawMessages = Array.isArray(payload.messages) ? payload.messages as Array<{ role: string; content: string }> : [];
  const input = rawMessages.map((m) => ({
    role: m.role,
    content: [{ type: 'input_text' as const, text: m.content }],
  }));

  // 工具转换：去掉 function 包裹层，responses API 格式
  const rawTools = Array.isArray(payload.tools) ? payload.tools as Array<{ type: string; function?: { name: string; description: string; parameters: Record<string, unknown> }; name?: string; description?: string; parameters?: Record<string, unknown> }> : [];
  const tools = rawTools.map((t) => {
    if (t.function) {
      return { type: 'function', name: t.function.name, description: t.function.description, parameters: t.function.parameters ?? {} };
    }
    return { type: 'function', name: t.name ?? '', description: t.description ?? '', parameters: t.parameters ?? {} };
  });

  const requestBody = JSON.stringify({
    model,
    input,
    tools,
    store: true,
  });

  const callOnce = async (which: string): Promise<{
    responseText: string;
    status: number;
    isNotFound: boolean;
  }> => {
    const upstream = await fetchWithTimeout(ARK_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...JSON.parse(requestBody), model: which }),
    });
    const text = await upstream.text();
    const isNotFound =
      !upstream.ok &&
      (upstream.status === 404 ||
        text.includes('InvalidEndpointOrModel') ||
        text.includes('NotFound'));
    return { responseText: text, status: upstream.status, isNotFound };
  };

  let first = await callOnce(model);

  const fastWasUsed = model !== modelDefault;
  if (first.isNotFound && fastWasUsed) {
    console.warn(`[llm.chat] 首次调用模型 ${model} 返回 NotFound，自动降级到主模型 ${modelDefault} 重试`);
    first = await callOnce(modelDefault);
  }

  if (first.status !== 200) {
    return jsonError(first.status, 'UPSTREAM_ERROR', `方舟调用失败: ${first.responseText.slice(0, 500)}`);
  }

  // —— 响应转换：responses → chat/completions 兼容格式 ——
  try {
    const resp = JSON.parse(first.responseText);
    const output = Array.isArray(resp.output) ? resp.output : [];

    // 提取 tool_calls
    const toolCalls = output
      .filter((item: { type?: string }) => item.type === 'function_call')
      .map((item: { name: string; arguments: string }) => ({
        id: `call_${item.name}_${Date.now()}`,
        type: 'function',
        function: { name: item.name, arguments: item.arguments ?? '{}' },
      }));

    // 提取文本
    let text = '';
    for (const item of output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.type === 'output_text' && c.text) {
            text += c.text;
          }
        }
      }
    }

    // 返回与原 chat/completions 兼容的格式，前端无需改动
    return json(200, {
      choices: [
        {
          message: {
            role: 'assistant',
            content: text || null,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          },
        },
      ],
      usage: resp.usage,
    });
  } catch {
    return json(200, first.responseText);
  }
});

// ============ /api/tts/synthesize —— 语音合成 ============
routes['/api/tts/synthesize'] = wrapHandler('tts.synth', async (_req, body) => {
  const appId = process.env.VOLC_TTS_APP_ID;
  // 官方：豆包语音在 SAMI 平台的 TTS 接口里，参数名叫 token（和 access_token 是同一个值）
  const accessToken = process.env.VOLC_TTS_ACCESS_TOKEN ?? process.env.VOLC_TTS_ACCESS_KEY ?? '';
  if (!appId || !accessToken) {
    return jsonError(503, 'PROVIDER_NOT_CONFIGURED', '服务端未配置 VOLC_TTS_APP_ID / VOLC_TTS_ACCESS_TOKEN');
  }

  const { text, voiceType, format, speed } = parseBody<{
    text?: string; voiceType?: string; format?: string; speed?: unknown;
  }>(body, ['text']);

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
  const url = `${TTS_HTTP_URL}?version=v4&token=${encodeURIComponent(accessToken)}&appkey=${encodeURIComponent(appId)}&namespace=TTS`;
  const upstream = await fetchWithTimeout(url, {
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
});

// ============ /api/asr/recognition —— 一句话识别（HTTP 非流式，备用） ============
routes['/api/asr/recognition'] = wrapHandler('asr.recognize', async (_req, body) => {
  const appId = process.env.VOLC_ASR_APP_ID;
  const resourceId = process.env.VOLC_ASR_RESOURCE_ID || 'volc.bigasr.sauc.duration';
  const auth = buildAsrAuth({});
  if (!appId) {
    return jsonError(503, 'PROVIDER_NOT_CONFIGURED', '服务端未配置 VOLC_ASR_APP_ID');
  }
  if (body.length === 0) {
    return jsonError(400, 'INVALID_ARGS', 'ASR 请求缺少音频 body');
  }

  // 火山引擎一句话识别（HTTP POST）支持两种鉴权：
  //   Token:     Authorization: Bearer;{access_token}
  //   也可以用 url 参数: appid=xxx&token=xxx（WebSocket URL 传也行
  // 参考: https://www.volcengine.com/docs/6561/1354868
  const targetUrl = new URL('https://openspeech.bytedance.com/api/v1/asr');
  targetUrl.searchParams.set('appid', appId);
  targetUrl.searchParams.set('token', auth.token);
  targetUrl.searchParams.set('resource', resourceId);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer;${auth.token}`,
    'X-Api-App-Id': appId,
    'X-Api-Resource-Id': resourceId,
  };
  // 只有选择 signature 模式 + 有 secret_key 时，再覆写 Authorization 头
  if (auth.authMode === 'signature' && auth.secretKey) {
    const host = targetUrl.host;
    const mac = computeVolcAsrSignature(
      'POST',
      `${targetUrl.pathname}?${targetUrl.searchParams.toString()}`,
      host,
      auth.secretKey,
      body.toString('base64'),
    );
    headers['Authorization'] = `HMAC256; access_token="${auth.token}"; mac="${mac}"`;
  }

  const upstream = await fetchWithTimeout(targetUrl.toString(), {
    method: 'POST',
    headers,
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
});

// ============ /api/health —— 健康检查 ============
routes['/api/health'] = wrapHandler('meta.health', async () => {
  const asrToken = process.env.VOLC_ASR_ACCESS_TOKEN ?? process.env.VOLC_ASR_ACCESS_KEY;
  const ttsToken = process.env.VOLC_TTS_ACCESS_TOKEN ?? process.env.VOLC_TTS_ACCESS_KEY;
  return json(200, {
    ok: true,
    llm: !!process.env.VOLC_ARK_API_KEY,
    tts: !!process.env.VOLC_TTS_APP_ID && !!ttsToken,
    asr: !!process.env.VOLC_ASR_APP_ID && !!asrToken,
    asrAuthMode: process.env.VOLC_ASR_SECRET_KEY ? 'signature' : (asrToken ? 'token' : null),
    rtc: !!process.env.VOLC_RTC_APP_ID && !!process.env.VOLC_RTC_APP_KEY,
  });
});

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
routes['/api/rtc/token'] = wrapHandler('rtc.token', async () => {
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
});

// ============ HTTP Server ============
const server = http.createServer(async (req, res) => {
  // —— CORS：先回应 OPTIONS 预检，再给所有响应统一加头 ——
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...CORS_HEADERS, 'Content-Length': '0' });
    res.end();
    return;
  }
  const addCors = (h: Record<string, string>): Record<string, string> => ({ ...CORS_HEADERS, ...h });

  try {
    const url = req.url?.split('?')[0] ?? '';
    const handler = routes[url];

    if (!handler) {
      res.writeHead(404, addCors({ 'Content-Type': 'application/json' }));
      res.end(JSON.stringify({ ok: false, error: 'Not Found', path: url }));
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks);

    const result = await handler(req, body);

    if (typeof result.body === 'string') {
      // 兼容 SSE/流式 text（stream=true 场景）
      const ct = (result.status >= 400 || url !== '/api/llm/chat')
        ? 'text/plain; charset=utf-8'
        : 'text/event-stream; charset=utf-8';
      res.writeHead(result.status, addCors({ 'Content-Type': ct }));
      res.end(result.body);
    } else {
      res.writeHead(result.status, addCors({ 'Content-Type': 'application/json; charset=utf-8' }));
      res.end(JSON.stringify(result.body));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    res.writeHead(500, addCors({ 'Content-Type': 'application/json' }));
    res.end(JSON.stringify({ ok: false, code: 'INTERNAL', error: message }));
  }
});

// ============ WebSocket 服务器 —— 实时流式 ASR ============
// 浏览器 ──ws──► 服务端 ──ws──► 火山引擎流式 ASR
// 支持: partial text 实时回传 + final text 最终结果
const wss = new WebSocketServer({ server, path: '/ws/asr' });

/** 生成火山引擎 WebSocket 流式 ASR 的 { url, headers, authMode }
 *
 * 官方文档：https://www.volcengine.com/docs/6561/107789
 *   TOKEN 模式（推荐简单）：
 *     Authorization: Bearer;{access_token}
 *     URL 参数：appid / token / resource
 *   SIGNATURE 模式（安全，可选 secret_key）：
 *     Authorization: HMAC256; access_token=""; mac=""; h="Host"
 */
function buildAsrWsAuth(): { url: string; headers: Record<string, string>; authMode: 'token' | 'signature' } {
  const appId = process.env.VOLC_ASR_APP_ID;
  const resourceId = process.env.VOLC_ASR_RESOURCE_ID || 'volc.bigasr.sauc.duration';
  const auth = buildAsrAuth({});
  if (!appId) throw new Error('ASR_NOT_CONFIGURED');

  const params = new URLSearchParams({
    appid: appId,
    token: auth.token,
    resource: resourceId,
  });
  const basePath = `/api/v2/asr?${params.toString()}`;
  const fullUrl = `${ASR_WS_URL}?${params.toString()}`;
  const urlObj = new URL(ASR_WS_URL);
  const host = urlObj.host;

  const headers: Record<string, string> = {
    Authorization: `Bearer;${auth.token}`,
    Host: host,
  };

  if (auth.authMode === 'signature' && auth.secretKey) {
    // WebSocket 建连请求按官方文档也要算签名（body 可空）
    const mac = computeVolcAsrSignature('GET', basePath, host, auth.secretKey, '');
    headers.Authorization = `HMAC256; access_token="${auth.token}"; mac="${mac}"`;
  }

  return { url: fullUrl, headers, authMode: auth.authMode };
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
    const asrToken = process.env.VOLC_ASR_ACCESS_TOKEN ?? process.env.VOLC_ASR_ACCESS_KEY;
    if (!appId || !asrToken) {
      sendError('ASR_NOT_CONFIGURED', '服务端未配置 VOLC_ASR_APP_ID / VOLC_ASR_ACCESS_TOKEN');
      sendToClient({ type: 'ready', asr: false });
      return;
    }

    try {
      const { url: upstreamUrl, headers: upstreamHeaders } = buildAsrWsAuth();
      upstreamWs = new WebSocket(upstreamUrl, { headers: upstreamHeaders });

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
