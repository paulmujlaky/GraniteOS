// QEMU runs on Emscripten's proxied pthread. A pre-js hook is used instead of
// frontend Module configuration because arbitrary Module fields are not copied
// into that worker.
if (typeof location !== 'undefined') {
  var graniteWebSocketScheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  Module['websocket'] = {
    url: graniteWebSocketScheme + '//' + location.host + '/network',
    subprotocol: 'binary',
  };
}
