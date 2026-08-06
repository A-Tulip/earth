"""
FastAPI 独立 API 服务 —— 地球探索者 AI 地理画布

功能职责（与原 Node.js voice-proxy 完全对齐并扩展）：
  1. 火山引擎 LLM 代理：/api/llm/chat （Responses API → chat/compat 格式）
  2. 火山引擎 TTS 代理：/api/tts/synthesize
  3. 火山引擎流式 ASR WebSocket 代理：/ws/asr
  4. 一句话 ASR（HTTP）：/api/asr/recognition
  5. RTC Token 预留端点：/api/rtc/token
  6. 健康检查：/api/health （供前端 VolcengineASR.start() 检测是否可用云端）
  7. ★ 新增：数据图表生成：/api/charts/generate （matplotlib → base64 PNG）
  8. ★ 新增：反向地理编码代理：/api/geocoding/reverse （Nominatim → 结构化结果）
  9. 限流（slowapi + memory）、上游 25s 硬超时、内存级 TTL 缓存

启动：
  cd api
  pip install -r requirements.txt
  cp .env.example .env   # 配置 VOLC_* 密钥
  uvicorn main:app --host 0.0.0.0 --port 8787 --reload
  或：
  python -m uvicorn main:app --port 8787
"""
from __future__ import annotations

# ============================================================
# 🚨 零心智负担启动自检：无论你在哪个目录跑 uvicorn 都不会踩坑
#
# 常见错误（用户常在仓库根直接跑）：
#   $ cd ~/Desktop/earth && uvicorn main:app --port 8787
#   → 报 "Could not import module main"
#
# 本文件做了 3 重兜底：
#   1) 如果你在仓库根跑：   python -m uvicorn api.main:app ✅
#   2) 如果你跑了仓库根新写的代理 main.py ✅（代理会 sys.path.insert api/）
#   3) 无论在哪跑，本文件开头都把"api/所在目录"加到 sys.path，避免相对 import 失效
#
# 推荐启动命令（二选一）：
#   make api                # Makefile 一键，自动 --app-dir api
#   ./earth-api --reload    # bash 脚本，自动选解释器 + 正确路径
# ============================================================
import sys as _sys
from pathlib import Path as _Path

_API_DIR = _Path(__file__).resolve().parent          # ~/Desktop/earth/api
_REPO_ROOT = _API_DIR.parent                          # ~/Desktop/earth

# 双保险：把仓库根 和 api/ 同时塞进 sys.path，使得"api.main"与"main"两种引用方式都能 import
if str(_REPO_ROOT) not in _sys.path:
    _sys.path.insert(0, str(_REPO_ROOT))
if str(_API_DIR) not in _sys.path:
    _sys.path.insert(0, str(_API_DIR))

# 顶层依赖缺失时给人类可读提示（不要让用户看一连串 ImportError 堆栈）
try:
    import fastapi  # noqa: F401
    import httpx    # noqa: F401
    import dotenv   # noqa: F401
except ImportError as _e:
    _missing = str(getattr(_e, "name", _e)) or "fastapi/httpx/dotenv"
    _sys.stderr.write(
        "\n[earth-api] ❌ 缺少 Python 依赖："
        + _missing
        + "\n[earth-api] 💡 请先执行：  cd "
        + str(_API_DIR)
        + " && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt\n"
        + "[earth-api]    或仓库根直接：  make setup\n\n"
    )
    raise

import asyncio
import array
import base64
import hashlib
import hmac
import io
import json
import logging
import os
import struct
import time
import urllib.parse
from collections import OrderedDict
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("earth.asr")
if not logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("[earth-asr] %(asctime)s %(levelname)s %(message)s", "%H:%M:%S"))
    logger.addHandler(_h)
    logger.setLevel(logging.INFO)
    logger.propagate = False

import httpx
from dotenv import load_dotenv
from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    Query,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator

# -------- slowapi / limits 限流（可选，依赖缺失时优雅降级）--------
try:  # pragma: no cover - optional dep
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded
    from slowapi.util import get_remote_address

    _limiter = Limiter(key_func=get_remote_address)
    _RATE_LIMIT_AVAILABLE = True
except Exception:  # pragma: no cover
    _RATE_LIMIT_AVAILABLE = False
    _limiter = None  # type: ignore


# ============================================================
# 1. 环境变量加载（读取顺序 = 从高优先级到低优先级）
#
# ⚠️ 典型"填了但说没配置"的 Incident：
#   用户按老文档（Node voice:proxy）把密钥放在 app/server/.env，
#   但 FastAPI 进程默认只搜 api/.env + app/.env.local，两边 miss。
#   这里把 3 个可能位置都搜，并且第一个命中后 override 后面的（高优先级覆盖）
#   同时把"到底读了哪个文件、哪些 KEY 真正被读到了"打到 stderr，避免任何歧义。
#
# 优先级（越靠前越优先，后同名字段覆盖前面）：
#   1) api/.env           → FastAPI 主线推荐位置
#   2) app/server/.env    → 旧 voice:proxy 兼容位（大量用户已经把密钥填在这里了！）
#   3) app/.env.local     → Vite 前端用的 VITE_* 位（不优先）
#   最后：进程 os.environ 里已经有的环境变量不会被 .env 覆盖（override=False）
# ============================================================
_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parent

_env_candidates = [
    _HERE / ".env",           # 1) FastAPI 主线
    _REPO / "app/server/.env",# 2) ⭐ 兼容 Node voice:proxy 时代填的密钥
    _REPO / "app/.env.local", # 3) Vite 前端 VITE_ 位
]
_seen_paths: list[str] = []
for _candidate in _env_candidates:
    if _candidate.exists():
        _ok = load_dotenv(_candidate, override=False)  # override=False：进程已有变量（exported）优先级最高
        _seen_paths.append(f"{_candidate} (loaded={_ok})")

# ---- stderr 打印自检：启动一次就能看见"到底读了哪个 env、KEY 有没有真正读到" ----
_KEY_METRICS: list[tuple[str, bool, str]] = []
for _name in ("VOLC_ARK_API_KEY", "VOLC_ARK_MODEL",
              "VOLC_ASR_API_KEY", "VOLC_ASR_APP_ID", "VOLC_ASR_ACCESS_KEY", "VOLC_ASR_ACCESS_TOKEN",
              "VOLC_TTS_APP_ID", "VOLC_TTS_ACCESS_KEY", "VOLC_TTS_ACCESS_TOKEN"):
    _v = os.environ.get(_name) or ""
    # 只打前后 4 位（防止 stderr 泄漏完整 key）
    _masked = f"{_v[:4]}…{_v[-4:]}" if len(_v) >= 10 else ("<set>" if _v else "<empty>")
    _KEY_METRICS.append((_name, bool(_v), _masked))

_sys.stderr.write(
    "\n" + "=" * 72
    + "\n[earth-api] 🛰️  dotenv 加载结果：\n"
    + "\n".join(
        (f"    - candidate: {p}" if i == 0 else f"                 {p}")
        for i, p in enumerate(_seen_paths)
    ) if _seen_paths else "    (没有 .env 命中，纯进程环境变量)"
    + "\n[earth-api] 🔑  关键密钥是否读入（前后 4 位掩码，防泄漏）：\n"
    + "\n".join(
        f"    {'✅' if ok else '❌'} {name:<28} = {masked}"
        for name, ok, masked in _KEY_METRICS
    )
    + "\n" + "=" * 72 + "\n\n"
)
del _KEY_METRICS, _seen_paths

PORT = int(os.environ.get("PORT", "8787"))
UPSTREAM_TIMEOUT_MS = 25_000  # 同 Node 版：硬超时 25s


# ============================================================
# 2. LRU / TTL 内存缓存（128 entry × 300s）
# ============================================================
@dataclass
class TTLCache:
    maxsize: int = 128
    ttl: float = 300.0
    _data: "OrderedDict[str, tuple[float, Any]]" = field(default_factory=OrderedDict)

    def get(self, key: str) -> Optional[Any]:
        if key not in self._data:
            return None
        ts, val = self._data[key]
        if time.monotonic() - ts > self.ttl:
            self._data.pop(key, None)
            return None
        self._data.move_to_end(key)
        return val

    def set(self, key: str, value: Any) -> None:
        self._data[key] = (time.monotonic(), value)
        while len(self._data) > self.maxsize:
            self._data.popitem(last=False)


_CACHE = TTLCache()


def _cache_key(prefix: str, payload: Any) -> str:
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str).encode()
    return f"{prefix}:{hashlib.sha256(raw).hexdigest()[:16]}"


# ============================================================
# 3. Lifespan：启动/关闭时共享一个 httpx.AsyncClient（避免每请求重建）
# ============================================================
_httpx_client: Optional[httpx.AsyncClient] = None


@asynccontextmanager
async def _lifespan(_: FastAPI):
    global _httpx_client
    timeout = httpx.Timeout(UPSTREAM_TIMEOUT_MS / 1000.0, connect=10.0)
    limits = httpx.Limits(max_connections=64, max_keepalive_connections=16)
    _httpx_client = httpx.AsyncClient(timeout=timeout, limits=limits, follow_redirects=True)
    try:
        yield
    finally:
        await _httpx_client.aclose()
        _httpx_client = None


app = FastAPI(
    title="Earth Explorer API",
    version="1.0.0",
    lifespan=_lifespan,
    docs_url="/docs",
    redoc_url=None,
)

# CORS：同 Node 版 CORS_HEADERS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS", "HEAD"],
    allow_headers=["Content-Type", "Authorization", "X-Model", "X-Intent-Hint"],
    max_age=86400,
)

if _RATE_LIMIT_AVAILABLE and _limiter is not None:
    app.state.limiter = _limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]


def limiter_dep():
    """Depends：返回 limiter；若依赖缺失则 no-op。"""
    return _limiter


# ============================================================
# 4. 错误码标准化（与 Node 版 wrapHandler.statusMap 对齐）
# ============================================================
class ApiError(HTTPException):
    CODE_STATUS = {
        "INVALID_ARGS": 400,
        "UNAUTHORIZED": 401,
        "PROVIDER_NOT_CONFIGURED": 503,
        "UPSTREAM_TIMEOUT": 504,
        "UPSTREAM_ERROR": 502,
        "NOT_IMPLEMENTED": 501,
        "RTC_NOT_CONFIGURED": 503,
        "ASR_NOT_CONFIGURED": 503,
        "INTERNAL": 500,
    }

    def __init__(self, code: str, message: str):
        status_code = self.CODE_STATUS.get(code, 500)
        super().__init__(status_code=status_code, detail={"ok": False, "code": code, "error": message})


def _json_error(code: str, message: str) -> Response:
    status_code = ApiError.CODE_STATUS.get(code, 500)
    return Response(
        content=json.dumps({"ok": False, "code": code, "error": message}, ensure_ascii=False),
        status_code=status_code,
        media_type="application/json; charset=utf-8",
    )


def _ok_json(body: Any, status_code: int = 200) -> Response:
    return Response(
        content=json.dumps(body, ensure_ascii=False),
        status_code=status_code,
        media_type="application/json; charset=utf-8",
    )


# ============================================================
# 5. 火山引擎 ASR / TTS 鉴权（新版 Header + 旧版 Query 双模式自动切换）
#    - 官方鉴权文档：ASR 流式 v3 (wss://openspeech.bytedance.com/api/v3/sauc/bigmodel)
#                   使用 Header: X-Api-App-Key + X-Api-Access-Key + X-Api-Resource-Id
#                   （参考 https://www.volcengine.com/docs/6561/1354869）
#    - TTS 官方两种鉴权：旧版 sami.bytedance.com/api/v1/invoke?version=v4&token=&appkey=
#                         新版 X-Api-Key Header（部分 SAMI 应用）
#      遇到 40200002 DeniedAccess:IllegalToken 时：
#         a) 优先尝试 新版 X-Api-Key Header + body 直接发送 payload
#         b) 失败时回退 旧版 query-string token+appkey + json={"payload": payload_inner}
# ============================================================
ARK_RESPONSES_URL = "https://ark.cn-beijing.volces.com/api/v3/responses"
TTS_HTTP_URL = "https://sami.bytedance.com/api/v1/invoke"
# ASR v3 流式大模型（官方最新，WS Header 鉴权，不再走 query/token）
ASR_WS_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel"
# ASR HTTP 一句话识别（留作兜底，未使用主路径但保持兼容）
ASR_HTTP_URL = "https://openspeech.bytedance.com/api/v1/asr"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"


@dataclass
class AsrAuth:
    auth_mode: str  # "token" | "signature"
    token: str
    secret_key: Optional[str] = None


def build_asr_auth() -> AsrAuth:
    access_token = os.environ.get("VOLC_ASR_ACCESS_TOKEN") or os.environ.get("VOLC_ASR_ACCESS_KEY", "")
    secret_key = os.environ.get("VOLC_ASR_SECRET_KEY", "")
    mode_env = (os.environ.get("VOLC_ASR_AUTH_MODE") or "").lower()
    if mode_env == "signature" and secret_key:
        mode = "signature"
    elif access_token and secret_key and mode_env != "token":
        mode = "signature"
    else:
        mode = "token"
    if not access_token:
        raise ApiError("ASR_NOT_CONFIGURED", "服务端未配置 VOLC_ASR_ACCESS_TOKEN")
    return AsrAuth(auth_mode=mode, token=access_token, secret_key=secret_key or None)


def compute_asr_signature(method: str, path_and_query: str, host: str, secret_key: str, body: str = "") -> str:
    request_line = f"{method} {path_and_query} HTTP/1.1"
    canonical = f"{request_line}\n{host}\n{body}"
    mac = hmac.new(secret_key.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).digest()
    return base64.b64encode(mac).decode().replace("+", "-").replace("/", "_").rstrip("=")


# ============================================================
# 6. 请求模型（Pydantic v2 —— 替代 Node parseBody）
# ============================================================
class LLMMessage(BaseModel):
    role: str
    content: Any  # str or list


class ToolFunction(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    parameters: dict[str, Any] = Field(default_factory=dict)


class ToolDef(BaseModel):
    type: str = "function"
    function: Optional[ToolFunction] = None
    # 兼容 flat 格式（responses API）
    name: Optional[str] = None
    description: Optional[str] = None
    parameters: dict[str, Any] = Field(default_factory=dict)


class LLMChatRequest(BaseModel):
    messages: list[LLMMessage] = Field(default_factory=list)
    tools: list[ToolDef] = Field(default_factory=list)
    tool_choice: Any = "auto"
    stream: bool = False
    temperature: float = 0.2


class TTSRequest(BaseModel):
    text: str
    voiceType: Optional[str] = None
    format: Optional[str] = None
    speed: Optional[float] = None


# -------- 图表生成 --------
class ChartSeries(BaseModel):
    label: str
    data: list[float]


class ChartRequest(BaseModel):
    chart_type: str = Field(
        ..., description="line | bar | scatter | pie | histogram | contour | heatmap"
    )
    title: str = ""
    x_label: str = ""
    y_label: str = ""
    labels: list[str] = Field(default_factory=list, description="X 轴分类标签（line/bar 适用）")
    series: list[ChartSeries] = Field(default_factory=list)
    # pie
    pie_labels: list[str] = Field(default_factory=list)
    pie_values: list[float] = Field(default_factory=list)
    # heatmap / contour：二维数组
    matrix: list[list[float]] = Field(default_factory=list)
    x_ticks: list[str] = Field(default_factory=list)
    y_ticks: list[str] = Field(default_factory=list)
    # 输出：宽/高像素（前端常用）+ inch/dpi（matplotlib 原生）。互斥转换，给 width/height 就转 inch
    width: Optional[int] = Field(default=None, ge=1, le=8192)
    height: Optional[int] = Field(default=None, ge=1, le=8192)
    width_in: float = 7.0
    height_in: float = 4.5
    dpi: int = 120

    @model_validator(mode="after")
    def _convert_px_to_in(self) -> "ChartRequest":
        if self.width and not self.__dict__.get("__width_px_handled"):
            self.width_in = max(1.0, float(self.width) / float(self.dpi))
            self.__dict__["__width_px_handled"] = True
        if self.height and not self.__dict__.get("__height_px_handled"):
            self.height_in = max(0.5, float(self.height) / float(self.dpi))
            self.__dict__["__height_px_handled"] = True
        return self


# ============================================================
# 7. HTTP 路由
# ============================================================

# ---------------- ASR 连通性探测（供 /api/health 真实反映云端 ASR 是否可用）----------------
# 旧逻辑只“看密钥是否存在”，导致密钥在但服务未开通/凭证错误时谎报 asr:true，
# 前端每次都走慢速失败的火山流式路径，最后才降级浏览器，语音体验“卡住/不可用”。
# 这里改为真实连接探测（带 TTL 缓存），连不上就返回 asr:false → 前端立即走浏览器 Web Speech 回退。
_asr_probe_cache: dict[str, Any] = {"at": 0.0, "ok": False, "checked": False}
_ASR_PROBE_TTL = 60.0  # 秒：避免每次 health 都真的连一次火山（首连失败/成功都很快速）


async def _probe_asr_connectivity() -> bool:
    """真实探测火山 ASR WebSocket 是否可连接（结果缓存 _ASR_PROBE_TTL 秒）。"""
    now = time.monotonic()
    if _asr_probe_cache["checked"] and (now - _asr_probe_cache["at"]) < _ASR_PROBE_TTL:
        return bool(_asr_probe_cache["ok"])

    app_id = os.environ.get("VOLC_ASR_APP_ID")
    asr_token = os.environ.get("VOLC_ASR_ACCESS_TOKEN") or os.environ.get("VOLC_ASR_ACCESS_KEY")
    asr_api_key = os.environ.get("VOLC_ASR_API_KEY")
    resource_id = os.environ.get("VOLC_ASR_RESOURCE_ID") or "volc.bigasr.sauc.duration"

    if not ((app_id and asr_token) or asr_api_key):
        _asr_probe_cache.update(at=now, ok=False, checked=True)
        return False

    try:
        import uuid as _uuid
        import websockets as _wslib
        base_headers = {
            "X-Api-Resource-Id": resource_id,
            "X-Api-Sequence": "-1",
            "X-Api-Connect-Id": str(_uuid.uuid4()),
            "X-Api-Request-Id": str(_uuid.uuid4()),
        }
        candidates: list[dict[str, str]] = []
        if asr_api_key:
            h1 = dict(base_headers); h1["X-Api-Key"] = asr_api_key
            candidates.append(h1)
            h2 = dict(base_headers); h2["X-Api-Access-Key"] = asr_api_key
            candidates.append(h2)
        if app_id and asr_token:
            h3 = dict(base_headers); h3["X-Api-App-Key"] = app_id; h3["X-Api-Access-Key"] = asr_token
            candidates.append(h3)
        for h in candidates:
            try:
                ws = await asyncio.wait_for(_wslib.connect(ASR_WS_URL, additional_headers=h), timeout=3.0)
                await ws.close()
                _asr_probe_cache.update(at=now, ok=True, checked=True)
                return True
            except Exception:
                continue
    except Exception:
        pass
    _asr_probe_cache.update(at=now, ok=False, checked=True)
    return False


@app.get("/api/health", tags=["meta"])
async def health_check():
    """返回各组件就绪状态：前端 VolcengineASR.start() 据此决定是否走云端。

    ⚠️ asr 采用真实连通性探测（缓存 60s），不再只看密钥是否存在：
       密钥在但服务未开通/凭证错误 → asr:false → 前端直接走浏览器 Web Speech 回退。
    """
    asr_token = os.environ.get("VOLC_ASR_ACCESS_TOKEN") or os.environ.get("VOLC_ASR_ACCESS_KEY")
    asr_api_key = os.environ.get("VOLC_ASR_API_KEY") or os.environ.get("VOLC_ASR_ACCESS_TOKEN") or os.environ.get("VOLC_ASR_ACCESS_KEY")
    tts_token = os.environ.get("VOLC_TTS_ACCESS_TOKEN") or os.environ.get("VOLC_TTS_ACCESS_KEY")
    tts_api_key = os.environ.get("VOLC_TTS_API_KEY")
    asr_ok = await _probe_asr_connectivity()
    return {
        "ok": True,
        "llm": bool(os.environ.get("VOLC_ARK_API_KEY")),
        "tts": bool((os.environ.get("VOLC_TTS_APP_ID") and tts_token) or tts_api_key),
        "asr": asr_ok,
        "asr_auth_mode": "signature"
            if os.environ.get("VOLC_ASR_SECRET_KEY")
            else ("apikey" if asr_api_key and not os.environ.get("VOLC_ASR_APP_ID") else "token"),
        "rtc": bool(os.environ.get("VOLC_RTC_APP_ID") and os.environ.get("VOLC_RTC_APP_KEY")),
        "charts": True,  # matplotlib Agg backend 默认可用
        "geocoding": True,  # Nominatim 公开 API，需降级则自动回退
    }


# ---------------- LLM Chat ----------------
@app.post("/api/llm/chat", tags=["llm"])
async def llm_chat(req: Request, limiter=Depends(limiter_dep)):
    if _RATE_LIMIT_AVAILABLE and limiter is not None:
        try:
            # 仅 HTTP 路径有效；WebSocket 不走此装饰器
            limiter.limit("60/minute")(lambda: None)()
        except Exception:
            pass

    api_key = os.environ.get("VOLC_ARK_API_KEY")
    if not api_key:
        # ⚠️ 不要抛 5xx：前端认为"网络失败"，会误以为课堂中断。
        # 返回 200 + 明确的 code=PROVIDER_NOT_CONFIGURED，前端 VolcengineLLM 会识别
        # 此字段，降级到 KeywordIntentLLM 继续上课，而不是打断老师。
        return _ok_json({
            "id": "",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": "fallback",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": "",
                    },
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            "error": {
                "code": "PROVIDER_NOT_CONFIGURED",
                "message": "服务端未配置 VOLC_ARK_API_KEY：请在 api/.env 中填写，或使用 make setup 一键配置。",
            },
        })

    try:
        payload = await req.json()
    except Exception:
        raise ApiError("INVALID_ARGS", "请求体不是合法 JSON")

    messages_raw = payload.get("messages") or []
    tools_raw = payload.get("tools") or []
    x_model = req.headers.get("x-model") or ""
    intent_hint = req.headers.get("x-intent-hint") or ""

    model_default = os.environ.get("VOLC_ARK_MODEL") or "doubao-seed-1-6-251015"
    model_fast = os.environ.get("VOLC_ARK_MODEL_FAST") or ""

    model = model_default
    if x_model:
        if x_model == "fast" and model_fast:
            model = model_fast
        elif x_model == "main":
            model = model_default
        else:
            model = x_model
    elif model_fast and intent_hint == "fast":
        model = model_fast

    ck = _cache_key("llm", {"m": model, "msgs": messages_raw, "tools": tools_raw})
    cached = _CACHE.get(ck)
    if cached is not None:
        return _ok_json(cached)

    # 格式转换 → 火山 Responses API
    input_list = []
    for m in messages_raw:
        role = m.get("role", "user")
        content_raw = m.get("content", "")
        if isinstance(content_raw, list):
            content = content_raw
        else:
            content = [{"type": "input_text", "text": str(content_raw)}]
        input_list.append({"role": role, "content": content})

    tools_list = []
    for t in tools_raw:
        fn = t.get("function") if isinstance(t, dict) else None
        if fn:
            tools_list.append(
                {
                    "type": "function",
                    "name": fn.get("name", ""),
                    "description": fn.get("description", ""),
                    "parameters": fn.get("parameters", {}),
                }
            )
        else:
            tools_list.append(
                {
                    "type": "function",
                    "name": (t.get("name") if isinstance(t, dict) else "") or "",
                    "description": (t.get("description") if isinstance(t, dict) else "") or "",
                    "parameters": (t.get("parameters") if isinstance(t, dict) else {}) or {},
                }
            )

    request_body = {
        "model": model,
        "input": input_list,
        "tools": tools_list,
        "store": True,
    }

    async def _call_once(which: str) -> tuple[int, str, bool]:
        # ⚠️ 不要直接 assert：lifespan 没跑（例如某些 testclient 场景）时给出明确错误，不抛断言
        if _httpx_client is None:
            raise ApiError(
                "SERVER_ERROR",
                "HTTP 客户端未初始化（请确认 lifespan 正常执行）。",
            )
        try:
            r = await _httpx_client.post(
                ARK_RESPONSES_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={**request_body, "model": which},
            )
        except httpx.TimeoutException as e:
            raise ApiError("UPSTREAM_TIMEOUT", f"上游 25s 超时未响应：{e}") from e
        except Exception as e:
            raise ApiError("UPSTREAM_ERROR", f"方舟调用网络错误：{e}") from e
        text = await r.aread()
        text_str = text.decode("utf-8", errors="replace")
        not_found = (
            r.status_code == 404
            or "InvalidEndpointOrModel" in text_str
            or "NotFound" in text_str
        )
        return r.status_code, text_str, not_found

    st_a, body_a, nf_a = await _call_once(model)
    if nf_a and model != model_default and model_fast:
        st_a, body_a, _ = await _call_once(model_default)

    if st_a != 200:
        raise ApiError("UPSTREAM_ERROR", f"方舟调用失败（{st_a}）：{body_a[:500]}")

    # Responses → chat/compat
    try:
        resp = json.loads(body_a)
        output = resp.get("output") or []
        tool_calls = []
        for it in output:
            if it.get("type") == "function_call":
                tool_calls.append(
                    {
                        "id": f"call_{it.get('name')}_{int(time.time()*1000)}",
                        "type": "function",
                        "function": {
                            "name": it.get("name", ""),
                            "arguments": it.get("arguments") or "{}",
                        },
                    }
                )
        text_out = ""
        for it in output:
            if it.get("type") == "message" and isinstance(it.get("content"), list):
                for c in it["content"]:
                    if c.get("type") == "output_text" and c.get("text"):
                        text_out += c["text"]
        result = {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": text_out or None,
                        "tool_calls": tool_calls or None,
                    },
                },
            ],
            "usage": resp.get("usage"),
        }
    except Exception:
        # 回退：把原始响应当文本透传（与 Node 版 json(200, first.responseText) 一致）
        return Response(content=body_a, media_type="text/plain; charset=utf-8", status_code=200)

    _CACHE.set(ck, result)
    return _ok_json(result)


# ---------------- TTS ----------------
@app.post("/api/tts/synthesize", tags=["tts"])
async def tts_synthesize(body: TTSRequest):
    app_id = os.environ.get("VOLC_TTS_APP_ID")
    # 新版控制台鉴权：X-Api-Key（单一 Key，不需要 app_id + access_token 组合）
    tts_api_key = os.environ.get("VOLC_TTS_API_KEY")
    # 旧版控制台鉴权：app_id + access_token（通过 query-string 传递）
    token = os.environ.get("VOLC_TTS_ACCESS_TOKEN") or os.environ.get("VOLC_TTS_ACCESS_KEY")

    if not tts_api_key and (not app_id or not token):
        raise ApiError(
            "PROVIDER_NOT_CONFIGURED",
            "服务端未配置 VOLC_TTS：请设置 VOLC_TTS_API_KEY（新版）或 VOLC_TTS_APP_ID+VOLC_TTS_ACCESS_TOKEN（旧版）",
        )
    if not body.text.strip():
        raise ApiError("INVALID_ARGS", "text 不能为空")

    speaker = body.voiceType or os.environ.get("VOLC_TTS_VOICE_TYPE") or "zh_female_qingxin"
    audio_fmt = body.format or "mp3"
    speed_val = body.speed if isinstance(body.speed, (int, float)) else 0

    payload_inner = json.dumps(
        {
            "speaker": speaker,
            "text": body.text,
            "audio_config": {
                "format": audio_fmt,
                "sample_rate": 24000,
                "speech_rate": speed_val,
            },
        },
        ensure_ascii=False,
    )

    if _httpx_client is None:
        raise ApiError("SERVER_ERROR", "HTTP 客户端未初始化（请确认 lifespan 正常执行）")

    # ------- 构造"两种鉴权 + 两种 body 包装"调用链，自动回退 -------
    # 官方有四种可能组合（不同 SAMI endpoint/控制台版本）：
    #  1. 新版 API Key 控制台：Header X-Api-Key + body 直接 payload_inner (JSON)
    #  2. 新版 API Key 控制台：Header X-Api-Key + body {"payload": payload_inner}
    #  3. 旧版 AppID+Access Token：query {version, token, appkey, namespace} + body {"payload": payload_inner}
    #  4. 旧版 AppID+Access Token：query {version, token, appkey, namespace} + body 直接 payload_inner (JSON)
    # 按"先新版后旧版"的顺序逐个尝试，任何 status_code==200+status_code==20000000 即命中。
    candidates: list[dict[str, Any]] = []

    # --- 模式 A：有 VOLC_TTS_API_KEY（新版控制台）---
    if tts_api_key:
        headers_a = {
            "Content-Type": "application/json",
            "X-Api-Key": tts_api_key,
        }
        # A1: body = payload_inner（最常命中）
        candidates.append({
            "url": TTS_HTTP_URL,
            "headers": headers_a,
            "json": json.loads(payload_inner),
            "label": "tts:new-api-key-body-raw",
        })
        # A2: body = {"payload": payload_inner}（有些 sami namespace 需要包裹）
        candidates.append({
            "url": TTS_HTTP_URL,
            "headers": headers_a,
            "json": {"payload": payload_inner},
            "label": "tts:new-api-key-body-wrapped",
        })

    # --- 模式 B：AppID + Access Token（旧版控制台 Query-string）---
    if app_id and token:
        qs_b = urllib.parse.urlencode(
            {"version": "v4", "token": token, "appkey": app_id, "namespace": "TTS"}
        )
        url_b = f"{TTS_HTTP_URL}?{qs_b}"
        headers_b = {"Content-Type": "application/json"}
        # B1: body = {"payload": payload_inner}（官方推荐）
        candidates.append({
            "url": url_b,
            "headers": headers_b,
            "json": {"payload": payload_inner},
            "label": "tts:old-query-body-wrapped",
        })
        # B2: body = payload_inner（兼容部分 endpoint）
        candidates.append({
            "url": url_b,
            "headers": headers_b,
            "json": json.loads(payload_inner),
            "label": "tts:old-query-body-raw",
        })

    last_err_msg = f"火山 TTS 所有鉴权组合均失败（共尝试 {len(candidates)} 种）"
    last_status_code = 0
    last_business_code: Any = None

    for c in candidates:
        label = c["label"]
        try:
            r = await _httpx_client.post(c["url"], headers=c["headers"], json=c["json"])
        except httpx.TimeoutException as e:
            last_err_msg = f"TTS {label} 上游 25s 超时：{e}"
            continue
        except Exception as e:
            last_err_msg = f"TTS {label} 网络错误：{e}"
            continue
        if r.status_code != 200:
            last_status_code = r.status_code
            last_err_msg = f"火山 TTS HTTP {label} {r.status_code}：{r.text[:500]}"
            continue
        try:
            data = r.json()
        except Exception as e:
            last_err_msg = f"火山 TTS {label} 返回非 JSON：{e}；body={r.text[:500]}"
            continue
        business_code = data.get("status_code")
        if business_code == 20000000 and data.get("data"):
            return _ok_json({"ok": True, "audio": data["data"], "format": audio_fmt})
        # 典型失败：40200002 DeniedAccess:IllegalToken → 下一个候选
        last_business_code = business_code
        last_err_msg = (
            f"火山 TTS 业务错误 [{label}] code={business_code} "
            f"{data.get('status_text') or data.get('status_code')}"
        )

    # ------- 所有候选均失败，返回汇总诊断 -------
    if last_business_code == 40200002 or (
        isinstance(last_err_msg, str) and "IllegalToken" in last_err_msg
    ):
        raise ApiError(
            "UPSTREAM_ERROR",
            f"{last_err_msg}。"
            "【排错建议】：控制台获取的 Key 类型不匹配本接口 SAMI namespace。"
            "请确认你在火山引擎『语音合成 TTS』中使用的是『新版 X-Api-Key』还是『旧版 AppID+Access_Token+SecretKey』，"
            "并设置到 api/.env 对应的 VOLC_TTS_API_KEY 或 VOLC_TTS_APP_ID+VOLC_TTS_ACCESS_TOKEN 变量（不要混用）。",
        )
    raise ApiError("UPSTREAM_ERROR", last_err_msg)


# ---------------- ASR（一句话 HTTP）----------------
@app.post("/api/asr/recognition", tags=["asr"])
async def asr_recognition(request: Request):
    app_id = os.environ.get("VOLC_ASR_APP_ID")
    resource_id = os.environ.get("VOLC_ASR_RESOURCE_ID") or "volc.bigasr.sauc.duration"
    auth = build_asr_auth()
    if not app_id:
        raise ApiError("PROVIDER_NOT_CONFIGURED", "服务端未配置 VOLC_ASR_APP_ID")

    raw_body = await request.body()
    if len(raw_body) == 0:
        raise ApiError("INVALID_ARGS", "ASR 请求缺少音频 body")

    target = urllib.parse.urlparse(ASR_HTTP_URL)
    qparams = urllib.parse.urlencode(
        {"appid": app_id, "token": auth.token, "resource": resource_id}
    )
    full_qs = f"{target.path}?{qparams}"
    headers: dict[str, str] = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer;{auth.token}",
        "X-Api-App-Id": app_id,
        "X-Api-Resource-Id": resource_id,
    }
    if auth.auth_mode == "signature" and auth.secret_key:
        host = target.netloc
        mac = compute_asr_signature(
            "POST", full_qs, host, auth.secret_key, base64.b64encode(raw_body).decode()
        )
        headers["Authorization"] = f'HMAC256; access_token="{auth.token}"; mac="{mac}"'

    if _httpx_client is None:
        raise ApiError("SERVER_ERROR", "HTTP 客户端未初始化（请确认 lifespan 正常执行）")
    try:
        r = await _httpx_client.post(
            f"{ASR_HTTP_URL}?{qparams}",
            headers=headers,
            json={
                "audio": base64.b64encode(raw_body).decode(),
                "audio_format": "wav",
                "user": "earth-explorer",
            },
        )
    except httpx.TimeoutException as e:
        raise ApiError("UPSTREAM_TIMEOUT", f"ASR 上游超时：{e}") from e
    except Exception as e:
        raise ApiError("UPSTREAM_ERROR", f"ASR 网络错误：{e}") from e

    if r.status_code != 200:
        raise ApiError("UPSTREAM_ERROR", f"ASR HTTP {r.status_code}：{r.text[:500]}")
    j = r.json()
    if j.get("code") != 3000 or not j.get("data"):
        raise ApiError("UPSTREAM_ERROR", f"ASR 业务 code={j.get('code')}")
    text_list = (j.get("data") or {}).get("text") or []
    return _ok_json({"ok": True, "text": "".join(text_list)})


# ---------------- RTC Token（预留 NOT_IMPLEMENTED）----------------
@app.get("/api/rtc/token", tags=["rtc"])
async def rtc_token():
    app_id = os.environ.get("VOLC_RTC_APP_ID")
    app_key = os.environ.get("VOLC_RTC_APP_KEY")
    if not app_id or not app_key:
        raise ApiError(
            "RTC_NOT_CONFIGURED",
            "未配置 VOLC_RTC_APP_ID / VOLC_RTC_APP_KEY。当前使用方案 B（WebSocket 流式 ASR + VAD）",
        )
    raise ApiError("NOT_IMPLEMENTED", "RTC 方案 A 尚未实现，当前使用方案 B")


# ---------------- 反向地理编码（Nominatim → 结构化）----------------
@app.get("/api/geocoding/reverse", tags=["geocoding"])
async def reverse_geocoding(
    latitude: Optional[float] = Query(default=None, ge=-90, le=90),
    longitude: Optional[float] = Query(default=None, ge=-180, le=180),
    lat: Optional[float] = Query(default=None, ge=-90, le=90, description="兼容别名：优先使用 latitude"),
    lon: Optional[float] = Query(default=None, ge=-180, le=180, description="兼容别名：优先使用 longitude"),
    lang: str = "zh-CN",
    zoom: int = Query(14, ge=3, le=18),
):
    """前端地理讲解（explain.location / explain.terrain）调用。失败时返回空数据，不中断课堂。

    Query 参数（主）：latitude, longitude（前端 GEOGRAPHY_TOOLS 已约定）
    Query 参数（别名，兼容旧脚本）：lat, lon
    """
    _lat = latitude if latitude is not None else lat
    _lon = longitude if longitude is not None else lon
    if _lat is None or _lon is None:
        raise ApiError("INVALID_ARGS", "缺少必填参数：latitude & longitude（或别名 lat & lon）")

    ck = _cache_key("geo", {"lat": round(_lat, 4), "lon": round(_lon, 4), "z": zoom, "l": lang})
    cached = _CACHE.get(ck)
    if cached is not None:
        return _ok_json(cached)

    if _httpx_client is None:
        # 上游不可达：仍然返回 ok=true 的结构化空结果（带输入经纬度），前端 UI 展示不中断
        _empty = {
            "ok": True,
            "place_id": None,
            "name": None,
            "display_name": None,
            "lat": _lat,
            "lon": _lon,
            "address": None,
            "type": None,
            "category": None,
            "error": "HTTP 客户端未初始化（lifespan 未运行）",
        }
        _CACHE.set(ck, _empty)
        return _ok_json(_empty)
    try:
        r = await _httpx_client.get(
            NOMINATIM_URL,
            params={
                "lat": str(_lat),
                "lon": str(_lon),
                "format": "json",
                "zoom": str(zoom),
                "accept-language": lang,
                "addressdetails": "1",
            },
            headers={"User-Agent": "EarthExplorerAI/1.0 (education)"},
        )
        if r.status_code != 200:
            _fail = {"ok": False, "error": f"nominatim HTTP {r.status_code}", "name": None, "address": None, "lat": _lat, "lon": _lon}
            _CACHE.set(ck, _fail, 30)
            return _ok_json(_fail)
        data = r.json()
    except Exception as e:
        _fail = {"ok": False, "error": str(e), "name": None, "address": None, "lat": _lat, "lon": _lon}
        _CACHE.set(ck, _fail, 30)
        return _ok_json(_fail)

    addr = data.get("address") or {}

    # ISO 3166-2:CN → 中文省级名称（4 直辖市 + 23 省 + 5 自治区 + 2 特别行政区）
    # 作用：北京、上海等直辖市 zoom=10 时 Nominatim 不返回 state 字段，
    #       仅返回 ISO3166-2-lvl4="CN-BJ"；通过本映射可还原"北京市"供前端 UI 展示
    _CN_ISO3166_LVL4 = {
        "BJ": "北京市", "SH": "上海市", "TJ": "天津市", "CQ": "重庆市",
        "HE": "河北省", "SX": "山西省", "LN": "辽宁省", "JL": "吉林省",
        "HL": "黑龙江省", "JS": "江苏省", "ZJ": "浙江省", "AH": "安徽省",
        "FJ": "福建省", "JX": "江西省", "SD": "山东省", "HA": "河南省",
        "HB": "湖北省", "HN": "湖南省", "GD": "广东省", "HI": "海南省",
        "SC": "四川省", "GZ": "贵州省", "YN": "云南省", "SN": "陕西省",
        "GS": "甘肃省", "QH": "青海省", "TW": "台湾省",
        "NM": "内蒙古自治区", "GX": "广西壮族自治区", "XZ": "西藏自治区",
        "NX": "宁夏回族自治区", "XJ": "新疆维吾尔自治区",
        "HK": "香港特别行政区", "MO": "澳门特别行政区",
    }
    _iso = (addr.get("ISO3166-2-lvl4") or "").split("-")[-1]  # "CN-BJ" → "BJ"
    _state_via_iso = _CN_ISO3166_LVL4.get(_iso) if _iso else None
    _state = addr.get("state") or addr.get("province") or _state_via_iso

    result = {
        "ok": True,
        "place_id": data.get("place_id"),
        "name": data.get("name") or data.get("display_name"),
        "display_name": data.get("display_name"),
        "lat": data.get("lat"),
        "lon": data.get("lon"),
        "address": {
            "country": addr.get("country"),
            "state": _state,
            "city": addr.get("city") or addr.get("town") or addr.get("county") or _state,
            "county": addr.get("county"),
            "district": addr.get("suburb") or addr.get("district"),
            "township": addr.get("township") or addr.get("neighbourhood"),
            "road": addr.get("road") or addr.get("pedestrian"),
            "postcode": addr.get("postcode"),
            "country_code": addr.get("country_code"),
        },
        "type": data.get("type"),
        "category": data.get("class"),
    }
    _CACHE.set(ck, result)
    return _ok_json(result)


# ---------------- 图表生成（matplotlib → base64 PNG）----------------
@app.post("/api/charts/generate", tags=["charts"])
async def generate_chart(body: ChartRequest):
    """教学场景数据可视化。返回 { ok:true, image:"data:image/png;base64,..." }。"""
    import matplotlib
    matplotlib.use("Agg")  # 必须在 pyplot import 之前
    import matplotlib.pyplot as plt
    import numpy as np

    # 中文支持（优雅降级：若系统无中文字体则用默认 DejaVu，不抛异常）
    for cfont in ["Noto Sans CJK SC", "SimHei", "PingFang SC", "Microsoft YaHei", "Arial Unicode MS"]:
        try:
            matplotlib.rcParams["font.sans-serif"] = [cfont]
            break
        except Exception:
            continue
    matplotlib.rcParams["axes.unicode_minus"] = False

    fig, ax = plt.subplots(figsize=(body.width_in, body.height_in), dpi=body.dpi)
    if body.title:
        ax.set_title(body.title)
    if body.x_label:
        ax.set_xlabel(body.x_label)
    if body.y_label:
        ax.set_ylabel(body.y_label)

    try:
        ct = body.chart_type.lower().strip()
        if ct in ("line", "bar"):
            xs = list(range(len(body.labels))) if body.labels else None
            for s in body.series:
                ys = s.data
                if xs is None:
                    xs = list(range(len(ys)))
                if ct == "line":
                    ax.plot(xs, ys, label=s.label, marker="o", linewidth=2)
                else:
                    ax.bar([x + 0.1 * i for i, _ in enumerate([body.series])][0] if len(body.series) > 1 else xs,
                           ys, label=s.label, alpha=0.85, width=0.8 / max(1, len(body.series)))
            if body.labels and xs is not None:
                ax.set_xticks(list(range(len(body.labels))))
                ax.set_xticklabels(body.labels, rotation=30, ha="right")
            if any(s.label for s in body.series):
                ax.legend()
            ax.grid(True, alpha=0.3)

        elif ct == "scatter":
            rng = np.random.default_rng(0)
            for s in body.series:
                ys = np.asarray(s.data, dtype=float)
                xs = np.arange(len(ys)) if not body.labels else np.arange(len(ys))
                ax.scatter(xs, ys, label=s.label, s=42, alpha=0.8,
                           color=rng.random(3))
            if body.labels:
                ax.set_xticks(list(range(len(body.labels))))
                ax.set_xticklabels(body.labels, rotation=30, ha="right")
            if any(s.label for s in body.series):
                ax.legend()
            ax.grid(True, alpha=0.3)

        elif ct == "pie":
            if len(body.pie_values) != len(body.pie_labels):
                raise ApiError("INVALID_ARGS", "pie_values 与 pie_labels 长度必须一致")
            if not body.pie_values:
                raise ApiError("INVALID_ARGS", "pie_values 为空")
            ax.pie(body.pie_values, labels=body.pie_labels or None,
                   autopct="%1.1f%%", startangle=90, wedgeprops={"linewidth": 1, "edgecolor": "white"})
            ax.axis("equal")

        elif ct == "histogram":
            all_vals: list[float] = []
            for s in body.series:
                all_vals.extend(s.data)
            if not all_vals:
                raise ApiError("INVALID_ARGS", "series 数据为空")
            ax.hist(all_vals, bins=min(20, max(5, len(all_vals) // 5)),
                    edgecolor="white", alpha=0.85, color="#4a90e2")
            ax.grid(True, alpha=0.3, axis="y")

        elif ct in ("heatmap", "contour"):
            if not body.matrix:
                raise ApiError("INVALID_ARGS", "matrix 二维数组为空")
            arr = np.asarray(body.matrix, dtype=float)
            if ct == "heatmap":
                im = ax.imshow(arr, cmap="viridis", aspect="auto")
                fig.colorbar(im, ax=ax)
                if body.x_ticks:
                    ax.set_xticks(list(range(len(body.x_ticks))))
                    ax.set_xticklabels(body.x_ticks, rotation=30, ha="right")
                if body.y_ticks:
                    ax.set_yticks(list(range(len(body.y_ticks))))
                    ax.set_yticklabels(body.y_ticks)
                for i in range(arr.shape[0]):
                    for j in range(arr.shape[1]):
                        ax.text(j, i, f"{arr[i, j]:.1f}", ha="center", va="center",
                                color="white" if abs(arr[i, j]) > (arr.max() - arr.min()) / 2 else "black",
                                fontsize=8)
            else:  # contour
                if arr.ndim != 2:
                    raise ApiError("INVALID_ARGS", "contour 需要二维 matrix")
                X, Y = np.meshgrid(np.arange(arr.shape[1]), np.arange(arr.shape[0]))
                cs = ax.contourf(X, Y, arr, cmap="terrain", levels=12)
                fig.colorbar(cs, ax=ax)
                ax.contour(X, Y, arr, colors="black", linewidths=0.5, levels=12, alpha=0.5)
                if body.x_ticks:
                    ax.set_xticks(list(range(len(body.x_ticks))))
                    ax.set_xticklabels(body.x_ticks, rotation=30, ha="right")
                if body.y_ticks:
                    ax.set_yticks(list(range(len(body.y_ticks))))
                    ax.set_yticklabels(body.y_ticks)
        else:
            raise ApiError(
                "INVALID_ARGS",
                "不支持的 chart_type，可选: line|bar|scatter|pie|histogram|heatmap|contour",
            )
    except ApiError:
        plt.close(fig)
        raise
    except Exception as e:
        plt.close(fig)
        raise ApiError("INTERNAL", f"图表渲染异常：{e}") from e

    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", facecolor="white")
    plt.close(fig)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return _ok_json({"ok": True, "image": f"data:image/png;base64,{b64}"})


# ============================================================
# 7.5 火山引擎流式 ASR v3 二进制协议工具（根因修复）
#
# 🔥 核心发现（参考官方 1354869 文档）：
#   火山 ASR v3 WebSocket 不是裸 PCM + JSON 文本包；
#   每一帧（控制/音频/结束）都必须封装成自定义二进制协议：
#     Byte 0 [7-4]  ProtocolVersion (0x0 = v1)
#            [3-0]  HeaderSize     (以 32-bit word 为单位，通常 = 1 → header 4bytes，无扩展)
#     Byte 1 [7-4]  MessageType
#                       1 = Control (JSON 文本包：握手/配置/错误)
#                       2 = Audio   (音频二进制数据 PCM)
#                       3 = Last    (结束负包：告知服务端"音频发完")
#            [3-0]  MessageFlags   (0x01=FullRequest，通常控制帧为 1，音频帧/结束帧=0)
#     Byte 2 [7-4]  Serialization
#                       0 = None（二进制音频、Last 帧）
#                       1 = JSON（Control 控制帧）
#            [3-0]  Compression
#                       0 = None
#     Byte 3         Reserved (=0x00)
#     Byte 4..N      [Optional Header Extensions] (HeaderSize>1 才出现)
#     Byte N..END    Payload
#
#   另外握手必须 Header 带齐：
#     X-Api-Sequence = -1        (固定值，必传)
#     X-Api-Connect-Id = UUID    (每次连接唯一)
#     X-Api-Request-Id = UUID    (每次请求唯一)
#     X-Api-Resource-Id = volc.bigasr.sauc.duration 等
#     鉴权二选一：
#       X-Api-Key                    (新版控制台 单Key)
#       X-Api-App-Key+X-Api-Access-Key (旧版 AppID+Token)
#
#   没有做二进制封装或漏传 X-Api-Sequence → 连接立即 403/400/直接不返回识别结果。
#   之前把浏览器 PCM 裸数据直接 send 给火山 → 火山完全没解析到合法音频帧 → 实时语音 100% 不可用。
# ============================================================
# 官方协议（文档 6561/1354869）：
#   Message type: 0b0001 = full client request（配置/控制帧）
#                0b0010 = audio only request（音频帧）
#   Message type 低4位 = Flags:
#                 0b0000 = 后 4 字节不是 sequence number
#                 0b0001 = 后 4 字节是 sequence number 且为正
#                 0b0010 = 后 4 字节不是 sequence number，仅指示“最后一包（负包）”
#                 0b0011 = 后 4 字节是 sequence number 且为负（最后一包/负包）
#   Serialization: 0b0000 = 无序列化, 0b0001 = JSON
#   Compression:   0b0000 = 无压缩
_VOLC_V3_MSG_CONTROL = 0b0001   # full client request
_VOLC_V3_MSG_AUDIO = 0b0010     # audio only request
_VOLC_V3_FLAG_NONE = 0b0000     # 无 sequence number
_VOLC_V3_FLAG_POSITIVE_SEQ = 0b0001  # 后接正 sequence number
_VOLC_V3_FLAG_LAST = 0b0010     # 最后一包（负包）
_VOLC_V3_SERIAL_NONE = 0x00
_VOLC_V3_SERIAL_JSON = 0x01
_VOLC_V3_COMPRESS_NONE = 0x00


def _encode_volc_asr_frame(
    msg_type: int,
    payload: bytes,
    *,
    flags: int = _VOLC_V3_FLAG_NONE,
    serial: int = _VOLC_V3_SERIAL_NONE,
    compression: int = _VOLC_V3_COMPRESS_NONE,
) -> bytes:
    """封装一帧火山 v3 ASR WebSocket 二进制包。

    官方帧格式（文档 6561/1354869）：
        [Header: 4 B] [Payload size: 4 B unsigned int32 大端] [Payload]

    Header（4 字节）：
        Byte0 高4bit = Protocol version (0b0001)，低4bit = Header size (0b0001 → 1×4=4 字节)
        Byte1 高4bit = Message type，低4bit = Flags
        Byte2 高4bit = Serialization，低4bit = Compression
        Byte3 Reserved = 0

    Args:
        msg_type: _VOLC_V3_MSG_CONTROL / _VOLC_V3_MSG_AUDIO
        payload: 实际负载数据（控制帧=JSON bytes，音频帧=PCM bytes，结束帧=空）
        flags:   _VOLC_V3_FLAG_* （结束帧用 _VOLC_V3_FLAG_LAST）
        serial:  _VOLC_V3_SERIAL_*  控制帧=JSON，音频/结束帧=NONE
        compression: _VOLC_V3_COMPRESS_NONE
    """
    protocol_version = 0b0001  # 官方当前唯一版本
    header_size = 0x1          # 1 * 4bytes = 4 字节 header，无扩展
    b0 = (protocol_version & 0x0F) << 4 | (header_size & 0x0F)
    b1 = ((msg_type & 0x0F) << 4) | (flags & 0x0F)
    b2 = ((serial & 0x0F) << 4) | (compression & 0x0F)
    b3 = 0x00  # reserved
    header = struct.pack("!BBBB", b0, b1, b2, b3)
    # 🔥 关键：协议要求 header 之后必须跟 4 字节 payload size（大端 uint32），
    #    之前漏掉该字段，导致火山服务端解析不到合法帧 → 实时语音 100% 不可用。
    payload_size = struct.pack("!I", len(payload))
    return header + payload_size + payload


def _resample_pcm_to_16k_mono(
    raw_bytes: bytes,
    *,
    src_rate: int,
    src_channels: int,
    src_sample_width: int = 2,
    src_is_float: bool = False,
    src_is_little_endian: bool = True,
) -> bytes:
    """把浏览器 MediaRecorder/ScriptProcessor 出来的 PCM 转成火山 ASR 要求的 16kHz mono int16 BIG-ENDIAN

    性能：200ms 音频 44100Hz → 16kHz 单声道约 0.5ms 以内，纯 Python 足够；
    不依赖 numpy/scipy 避免用户没装就跑不起来。
    """
    if not raw_bytes:
        return b""
    target_rate = 16000
    target_channels = 1
    # 系统字节序（array.array 用本机格式）：在 macOS/Linux/Windows/ARM 基本都是 LE
    import sys as _sys
    native_is_le = _sys.byteorder == "little"

    def _byteswap_if_needed(arr) -> None:
        """如果源字节序 != 本机字节序，byteswap 一下（否则解出来的符号/幅度全错）"""
        if src_is_little_endian != native_is_le:
            try:
                arr.byteswap()
            except Exception:
                pass

    # ---------- 1. 解成 float32 [-1,1] 的样本序列 ----------
    if src_is_float and src_sample_width == 4:
        values = array.array("f")
        try:
            values.frombytes(raw_bytes)
        except Exception:
            values.frombytes(raw_bytes[: len(raw_bytes) - (len(raw_bytes) % 4)])
        _byteswap_if_needed(values)
        src_floats = values.tolist()
    elif src_sample_width == 2 and not src_is_float:
        shorts = array.array("h")
        try:
            shorts.frombytes(raw_bytes)
        except Exception:
            shorts.frombytes(raw_bytes[: len(raw_bytes) - (len(raw_bytes) % 2)])
        _byteswap_if_needed(shorts)
        src_floats = [s / 32768.0 for s in shorts]
    elif src_sample_width == 1:
        # 8-bit unsigned PCM (少见，兼容)
        src_floats = [(b - 128) / 128.0 for b in raw_bytes]
    else:
        # 未知格式：按 16-bit int 解，不行就返回空（不中断）
        shorts = array.array("h")
        safe_len = len(raw_bytes) - (len(raw_bytes) % 2)
        if safe_len > 0:
            shorts.frombytes(raw_bytes[:safe_len])
            _byteswap_if_needed(shorts)
            src_floats = [s / 32768.0 for s in shorts]
        else:
            return b""

    # ---------- 2. 降混多声道 → mono ----------
    n_total = len(src_floats)
    if src_channels <= 0:
        src_channels = 1
    n_frames = n_total // src_channels
    if src_channels > 1 and n_frames > 0:
        # 平均所有声道，浮点够精度
        mono = array.array("f", [0.0]) * n_frames
        ch = src_channels
        for i in range(n_frames):
            s = 0.0
            base = i * ch
            for c in range(ch):
                s += src_floats[base + c]
            mono[i] = s / ch
        mono_list = mono.tolist()
    else:
        mono_list = src_floats

    # ---------- 3. 线性插值降采样 到 16kHz ----------
    if src_rate <= 0:
        src_rate = target_rate
    if n_frames <= 1 or src_rate == target_rate:
        out_frames = mono_list
    else:
        duration = n_frames / src_rate
        n_out = max(1, int(round(duration * target_rate)))
        # 线性插值，每个目标样本位置在 src 的刻度
        step = (n_frames - 1) / max(1, n_out - 1)
        out = [0.0] * n_out
        for i in range(n_out):
            pos = i * step
            idx0 = int(pos)
            frac = pos - idx0
            if idx0 >= n_frames - 1:
                out[i] = mono_list[n_frames - 1]
            else:
                a = mono_list[idx0]
                b = mono_list[idx0 + 1]
                out[i] = a * (1.0 - frac) + b * frac
        out_frames = out

    # ---------- 4. 转 int16 大端（火山官方：所有整数类型用 BIG-ENDIAN）----------
    # 限幅避免爆音
    out_bytes = bytearray()
    to_int = lambda f: max(-32768, min(32767, int(f * 32767.0)))
    for f in out_frames:
        out_bytes += struct.pack(">h", to_int(f))
    return bytes(out_bytes)


# ============================================================
# 8. WebSocket /ws/asr（流式 ASR 代理，同 Node 版 wss.path='/ws/asr'）
# ============================================================
@app.websocket("/ws/asr")
async def ws_asr_proxy(ws: WebSocket):
    await ws.accept()
    logger.info("客户端已连接 /ws/asr")
    upstream_ws: Optional[Any] = None
    upstream_ready = False
    audio_queue: asyncio.Queue[bytes] = asyncio.Queue()
    # ---------- 浏览器端传来的 PCM 格式（start 消息中告诉后端）----------
    #   - 如果浏览器没传，保守估计是 MediaRecorder / ScriptProcessor 默认值：44100Hz 双声道 / int16
    #   - 实时对话路径会传真实值（audio.sampleRate + audio.channels + audio.sampleWidth）
    client_audio_format: dict[str, Any] = {
        "rate": 44100,
        "channels": 2,
        "sample_width": 2,
        "is_float": False,
        "is_little_endian": True,  # JS TypedArray / AudioBuffer default LE
    }
    # 记录本次连接是否使用了 v2 协议（v2 不需要二进制封装，直接 JSON/裸 PCM）
    using_v2_fallback = False

    def _send_json(obj: dict[str, Any]):
        # 保护：ws 关闭时静默忽略
        try:
            return ws.send_json(obj)
        except Exception:
            return None

    async def _flush_audio_loop():
        nonlocal upstream_ws, upstream_ready, client_audio_format, using_v2_fallback
        while True:
            chunk = await audio_queue.get()
            if upstream_ready and upstream_ws is not None:
                try:
                    if using_v2_fallback:
                        # v2: 直接发送裸 PCM（v2 协议直接吃 binary frame）
                        await upstream_ws.send(chunk)
                    else:
                        # v3: 必须是 16kHz mono PCM16 BE（大端），先重采样/转字节序，再封装火山二进制 Header
                        src_rate = int(client_audio_format.get("rate") or 44100)
                        src_channels = int(client_audio_format.get("channels") or 2)
                        src_sample_width = int(client_audio_format.get("sample_width") or 2)
                        src_is_float = bool(client_audio_format.get("is_float") or False)
                        src_is_le = bool(client_audio_format.get("is_little_endian") or True)

                        # 🔥 快路径：已经是 16kHz mono int16 → 只做 LE→BE 字节序 swap（如需要），不跑线性插值
                        if (
                            src_rate == 16000
                            and src_channels == 1
                            and src_sample_width == 2
                            and not src_is_float
                            and len(chunk) % 2 == 0
                        ):
                            if src_is_le:
                                # JS Int16Array 小端 → 火山要求大端：成对 swap bytes
                                pcm_16k = bytes(
                                    b for i in range(0, len(chunk), 2)
                                    for b in (chunk[i + 1], chunk[i])
                                )
                            else:
                                pcm_16k = chunk
                        else:
                            # 慢路径：线性插值重采样 + 自动转 BE
                            pcm_16k = _resample_pcm_to_16k_mono(
                                chunk,
                                src_rate=src_rate,
                                src_channels=src_channels,
                                src_sample_width=src_sample_width,
                                src_is_float=src_is_float,
                                src_is_little_endian=src_is_le,
                            )
                        if pcm_16k:
                            frame = _encode_volc_asr_frame(
                                _VOLC_V3_MSG_AUDIO, pcm_16k,
                                flags=_VOLC_V3_FLAG_NONE, serial=_VOLC_V3_SERIAL_NONE,
                            )
                            await upstream_ws.send(frame)
                except Exception:
                    # 上游断了，暂存会无限积压 → 丢弃，等重连
                    pass

    flush_task: Optional[asyncio.Task] = None
    app_id = os.environ.get("VOLC_ASR_APP_ID")
    asr_token = os.environ.get("VOLC_ASR_ACCESS_TOKEN") or os.environ.get("VOLC_ASR_ACCESS_KEY")
    asr_api_key = os.environ.get("VOLC_ASR_API_KEY")
    resource_id_default = os.environ.get("VOLC_ASR_RESOURCE_ID") or "volc.bigasr.sauc.duration"
    # 新版 v3 只需要：X-Api-App-Key + X-Api-Access-Key（Header 鉴权，不用 Query Token）
    # 旧版 v2 需要：appid+token+resource (Query) + Authorization (Header)
    new_auth_ok = bool((app_id and asr_token) or asr_api_key)
    if not new_auth_ok:
        await _send_json({"type": "error", "code": "ASR_NOT_CONFIGURED",
                          "message": "服务端未配置 VOLC_ASR：请设置 VOLC_ASR_APP_ID+VOLC_ASR_ACCESS_TOKEN 或 VOLC_ASR_API_KEY"})
        await _send_json({"type": "ready", "asr": False})
    try:
        if flush_task is None:
            flush_task = asyncio.create_task(_flush_audio_loop())
    except Exception:
        pass

    try:
        while True:
            try:
                data = await ws.receive()
            except WebSocketDisconnect:
                break

            # 区分文本（JSON 命令）/ 二进制（音频）
            bytes_data: Optional[bytes] = None
            text_data: Optional[str] = None
            if isinstance(data, dict):  # starlette/fastapi 会包装成 dict
                # 🔥 断开消息：Starlette 在收到 disconnect 后返回 {"type":"websocket.disconnect"} 而非抛异常。
                #   若继续循环再调 ws.receive() 会抛 RuntimeError:"Cannot call receive once a disconnect message has been received"，
                #   导致 ASR 会话在客户端断开时被异常打断（前端看到"语音失败"）。
                if data.get("type") == "websocket.disconnect":
                    break
                if "bytes" in data and data["bytes"] is not None:
                    bytes_data = data["bytes"]
                elif "text" in data and data["text"] is not None:
                    text_data = data["text"]
            if bytes_data:
                if audio_queue.qsize() < 512:  # 积压保护
                    audio_queue.put_nowait(bytes_data)
                continue
            if not text_data:
                continue

            try:
                msg = json.loads(text_data)
            except Exception:
                continue
            mtype = msg.get("type")

            if mtype == "start":
                # ---------- 保存客户端音频格式（供 flush loop 重采样）----------
                cli_audio = msg.get("audio") or {}
                if isinstance(cli_audio, dict):
                    if cli_audio.get("rate"): client_audio_format["rate"] = int(cli_audio["rate"])
                    if cli_audio.get("channels"): client_audio_format["channels"] = int(cli_audio["channels"])
                    if cli_audio.get("sample_width"): client_audio_format["sample_width"] = int(cli_audio["sample_width"])
                    if cli_audio.get("is_float") is not None: client_audio_format["is_float"] = bool(cli_audio["is_float"])
                    if cli_audio.get("is_little_endian") is not None: client_audio_format["is_little_endian"] = bool(cli_audio["is_little_endian"])
                logger.info(
                    "收到 start：音频格式=%s", client_audio_format
                )

                # ---------- 连接到火山引擎 ASR WS ----------
                try:
                    import uuid
                    import websockets as wslib

                    connect_id = str(uuid.uuid4())
                    request_id = str(uuid.uuid4())
                    app_id_v = app_id or ""
                    access_v = asr_api_key or asr_token or ""
                    resource_v = resource_id_default
                    # 通用头（所有鉴权模式都带）
                    base_headers: dict[str, str] = {
                        "X-Api-Connect-Id": connect_id,
                        "X-Api-Request-Id": request_id,
                        "X-Api-Resource-Id": resource_v,
                        "X-Api-Sequence": "-1",       # 🔥 官方固定值，必传
                    }
                    # 逐个尝试多个鉴权组合（不同控制台版本/密钥类型）
                    candidates_v3: list[tuple[str, str]] = []
                    if asr_api_key:
                        # 新版控制台单密钥：优先 X-Api-Key
                        c1 = dict(base_headers)
                        c1["X-Api-Key"] = asr_api_key
                        candidates_v3.append(("asr:v3-x-api-key", json.dumps(c1)))
                        # 部分链路把新控制台 Key 当作 Access Token 用
                        c2 = dict(base_headers)
                        c2["X-Api-Access-Key"] = asr_api_key
                        candidates_v3.append(("asr:v3-access-key", json.dumps(c2)))
                    if app_id_v and access_v:
                        # 旧控制台 AppID + AccessToken
                        c3 = dict(base_headers)
                        c3["X-Api-App-Key"] = app_id_v
                        c3["X-Api-Access-Key"] = access_v
                        candidates_v3.append(("asr:v3-app-access", json.dumps(c3)))

                    # 🔥 已移除损坏的 v2 回退：旧版 /api/v2/asr 无法处理二进制帧，且会造成
                    #   asr:true 的假象（实际音频全部失败）。只保留官方 v3 二进制协议鉴权。
                    #   若全部 v3 鉴权失败 → 走下方 RuntimeError → 前端收到 ready:asr:false，
                    #   从而干净降级到浏览器 Web Speech API，而不是卡在"连上了但识别不了"。
                    connect_candidates: list[tuple[str, dict[str, str], str, bool]] = []
                    for label, headers_json in candidates_v3:
                        connect_candidates.append(
                            (ASR_WS_URL, json.loads(headers_json), label, False)
                        )

                    logger.info(
                        "鉴权候选=%s",
                        [c[2] for c in connect_candidates],
                    )
                    using_v2_fallback = False
                    last_err: Optional[str] = None
                    for url_c, headers_c, label_c, is_v2 in connect_candidates:
                        try:
                            upstream_ws = await wslib.connect(url_c, additional_headers=headers_c)
                            upstream_ready = True
                            using_v2_fallback = is_v2
                            last_err = None
                            # 记录服务端返回的 X-Tt-Logid 作为排错线索
                            try:
                                resp_headers = upstream_ws.response_headers
                                logid = resp_headers.get("X-Tt-Logid") or resp_headers.get("x-tt-logid")
                                logger.info("✅ 上游连接成功 auth=%s X-Tt-Logid=%s", label_c, logid)
                            except Exception:
                                logger.info("✅ 上游连接成功 auth=%s", label_c)
                            break
                        except Exception as e:
                            last_err = f"[{label_c}] {e}"
                            logger.warning("❌ 上游连接失败 auth=%s → %s", label_c, e)
                            continue

                    if upstream_ws is None or not upstream_ready or last_err is not None:
                        raise RuntimeError(
                            f"所有 ASR 鉴权组合连接失败：{last_err}\n"
                            "【排错建议】：\n"
                            "  ① 确认已开通『流式语音识别』并绑定正确的 Resource ID：\n"
                            "     - 豆包流式 1.0 小时版：volc.bigasr.sauc.duration\n"
                            "     - 豆包流式 1.0 并发版：volc.bigasr.sauc.concurrent\n"
                            "     - 豆包流式 2.0 小时版：volc.seedasr.sauc.duration\n"
                            "     - 豆包流式 2.0 并发版：volc.seedasr.sauc.concurrent\n"
                            "  ② 若使用『新版控制台 X-Api-Key 单密钥』：\n"
                            "     cp api/.env.example api/.env → 只填 VOLC_ASR_API_KEY（不要同时填 AppID/AccessKey）\n"
                            "  ③ 若使用『旧版 AppID+AccessKey』：\n"
                            "     只填 VOLC_ASR_APP_ID + VOLC_ASR_ACCESS_TOKEN（不要同时填 VOLC_ASR_API_KEY）\n"
                            "  ④ 密钥粘贴时确保没有多余的前后空格或换行符。"
                        )

                    await _send_json({"type": "ready", "asr": True, "using_v2_fallback": using_v2_fallback, "connect_id": connect_id})

                    init_msg = {
                        "user": {"uid": "earth-explorer"},
                        "audio": {
                            "format": "pcm", "codec": "raw", "rate": 16000,
                            "bits": 16, "channel": 1,
                        },
                        "request": {
                            "model_name": "bigmodel",
                            "enable_itn": True,
                            "enable_punc": True,
                            "enable_ddc": False,
                            "mode": "2pass",
                            "result_type": "full",
                            "enable_nonstream": True,
                        },
                    }

                    # 🔥 控制帧封装：不再直接 send(json)；v3 走二进制封装 Control JSON Full
                    if using_v2_fallback:
                        logger.info("协议=v2（裸 PCM 直发）")
                        await upstream_ws.send(json.dumps(init_msg, ensure_ascii=False))
                    else:
                        logger.info("协议=v3（二进制帧封装），发送控制帧 msg_type=%s", _VOLC_V3_MSG_CONTROL)
                        init_bytes = json.dumps(init_msg, ensure_ascii=False).encode("utf-8")
                        init_frame = _encode_volc_asr_frame(
                            _VOLC_V3_MSG_CONTROL, init_bytes,
                            flags=_VOLC_V3_FLAG_POSITIVE_SEQ, serial=_VOLC_V3_SERIAL_JSON,
                        )
                        await upstream_ws.send(init_frame)

                    # ---------- 上游读循环（独立 task）----------
                    async def _upstream_read_loop():
                        nonlocal upstream_ready, upstream_ws
                        try:
                            assert upstream_ws is not None
                            async for frame in upstream_ws:
                                try:
                                    uj = json.loads(frame)
                                except Exception:
                                    continue
                                # 兼容 v3 返回（result / additions）与 v2 返回（code=3000 / data）
                                result_obj: Any = uj.get("result") or uj.get("data") or uj
                                code = uj.get("code")
                                additions = uj.get("additions") or []
                                if isinstance(result_obj, dict):
                                    text_val = (
                                        result_obj.get("text")
                                        or result_obj.get("sentence", "")
                                        or ""
                                    )
                                    final_flag = (
                                        bool(result_obj.get("is_final"))
                                        or result_obj.get("mode") == "append"
                                        or any(
                                            a.get("definite")
                                            for a in additions
                                            if isinstance(a, dict)
                                        )
                                    )
                                    if text_val:
                                        await _send_json({
                                            "type": "final" if final_flag else "partial",
                                            "text": text_val,
                                        })
                                        logger.info(
                                            "上游 → 客户端 type=%s text=%r",
                                            "final" if final_flag else "partial",
                                            text_val[:60],
                                        )
                                    continue
                                # v2 code 兼容分支
                                if code == 3000 and uj.get("data"):
                                    d = uj["data"]
                                    is_final = bool(d.get("is_final")) or d.get("mode") == "append"
                                    await _send_json({
                                        "type": "final" if is_final else "partial",
                                        "text": d.get("text") or "",
                                    })
                                elif code is not None and code != 3000:
                                    await _send_json({
                                        "type": "error",
                                        "code": "UPSTREAM_ERROR",
                                        "message": f"火山 ASR 错误 code={code} {uj.get('message','')}",
                                    })
                        except Exception as e:
                            try:
                                await _send_json({"type": "upstream_closed", "message": str(e)})
                            except Exception:
                                pass
                        finally:
                            upstream_ready = False

                    asyncio.create_task(_upstream_read_loop())

                except Exception as e:
                    upstream_ready = False
                    await _send_json({"type": "error", "code": "ASR_CONNECT_FAILED",
                                      "message": f"连接火山引擎失败: {e}"})
                    await _send_json({"type": "ready", "asr": False})

            elif mtype == "audio":
                b64d = msg.get("data") or ""
                try:
                    chunk = base64.b64decode(b64d)
                except Exception:
                    continue
                if audio_queue.qsize() < 512:
                    audio_queue.put_nowait(chunk)

            elif mtype == "end":
                if upstream_ws is not None and upstream_ready:
                    try:
                        # 🔥 v3 必须发 Last 负包（msg_type=3），服务端才会出最终 final 结果
                        if using_v2_fallback:
                            end_msg = {
                                "user": {"uid": "earth-explorer"},
                                "audio": {"format": "pcm", "codec": "raw", "rate": 16000,
                                          "bits": 16, "channel": 1},
                                "request": {
                                    "mode": "2pass", "result_type": "full",
                                    "language": "zh_cn", "is_final": True,
                                },
                            }
                            await upstream_ws.send(json.dumps(end_msg, ensure_ascii=False))
                        else:
                            # 结束帧：msg_type=audio + flags=0b0010（最后一包/负包），payload 为空
                            last_frame = _encode_volc_asr_frame(
                                _VOLC_V3_MSG_AUDIO, b"",
                                flags=_VOLC_V3_FLAG_LAST, serial=_VOLC_V3_SERIAL_NONE,
                            )
                            await upstream_ws.send(last_frame)
                        # 等 0.8s 给服务端回传最终 final 文本（之前 0.5s 有时来不及返回 final）
                        await asyncio.sleep(0.8)
                        try:
                            await upstream_ws.close()
                        except Exception:
                            pass
                    except Exception:
                        pass
                upstream_ws = None
                upstream_ready = False
    finally:
        if flush_task is not None:
            flush_task.cancel()
        if upstream_ws is not None:
            try:
                await upstream_ws.close()
            except Exception:
                pass


# ============================================================
# 8.5 端到端实时语音大模型（Realtime S2S）WebSocket 透明代理
# ============================================================
# 火山「端到端实时语音大模型（Realtime API / S2S）」：
#   端点：wss://openspeech.bytedance.com/api/v3/realtime/dialogue
#   鉴权：新版控制台「单 API Key」直接放进 X-Api-Key 请求头即可，无需 AppID+AccessToken。
#   一次 WebSocket 连接完成 ASR + LLM + TTS 全链路（语音进、语音出）。
#
# 本代理是「透明双向二进制转发」：
#   - 前端负责按官方二进制帧协议封装 StartConnection / StartSession / TaskRequest(音频) /
#     FinishSession / ClientInterrupt 等事件帧，后端不解析、不重采样、不改帧。
#   - 后端只做两件事：① 用单 Key 建立上游连接；② 把前端字节帧原样转发给火山、把火山字节帧
#     原样转发回前端。
#
# 帧协议速记（详见 docs，已验证自官方字节数组示例）：
#   Header: [b0=0x11(version1+4B头)][b1=消息类型+flags][b2=序列化+压缩][b3=0x00]
#   事件帧(Full-client request 0b0001 + event 0b0100 + JSON): b1=0x14,b2=0x10
#       帧 = header + event(4B) + [session_id_size(4B)+session_id] + payload_size(4B) + payload_json
#   音频帧(Audio-only request 0b0010 + Raw): b1=0x20,b2=0x00
#       帧 = header + payload_size(4B) + payload_bytes
#   服务端事件 ID：352=TTSResponse(音频)、450=ASRInfo、451=ASRResponse(转写)、459=ASREnded
S2S_WS_URL = "wss://openspeech.bytedance.com/api/v3/realtime/dialogue"
S2S_RESOURCE_ID = "volc.speech.dialog"


@app.websocket("/ws/s2s")
async def ws_s2s_proxy(ws: WebSocket):
    """透明双向转发：浏览器 <-> 火山 Realtime S2S（单 Key 鉴权）"""
    await ws.accept()
    logger.info("客户端已连接 /ws/s2s")

    s2s_api_key = os.environ.get("VOLC_ASR_API_KEY") or os.environ.get("VOLC_S2S_API_KEY")
    resource_id = os.environ.get("VOLC_S2S_RESOURCE_ID") or os.environ.get("VOLC_ASR_RESOURCE_ID") or S2S_RESOURCE_ID

    def _send_json(obj: dict[str, Any]):
        try:
            return ws.send_json(obj)
        except Exception:
            return None

    if not s2s_api_key:
        await _send_json({"type": "error", "code": "S2S_NOT_CONFIGURED",
                          "message": "服务端未配置 S2S：请在 api/.env 填写 VOLC_ASR_API_KEY（新版单 Key）"})
        await _send_json({"type": "ready", "s2s": False})
        await ws.close()
        return

    # ---------- 建立火山上游连接（单 Key 直连）----------
    import websockets as wslib
    import uuid
    connect_id = str(uuid.uuid4())
    upstream_headers: dict[str, str] = {
        "X-Api-Key": s2s_api_key,
        "X-Api-Resource-Id": resource_id,
        "X-Api-Connect-Id": connect_id,
    }
    upstream_ws = None
    try:
        upstream_ws = await wslib.connect(S2S_WS_URL, additional_headers=upstream_headers)
        try:
            logid = upstream_ws.response_headers.get("X-Tt-Logid") or upstream_ws.response_headers.get("x-tt-logid")
            logger.info("✅ S2S 上游连接成功 X-Tt-Logid=%s connect_id=%s", logid, connect_id)
        except Exception:
            logger.info("✅ S2S 上游连接成功 connect_id=%s", connect_id)
    except Exception as e:
        logger.warning("❌ S2S 上游连接失败 → %s", e)
        await _send_json({"type": "error", "code": "S2S_CONNECT_FAILED", "message": f"火山 S2S 连接失败：{e}"})
        await _send_json({"type": "ready", "s2s": False})
        await ws.close()
        return

    await _send_json({"type": "ready", "s2s": True, "connect_id": connect_id})

    # ---------- 双向转发 ----------
    async def _forward_client_to_upstream():
        # 浏览器 -> 火山：原样转发二进制字节帧
        while True:
            try:
                msg = await ws.receive()
            except Exception:
                break
            if isinstance(msg, dict):
                if msg.get("type") == "websocket.disconnect":
                    break
                if "text" in msg and msg.get("text") is not None:
                    try:
                        await upstream_ws.send(msg["text"])
                    except Exception:
                        break
                elif "bytes" in msg and msg.get("bytes") is not None:
                    try:
                        await upstream_ws.send(msg["bytes"])
                    except Exception:
                        break

    async def _forward_upstream_to_client():
        # 火山 -> 浏览器：原样转发二进制字节帧
        try:
            async for frame in upstream_ws:
                try:
                    if isinstance(frame, bytes):
                        await ws.send_bytes(frame)
                    else:
                        await ws.send_text(frame)
                except Exception:
                    break
        except Exception:
            pass

    try:
        await asyncio.gather(
            _forward_client_to_upstream(),
            _forward_upstream_to_client(),
        )
    finally:
        try:
            await upstream_ws.close()
        except Exception:
            pass
        try:
            await ws.close()
        except Exception:
            pass


# ============================================================
# 9. 根路径：友好提示（方便直接浏览器访问 http://localhost:8787/）
# ============================================================
@app.get("/", tags=["meta"])
async def root():
    return {
        "name": "Earth Explorer FastAPI",
        "version": "1.0.0",
        "endpoints": {
            "health": "/api/health",
            "llm_chat": "POST /api/llm/chat",
            "tts": "POST /api/tts/synthesize",
            "asr_http": "POST /api/asr/recognition",
            "asr_ws": "WS /ws/asr",
            "rtc_token": "GET /api/rtc/token",
            "reverse_geocoding": "GET /api/geocoding/reverse?lat=&lon=",
            "charts": "POST /api/charts/generate",
            "docs": "/docs",
        },
    }


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
