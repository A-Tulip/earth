# 语音 Agent

## 1. 交互模型

### 桌面端：Push-to-Talk
- **按住 Space** 开始录音，**松开 Space** 提交
- 首次使用只展示一次快捷键提示
- 按住空格 → 画面底部中央出现很轻的"正在聆听"
- 松开 → 显示识别结果和执行状态 → 完成后自动淡出

### 触摸设备
- 右下角小型麦克风按钮（`md:hidden`）

## 2. 空格键安全处理（`src/voice/PushToTalk.ts`）

| 场景 | 处理 |
|---|---|
| `event.repeat` | 忽略，防重复录音会话 |
| `INPUT`/`TEXTAREA`/`contenteditable` | 空格正常输入，不触发录音 |
| 模态窗口打开 | （由 CommandMenu 等组件聚焦处理） |
| 窗口失焦（`blur`） | 立即安全结束录音 |
| 页面隐藏（`visibilitychange`） | 立即安全结束录音 |
| 录音中断 | `asr.abort()` + 清理状态 |
| 语音权限拒绝 | 提供文本命令入口和恢复提示 |
| 静音状态 | 不触发录音 |

`isEditable(target)` 导出函数：检查 tagName + `isContentEditable` + `getAttribute('contenteditable')`（jsdom 兼容）。

## 3. AI 语音流程

```
流式 ASR → 意图理解(LLM) → 工具调用 → 动作校验(Schema) → 场景执行 → 讲解生成 → 流式 TTS
```

### 教师打断
- 教师开始讲话时（`voice.listening` 从 false→true）
- `LessonRuntime.interrupt()` 暂停当前旁白
- 处理用户指令或问题
- 根据语义恢复原课程

### 字幕与语音同步
- `voice.transcript` 显示识别结果
- `voice.response` 显示 AI 回复
- `voice.speaking` 控制 TTS 朗读
- 教师可静音（`voice.muted`）、调整音量和语速

## 4. 供应商适配层（`src/voice/adapters.ts`）

### 接口

```typescript
interface ASRAdapter { start(); stop(): Promise<{text}>; abort(); isListening(): boolean }
interface TTSAdapter { speak(text); stop(); setRate(rate); setVolume(v) }
interface LLMAdapter { chat(messages): Promise<{ text, toolCalls }> }
```

### 默认回退实现

| 适配器 | 默认 | 生产替换 |
|---|---|---|
| ASR | `BrowserSpeechASR`（Web Speech API，Chrome/Edge） | 火山引擎（服务端代理，当前自动降级浏览器） |
| TTS | `BrowserSpeechTTS`（speechSynthesis） | 火山引擎（服务端代理，HTTP 非流式） |
| LLM | `KeywordIntentLLM`（关键词意图解析，无网络） | 火山方舟（OpenAI 兼容 + tools function calling） |

### 火山引擎集成（生产，需服务端代理）

**架构：**
```
浏览器 ──/api/llm/chat──► 服务端代理 ──Bearer ARK_API_KEY──► ark.cn-beijing.volces.com
        ──/api/tts/synthesize──►            ──X-Api-Access-Key──► sami.bytedance.com
        ──/api/asr/recognize──►             ──X-Api-Access-Key──► openspeech.bytedance.com
        ──/api/health──►                    （健康检查）
```

**启动代理：**
```bash
# 1. 配置服务端密钥（不入前端构建）
cp .env.example .env
# 编辑 .env 填入 VOLC_ARK_API_KEY、VOLC_TTS_APP_ID、VOLC_TTS_ACCESS_KEY 等

# 2. 启动代理（端口 8787）
npm run voice:proxy

# 3. 另开终端启动前端
npm run dev
```

**前端启用火山引擎：**
在 `.env.local` 中：
```
VITE_LLM_PROVIDER=volcengine
VITE_TTS_PROVIDER=volcengine
VITE_ASR_PROVIDER=volcengine   # 当前自动降级浏览器
```

**适配器实现：**

| 类 | 实现 | 说明 |
|---|---|---|
| `VolcengineArkLLM` | OpenAI 兼容 + tools function calling | 16 个地理工具定义，温度 0.2 提升指令稳定性 |
| `VolcengineTTS` | HTTP 非流式，base64 → Blob → Audio | 浏览器原生播放，自动释放 ObjectURL |
| `VolcengineASR` | 健康检查后降级浏览器 | 流式 ASR 需 WebSocket 鉴权，浏览器无法持有 Access Key |

**密钥安全：**
- 所有 `VOLC_*` 变量仅在 `app/server/` 进程可见（`process.env`）
- 前端构建产物（`dist/`）不含任何密钥
- 服务端日志仅输出 enabled 状态（`llm`/`tts`/`asr`），不打印密钥本身
- 代理失败时返回明确 `code`（`PROVIDER_NOT_CONFIGURED` / `UPSTREAM_ERROR`），前端自动降级

### KeywordIntentLLM 覆盖的指令

| 用户说 | 解析为 |
|---|---|
| 打开/显示等高线 | `layer.showContour` |
| 显示高程分层 | `layer.showElevationRamp` |
| 切换到二维/三维 | `view.setMode` |
| 飞到北京/上海/... | `camera.flyTo` |
| 显示/隐藏城市 | `layer.toggle` |
| 显示经纬线/晨昏线 | `layer.toggle` |
| 停止/开始自转 | `animation.pause` / `animation.play` |
| 地形夸张 N 倍 | `terrain.setExaggeration` |
| 开始等高线/板块课程 | `lesson.open` |

## 5. 密钥安全

**所有密钥由服务端环境变量配置，公共界面不出现：**
- 供应商选择
- 模型选择
- 密钥输入
- 连接测试
- fallback 设置

密钥**不进入**：
- 前端构建产物
- localStorage
- 公开仓库
- 浏览器直接请求

生产环境通过服务端代理调用 ASR/TTS/LLM，前端只调代理端点。

## 6. 可靠性

- 请求限流、超时、取消、重试
- 错误分类（权限/网络/服务/参数）
- 可观测日志（开发环境）
- 任何环节失败保留字幕和手动工具能力
