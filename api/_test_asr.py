"""临时测试：连接后端 /ws/asr，模拟前端 start 握手，观察后端是否连上火山并返回 ready。"""
import asyncio, json, sys
import websockets

async def main():
    uri = "ws://127.0.0.1:8787/ws/asr"
    print("连接:", uri)
    try:
        async with websockets.connect(uri) as ws:
            await ws.send(json.dumps({
                "type": "start",
                "audio": {
                    "format": "pcm", "codec": "raw", "rate": 16000,
                    "channels": 1, "sample_width": 2, "bits": 16,
                    "is_float": False, "is_little_endian": True,
                },
            }))
            print("已发送 start，等待 ready...")
            for _ in range(10):
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=8)
                    print("收到:", msg)
                    if isinstance(msg, str):
                        try:
                            obj = json.loads(msg)
                            if obj.get("type") == "ready":
                                print(">>> READY 收到，asr =", obj.get("asr"))
                                break
                        except Exception:
                            pass
                except asyncio.TimeoutError:
                    print(">>> 超时未收到 ready")
                    break
            # 发送一段静音 PCM（16k mono int16 LE）模拟录音
            import struct
            silence = struct.pack("<%dh" % 1600, *([0] * 1600))
            await ws.send(silence)
            await asyncio.sleep(1)
            # 结束
            try:
                await ws.send(json.dumps({"type": "end"}))
            except Exception:
                pass
            await asyncio.sleep(1)
    except Exception as e:
        print(">>> 连接失败:", type(e).__name__, e)
        sys.exit(1)

asyncio.run(main())