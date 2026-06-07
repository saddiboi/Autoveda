# PyInstaller spec — bundles the FastAPI backend into a standalone executable so
# the packaged Electron app can launch it without a system Python.
# Build via: npm run build:backend   (used by `npm run dist`).

import os

block_cipher = None
here = SPECPATH  # directory containing this spec, injected by PyInstaller

a = Analysis(
    [os.path.join(here, "main.py")],
    pathex=[here],
    binaries=[],
    datas=[],
    hiddenimports=[
        "uvicorn.logging",
        "uvicorn.loops.auto",
        "uvicorn.loops.asyncio",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan.on",
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    cipher=block_cipher,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="autoveda-backend",
    console=True,
    disable_windowed_traceback=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    name="autoveda-backend",
)
