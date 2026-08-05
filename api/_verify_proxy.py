"""临时验证：通过后端 /ws/s2s 代理（.venv）完成 StartConnection+StartSession，确认收到 dialog_id。"""
import asyncio, json, struct, uuid
import websockets

SESSION_ID = uuid.uuid4().hex

def int32(n):
    return struct.pack('>I', n)

def frame(event_id, with_sid, payload: bytes):
    parts = [b'\x11\x14\x10\x00', int32(event_id)]
    if with_sid:
        sid = SESSION_ID.encode()
        parts += [int32(len(sid)), sid]
    parts += [int32(len(payload)), payload]
    return b''.join(parts)

async def main():
    async with websockets.connect('ws://127.0.0.1:8787/ws/s2s') as ws:
        ready = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
        print('READY:', ready)
        if not ready.get('s2s'):
            print('>>> S2S 未就绪')
            return
        await ws.send(frame(1, False, b'{}'))
        payload = json.dumps({
            'asr': {'extra': {'end_smooth_window_ms': 1500, 'enable_custom_vad': False}},
            'tts': {'audio_config': {'channel': 1, 'format': 'pcm_s16le', 'sample_rate': 24000},
                    'speaker': 'zh_female_vv_jupiter_bigtts', 'extra': {}},
            'dialog': {'bot_name': '地理助教', 'system_role': '你是地理助教',
                       'speaking_style': '温和', 'extra': {'model': '1.2.1.1'}},
        }).encode()
        await ws.send(frame(100, True, payload))
        for _ in range(4):
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=6)
                if not isinstance(msg, str) and b'dialog_id' in msg:
                    print('>>> ✅ 后端代理链路鉴权+会话成功')
                    return
            except asyncio.TimeoutError:
                print('(等待响应超时)')
                return
        print('>>> 未收到 dialog_id')

asyncio.run(main())