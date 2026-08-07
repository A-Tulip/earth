/**
 * Vercel Serverless Function - 豆包 AI 代理
 *
 * 作用：把前端请求转发到火山引擎豆包 API，隐藏 API Key，解决 CORS 问题
 *
 * 部署：
 *   1. 把整个项目推送到 GitHub
 *   2. 在 Vercel 中 Import Project
 *   3. 在 Vercel 的 Settings → Environment Variables 中添加：
 *        DOUBAO_API_KEY = 你的火山引擎豆包 API Key
 *   4. 部署后访问：https://your-project.vercel.app/api/doubao/v1/chat/completions
 *
 * 注意：如果没配置环境变量，会使用内置的 API Key 作为回退
 */

export default async function handler(req, res) {
  // CORS 头
  const allowedOrigins = [
    'https://a-tulip.github.io',
    'https://earth-earth7-f786.vercel.app',
    'http://localhost:8080',
    'http://127.0.0.1:8080'
  ];

  const origin = req.headers.origin || '';
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  // 处理 CORS 预检请求
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // 只允许 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求 / Only POST requests are supported' });
  }

  // 获取 API Key：优先使用环境变量，回退到内置 Key
  const apiKey = process.env.DOUBAO_API_KEY || 'f8d5c334-632e-4093-aa54-3a49abe6ab40';
  if (!apiKey) {
    return res.status(500).json({ error: '未配置 API Key / API Key not configured' });
  }

  try {
    // 读取请求体
    const requestBody = req.body;

    // 转发到火山引擎豆包 API
    const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
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
    res.status(response.status);
    res.setHeader('Content-Type', 'application/json');
    res.send(data);

  } catch (error) {
    console.error('代理请求失败:', error);
    res.status(502).json({
      error: '代理请求失败 / Proxy request failed',
      message: error.message
    });
  }
}
