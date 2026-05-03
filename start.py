import subprocess
import webbrowser
import time
import os
import sys

def run_project():
    print("🚀 Starting ACTAM Pro Audio Server...")
    print("⏳ Please wait while instruments are generated (this may take a moment)...")
    
    # 1. Start the server in the background
    # We use sys.executable to ensure it uses your current Python environment
    server_process = subprocess.Popen([sys.executable, "main.py"])
    
    # 2. Wait for the server to precompute instruments and open the WebSocket
    # If your computer needs more time to generate the audio, increase this number
    time.sleep(5) 
    
    # 3. Get the exact path to your HTML file and open it in the default browser
    html_path = f"file://{os.path.abspath('index.html')}"
    print(f"🌐 Opening interface at: {html_path}")
    webbrowser.open(html_path)
    
    # 4. Keep this script alive until you press Ctrl+C
    try:
        print("\n✅ System running! Press Ctrl+C in this terminal to shut down.")
        server_process.wait()
    except KeyboardInterrupt:
        print("\n🛑 Shutting down ACTAM Pro Server...")
        server_process.terminate()

if __name__ == '__main__':
    run_project()