import { useState, type FormEvent } from 'react'
import { fuente } from '../lib/fuente-activa'
import { ErrorApi } from '../lib/fuente'
import Monograma from '../marca/Monograma'

// Acceso sin contraseña: el lector recibe un enlace en su correo (docs/api.md, Autenticación).
export default function Entrar({ error }: { error?: string }) {
  const [correo, setCorreo] = useState('')
  const [enviado, setEnviado] = useState(false)
  const [mensaje, setMensaje] = useState(error ?? '')
  const [ocupado, setOcupado] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setOcupado(true)
    setMensaje('')
    try {
      await fuente.pedirEnlace(correo.trim())
      setEnviado(true)
    } catch (err) {
      setMensaje(err instanceof ErrorApi && err.status === 429
        ? 'Ya pediste varios enlaces. Espera un rato antes de pedir otro.'
        : 'No se pudo enviar el enlace. Revisa tu conexión e inténtalo de nuevo.')
    }
    setOcupado(false)
  }

  return (
    <div className="entrar">
      <form onSubmit={enviar}>
        <div className="marca"><Monograma className="monograma" titulo="Publicaciones Pneuma" /><h1><small>Publicaciones</small>Pneuma</h1></div>
        {enviado ? (
          <>
            <p>Te enviamos un enlace a <strong>{correo}</strong>. Ábrelo desde este dispositivo para entrar. Vale por 15 minutos.</p>
            <button type="button" className="enlace" onClick={() => setEnviado(false)}>Usar otro correo</button>
          </>
        ) : (
          <>
            <p>Escribe el correo con el que compraste o canjeaste tus libros. Te enviaremos un enlace para entrar, sin contraseña.</p>
            <label htmlFor="correo">Correo</label>
            <input id="correo" type="email" autoComplete="email" required value={correo} onChange={(e) => setCorreo(e.target.value)} />
            {mensaje && <p className="mensaje" role="alert">{mensaje}</p>}
            <button className="btn" disabled={ocupado}>{ocupado ? 'Enviando…' : 'Enviarme el enlace'}</button>
          </>
        )}
      </form>
    </div>
  )
}
