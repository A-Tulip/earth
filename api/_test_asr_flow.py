"""临时诊断脚本：直连本地 /ws/asr，验证 ASR 全链路是否真的能出结果。
仅用于诊断，运行后删除。"""
import asyncio, json, math, struct, sys
import websockets

async def main():
    uri = "ws://127.0.0.1:8787/ws/asr"
    print(f"连接 {uri} ...")
    async with websockets.connect(uri) as ws:
        # 1) start
        await ws.send(json.dumps({
            "type": "start",
            "audio": {"format": "pcm", "codec": "raw", "rate": 16000,
                      "channels": 1, "sample_width": 2, "bits": 16,
                      "is_float": False, "is_little_endian": True},
        }))
        # 读 ready / error
        print("等待 ready ...")
        try:
            ready = await asyncio.wait_for(ws.recv(), timeout=8)
            print("READY:", ready[:300])
        except asyncio.TimeoutError:
            print("TIMEOUT waiting ready")
            return
        if '"type": "error"' in ready or '"asr": false' in ready:
            print(">>> ASR 未真正就绪，链路无法继续")
            return

        # 2) 发送一段 16k sine pcm（约 1 秒，模拟语音）
        rate = 16000
        duration = 1.0
        pcm = bytearray()
        freq = 440.0
        for i in range(int(rate * duration)):
            sample = int(32767 * 0.3 * math.sin(2 * math.pi * freq * i / rate))
            # 小端 int16（前端 JS 端字节序）
            pcm += struct.pack("<h", sample)
        chunk = bytes(pcm)
        for i in range(0, len(chunk), 8000):
            await ws.send(chunk[i:i+8000])
        await asyncio.sleep(0.2)

        # 3) end
        await ws.send(json.dumps({"type": "end"}))
        print("已发送 end，等待结果 6s ...")

        # 4) 收集结果
        try:
            while True:
                msg = await asyncio.wait_for(ws.recv(), timeout=6)
                print("RECV:", msg[:200])
                if '"final"' in msg or '"type": "error"' in msg or '"upstream_closed"' in msg:
                    break
        except asyncio.TimeoutError:
            print("TIMEOUT waiting results")

if __name__ == "__main__":
    asyncio.run(main())