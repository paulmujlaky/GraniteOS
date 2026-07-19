import { useEffect, useRef, useState } from 'react'
import { openpty } from 'xterm-pty'
import { DisplayClient } from '../lib/display'
import { startGranite2, stopQemu } from '../lib/qemu'
import type { QemuModule } from '../lib/qemu'

export default function Desktop() {

  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cursorRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<string | null>('Preparing GraniteOS 2...')

  useEffect(() => {

    const viewport = viewportRef.current
    const canvas = canvasRef.current
    const cursor = cursorRef.current

    if (!viewport || !canvas || !cursor) return

    let active = true
    let qemu: QemuModule | null = null
    let resizeFrame = 0

    const channel = `graniteos-display-${crypto.randomUUID()}`
    const display = new DisplayClient(channel, canvas, cursor, (message) => {

      if (active) setStatus(message)

    })
    const { master, slave } = openpty()
    const serial = master.onWrite(([, acknowledge]) => acknowledge())

    const resize = () => {

      cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(() => {

        const rect = viewport.getBoundingClientRect()
        display.sendResize(rect.width, rect.height)

      })

    }

    const observer = new ResizeObserver(resize)
    const onReady = () => resize()
    const onKeyDown = (event: KeyboardEvent) => display.key(event, true)
    const onKeyUp = (event: KeyboardEvent) => display.key(event, false)
    const onBlur = () => display.releaseKeys()
    const onPointerMove = (event: PointerEvent) => display.pointer(event)
    const onPointerLeave = () => display.pointerLeave()
    const onPointerDown = (event: PointerEvent) => {

      viewport.focus()
      viewport.setPointerCapture(event.pointerId)
      display.pointer(event)
      display.button(event.button, true)

    }
    const onPointerUp = (event: PointerEvent) => {

      display.pointer(event)
      display.button(event.button, false)

    }
    const onWheel = (event: WheelEvent) => {

      event.preventDefault()
      display.wheel(event.deltaY)

    }
    const onContextMenu = (event: MouseEvent) => event.preventDefault()

    observer.observe(viewport)
    viewport.addEventListener('keydown', onKeyDown)
    viewport.addEventListener('keyup', onKeyUp)
    viewport.addEventListener('blur', onBlur)
    viewport.addEventListener('pointermove', onPointerMove)
    viewport.addEventListener('pointerleave', onPointerLeave)
    viewport.addEventListener('pointerdown', onPointerDown)
    viewport.addEventListener('pointerup', onPointerUp)
    viewport.addEventListener('wheel', onWheel, { passive: false })
    viewport.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('granite-display-ready', onReady)

    startGranite2(slave, channel, (message) => {

      if (active) setStatus(message)

    }).then((module) => {

      if (!active) {

        void stopQemu(module)
        return

      }

      qemu = module

    }).catch((err: unknown) => {

      console.error('[desktop] QEMU failed:', err)

      if (active) {

        const detail = err instanceof Error ? err.message : String(err)
        setStatus(`GraniteOS 2 failed: ${detail}`)

      }

    })

    return () => {

      active = false
      cancelAnimationFrame(resizeFrame)
      observer.disconnect()
      viewport.removeEventListener('keydown', onKeyDown)
      viewport.removeEventListener('keyup', onKeyUp)
      viewport.removeEventListener('blur', onBlur)
      viewport.removeEventListener('pointermove', onPointerMove)
      viewport.removeEventListener('pointerleave', onPointerLeave)
      viewport.removeEventListener('pointerdown', onPointerDown)
      viewport.removeEventListener('pointerup', onPointerUp)
      viewport.removeEventListener('wheel', onWheel)
      viewport.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('granite-display-ready', onReady)
      serial.dispose()
      master.dispose()
      display.close()
      void stopQemu(qemu)

    }

  }, [])

  return (

    <div
      ref={viewportRef}
      tabIndex={0}
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black outline-none"
      aria-label="GraniteOS 2 desktop"
    >

      <div className="relative max-h-full max-w-full">

        <canvas
          ref={canvasRef}
          className="block max-h-full max-w-full cursor-none"
          width={1280}
          height={720}
        />

        <canvas
          ref={cursorRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
          width={1280}
          height={720}
        />

      </div>

      {status && (

        <div className="absolute rounded border border-zinc-800 bg-zinc-950/90 px-4 py-3 text-sm text-zinc-400 shadow-xl">

          {status}

        </div>

      )}

    </div>

  )

}
