import { lazy, Suspense, useEffect, useState } from 'react'
import Home from './pages/Home'

// The site is served as static files with no rewrite rule, so routing lives in
// the fragment. Everything after the page name is the page's own business.
const Try = lazy(() => import('./pages/Try'))

function currentRoute(): string {

  return window.location.hash.replace(/^#\/?/, '')

}

export default function App() {

  const [route, setRoute] = useState(currentRoute)

  useEffect(() => {

    const onHashChange = () => setRoute(currentRoute())

    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)

  }, [])

  // Any query on the fragment belongs to the page, not the route.
  const page = route.split('?')[0].split('/')[0]

  if (page === 'try') return <Suspense fallback={<Loading />}><Try /></Suspense>

  return <Home />

}

function Loading() {

  return (

    <div className="flex h-screen items-center justify-center bg-zinc-950 font-mono text-sm text-zinc-600">
      Loading...
    </div>

  )

}
