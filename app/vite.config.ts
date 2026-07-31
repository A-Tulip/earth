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
      // 火山引擎语音/LLM 服务端代理（app/server/index.ts）
      // 启动: npm run voice:proxy
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        // 代理不可达时返回明确错误而非崩溃
        configure: (proxy) => {
          proxy.on('error', (err) => {
            // 仅在 dev 控制台提示，不影响 Vite 主进程
            console.warn(`[vite proxy] /api 代理失败（语音代理未启动？）: ${err.message}`);
          });
        },
      },
      // WebSocket 代理：实时流式 ASR
      '/ws': {
        target: 'ws://localhost:8787',
        ws: true,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.warn(`[vite proxy] /ws WebSocket 代理失败（语音代理未启动？）: ${err.message}`);
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
