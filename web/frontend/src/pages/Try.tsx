import { useState } from 'react'
import Terminal from '../components/Terminal'
import Desktop from '../components/Desktop'

type Tab = 'graniteos-1' | 'graniteos-2'

/** True for iPhone/iPad/iPod, including iPadOS that reports as desktop Safari. */
function isIOS(): boolean {

  if (typeof navigator === 'undefined') return false
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true

  // iPadOS 13+ masquerades as MacIntel with touch
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1

}

function tabFromQuery(): Tab {

  // `?v=2` works either on the URL itself or on the route fragment.
  const fragment = window.location.hash.split('?')[1] ?? ''
  const version =
    new URLSearchParams(fragment).get('v') ?? new URLSearchParams(window.location.search).get('v')

  if (version === '2' && !isIOS()) return 'graniteos-2'

  return 'graniteos-1'

}

export default function Try() {

  const ios = isIOS()
  const [tab, setTab] = useState<Tab>(tabFromQuery)

  return (

    <div className="flex flex-col h-screen bg-zinc-950 font-mono overflow-hidden">

      <header className="flex shrink-0 border-b border-zinc-800">

        <a
          href="#/"
          title="Back to graniteos.org"
          className="flex items-center px-4 py-2.5 text-sm font-semibold tracking-wide text-zinc-500 transition-colors hover:bg-zinc-900/40 hover:text-zinc-300"
        >
          ←
        </a>

        <button
          type="button"
          onClick={() => setTab('graniteos-1')}
          className={`flex-1 border-l border-zinc-800 py-2.5 text-sm font-semibold tracking-wide transition-colors ${
            tab === 'graniteos-1'
              ? 'bg-zinc-900/70 text-zinc-200 border-b border-b-zinc-600'
              : 'bg-zinc-950 text-zinc-500 hover:text-zinc-400 hover:bg-zinc-900/40'
          }`}
        >
          GraniteOS 1
        </button>

        <button
          type="button"
          onClick={() => !ios && setTab('graniteos-2')}
          disabled={ios}
          title={ios ? 'GraniteOS 2 is not available on iOS Safari' : undefined}
          className={`flex-1 border-l border-zinc-800 py-2.5 text-sm font-semibold tracking-wide transition-colors ${
            ios
              ? 'bg-zinc-950 text-zinc-700 cursor-not-allowed'
              : tab === 'graniteos-2'
                ? 'bg-zinc-900/70 text-zinc-200 border-b border-b-zinc-600'
                : 'bg-zinc-950 text-zinc-500 hover:text-zinc-400 hover:bg-zinc-900/40'
          }`}
        >
          GraniteOS 2
        </button>

      </header>

      <main className="flex-1 min-h-0">

        {tab === 'graniteos-1' && <Terminal key="graniteos-1" />}
        {tab === 'graniteos-2' && !ios && <Desktop key="graniteos-2" />}

      </main>

    </div>

  )

}
