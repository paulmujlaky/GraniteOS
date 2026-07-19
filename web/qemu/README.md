# QEMU Web Display

The WebAssembly display frontend sends QEMU dirty rectangles directly to a
browser `BroadcastChannel`. The browser uploads those rectangles to WebGL and
returns keyboard, tablet, button, wheel, and resize events over the same
channel. It does not include SDL, VNC, or an intermediate display protocol.

The patch targets `ktock/qemu-wasm` commit
`0ef7b4e2814b231705d8371dd7997f5b72e70baf`. Build it from a clean checkout:

```powershell
.\scripts\build-qemu.ps1 -Source C:\path\to\qemu-wasm
```

The build runs inside an ephemeral container and leaves the QEMU source tree
unchanged. Output is written to `frontend/public/qemu/wasm`.
