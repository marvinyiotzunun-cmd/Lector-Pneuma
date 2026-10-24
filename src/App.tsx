import { lazy, Suspense, useEffect, useState } from 'react'
import { HashRouter, Route, Routes, useParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Biblioteca from './paginas/Biblioteca'
import Entrar from './paginas/Entrar'

// El lector (epub.js y pdf.js) se carga solo al abrir un libro.
const Lector = lazy(() => import('./paginas/Lector'))

export default function App() {
  const [sesion, setSesion] = useState<Session | null | undefined>(supabase ? undefined : null)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSesion(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSesion(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (sesion === undefined) return null
  if (supabase && !sesion) return <Entrar />

  // HashRouter para que las rutas funcionen igual en la web y dentro de la app (Capacitor).
  return (
    <HashRouter>
      <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<Biblioteca />} />
        <Route path="/leer/:id" element={<LectorPorLibro />} />
      </Routes>
      </Suspense>
    </HashRouter>
  )
}

// Una instancia nueva del lector por cada libro, para no arrastrar estado de uno a otro.
function LectorPorLibro() {
  const { id } = useParams()
  return <Lector key={id} />
}
