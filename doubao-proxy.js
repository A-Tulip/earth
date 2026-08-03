// 豆包代理服务器 - 无需 npm install，直接运行
// 运行: node doubao-proxy.js

const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3001;
const ARK_CHAT_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

// 从多个位置读取 API Key
let API_KEY = '';
const fs = require('fs');
const path = require('path');

// 尝试多个 .env 位置
const envPaths = [
  path.join(__dirname, '.env'),                    // 当前目录 .env
  path.join(__dirname, 'app', 'server', '.env'),   // app/server/.env
  path.join(__dirname, 'server', '.env'),          // server/.env
];

for (const envPath of envPaths) {
  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/VOLC_ARK_API_KEY=(.+)/);
      if (match) {
        API_KEY = match[1].trim();
        console.log(`✅ 从 ${envPath} 读取到 API Key`);
        break;
      }
    }
  } catch (e) {
    // 继续尝试下一个
  }
}

// 如果还没找到，尝试环境变量
if (!API_KEY) {
  API_KEY = process.env.VOLC_ARK_API_KEY || '';
}

if (!API_KEY) {
  console.error('❌ 错误: 未找到 API Key');
  console.log('请设置环境变量 VOLC_ARK_API_KEY 或创建 .env 文件');
  console.log('');
  console.log('支持的 .env 文件位置:');
  envPaths.forEach(p => console.log(`  - ${p}`));
  process.exit(1);
}

const server = http.createServer((req, res) => {
  // CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/doubao/v1/chat/completions') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        console.log('收到请求:', data.model);

        // 调用豆包 API
        const postData = JSON.stringify({
          model: data.model || 'doubao-lite',
          messages: data.messages,
          temperature: data.temperature || 0.7,
          max_tokens: data.max_tokens || 1000
        });

        const options = {
          hostname: 'ark.cn-beijing.volces.com',
          path: '/api/v3/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Length': Buffer.byteLength(postData)
          }
        };

        const proxyReq = https.request(options, (proxyRes) => {
          let responseData = '';
          proxyRes.on('data', chunk => responseData += chunk);
          proxyRes.on('end', () => {
            console.log('豆包响应:', proxyRes.statusCode);
            res.writeHead(proxyRes.statusCode, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(responseData);
          });
        });

        proxyReq.on('error', (e) => {
          console.error('代理请求错误:', e.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        });

        proxyReq.write(postData);
        proxyReq.end();

      } catch (e) {
        console.error('解析错误:', e.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`❌ 端口 ${PORT} 被占用，请尝试:`);
    console.log(`  1. 关闭占用端口的程序`);
    console.log(`  2. 或换端口: PORT=3002 node doubao-proxy.js`);
    process.exit(1);
  } else {
    console.error('服务器错误:', e.message);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`✅ 豆包代理服务器已启动: http://localhost:${PORT}`);
  console.log(`📝 API Key: 已配置`);
  console.log(`🤖 默认模型: doubao-lite`);
  console.log('');
  console.log('按 Ctrl+C 停止服务器');
});
