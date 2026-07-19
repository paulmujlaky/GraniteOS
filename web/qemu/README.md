# QEMU Web Display

The WebAssembly display frontend sends QEMU dirty rectangles directly to a
browser `BroadcastChannel`. The browser uploads those rectangles to WebGL and
returns keyboard, tablet, button, wheel, and resize events over the same
channel. It does not include SDL, VNC, or an intermediate display protocol.

The patch targets `ktock/qemu-wasm` commit
`0ef7b4e2814b231705d8371dd7997f5b72e70baf`. From the `web` directory, run:

```sh
./scripts/build-qemu.sh
```

The script fetches the pinned QEMU source into a temporary directory, creates
the Docker toolchain image when necessary, and runs the build in an ephemeral
container. Output is written to `frontend/public/qemu/wasm`.

## Networking

The build already includes QEMU's `socket` netdev and `virtio-net-device`.
GraniteOS connects that netdev to `/network` through Emscripten's WebSocket
socket shim. A `--pre-js` hook configures the same-origin `ws:` or `wss:` URL in
both the browser page and Emscripten's proxied pthread. The Go web server creates
an isolated gVisor user-mode network for each browser VM and forwards its TCP,
UDP, and DNS traffic through the server.

The proxy deliberately presents the same static slirp-compatible network used
by GraniteOS 2: guest `10.0.2.15`, gateway `10.0.2.2`, and DNS `10.0.2.3`.
Rebuild QEMU-WASM after changing the hook or other networking build settings.

### Deployment security

The `/network` endpoint makes outbound connections from the web server's network
namespace on behalf of the guest. For a public deployment, run the server in an
isolated container or network and apply egress rules that prevent access to private
or otherwise sensitive destinations.
