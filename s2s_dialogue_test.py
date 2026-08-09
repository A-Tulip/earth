"""端到端 S2S 对话链路测试：本地代理 -> 火山 Realtime API
验证：握手 -> StartConnection -> StartSession -> 文本query -> 模型回复 + TTS 音频
"""
import sys
import asyncio, json, struct, uuid
import websockets

WS = sys.argv[1] if len(sys.argv) > 1 else "ws://127.0.0.1:8787/ws/s2s"

def build_event_frame(event_id, payload_json, session_id=None):
    head = bytes([0x11, 0x14, 0x10, 0x00])
    ev = struct.pack(">I", event_id)
    parts = [head, ev]
    if session_id:
        sid = session_id.encode()
        parts.append(struct.pack(">I", len(sid)))
        parts.append(sid)
    payload = payload_json.encode()
    parts.append(struct.pack(">I", len(payload)))
    parts.append(payload)
    return b"".join(parts)

def parse_full_server(buf):
    if len(buf) < 4:
        return None
    b1 = buf[1]
    msg_type = (b1 >> 4) & 0x0f
    flags = b1 & 0x0f
    off = 4
    event_id = None
    if msg_type == 0b1001:
        if flags & 0b0100:
            event_id = struct.unpack(">I", buf[off:off+4])[0]
            off += 4
        elif flags & 0b0001 or flags in (0b0010, 0b0011):
            off += 4
        if off + 4 <= len(buf):
            sid_size = struct.unpack(">I", buf[off:off+4])[0]
            off += 4 + sid_size
        if off + 4 <= len(buf):
            size = struct.unpack(">I", buf[off:off+4])[0]
            off += 4
            return event_id, buf[off:off+size]
    return None

def parse_audio(buf):
    b1 = buf[1]
    msg_type = (b1 >> 4) & 0x0f
    flags = b1 & 0x0f
    if msg_type == 0b1011:
        off = 4
        if flags & 0b0001 or flags in (0b0010, 0b0011):
            off += 4
        size = struct.unpack(">I", buf[off:off+4])[0]
        off += 4
        return buf[off:off+size]
    return None

async def main():
    async with websockets.connect(WS, open_timeout=15) as ws:
        ready = json.loads(await asyncio.wait_for(ws.recv(), 10))
        print("STEP1 HANDSHAKE:", ready)
        if not ready.get("s2s"):
            print("S2S 后端未配置，abort")
            return

        await ws.send(build_event_frame(1, "{}"))
        print("STEP2 StartConnection sent")

        ev_id = None
        for _ in range(10):
            buf = await asyncio.wait_for(ws.recv(), 10)
            r = parse_full_server(buf)
            if r:
                ev_id, payload = r
                print(f"STEP3 server event {ev_id}: {payload[:120]}")
                if ev_id == 50:
                    break
        if ev_id != 50:
            print("未收到 ConnectionStarted(50)，abort")
            return

        session_id = str(uuid.uuid4())
        start_payload = {
            "asr": {"extra": {"end_smooth_window_ms": 1500,
                              "enable_custom_vad": True, "enable_asr_twopass": False,
                              "enable_punc": True, "enable_itn": True}},
            "dialog": {"bot_name": "地理助教",
                       "system_role": "你是地理助教，回答简洁准确。",
                       "speaking_style": "简洁、亲切",
                       "extra": {"model": "O", "strict_audit": False}},
            "tts": {"audio_config": {"channel": 1, "format": "pcm_s16le", "sample_rate": 24000}},
        }
        await ws.send(build_event_frame(100, json.dumps(start_payload), session_id))
        print("STEP4 StartSession sent")

        ev_id = None
        for _ in range(10):
            buf = await asyncio.wait_for(ws.recv(), 10)
            r = parse_full_server(buf)
            if r:
                ev_id, payload = r
                print(f"STEP5 server event {ev_id}: {payload[:200]}")
                if ev_id == 150:
                    break
        if ev_id != 150:
            print("未收到 SessionStarted(150)，abort")
            return

        print("STEP6 sending ChatTextQuery...")
        await ws.send(build_event_frame(501, json.dumps({"content": "请介绍一下长江"}), session_id))

        print("STEP7 collecting events (wait for model reply + TTS audio)...")
        audio_received = 0
        events_seen = []
        try:
            while True:
                buf = await asyncio.wait_for(ws.recv(), 10)
                r = parse_full_server(buf)
                if r:
                    ev_id, payload = r
                    if ev_id == 352:
                        # TTSResponse 音频（payload 为二进制）
                        audio_received += 1
                        print(f"EVENT352 AUDIO frame {audio_received}: {len(payload)} bytes")
                        if audio_received >= 3:
                            break
                        continue
                    txt = ""
                    try:
                        txt = payload.decode()[:120]
                    except Exception:
                        txt = f"<binary {len(payload)}B>"
                    events_seen.append(ev_id)
                    print(f"event {ev_id}: {txt}")
                    if ev_id in (152, 559):
                        # ChatEnded 后继续等音频，不 break
                        print("  (ChatEnded/SessionEnded, keep listening for audio)")
                        continue
                else:
                    audio = parse_audio(buf)
                    if audio is not None:
                        audio_received += 1
                        print(f"0b1011 AUDIO frame {audio_received}: {len(audio)} bytes")
                        if audio_received >= 3:
                            break
        except asyncio.TimeoutError:
            print("TIMEOUT waiting for events")

        print("\n===== RESULT =====")
        print(f"events_seen: {events_seen}")
        print(f"audio_received: {audio_received}")

asyncio.run(main())