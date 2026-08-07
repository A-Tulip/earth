/**
 * Cloudflare Worker — 豆包 AI 代理
 *
 * 作用：把前端请求转发到火山引擎豆包 API，隐藏 API Key，解决 CORS 问题
 *
 * 部署步骤：
 *   1. 注册/登录 https://dash.cloudflare.com → Workers & Pages → 创建 Worker
 *   2. 把本文件内容粘贴到 Worker 编辑器中，保存部署
 *   3. 在 Worker 的「设置 → 变量」中添加环境变量：
 *        DOUBAO_API_KEY = 你的火山引擎豆包 API Key
 *   4. 复制 Worker 的 URL（如 https://ai-proxy.xxx.workers.dev）
 *   5. 把 earth.html 中 callVolcanoEngineAPI 的 proxyUrl 改成这个 URL
 */

// 火山引擎豆包 API 地址
const DOUBAO_API_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

// 允许的来源（GitHub Pages + 本地调试）
const ALLOWED_ORIGINS = [
  'https://a-tulip.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080'
];

function getCorsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const corsHeaders = getCorsHeaders(origin);

    // 处理 CORS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // 只允许 POST 请求
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: '仅支持 POST 请求' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 获取 API Key：优先使用环境变量，回退到内置 Key
    const apiKey = env.DOUBAO_API_KEY || 'f8d5c334-632e-4093-aa54-3a49abe6ab40';
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Worker 未配置 API Key' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    try {
      // 读取前端发来的请求体
      const requestBody = await request.json();

      // 转发到火山引擎豆包 API，用 Worker 环境变量中的 Key（前端传的 Key 被忽略）
      const response = await fetch(DOUBAO_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

      // 读取豆包 API 的响应
      const data = await response.text();

      // 返回给前端
      return new Response(data, {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });

    } catch (error) {
      return new Response(JSON.stringify({
        error: '代理请求失败',
        message: error.message
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }
};
