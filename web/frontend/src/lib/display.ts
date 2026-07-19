type StatusHandler = (status: string | null) => void

interface CursorState {

  image: ImageData
  hotX: number
  hotY: number

}

const KEY_CODES: Record<string, number> = {

  Escape: 1,
  Digit1: 2,
  Digit2: 3,
  Digit3: 4,
  Digit4: 5,
  Digit5: 6,
  Digit6: 7,
  Digit7: 8,
  Digit8: 9,
  Digit9: 10,
  Digit0: 11,
  Minus: 12,
  Equal: 13,
  Backspace: 14,
  Tab: 15,
  KeyQ: 16,
  KeyW: 17,
  KeyE: 18,
  KeyR: 19,
  KeyT: 20,
  KeyY: 21,
  KeyU: 22,
  KeyI: 23,
  KeyO: 24,
  KeyP: 25,
  BracketLeft: 26,
  BracketRight: 27,
  Enter: 28,
  ControlLeft: 29,
  KeyA: 30,
  KeyS: 31,
  KeyD: 32,
  KeyF: 33,
  KeyG: 34,
  KeyH: 35,
  KeyJ: 36,
  KeyK: 37,
  KeyL: 38,
  Semicolon: 39,
  Quote: 40,
  Backquote: 41,
  ShiftLeft: 42,
  Backslash: 43,
  KeyZ: 44,
  KeyX: 45,
  KeyC: 46,
  KeyV: 47,
  KeyB: 48,
  KeyN: 49,
  KeyM: 50,
  Comma: 51,
  Period: 52,
  Slash: 53,
  ShiftRight: 54,
  NumpadMultiply: 55,
  AltLeft: 56,
  Space: 57,
  CapsLock: 58,
  F1: 59,
  F2: 60,
  F3: 61,
  F4: 62,
  F5: 63,
  F6: 64,
  F7: 65,
  F8: 66,
  F9: 67,
  F10: 68,
  NumLock: 69,
  ScrollLock: 70,
  Numpad7: 71,
  Numpad8: 72,
  Numpad9: 73,
  NumpadSubtract: 74,
  Numpad4: 75,
  Numpad5: 76,
  Numpad6: 77,
  NumpadAdd: 78,
  Numpad1: 79,
  Numpad2: 80,
  Numpad3: 81,
  Numpad0: 82,
  NumpadDecimal: 83,
  IntlBackslash: 86,
  F11: 87,
  F12: 88,
  NumpadEnter: 96,
  ControlRight: 97,
  NumpadDivide: 98,
  PrintScreen: 99,
  AltRight: 100,
  Home: 102,
  ArrowUp: 103,
  PageUp: 104,
  ArrowLeft: 105,
  ArrowRight: 106,
  End: 107,
  ArrowDown: 108,
  PageDown: 109,
  Insert: 110,
  Delete: 111,
  Pause: 119,
  MetaLeft: 125,
  MetaRight: 126,
  ContextMenu: 127,

}

const INPUT_EVENT_SIZE = 5
const INPUT_QUEUE_HEADER_SIZE = 2

const INPUT_TYPES: Record<string, number> = {

  key: 1,
  pointer: 2,
  button: 3,
  wheel: 4,
  resize: 5,

}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {

  const shader = gl.createShader(type)

  if (!shader) throw new Error('Unable to create a WebGL shader')

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {

    throw new Error(gl.getShaderInfoLog(shader) ?? 'WebGL shader compilation failed')

  }

  return shader

}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {

  const vertex = compileShader(gl, gl.VERTEX_SHADER, `#version 300 es
    out vec2 texturePoint;
    const vec2 positions[3] = vec2[3](
      vec2(-1.0, -1.0),
      vec2(3.0, -1.0),
      vec2(-1.0, 3.0)
    );
    void main() {
      vec2 position = positions[gl_VertexID];
      texturePoint = position * 0.5 + 0.5;
      gl_Position = vec4(position, 0.0, 1.0);
    }
  `)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float;
    uniform sampler2D displayTexture;
    in vec2 texturePoint;
    out vec4 outputColor;
    void main() {
      vec4 pixel = texture(displayTexture, vec2(texturePoint.x, 1.0 - texturePoint.y));
      outputColor = vec4(pixel.bgr, 1.0);
    }
  `)
  const program = gl.createProgram()

  if (!program) throw new Error('Unable to create the WebGL program')

  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {

    throw new Error(gl.getProgramInfoLog(program) ?? 'WebGL program linking failed')

  }

  return program

}

export class DisplayClient {

  private readonly channel: BroadcastChannel
  private readonly gl: WebGL2RenderingContext
  private readonly texture: WebGLTexture
  private readonly cursorContext: CanvasRenderingContext2D
  private readonly pressedKeys = new Set<number>()
  private readonly onStatus: StatusHandler

  private cursor: CursorState | null = null
  private cursorX = 0
  private cursorY = 0
  private cursorVisible = false
  private hasPointer = false
  private framePending = false
  private inputOffset = 0
  private inputCapacity = 0

  constructor(
    channelName: string,
    private readonly canvas: HTMLCanvasElement,
    private readonly cursorCanvas: HTMLCanvasElement,
    onStatus: StatusHandler,
  ) {

    this.onStatus = onStatus
    this.channel = new BroadcastChannel(channelName)

    const gl = canvas.getContext('webgl2', {

      alpha: false,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: false,

    })

    if (!gl) throw new Error('WebGL 2 is required for the GraniteOS display')

    const cursorContext = cursorCanvas.getContext('2d')

    if (!cursorContext) throw new Error('Unable to create the cursor canvas')

    const program = createProgram(gl)
    const texture = gl.createTexture()
    const vertexArray = gl.createVertexArray()

    if (!texture || !vertexArray) throw new Error('Unable to allocate WebGL display resources')

    gl.useProgram(program)
    gl.bindVertexArray(vertexArray)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.uniform1i(gl.getUniformLocation(program, 'displayTexture'), 0)

    this.gl = gl
    this.texture = texture
    this.cursorContext = cursorContext
    this.channel.onmessage = ({ data }) => this.receive(data)

  }

  close() {

    this.releaseKeys()
    this.channel.close()

  }

  sendResize(width: number, height: number) {

    this.send({

      type: 'resize',
      width: Math.max(640, Math.floor(width)),
      height: Math.max(400, Math.floor(height)),

    })

  }

  key(event: KeyboardEvent, down: boolean): boolean {

    const code = KEY_CODES[event.code]

    if (!code) return false

    event.preventDefault()

    if (down) {

      if (event.repeat || this.pressedKeys.has(code)) return true
      this.pressedKeys.add(code)

    } else {

      this.pressedKeys.delete(code)

    }

    this.send({ type: 'key', code, down })
    return true

  }

  releaseKeys() {

    for (const code of this.pressedKeys) {

      this.send({ type: 'key', code, down: false })

    }

    this.pressedKeys.clear()

  }

  pointer(event: PointerEvent) {

    const rect = this.canvas.getBoundingClientRect()

    if (!rect.width || !rect.height || !this.canvas.width || !this.canvas.height) return

    const x = Math.floor((event.clientX - rect.left) * this.canvas.width / rect.width)
    const y = Math.floor((event.clientY - rect.top) * this.canvas.height / rect.height)

    // Host position is authoritative; QEMU mouse_set often flashes (0,0).
    this.cursorX = x
    this.cursorY = y
    this.hasPointer = true
    this.drawCursor()
    this.send({ type: 'pointer', x, y })

  }

  pointerLeave() {

    this.hasPointer = false
    this.drawCursor()

  }

  button(button: number, down: boolean) {

    const mapped = button === 0 ? 0 : button === 1 ? 1 : button === 2 ? 2 : -1

    if (mapped >= 0) this.send({ type: 'button', button: mapped, down })

  }

  wheel(deltaY: number) {

    if (deltaY) this.send({ type: 'wheel', delta: deltaY < 0 ? -1 : 1 })

  }

  private send(message: Record<string, unknown>) {

    const heap = window.Module?.HEAP32
    const type = INPUT_TYPES[String(message.type)]

    if (!heap || !type || !this.inputOffset || this.inputCapacity < 2) return

    const queue = this.inputOffset >> 2
    const read = Atomics.load(heap, queue)
    const write = Atomics.load(heap, queue + 1)
    const next = (write + 1) % this.inputCapacity

    if (next === read) return

    const event = queue + INPUT_QUEUE_HEADER_SIZE + write * INPUT_EVENT_SIZE
    const values = type === INPUT_TYPES.key
      ? [type, Number(message.code), message.down ? 1 : 0, 0, 0]
      : type === INPUT_TYPES.pointer
        ? [type, Number(message.x), Number(message.y), 0, 0]
        : type === INPUT_TYPES.button
          ? [type, Number(message.button), message.down ? 1 : 0, 0, 0]
          : type === INPUT_TYPES.wheel
            ? [type, Number(message.delta), 0, 0, 0]
            : [type, Number(message.width), Number(message.height), 0, 0]

    for (let index = 0; index < INPUT_EVENT_SIZE; index++) {

      Atomics.store(heap, event + index, values[index])

    }

    Atomics.store(heap, queue + 1, next)

  }

  private receive(message: unknown) {

    if (!message || typeof message !== 'object') return

    const data = message as Record<string, unknown>

    if (data.source !== 'qemu') return

    switch (data.type) {
    case 'ready':
      this.inputOffset = Number(data.inputOffset)
      this.inputCapacity = Number(data.inputCapacity)
      this.onStatus('Waiting for the GraniteOS display...')
      window.dispatchEvent(new Event('granite-display-ready'))
      break
    case 'mode':
      this.setMode(Number(data.width), Number(data.height))
      break
    case 'frame':
      this.updateFrame(data)
      break
    case 'cursor':
      this.setCursor(data)
      break
    case 'cursor-position':
      // Shape/visibility from QEMU only; position comes from host pointer.
      this.cursorVisible = Boolean(data.visible)
      this.drawCursor()
      break
    }

  }

  private setMode(
    width: number,
    height: number,
  ) {

    if (
      !Number.isInteger(width) || !Number.isInteger(height) ||
      width <= 0 || height <= 0
    ) return

    this.canvas.width = width
    this.canvas.height = height
    this.cursorCanvas.width = width
    this.cursorCanvas.height = height
    this.gl.viewport(0, 0, width, height)
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture)
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      width,
      height,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      null,
    )
    this.scheduleFrame()
    this.drawCursor()

  }

  private updateFrame(data: Record<string, unknown>) {

    const x = Number(data.x)
    const y = Number(data.y)
    const width = Number(data.width)
    const height = Number(data.height)
    const pixels = data.pixels

    if (
      !(pixels instanceof Uint8Array) || pixels.length !== width * height * 4 ||
      !Number.isInteger(x) || !Number.isInteger(y) ||
      !Number.isInteger(width) || !Number.isInteger(height) ||
      x < 0 || y < 0 || width <= 0 || height <= 0 ||
      x + width > this.canvas.width || y + height > this.canvas.height
    ) return

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture)
    this.gl.texSubImage2D(
      this.gl.TEXTURE_2D,
      0,
      x,
      y,
      width,
      height,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      pixels,
    )
    this.scheduleFrame()
    this.onStatus(null)

  }

  private scheduleFrame() {

    if (this.framePending) return

    this.framePending = true
    requestAnimationFrame(() => {

      this.framePending = false
      this.gl.drawArrays(this.gl.TRIANGLES, 0, 3)

    })

  }

  private setCursor(data: Record<string, unknown>) {

    const pixels = data.pixels
    const width = Number(data.width)
    const height = Number(data.height)

    if (!(pixels instanceof Uint8Array) || pixels.length !== width * height * 4) return

    this.cursor = {

      image: new ImageData(new Uint8ClampedArray(pixels), width, height),
      hotX: Number(data.hotX),
      hotY: Number(data.hotY),

    }
    this.drawCursor()

  }

  private drawCursor() {

    this.cursorContext.clearRect(0, 0, this.cursorCanvas.width, this.cursorCanvas.height)

    if (this.cursor && this.cursorVisible && this.hasPointer) {

      this.cursorContext.putImageData(
        this.cursor.image,
        this.cursorX - this.cursor.hotX,
        this.cursorY - this.cursor.hotY,
      )

    }

  }

}
