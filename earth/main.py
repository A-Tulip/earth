"""
仓库根目录代理入口 —— 解决「在 earth/ 下直接 uvicorn main:app 报错找不到 main」的问题。

发生了什么？
    当你在 ~/Desktop/earth 目录下执行：
        uvicorn main:app --port 8787 --reload
    或  (.venv) $ uvicorn main:app --host 127.0.0.1 --port 8787 --reload
    之前会报：ERROR: Could not import module "main"
    因为真正的 FastAPI 主程序在 api/main.py，不在仓库根。

这个文件做了什么？
    1. 把 api/ 目录注入 sys.path（让 Python import 时能找到真正的 api/main.py）
    2. 从真正的入口 re-export `app` 对象
    3. 启动时打印一行清晰提示，告诉用户这是代理入口

如果你想跳过代理，用下面任何一种都可以（结果完全一样）：
    make api                                    # 推荐：零心智负担
    ./earth-api --reload                        # 脚本自动处理路径
    cd api && uvicorn main:app --port 8787      # 先进子目录再跑
    uvicorn api.main:app --app-dir .            # 用点号引用 + --app-dir
"""
from __future__ import annotations

import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent        # ~/Desktop/earth
_API_DIR = _REPO_ROOT / "api"                        # ~/Desktop/earth/api

# 双保险：repo 根 + api 目录都入 sys.path，两种引用路径都 work
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))
if str(_API_DIR) not in sys.path:
    sys.path.insert(0, str(_API_DIR))

# 从真正的 api/main.py 导出 FastAPI app 实例
#   - 如果这里抛 ImportError，会让 uvicorn 默认打出缺少 fastapi/httpx 的堆栈
#     但 api/main.py 顶部已经做了更友好的"怎么装依赖"提示，所以直接透传即可
try:
    from api.main import app  # noqa: F401
except ImportError as _e:
    # 最终兜底：按绝对路径动态 import api/main.py 文件本身（彻底绕过包结构/目录问题）
    try:
        import importlib.util as _ilu

        _spec = _ilu.spec_from_file_location(
            "earth_api_main", str(_API_DIR / "main.py")
        )
        if _spec is None or _spec.loader is None:
            raise _e
        _real_main = _ilu.module_from_spec(_spec)
        sys.modules["earth_api_main"] = _real_main
        _spec.loader.exec_module(_real_main)
        app = _real_main.app  # noqa: F401
    except Exception:
        # 如果还是失败，把"为什么失败 + 怎么正确启动"打印到最显眼位置然后再抛
        sys.stderr.write(
            "\n"
            + "=" * 72
            + "\n[earth-api] ❌ 无法导入 FastAPI app："
            + str(_e)
            + "\n[earth-api] 💡 推荐的正确启动命令（任选其一，都已自动处理路径）："
            + "\n[earth-api]    ① make api"
            + "\n[earth-api]    ② ./earth-api --reload"
            + "\n[earth-api]    ③ cd "
            + str(_API_DIR)
            + " && source .venv/bin/activate && uvicorn main:app --port 8787 --reload"
            + "\n"
            + "=" * 72
            + "\n"
        )
        raise

# 给启动日志加一行肉眼可见的锚点，证明代理入口生效了（不影响生产）
if __name__ == "__main__":
    print(f"[earth-api] 🚪 通过仓库根代理入口启动（真实入口 = {_API_DIR / 'main.py'}）")
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8787, reload=True)
