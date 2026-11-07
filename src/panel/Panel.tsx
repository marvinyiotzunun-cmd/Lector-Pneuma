import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { HashRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom'
import Monograma from '../marca/Monograma'
import { api, ErrorApi, type Ministerio, type Usuario } from './api'
import Entrar from './Entrar'

const MisObras = lazy(() => import('./ventanilla/MisObras'))
const NuevaSolicitud = lazy(() => import('./ventanilla/NuevaSolicitud'))
const SeguirExpediente = lazy(() => import('./ventanilla/SeguirExpediente'))
const Tablero = lazy(() => import('./editorial/Tablero'))
const Expedientes = lazy(() => import('./editorial/Expedientes'))
const ExpedienteEditorial = lazy(() => import('./editorial/ExpedienteEditorial'))
const Etapas = lazy(() => import('./editorial/Etapas'))
const Libros = lazy(() => import('./admin/Libros'))
const LibroFicha = lazy(() => import('./admin/LibroFicha'))
const Contenidos = lazy(() => import('./admin/Contenidos'))
const Ministerios = lazy(() => import('./admin/Ministerios'))
const Usuarios = lazy(() => import('./admin/Usuarios'))
const Accesos = lazy(() => import('./admin/Accesos'))
const Lecturas = lazy(() => import('./admin/Lecturas'))

interface Sesion { usuario: Usuario; ministerios: Ministerio[]; recargar: () => Promise<void>; salir: () => Promise<void> }
const ContextoSesion = createContext<Sesion | null>(null)
export const useSesion = () => useContext(ContextoSesion)!

export const esEditorial = (u: Usuario) => u.rol === 'editor' || u.rol === 'admin'

export default function Panel() {
  const [estado, setEstado] = useState<'cargando' | 'fuera' | { usuario: Usuario; ministerios: Ministerio[] }>('cargando')
  const [error, setError] = useState<string | null>(null)

  const recargar = useCallback(async () => {
    try {
      const d = await api<{ usuario: Usuario; ministerios: Ministerio[] }>('/ventanilla/yo')
      setEstado(d)
    } catch (e) {
      if (e instanceof ErrorApi && e.estado === 401) setEstado('fuera')
      else { setError((e as Error).message); setEstado('fuera') }
    }
  }, [])

  useEffect(() => {
    // Vuelta del enlace mágico: /panel?token=...#/ruta
    const token = new URLSearchParams(location.search).get('token')
    if (!token) { recargar(); return }
    api<{ destino?: string | null }>('/auth/verificar', { cuerpo: { token } })
      .then((r) => { const h = r?.destino?.split('#')[1]; if (h && !location.hash.slice(1)) location.hash = h })
      .catch((e) => setError(e instanceof ErrorApi && e.codigo !== 'limite_dispositivos' ? e.message : null))
      .finally(() => {
        history.replaceState(null, '', location.pathname + location.hash)
        recargar()
      })
  }, [recargar])

  const salir = useCallback(async () => {
    await api('/auth/salir', { cuerpo: {} }).catch(() => {})
    setEstado('fuera')
  }, [])

  if (estado === 'cargando') return <div className="p-cargando">Cargando…</div>
  if (estado === 'fuera') return <Entrar error={error} />

  const sesion: Sesion = { ...estado, recargar, salir }
  const editorial = esEditorial(estado.usuario)
  return (
    <ContextoSesion.Provider value={sesion}>
      <HashRouter>
        <Marco>
          <Suspense fallback={<div className="p-cargando">Cargando…</div>}>
            <Routes>
              <Route path="/" element={<Navigate to={editorial ? '/editorial' : '/ventanilla'} replace />} />
              <Route path="/ventanilla" element={<MisObras />} />
              <Route path="/ventanilla/nueva" element={<NuevaSolicitud />} />
              <Route path="/ventanilla/:codigo" element={<SeguirExpediente />} />
              {editorial && <>
                <Route path="/editorial" element={<Tablero />} />
                <Route path="/editorial/expedientes" element={<Expedientes />} />
                <Route path="/editorial/etapas" element={<Etapas />} />
                <Route path="/editorial/:id" element={<ExpedienteEditorial />} />
                <Route path="/admin/libros" element={<Libros />} />
                <Route path="/admin/libros/:id" element={<LibroFicha />} />
                <Route path="/admin/contenidos" element={<Contenidos />} />
                <Route path="/admin/ministerios" element={<Ministerios />} />
                <Route path="/admin/usuarios" element={<Usuarios />} />
                <Route path="/admin/accesos" element={<Accesos />} />
                <Route path="/admin/lecturas" element={<Lecturas />} />
              </>}
              <Route path="*" element={<div className="p-vacio">Esta página no existe o su cuenta no tiene acceso.</div>} />
            </Routes>
          </Suspense>
        </Marco>
      </HashRouter>
    </ContextoSesion.Provider>
  )
}

function Marco({ children }: { children: ReactNode }) {
  const { usuario, ministerios, salir } = useSesion()
  const [menu, setMenu] = useState(false)
  const editorial = esEditorial(usuario)
  const enlace = (a: string, texto: string, fin = false) => (
    <NavLink to={a} end={fin} onClick={() => setMenu(false)}>{texto}</NavLink>
  )
  return (
    <div className="p-marco">
      <aside className={`p-lateral${menu ? ' abierto' : ''}`}>
        <div className="p-marca">
          <Monograma variante="blanco" className="monograma" />
          <div><strong>Pneuma</strong><small>{editorial ? 'Panel editorial' : 'Ventanilla editorial'}</small></div>
        </div>
        <nav>
          {(!editorial || ministerios.length > 0) && <>
            <span className="p-grupo">Ventanilla</span>
            {enlace('/ventanilla', 'Mis obras', true)}
            {enlace('/ventanilla/nueva', 'Presentar una obra')}
          </>}
          {editorial && <>
            <span className="p-grupo">Dirección Editorial</span>
            {enlace('/editorial', 'Tablero', true)}
            {enlace('/editorial/expedientes', 'Expedientes')}
            {enlace('/editorial/etapas', 'Etapas del proceso')}
            <span className="p-grupo">Catálogo y lector</span>
            {enlace('/admin/libros', 'Libros')}
            {enlace('/admin/accesos', 'Accesos al lector')}
            {enlace('/admin/lecturas', 'Quién lee qué')}
            <span className="p-grupo">Sitio y cuentas</span>
            {enlace('/admin/contenidos', 'Contenidos del sitio')}
            {enlace('/admin/ministerios', 'Ministerios')}
            {enlace('/admin/usuarios', 'Usuarios')}
          </>}
        </nav>
        <div className="p-cuenta">
          <span>{usuario.nombre || usuario.correo}</span>
          <small>{usuario.correo}</small>
          <button className="p-enlace" onClick={salir}>Cerrar sesión</button>
        </div>
      </aside>
      <div className="p-cuerpo">
        <header className="p-barra-movil">
          <button className="p-menu" aria-label="Menú" aria-expanded={menu} onClick={() => setMenu(!menu)}>☰</button>
          <strong>Pneuma</strong>
        </header>
        <main className="p-contenido">{children}</main>
        <footer className="p-firma">Publicaciones Pneuma · Creado por Tecnoiagt · www.tecnoiagt.com</footer>
      </div>
      {menu && <div className="p-velo" onClick={() => setMenu(false)} />}
    </div>
  )
}
