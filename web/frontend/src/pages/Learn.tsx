import { useEffect, useMemo, useRef, useState } from 'react'
import { renderReport } from '../lib/markdown'
import type { Section } from '../lib/markdown'

const REPORT = '/docs/GraniteOS2.md'

export default function Learn({ section }: { section: string }) {

  const [markdown, setMarkdown] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const report = useMemo(() => (markdown ? renderReport(markdown) : null), [markdown])
  const active = useActiveSection(report?.sections, contentRef)

  useEffect(() => {

    let live = true

    fetch(REPORT)
      .then((response) => (response.ok ? response.text() : Promise.reject(response.status)))
      .then((text) => live && setMarkdown(text))
      .catch(() => live && setFailed(true))

    return () => { live = false }

  }, [])

  // Diagrams are worth their weight here, but only once the prose is on screen.
  useEffect(() => {

    const container = contentRef.current
    if (!report || !container) return

    let live = true

    import('mermaid').then(({ default: mermaid }) => {

      if (!live) return

      mermaid.initialize({

        startOnLoad: false,
        theme: 'dark',
        darkMode: true,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        themeVariables: {

          background: '#09090b',
          primaryColor: '#18181b',
          primaryTextColor: '#e4e4e7',
          primaryBorderColor: '#3f3f46',
          lineColor: '#52525b',
          secondaryColor: '#27272a',
          tertiaryColor: '#18181b',

        },

      })

      mermaid.run({

        nodes: Array.from(container.querySelectorAll<HTMLElement>('pre.mermaid')),
        suppressErrors: true,

      })

    })

    return () => {

      live = false

      // Mermaid parks a tooltip on the body and never takes it back, which leaves
      // every other page of the site with six stray pixels of scroll.
      for (const tooltip of document.querySelectorAll('body > .mermaidTooltip')) tooltip.remove()

    }

  }, [report])

  // The route fragment carries the section to land on.
  useEffect(() => {

    if (!report) return

    if (!section) {

      window.scrollTo(0, 0)
      return

    }

    document.getElementById(section)?.scrollIntoView({ behavior: 'smooth' })

  }, [report, section])

  return (

    <div className="min-h-screen bg-zinc-950 font-mono text-zinc-300">

      <div className="mx-auto flex max-w-[90rem] gap-10 px-5 sm:px-8">

        <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col py-10 lg:flex">

          <a
            href="#/"
            className="mb-6 text-xs tracking-wide text-zinc-500 transition-colors hover:text-zinc-300"
          >
            ← The GraniteOS Project
          </a>

          <nav className="-mr-3 min-h-0 flex-1 overflow-y-auto pr-3">
            <SectionList sections={report?.sections ?? []} active={active} />
          </nav>

        </aside>

        <main className="min-w-0 flex-1 py-10 lg:py-16">

          <header className="mx-auto max-w-3xl">

            <a
              href="#/"
              className="text-xs tracking-wide text-zinc-500 transition-colors hover:text-zinc-300 lg:hidden"
            >
              ← The GraniteOS Project
            </a>

            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-100 lg:mt-0">
              GraniteOS 2
            </h1>

            <p className="mt-2 text-sm text-zinc-500">Overview &amp; Implementation</p>

            <img
              src="/docs/desktop_demo.png"
              alt="The GraniteOS 2 desktop, running a shell, a file browser, and a text editor."
              className="mt-8 w-full rounded-md border border-zinc-800"
            />

          </header>

          {report && (

            <details className="mt-8 border-y border-zinc-800 py-3 lg:hidden">

              <summary className="cursor-pointer text-xs tracking-wide text-zinc-400">
                Contents
              </summary>

              <div className="mt-3 max-h-80 overflow-y-auto">
                <SectionList sections={report.sections} active={active} />
              </div>

            </details>

          )}

          {failed && (

            <p className="mt-10 text-sm text-zinc-500">
              The implementation report could not be loaded.
            </p>

          )}

          {!report && !failed && <p className="mt-10 text-sm text-zinc-600">Loading report...</p>}

          <div
            ref={contentRef}
            className="prose mx-auto mt-10 max-w-3xl"
            dangerouslySetInnerHTML={{ __html: report?.html ?? '' }}
          />

        </main>

        {/*
          Balances the sidebar so the article sits on the middle of the page rather than the
          middle of what is left over. Only once the window is wide enough to give it away:
          below that the article needs the width more than the symmetry.
        */}
        <div aria-hidden="true" className="hidden w-72 shrink-0 2xl:block" />

      </div>

    </div>

  )

}

function SectionList({ sections, active }: { sections: Section[]; active: string }) {

  return (

    <ul className="space-y-0.5 text-sm">

      {sections.map((section) => (

        <li key={section.id}>

          <a
            href={`#/learn/${section.id}`}
            data-active={section.id === active || undefined}
            className={`block truncate rounded py-1 transition-colors hover:text-zinc-200 data-[active]:text-zinc-100 ${
              section.depth === 2
                ? 'mt-3 font-medium text-zinc-400 first:mt-0'
                : 'pl-4 text-[13px] text-zinc-500'
            }`}
          >
            {section.title}
          </a>

        </li>

      ))}

    </ul>

  )

}

/** Highlights the heading the reader is currently sitting on. */
function useActiveSection(sections: Section[] | undefined, contentRef: React.RefObject<HTMLElement>) {

  const [active, setActive] = useState('')

  useEffect(() => {

    const container = contentRef.current
    if (!sections?.length || !container) return

    const visible = new Set<string>()

    const observer = new IntersectionObserver(

      (entries) => {

        for (const entry of entries) {

          if (entry.isIntersecting) visible.add(entry.target.id)
          else visible.delete(entry.target.id)

        }

        const first = sections.find((section) => visible.has(section.id))
        if (first) setActive(first.id)

      },

      { rootMargin: '0px 0px -75% 0px' },

    )

    for (const heading of container.querySelectorAll('h2[id], h3[id]')) observer.observe(heading)

    return () => observer.disconnect()

  }, [sections, contentRef])

  useEffect(() => {

    if (!active) return

    document
      .querySelector(`a[href="#/learn/${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })

  }, [active])

  return active

}
