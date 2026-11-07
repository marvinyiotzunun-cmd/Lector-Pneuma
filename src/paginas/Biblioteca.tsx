import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fuente, modoDemo, permiteSinConexion, red } from '../lib/fuente-activa'
import { idDispositivo } from '../lib/dispositivo'
import BotonDescarga from '../sinconexion/BotonDescarga'
import { renovar } from '../sinconexion/sin-conexion'
import type { Obra } from '../lib/tipos'
import Monograma from '../marca/Monograma'

const ACCESO: Record<Obra['acceso'], string> = {
  compra: 'Comprado', alquiler: 'Alquiler', suscripcion: 'Suscripción', canje: 'Código canjeado', cortesia: 'Cortesía', muestra: 'Muestra',
}

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-GT', { day: 'numeric', month: 'short' })

export default function Biblioteca({ correo, onSalir }: { correo: string; onSalir: () => void }) {
  const [libros, setLibros] = useState<(Obra & { progreso: number })[] | null>(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    fuente.biblioteca().then(setLibros).catch(() => setError('No se pudo cargar tu biblioteca. Revisa tu conexión.'))
    if (permiteSinConexion() && navigator.onLine) renovar(red, idDispositivo())
  }, [])
  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(''), 2600)
    return () => clearTimeout(t)
  }, [aviso])

  return (
    <div className="biblioteca">
      <header className="cabecera">
        <div className="marca">
          <Monograma className="monograma" />
          <h1><small>Publicaciones</small>Pneuma</h1>
          <span className="sub">Lector digital</span>
        </div>
        <div className="cuenta">
          <span>{correo}</span>
          <Link to="/dispositivos">Mis dispositivos</Link>
          {!modoDemo && <button className="enlace" onClick={onSalir}>Salir</button>}
        </div>
      </header>

      {modoDemo && (
        <p className="demo">Modo de demostración: libros de muestra (Reina-Valera 1909). Tu avance y tus notas se guardan solo en este navegador.</p>
      )}

      <h2 className="seccion">Tus libros</h2>
      {error && <p className="error">{error}</p>}
      {libros && !libros.length && (
        <p className="vacio">Todavía no tienes libros. Los libros que compres, alquiles o canjees en el sitio de Publicaciones Pneuma aparecerán aquí.</p>
      )}
      <div className="rejilla">
        {libros?.map((l) => {
          const pct = Math.round(l.progreso * 100)
          return (
            <div key={l.id} className="celda">
            <Link to={`/leer/${l.id}`} className="libro">
              <Portada libro={l} />
              <span className="titulo">{l.titulo}</span>
              <span className="autor">{l.autor}</span>
              <span className="barra"><i style={{ width: `${pct}%` }} /></span>
              <span className="meta">
                <span>{pct ? `${pct} % leído` : 'Sin empezar'}</span>
                <span className={`acceso acceso-${l.acceso}`}>
                  {ACCESO[l.acceso]}{l.vence_en ? ` hasta ${fecha(l.vence_en)}` : ''}
                </span>
              </span>
            </Link>
            {permiteSinConexion() && <BotonDescarga obra={l} avisar={setAviso} />}
            </div>
          )
        })}
      </div>

      {aviso && <div className="aviso" role="status">{aviso}</div>}

      <footer className="firma">
        Creado por Tecnoiagt · <a href="https://www.tecnoiagt.com" target="_blank" rel="noreferrer">www.tecnoiagt.com</a>
      </footer>
    </div>
  )
}

function Portada({ libro }: { libro: Obra }) {
  if (libro.portada_url) return <img className="portada" src={libro.portada_url} alt={`Portada de ${libro.titulo}`} loading="lazy" />
  const color = libro.color ?? '#04044A'
  return (
    <div className="portada generada" style={{ background: color }}>
      <span className="pt">{libro.titulo}</span>
      <span className="pa">{libro.autor}</span>
      <Monograma variante="blanco" className="pm" />
    </div>
  )
}
