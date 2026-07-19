import { loadDisk, saveDisk } from './diskStore'

/** Emscripten Module shape used by QEMU Wasm. */
export interface QemuModule {

  arguments: string[]
  pty?: unknown
  diskKey?: string

  mainScriptUrlOrBlob?: string

  preRun?: Array<() => void>
  locateFile?: (path: string, prefix: string) => string

  addRunDependency?: (id: string) => void
  removeRunDependency?: (id: string) => void

  FS_createPath?: (parent: string, path: string, canRead: boolean, canWrite: boolean) => void
  FS_createDataFile?: (parent: string, name: string | null, data: Uint8Array, canRead: boolean, canWrite: boolean, canOwn: boolean) => void

  FS?: {
    readFile: (path: string, opts?: { encoding?: string }) => Uint8Array
  }

  PThread?: { terminateAllThreads: () => void }
  HEAP32?: Int32Array
  HEAPU8?: Uint8Array

  TTY?: {

    stream_ops: {

      poll: (stream: unknown, timeout: number) => number

    }

  }

}

declare global {

  interface Window {

    Module?: QemuModule

  }

}

// Single emulated core to reduce host CPU.
const QEMU_ARGS = [

  '-machine', 'virt',
  '-cpu', 'cortex-a57',
  '-smp', '1',
  '-m', '256M',
  '-display', 'none',
  '-nographic',
  '-accel', 'tcg,tb-size=500',
  '-nic', 'none',
  '-kernel', '/pack/kernel',
  '-drive', 'file=/pack/disk.img,format=raw,if=none,id=hd0',
  '-device', 'virtio-blk-device,drive=hd0',

] as const

async function fetchAsset(url: string, label: string): Promise<ArrayBuffer> {

  const res = await fetch(url)
  if (!res.ok) throw new Error(`${label}: ${res.status}`)

  return res.arrayBuffer()

}

function preloadAssets(module: QemuModule, kernel: ArrayBuffer, disk: Uint8Array) {

  const orig = module.preRun ?? []

  module.preRun = [...orig, () => {

    module.FS_createPath?.('/', 'pack', true, true)
    module.FS_createDataFile?.('/pack', 'kernel', new Uint8Array(kernel), true, true, true)
    module.FS_createDataFile?.('/pack', 'disk.img', disk, true, true, true)

  }]

}

function patchTtyPoll(module: QemuModule) {

  const ops = module.TTY!.stream_ops
  const oldPoll = ops.poll.bind(ops)

  const pty = module.pty

  ops.poll = (stream, timeout) => {

    if (pty && typeof pty === 'object' && 'readable' in pty && !(pty as { readable: boolean }).readable) {

      const p = pty as { readable: boolean; writable: boolean }
      return (p.readable ? 1 : 0) | (p.writable ? 4 : 0)

    }

    return oldPoll(stream, timeout)

  }

}

function readDiskFromFs(module: QemuModule): Uint8Array | null {

  try {

    return module.FS?.readFile('/pack/disk.img') ?? null

  } catch {

    return null

  }

}

/** Persist the current disk state to IndexedDB, then tear down QEMU Wasm workers. */
export async function stopQemu(module: QemuModule | null): Promise<void> {

  if (!module) return

  const disk = readDiskFromFs(module)

  if (disk) {

    try {

      await saveDisk(disk, module.diskKey)

    } catch (err) {

      console.warn('[qemu] failed to persist disk:', err)

    }

  }

  try {

    module.PThread?.terminateAllThreads()

  } catch {

    // already stopped

  }

  if (window.Module === module) delete window.Module

}

/** Load QEMU Wasm, preload kernel + disk, and start the VM. */
export async function startQemu(pty: unknown, onProgress: (msg: string) => void): Promise<QemuModule> {

  onProgress('Loading assets...')

  const [kernel, cachedDisk] = await Promise.all([

    fetchAsset('/assets/kernel', 'kernel'),
    loadDisk(),

  ])

  let disk: Uint8Array

  if (cachedDisk) {

    onProgress('Restoring saved disk...')
    disk = cachedDisk

  } else {

    onProgress('Downloading disk image...')
    const raw = await fetchAsset('/assets/disk.img', 'disk image')
    disk = new Uint8Array(raw)

    try {

      await saveDisk(disk)

    } catch (err) {

      console.warn('[qemu] failed to cache disk:', err)

    }

  }

  onProgress('Downloading QEMU emulator...')

  const module: QemuModule = {

    arguments: [...QEMU_ARGS],
    pty,

    mainScriptUrlOrBlob: `${location.origin}/qemu/out.js`,

    locateFile: (path) => `/qemu/${path}`,

  }

  preloadAssets(module, kernel, disk)
  window.Module = module

  onProgress('Starting GraniteOS...')

  const url = `${location.origin}/qemu/out.js`

  const { default: init } = await import(/* @vite-ignore */ url) as {

    default: (m: QemuModule) => Promise<void>

  }

  await init(module)
  patchTtyPoll(module)

  return module

}

const GRANITE2_DISK_KEY = 'graniteos-2-disk.img'
const GRANITE2_QEMU_BUILD = 'full-reconcile-1'

function preloadGranite2(module: QemuModule, kernel: ArrayBuffer, bundle: ArrayBuffer, disk: Uint8Array) {

  const orig = module.preRun ?? []

  module.preRun = [...orig, () => {

    module.FS_createPath?.('/', 'pack', true, true)
    module.FS_createDataFile?.('/pack', 'granite-kernel.bin', new Uint8Array(kernel), true, true, true)
    module.FS_createDataFile?.('/pack', 'bundle.img', new Uint8Array(bundle), true, true, true)
    module.FS_createDataFile?.('/pack', 'disk.img', disk, true, true, true)

  }]

}

/** Load the GUI GraniteOS 2 image with the native browser display backend. */
export async function startGranite2(
  pty: unknown,
  channel: string,
  onProgress: (msg: string) => void,
): Promise<QemuModule> {

  onProgress('Loading GraniteOS 2 assets...')

  const [kernel, bundle, cachedDisk] = await Promise.all([

    fetchAsset('/assets/gos2/granite-kernel.bin', 'GraniteOS 2 kernel'),
    fetchAsset('/assets/gos2/bundle.img', 'GraniteOS 2 bundle'),
    loadDisk(GRANITE2_DISK_KEY),

  ])

  let disk: Uint8Array

  if (cachedDisk) {

    onProgress('Restoring the GraniteOS 2 disk...')
    disk = cachedDisk

  } else {

    onProgress('Loading the GraniteOS 2 disk...')
    disk = new Uint8Array(await fetchAsset('/assets/gos2/disk.img', 'GraniteOS 2 disk'))

    try {

      await saveDisk(disk, GRANITE2_DISK_KEY)

    } catch (err) {

      console.warn('[qemu] failed to cache the GraniteOS 2 disk:', err)

    }

  }

  onProgress('Loading the WebAssembly emulator...')

  const args = [

    '-machine', 'virt,gic-version=3',
    '-cpu', 'cortex-a57',
    '-smp', '1',
    '-m', '256M',
    '-global', 'virtio-mmio.force-legacy=false',
    '-display', `wasm,channel=${channel}`,
    '-serial', 'stdio',
    '-monitor', 'none',
    '-accel', 'tcg,tb-size=128',
    '-nic', 'none',
    '-kernel', '/pack/granite-kernel.bin',
    '-initrd', '/pack/bundle.img',
    '-drive', 'if=none,format=raw,id=granite-disk,file=/pack/disk.img',
    '-device', 'virtio-blk-device,drive=granite-disk',
    '-device', 'virtio-gpu-device',
    '-device', 'virtio-keyboard-device',
    '-device', 'virtio-tablet-device',

  ]

  const module: QemuModule = {

    arguments: args,
    pty,
    diskKey: GRANITE2_DISK_KEY,

    mainScriptUrlOrBlob: `${location.origin}/qemu/wasm/out.js?v=${GRANITE2_QEMU_BUILD}`,
    locateFile: (path) => `/qemu/wasm/${path}?v=${GRANITE2_QEMU_BUILD}`,

  }

  preloadGranite2(module, kernel, bundle, disk)
  window.Module = module

  onProgress('Starting GraniteOS 2...')

  const url = `${location.origin}/qemu/wasm/out.js?v=${GRANITE2_QEMU_BUILD}`
  const { default: init } = await import(/* @vite-ignore */ url) as {

    default: (m: QemuModule) => Promise<void>

  }

  await init(module)
  patchTtyPoll(module)

  return module

}
