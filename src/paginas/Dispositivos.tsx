import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fuente } from '../lib/fuente-activa'
import type { Dispositivo } from '../lib/tipos'

type Fila = Dispositivo & { actual: boolean }

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-GT', { day: 'numeric', month: 'long', year: 'numeric' })

// Con "limite" se muestra al entrar desde un dispositivo nuevo cuando la cuenta ya está en el máximo.
export default function Dispositivos({ limite, lista: inicial, onListo }: { limite?: boolean; lista?: Fila[]; onListo?: () => void }) {
  const [lista, setLista] = useState<Fila[] | null>(inicial ?? null)
  const [ocupado, setOcupado] = useState('')

  useEffect(() => {
    if (!inicial) fuente.dispositivos().then(setLista).catch(() => setLista([]))
  }, [inicial])

  async function quitar(d: Fila) {
    setOcupado(d.id)
    await fuente.quitarDispositivo(d.id)
    setLista((l) => l?.filter((x) => x.id !== d.id) ?? null)
    setOcupado('')
    if (limite && onListo) onListo()
  }

  return (
    <div className="biblioteca dispositivos">
      {!limite && <Link to="/" className="volver">‹ Biblioteca</Link>}
      <h2 className="seccion">{limite ? 'Llegaste al límite de dispositivos' : 'Mis dispositivos'}</h2>
      <p className="vacio">
        {limite
          ? 'Tu cuenta ya está abierta en el máximo de dispositivos permitidos. Quita uno para leer en este.'
          : 'Tu cuenta puede estar abierta en pocos dispositivos a la vez. Si quitas uno, deberá volver a entrar con un enlace a tu correo, y se borran sus libros descargados.'}
      </p>
      <ul className="lista-dispositivos">
        {lista?.map((d) => (
          <li key={d.id}>
            <div>
              <strong>{d.nombre}</strong>{d.actual && <span className="etiqueta">Este dispositivo</span>}
              <span className="autor">Último uso: {fecha(d.ultimo_uso)}</span>
            </div>
            {!d.actual && <button className="btn secundario" disabled={!!ocupado} onClick={() => quitar(d)}>{ocupado === d.id ? 'Quitando…' : 'Quitar'}</button>}
          </li>
        ))}
      </ul>
    </div>
  )
}
