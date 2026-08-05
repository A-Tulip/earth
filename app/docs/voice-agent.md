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
浏览器 ──/api/llm/chat──► FastAPI 后端(8787) ──Bearer ARK_API_KEY──► ark.cn-beijing.volces.com
        ──/api/tts/synthesize──►                ──X-Api-Access-Key──► sami.bytedance.com
        ──/api/asr/recognition──►               ──X-Api-Access-Key──► openspeech.bytedance.com
        ──/ws/asr──►                            （流式 ASR WebSocket）
        ──/api/health──►                        （健康检查）
        ──/api/charts/generate──►               （matplotlib 图表）
        ──/api/geocoding/reverse──►             （反向地理编码代理）
```

**后端（FastAPI）启动：**

```bash
# 0. （可选）一键准备前后端环境：node_modules + api/.venv + pip 依赖
make setup

# 1. 配置后端密钥（不入前端构建）
cp api/.env.example api/.env
# 编辑 api/.env 填入 VOLC_ARK_API_KEY、VOLC_TTS_APP_ID、VOLC_TTS_ACCESS_KEY 等

# 2. 启动后端 FastAPI（端口 8787，开发模式）
make api
#   等价命令（任选其一）：
#     npm run api:dev          # 在 app/ 目录下
#     cd api && uvicorn main:app --host 0.0.0.0 --port 8787 --reload
#     ./earth-api --reload     # 仓库根脚本，自动处理路径

# 3. 另开终端启动前端
make dev
#   等价命令：npm run dev（在 app/ 目录下）

# 一键同时启动前后端（需系统装有 concurrently）
make start
```

> 注：原 `npm run voice:proxy`（Node.js 版）已废弃。FastAPI 后端已完全覆盖其所有端点，两者监听同一端口（8787）互斥，启用 FastAPI 后无需再运行 Node 版。

**前端启用火山引擎：**
在 `app/.env.local` 中：
```
VITE_LLM_PROVIDER=volcengine
VITE_TTS_PROVIDER=volcengine
VITE_ASR_PROVIDER=volcengine   # 流式 ASR，WS 鉴权不足时自动降级浏览器
```

可选：在 `app/.env` 中用 `VITE_LLM_PROVIDER=volcengine` 作为默认开关（无需 `.env.local`）。

**适配器实现：**

| 类 | 实现 | 说明 |
|---|---|---|
| `VolcengineArkLLM` | OpenAI 兼容 + tools function calling | 30+ 地理工具定义，温度 0.2 提升指令稳定性 |
| `VolcengineTTS` | HTTP 非流式，base64 → Blob → Audio | 浏览器原生播放，自动释放 ObjectURL |
| `VolcengineASR` | 健康检查 `/api/health.asr` → `StreamingASR`（WebSocket） | 流式 ASR 走 `/ws/asr`，失败自动降级浏览器 |

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

**存放位置：**
- 后端密钥 → `api/.env`（`VOLC_*` 系列），仅 FastAPI 服务进程可见（`process.env` / `python-dotenv`）
- 前端供应商开关 → `app/.env.local`（`VITE_*_PROVIDER`），仅含供应商名，不含密钥
- 生产环境：前端只调代理端点（`/api/*`、`/ws/*`），密钥由后端持有

**降级与安全细节：**
- FastAPI 日志仅输出各供应商 enabled 状态（`llm`/`asr`/`tts`），不打印密钥本身
- 密钥缺失时返回明确 `code`（`PROVIDER_NOT_CONFIGURED` / `UPSTREAM_ERROR`），前端自动降级
- 前端 `VITE_ASR_PROVIDER=volcengine` 时先探测 `/api/health.asr`，为 false 则退回浏览器 Web Speech API
- 所有出网请求（LLM 调用、TTS、反向地理编码、图表）均经 FastAPI 代理，避免前端直连第三方服务

## 6. 实时对话模式（`src/voice/RealtimeVoiceChat.ts`）

与 Push-to-Talk（按住空格）不同，实时对话模式为**全双工**：

- 用户随时说话，VAD 自动检测说话开始/结束
- 检测到句末（静音 800ms）自动提交 LLM
- AI 回复通过 TTS 实时播放
- 用户说话时自动打断 TTS（barge-in）

**VAD 状态机：** `idle → listening → processing → speaking`

| 状态 | 触发 | 动作 |
|---|---|---|
| `idle` | 超过能量阈值且持续 ≥300ms | 启动 ASR → `listening` |
| `speaking` | 播放中检测到用户说话 | 停止 TTS（barge-in）→ 重启 ASR → `listening` |
| `listening` | 静音 ≥800ms | 停止 ASR → 提交 LLM → `processing` |
| `processing` | LLM 返回并有 TTS 文本 | 执行工具 → 播放 TTS → `speaking` |

**对话历史：** 最多 20 条消息（`trimHistory`），切换课程时自动清空（按 `activeLessonId` 订阅）。

**启用方式：** TopBar 的「实时对话」按钮（`data-agent-button="voice.toggleRealtime"`），或 AI 调用 `realtime.toggle`。启用后自动禁用 Push-to-Talk。

**降级链：**
1. 流式 ASR（`/ws/asr` WebSocket）+ VAD ← 主路径
2. 浏览器 Web Speech API（连续模式）+ VAD ← 自动降级
3. Push-to-Talk 模式 ← 手动降级（关闭实时对话）

## 7. 可靠性

- 请求限流、超时、取消、重试
- 错误分类（权限/网络/服务/参数）
- 可观测日志（开发环境）
- 任何环节失败保留字幕和手动工具能力
- 实时对话启动失败（麦克风权限/ASR 不可用）→ 提示用户切换到按住空格模式，课堂不中断
