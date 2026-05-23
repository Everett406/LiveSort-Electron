import uvicorn
import sys
import os

# Ensure module import works when bundled by PyInstaller
if getattr(sys, 'frozen', False):
    bundle_dir = os.path.dirname(sys.executable)
    if bundle_dir not in sys.path:
        sys.path.insert(0, bundle_dir)

try:
    from main import app
except Exception as e:
    print(f"Failed to import main.app: {e}", file=sys.stderr)
    app = None

if __name__ == "__main__":
    if app is None:
        raise RuntimeError("main.app could not be imported")
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=False, log_level="info")
