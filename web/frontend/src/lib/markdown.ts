import { Marked } from 'marked'

/** A heading in the report, used to build the reader sidebar. */
export type Section = {

  id: string
  title: string
  depth: number

}

const ESCAPES: Record<string, string> = {

  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',

}

function escape(text: string): string {

  return text.replace(/[&<>"]/g, (character) => ESCAPES[character])

}

/** GitHub-style anchor slug, so anchors written in the source markdown still resolve. */
function slugify(text: string): string {

  return text
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')

}

/**
 * The report opens with its own title block and a hand-written table of contents.
 * The reader view supplies both, so the body starts at the first real chapter.
 */
function body(markdown: string): string {

  const start = markdown.search(/^## Overview$/m)
  return start < 0 ? markdown : markdown.slice(start)

}

/** Converts the implementation report into HTML plus the section list for the sidebar. */
export function renderReport(markdown: string): { html: string; sections: Section[] } {

  const sections: Section[] = []
  const seen = new Map<string, number>()
  const marked = new Marked({ gfm: true })

  marked.use({

    renderer: {

      heading({ tokens, depth }) {

        const html = this.parser.parseInline(tokens)
        const title = html.replace(/<[^>]+>/g, '')

        const base = slugify(title)
        const count = seen.get(base) ?? 0

        seen.set(base, count + 1)

        const id = count === 0 ? base : `${base}-${count}`

        if (depth === 2 || depth === 3) sections.push({ id, title, depth })

        return `<h${depth} id="${id}">${html}</h${depth}>\n`

      },

      code({ text, lang }) {

        if (lang === 'mermaid') return `<pre class="mermaid">${escape(text)}</pre>\n`

        const language = lang ? ` class="language-${escape(lang)}"` : ''
        return `<pre><code${language}>${escape(text)}</code></pre>\n`

      },

      link({ href, tokens }) {

        const html = this.parser.parseInline(tokens)

        // In-document anchors have to keep the reader route in front of them.
        if (href.startsWith('#')) return `<a href="#/learn/${href.slice(1)}">${html}</a>`

        return `<a href="${escape(href)}" target="_blank" rel="noreferrer">${html}</a>`

      },

    },

  })

  // The report is stored with a byte order mark.
  const html = marked.parse(body(markdown.replace(/^﻿/, ''))) as string

  return { html, sections }

}
