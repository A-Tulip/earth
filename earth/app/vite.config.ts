import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Cesium 静态资源（Workers、Assets、ThirdParty、Widgets）需拷贝到 public
// 参考 CesiumJS 官方 Vite 集成指南
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: 'node_modules/cesium/Build/Cesium/Workers', dest: 'cesium' },
        { src: 'node_modules/cesium/Build/Cesium/Assets', dest: 'cesium' },
        { src: 'node_modules/cesium/Build/Cesium/ThirdParty', dest: 'cesium' },
        { src: 'node_modules/cesium/Build/Cesium/Widgets', dest: 'cesium' },
      ],
    }),
  ],
  define: {
    // CesiumJS 需要全局 CESIUM_BASE_URL
    CESIUM_BASE_URL: JSON.stringify('/cesium'),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@content': resolve(__dirname, 'content'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      // 后端代理（二选一，默认推荐 FastAPI，两者端口与端点完全兼容）：
      //   A. 【推荐】FastAPI：cd api && pip install -r requirements.txt && uvicorn main:app --port 8787
      //      或从 app 目录:   npm run api:dev
      //   B. 兼容原 Node.js 版：  npm run voice:proxy  （不再新增特性，仅保留兼容性）
      // 端点覆盖：/api/health, /api/llm/chat, /api/tts/synthesize, /api/asr/recognition,
      //          /api/charts/generate, /api/geocoding/reverse, /ws/asr
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        // 代理不可达时仅在 dev 控制台提示，不中断 Vite 主进程
        // （功能层已在前端做了降级：ASR→浏览器WebSpeech, LLM→关键词匹配, 图表→本地提示）
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.warn(`[vite proxy] /api 代理失败（后端未启动？请运行 npm run api:dev 或 npm run voice:proxy）: ${err.message}`);
          });
        },
      },
      // WebSocket 代理：实时流式 ASR（/ws/asr）
      '/ws': {
        target: 'ws://localhost:8787',
        ws: true,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.warn(`[vite proxy] /ws WebSocket 代理失败（后端未启动？）: ${err.message}`);
          });
        },
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks: {
          cesium: ['cesium'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
