const http = require('http');
const https = require('https');
const url = require('url');

const PORT = 3001;

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (pathname.startsWith('/api/doubao')) {
    const targetPath = pathname.replace('/api/doubao', '');
    const targetUrl = 'https://ark.cn-beijing.volces.com' + targetPath;
    
    console.log('Target URL:', targetUrl);
    
    const options = url.parse(targetUrl);
    options.method = req.method;
    options.headers = {
      'Content-Type': 'application/json'
    };

    if (req.headers.authorization) {
      options.headers.Authorization = req.headers.authorization;
      console.log('Authorization:', req.headers.authorization.substring(0, 30) + '...');
    }

    const proxyReq = https.request(options, (proxyRes) => {
      console.log('Response status:', proxyRes.statusCode);
      console.log('Response headers:', JSON.stringify(proxyRes.headers));
      
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      
      let responseBody = '';
      proxyRes.on('data', (chunk) => {
        responseBody += chunk;
      });
      proxyRes.on('end', () => {
        console.log('Response body:', responseBody.substring(0, 200) + '...');
        res.end(responseBody);
      });
    });

    proxyReq.on('error', (err) => {
      console.error('Proxy error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      console.log('Request body:', body);
      proxyReq.write(body);
      proxyReq.end();
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
});
