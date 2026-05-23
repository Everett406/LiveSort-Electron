"""
Build the Python backend into a standalone executable using PyInstaller.
This script is invoked by GitHub Actions before building the Electron app.
"""
import PyInstaller.__main__
import os
import sys
import platform

IS_WIN = platform.system() == "Windows"
SEP = os.pathsep

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(BASE_DIR, "LiveSortApp")

def main():
    args = [
        os.path.join(APP_DIR, "prod.py"),
        "--name", "livesort-backend",
        "--distpath", os.path.join(BASE_DIR, "bin"),
        "--workpath", os.path.join(BASE_DIR, "build", "pyinstaller"),
        "--specpath", os.path.join(BASE_DIR, "build"),
        "--noconfirm",
        "--clean",
        # Data files
        f"--add-data={os.path.join(APP_DIR, 'templates')}{SEP}templates",
        f"--add-data={os.path.join(APP_DIR, 'static')}{SEP}static",
        # Application modules (critical: prod.py imports these dynamically via uvicorn)
        "--hidden-import=main",
        "--hidden-import=audio_analyzer",
        # Uvicorn / FastAPI hidden imports
        "--hidden-import=uvicorn.logging",
        "--hidden-import=uvicorn.loops.auto",
        "--hidden-import=uvicorn.protocols.http.auto",
        "--hidden-import=uvicorn.protocols.websockets.auto",
        "--hidden-import=uvicorn.lifespan.on",
        "--hidden-import=jinja2.ext",
        "--hidden-import=pydantic.deprecated.decorator",
        "--hidden-import=mutagen",
        "--hidden-import=numpy",
        "--hidden-import=scipy",
        "--hidden-import=librosa",
        "--hidden-import=soundfile",
        "--hidden-import=numba",
        "--hidden-import=sklearn",
        "--hidden-import=matplotlib",
        "--hidden-import=matplotlib.backends.backend_agg",
        # Collect entire packages (heavy but reliable for scientific libs)
        "--collect-all=numba",
        "--collect-all=llvmlite",
        "--collect-all=librosa",
        "--collect-all=soundfile",
        "--collect-all=sklearn",
        "--collect-all=mutagen",
        "--collect-all=matplotlib",
        "--collect-all=numpy",
        "--collect-all=scipy",
    ]

    # Windows-specific: collect all for packages that ship DLLs
    if IS_WIN:
        args.append("--collect-all=sklearn.utils")

    print("Running PyInstaller with args:")
    for a in args:
        print("  ", a)

    PyInstaller.__main__.run(args)
    print("PyInstaller build completed.")


if __name__ == "__main__":
    main()
