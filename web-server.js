const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
  let urlPath = req.url === '/' ? '/src/earth.html' : req.url;
  
  // URL解码处理文件名中的特殊字符（空格、中文等）
  try {
    urlPath = decodeURIComponent(urlPath);
  } catch (e) {
    console.warn('URL解码失败:', urlPath, e.message);
  }
  
  // 防止路径遍历攻击
  const normalizedPath = path.normalize(urlPath);
  if (normalizedPath.startsWith('..')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  
  let filePath = path.join(ROOT, urlPath);
  
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found: ' + urlPath);
      } else {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
      res.end(content);
    }
  });
});

server.listen(PORT, () => {
  console.log(`静态文件服务器运行于 http://localhost:${PORT}`);
  console.log(`主页面: http://localhost:${PORT}/src/earth.html`);
});
