# 部署

## 1. 本地开发

```bash
cd app
npm install
npm run dev
# → http://localhost:5173/
```

**零配置即可启动**：不需要任何环境变量，使用 OSM 免 token 底图 + 椭球地形 + 浏览器语音 + 关键词意图解析回退。

## 2. 配置环境变量（可选，增强体验）

```bash
cd app
cp .env.example .env.local
# 编辑 .env.local 填入真实值
```

| 变量 | 作用 | 不填的回退 |
|---|---|---|
| `VITE_CESIUM_ION_TOKEN` | Cesium World Terrain + 高清影像 | OSM 底图 + 椭球地形 |
| `VITE_ASR_PROVIDER` | 语音识别供应商 | 浏览器 Web Speech API |
| `VITE_TTS_PROVIDER` | 语音合成供应商 | 浏览器 speechSynthesis |
| `VITE_LLM_PROVIDER` | 意图理解供应商 | 本地关键词解析（无网络） |

**密钥安全：**
- 带 `VITE_` 前缀的变量进入前端构建，**只放可公开的 token**（如 Cesium ion 公开 token）
- 真实密钥（GLM/通义/Azure/火山）**不带 `VITE_` 前缀**，仅服务端代理可见
- `.env.local` 已在 `.gitignore`，不提交

## 3. 生产构建

```bash
cd app
npm run build
# 产物在 app/dist/
```

构建过程：
1. `tsc --noEmit` 类型检查
2. `vite build` 打包
3. `vite-plugin-static-copy` 复制 Cesium 静态资源（Workers/Assets/ThirdParty/Widgets）到 `dist/cesium/`

**产物结构：**
```
dist/
├── index.html
├── assets/
│   ├── index-*.js          # 应用代码
│   ├── react-*.js          # React 供应商包
│   ├── cesium-*.js         # Cesium 供应商包
│   └── index-*.css
└── cesium/                 # Cesium 静态资源
    ├── Workers/
    ├── Assets/
    ├── ThirdParty/
    └── Widgets/
```

## 4. 预览生产构建

```bash
cd app
npm run preview
# → http://localhost:4173/
```

## 5. 部署到静态托管

由于是纯前端 SPA，可部署到任何静态托管：

### GitHub Pages
```bash
cd app
npm run build
# 将 dist/ 内容推送到 gh-pages 分支
```

**注意：** 若部署在子路径（如 `/earth/`），需在 `vite.config.ts` 设置 `base: '/earth/'`。

### Vercel / Netlify / Cloudflare Pages
- 构建命令：`cd app && npm install && npm run build`
- 输出目录：`app/dist`
- SPA 回退：所有路由指向 `index.html`

### Cesium 静态资源
`dist/cesium/` 必须与 `index.html` 一起部署，Cesium 运行时按相对路径 `/cesium/` 加载 Workers/Assets。

## 6. 测试

```bash
cd app
npm test            # 单元 + 集成测试（Vitest）
npm run test:watch  # 监听模式
npm run test:e2e    # 端到端测试（Playwright，待补）
npm run typecheck   # 类型检查
npm run lint        # ESLint
```

## 7. 课程内容校验

```bash
cd app
npm run validate:content
```

校验项：字段完整性、工具名称合法、地点经纬度合法、GeoJSON/CZML 语法、引用存在。

## 8. 性能注意

- Cesium 主包较大（gzip 后约 1.1MB），已通过 `manualChunks` 分离
- 生产构建启用 `requestRenderMode`，静态场景 CPU 占用降低 80%+
- 首次加载需下载 Cesium Workers，建议使用 CDN 或预缓存

## 9. 已知限制

- 无 ion token 时使用椭球地形（无真实起伏），等高线/高程分层效果有限
- 浏览器 Web Speech API 中文识别质量有限，建议生产环境接入云端 ASR
- 本地关键词意图解析覆盖教学常用指令，复杂问句需接入 LLM
- 端到端测试（Playwright）待补
- 日出日落计算、世界时钟、城市对比、截图、分享功能待迁移
- 太阳系 Three.js 场景未在新主线启用（旧 `src/engines/concept/solar-system.js` 作参考）

## 10. 安全

- 所有外部密钥通过 `.env.example` 描述，真实密钥不提交
- 模型工具调用使用白名单 Schema（`TOOL_SCHEMAS`）
- 富文本和生成 HTML 待接入清理（DOMPurify）和沙箱隔离
- URL 抓取、课程材料上传待接入安全校验
- 生产环境应通过服务端代理调用 ASR/TTS/LLM，前端不直接请求
