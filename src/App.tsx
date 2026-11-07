import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { HashRouter, Route, Routes, useParams } from 'react-router-dom'
import { fuente } from './lib/fuente-activa'
import { ErrorApi } from './lib/fuente'
import type { Dispositivo } from './lib/tipos'
import Biblioteca from './paginas/Biblioteca'
import Entrar from './paginas/Entrar'
import Dispositivos from './paginas/Dispositivos'

const Lector = lazy(() => import('./paginas/Lector'))

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'fuera'; error?: string }
  | { tipo: 'limite'; lista: (Dispositivo & { actual: boolean })[] }
  | { tipo: 'dentro'; correo: string }

// El enlace del correo trae ?token=... (en la web o al abrir la app desde el enlace).
function tokenDeUrl(url: string): string | null {
  try {
    const u = new URL(url)
    return u.searchParams.get('token') ?? new URLSearchParams(u.hash.split('?')[1] ?? '').get('token')
  } catch {
    return null
  }
}

export default function App() {
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' })

  const arrancar = useCallback(async (token?: string | null) => {
    try {
      if (token) {
        const destino = await fuente.verificar(token)
        const hash = destino?.startsWith('#/') ? destino : location.hash.split('?')[0]
        history.replaceState(null, '', location.pathname + hash)
      }
      const u = await fuente.yo()
      if (!u) return setEstado({ tipo: 'fuera' })
      try {
        await fuente.registrarDispositivo()
      } catch (e) {
        if (e instanceof ErrorApi && e.codigo === 'limite_dispositivos') {
          return setEstado({ tipo: 'limite', lista: (e.datos.dispositivos as (Dispositivo & { actual: boolean })[]) ?? [] })
        }
        throw e
      }
      setEstado({ tipo: 'dentro', correo: u.correo })
    } catch (e) {
      setEstado({ tipo: 'fuera', error: e instanceof ErrorApi && e.status === 400 ? 'El enlace ya venció o ya se usó. Pide uno nuevo.' : undefined })
    }
  }, [])

  useEffect(() => {
    arrancar(tokenDeUrl(location.href))
    // En la app, el enlace del correo abre la app (App Links) y llega por este evento.
    if (!Capacitor.isNativePlatform()) return
    const escucha = CapApp.addListener('appUrlOpen', ({ url }) => { const t = tokenDeUrl(url); if (t) arrancar(t) })
    return () => { escucha.then((e) => e.remove()) }
  }, [arrancar])

  if (estado.tipo === 'cargando') return null
  if (estado.tipo === 'fuera') return <Entrar error={estado.error} />
  if (estado.tipo === 'limite') return <Dispositivos limite lista={estado.lista} onListo={() => arrancar()} />

  const salir = async () => {
    await fuente.salir()
    setEstado({ tipo: 'fuera' })
  }

  // HashRouter para que las rutas funcionen igual en la web y dentro de la app (Capacitor).
  return (
    <HashRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Biblioteca correo={estado.correo} onSalir={salir} />} />
          <Route path="/dispositivos" element={<Dispositivos />} />
          <Route path="/leer/:id" element={<LectorPorLibro correo={estado.correo} />} />
          <Route path="/muestra/:id" element={<LectorPorLibro correo={estado.correo} />} />
        </Routes>
      </Suspense>
    </HashRouter>
  )
}

// Una instancia nueva del lector por cada libro, para no arrastrar estado de uno a otro.
function LectorPorLibro({ correo }: { correo: string }) {
  const { id } = useParams()
  return <Lector key={id} correo={correo} />
}
