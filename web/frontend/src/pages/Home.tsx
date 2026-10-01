import { useEffect, useRef, useState } from 'react'

const BUTTON = 'flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-md border px-5 text-sm font-medium tracking-wide transition-colors'

const DOWNLOADS = [

  { label: 'GraniteOS 1', href: '/downloads/graniteos-1.zip', download: true },
  { label: 'GraniteOS 2', href: '/downloads/graniteos-2.zip', download: true },
  {
    label: 'Windows Launcher',
    href: 'https://github.com/elucid503/GraniteOS-2/releases/tag/Launcher',
    download: false,
  },

]

export default function Home() {

  return (

    <div className="relative min-h-screen overflow-hidden bg-zinc-950 font-mono">

      <main className="relative flex min-h-screen flex-col items-center justify-center px-6 py-20">

        <h1 className="text-center text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl">
          The GraniteOS Project
        </h1>

        <p className="mt-6 max-w-2xl text-center text-sm leading-7 text-zinc-400 sm:text-base sm:leading-8">
          The GraniteOS project aims to make functional, educational and fully open-source operating systems. The first
          is a small monolithic kernel with a shell; the second is a capability-based microkernel
          that runs its filesystem, drivers, network stack, and desktop as user processes.
        </p>

        <nav className="mt-12 flex w-full max-w-md flex-col items-stretch gap-3 sm:w-auto sm:max-w-none sm:flex-row">

          <a
            href="#/try"
            className={`${BUTTON} border-zinc-300 bg-zinc-200 text-zinc-900 hover:bg-white`}
          >
            Try GraniteOS
          </a>

          <DownloadMenu />

        </nav>

      </main>

      <footer className="absolute inset-x-0 bottom-0 flex text-center items-center justify-center gap-6 px-6 py-6 text-xs text-zinc-600">
        <a
          href="https://github.com/elucid503/GraniteOS"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-zinc-400"
        >
          GraniteOS 1 Source Code
        </a>
        <a
          href="https://github.com/elucid503/GraniteOS-2"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-zinc-400"
        >
          GraniteOS 2 Source Code
        </a>
      </footer>

    </div>

  )

}

function DownloadMenu() {

  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {

    if (!open) return

    const onPointerDown = (event: PointerEvent) => {

      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)

    }

    const onKeyDown = (event: KeyboardEvent) => {

      if (event.key === 'Escape') setOpen(false)

    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)

    return () => {

      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)

    }

  }, [open])

  return (

    <div ref={containerRef} className="relative">

      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`${BUTTON} w-full border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100`}
      >

        Download A Release

        <span
          className={`text-lg leading-none text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          ▾
        </span>

      </button>

      {open && (

        <div
          role="menu"
          className="absolute left-0 right-0 top-full z-10 mt-2 overflow-hidden rounded-md border border-zinc-800 bg-zinc-900 shadow-lg shadow-black/40"
        >

          {DOWNLOADS.map((download) => (

            <a
              key={download.href}
              role="menuitem"
              href={download.href}
              {...(download.download
                ? { download: true }
                : { target: '_blank', rel: 'noopener noreferrer' })}
              onClick={() => setOpen(false)}
              className="block px-5 py-2.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              {download.label}
            </a>

          ))}

        </div>

      )}

    </div>

  )

}
