import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import * as datos from '../lib/datos'
import { modoDemo, supabase } from '../lib/supabase'
import type { Libro } from '../lib/tipos'
import Monograma from '../marca/Monograma'

export default function Biblioteca() {
  const [libros, setLibros] = useState<Libro[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    datos.listarBiblioteca().then(setLibros).catch(() => setError('No se pudo cargar tu biblioteca. Revisa tu conexión.'))
  }, [])

  return (
    <div className="biblioteca">
      <header className="cabecera">
        <div className="marca">
          <Monograma className="monograma" />
          <h1><small>Publicaciones</small>Pneuma</h1>
          <span className="sub">Lector digital</span>
        </div>
        {supabase && <button className="btn secundario" onClick={() => supabase!.auth.signOut()}>Salir</button>}
      </header>

      {modoDemo && (
        <p className="demo">Modo de demostración: se muestran libros de muestra (Reina-Valera 1909) y tu avance se guarda solo en este dispositivo.</p>
      )}

      <h2 className="seccion">Tus libros</h2>
      {error && <p className="error">{error}</p>}
      {libros && !libros.length && (
        <p className="vacio">Todavía no tienes libros. Los libros que compres en la tienda de Publicaciones Pneuma aparecerán aquí.</p>
      )}
      <div className="rejilla">
        {libros?.map((l) => {
          const pct = Math.round(datos.progresoLocal(l.id) * 100)
          return (
            <Link key={l.id} to={`/leer/${l.id}`} className="libro">
              <Portada libro={l} />
              <span className="titulo">{l.titulo}</span>
              <span className="autor">{l.autor}</span>
              <span className="barra"><i style={{ width: `${pct}%` }} /></span>
              <span className="meta">
                <span>{pct ? `${pct} % leído` : 'Sin empezar'}</span>
                <span className="formato">{l.formato.toUpperCase()}</span>
              </span>
            </Link>
          )
        })}
      </div>

      <footer className="firma">
        Creado por Tecnoiagt · <a href="https://www.tecnoiagt.com" target="_blank" rel="noreferrer">www.tecnoiagt.com</a>
      </footer>
    </div>
  )
}

function Portada({ libro }: { libro: Libro }) {
  const url = datos.urlPortada(libro)
  if (url) return <img className="portada" src={url} alt={`Portada de ${libro.titulo}`} loading="lazy" />
  const color = libro.color ?? '#04044A'
  return (
    <div className="portada generada" style={{ background: `linear-gradient(160deg, ${color}, color-mix(in srgb, ${color} 60%, #000))` }}>
      <Monograma variante="blanco" className="pm" />
      <span className="pt">{libro.titulo}</span>
      <span className="pa">Publicaciones Pneuma</span>
    </div>
  )
}
