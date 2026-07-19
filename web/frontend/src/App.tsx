import { useState } from 'react'
import Terminal from './components/Terminal'
import Desktop from './components/Desktop'

type Tab = 'graniteos-1' | 'graniteos-2'

export default function App() {

  const [tab, setTab] = useState<Tab>('graniteos-1')

  return (

    <div className="flex flex-col h-screen bg-zinc-950 font-mono overflow-hidden">

      <header className="flex shrink-0 border-b border-zinc-800">

        <button type="button" onClick={() => setTab('graniteos-1')}

          className={`flex-1 py-2.5 text-sm font-semibold tracking-wide transition-colors ${
            tab === 'graniteos-1'
              ? 'bg-zinc-900/70 text-zinc-200 border-b border-zinc-600'
              : 'bg-zinc-950 text-zinc-500 hover:text-zinc-400 hover:bg-zinc-900/40'
          }`}

        >

          GraniteOS 1

        </button>

        <button type="button" onClick={() => setTab('graniteos-2')}

          className={`flex-1 border-l border-zinc-800 py-2.5 text-sm font-semibold tracking-wide transition-colors ${
            tab === 'graniteos-2'
              ? 'bg-zinc-900/70 text-zinc-200 border-b border-zinc-600'
              : 'bg-zinc-950 text-zinc-500 hover:text-zinc-400 hover:bg-zinc-900/40'
          }`}

        >

          GraniteOS 2

        </button>

      </header>

      <main className="flex-1 min-h-0">

        {tab === 'graniteos-1' && <Terminal key="graniteos-1" />}
        {tab === 'graniteos-2' && <Desktop key="graniteos-2" />}

      </main>

    </div>

  )

}
