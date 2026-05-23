# main.py
import asyncio
import json
import sys
import websockets

# Import our AudioEngine class
from server.engine import AudioEngine

class ACTAMServer:
    """Handles WebSocket communication and routes messages to the Engine."""
    def __init__(self, host="localhost", port=8765):
        self.host = host
        self.port = port
        self.engine = AudioEngine()

    async def ws_handler(self, ws):
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                    kind = msg.get('type')
                    
                    if kind == 'note_on':
                        # Add msg.get('vst') to pass the instrument name
                        self.engine.note_on(msg['id'], msg['freq'], msg.get('vst'))
                    elif kind == 'note_off':
                        self.engine.note_off(msg['id'])
                    elif kind == 'switch':
                        self.engine.set_vst(msg.get('vst', 'piano'))
                    elif kind == 'param':
                        self.engine.update_param(msg['name'], float(msg['val']))
                    elif kind == 'param':
                        self.engine.update_param(msg['name'], float(msg['val']))
                    # --- ADD THESE LINES ---
                    elif kind == 'start_recording':
                        self.engine.start_recording(msg.get('format', 'wav'))
                    elif kind == 'stop_recording':
                        self.engine.stop_recording()
                    elif kind == 'stop_recording':
                        self.engine.stop_recording()
                    
                    # --- ADD THIS NEW BLOCK ---
                    elif kind == 'quit':
                        import os
                        print("🛑 Received Quit Command from frontend. Shutting down...")
                        os._exit(0) # Immediately terminates the python server & releases the audio device
                except Exception:
                    pass
        except websockets.exceptions.ConnectionClosed:
            pass

    async def start(self):
        self.engine.start()
        async with websockets.serve(self.ws_handler, self.host, self.port):
            print(f"🌐 Server Active → ws://{self.host}:{self.port}")
            await asyncio.Future()

if __name__ == '__main__':
    if sys.platform == 'win32': 
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        
    server = ACTAMServer()
    asyncio.run(server.start())
