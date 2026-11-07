import { useState, type FormEvent } from 'react'
import Monograma from '../marca/Monograma'
import { api } from './api'

// Entrada sin contraseña: se envía un enlace al correo que vuelve a /panel?token=...
export default function Entrar({ error, alEntrar }: { error: string | null; alEntrar: () => void }) {
  const [correo, setCorreo] = useState('')
  const [estado, setEstado] = useState<'listo' | 'enviando' | 'enviado'>('listo')
  const [fallo, setFallo] = useState<string | null>(error)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setEstado('enviando'); setFallo(null)
    try {
      await api('/auth/enlace', { cuerpo: { correo, destino: `/panel${location.hash || '#/'}` } })
      setEstado('enviado')
    } catch (err) {
      setFallo((err as Error).message); setEstado('listo')
    }
  }

  async function demo(correoDemo: string) {
    try {
      await api('/demo/entrar', { cuerpo: { correo: correoDemo } })
      alEntrar()
    } catch (err) { setFallo((err as Error).message) }
  }

  return (
    <div className="entrar">
      <form onSubmit={enviar}>
        <div className="marca">
          <Monograma className="monograma" />
          <h1>Pneuma<small>Ventanilla editorial</small></h1>
        </div>
        {estado === 'enviado' ? (
          <>
            <p className="mensaje">Le enviamos un enlace a <strong>{correo}</strong>. Ábralo desde este dispositivo para entrar. El enlace vale 15 minutos.</p>
            <button type="button" className="enlace" onClick={() => setEstado('listo')}>Usar otro correo</button>
          </>
        ) : (
          <>
            <p>Escriba el correo de su cuenta. Le enviaremos un enlace para entrar, sin contraseña.</p>
            <label htmlFor="correo">Correo</label>
            <input id="correo" type="email" required autoComplete="email" value={correo} onChange={(e) => setCorreo(e.target.value)} />
            {fallo && <p className="error">{fallo}</p>}
            <button className="btn" disabled={estado === 'enviando'}>{estado === 'enviando' ? 'Enviando…' : 'Enviarme el enlace'}</button>
            <p className="p-nota">¿Su ministerio aún no tiene cuenta? Escriba a publicacionespneuma@gmail.com y la Dirección Editorial se la abrirá.</p>
          </>
        )}
        {import.meta.env.DEV && (
          <div className="p-demo">
            <span>Modo de prueba local:</span>
            <button type="button" className="enlace" onClick={() => demo('jlara@pneuma.gt')}>Dirección Editorial</button>
            <button type="button" className="enlace" onClick={() => demo('pastor@ejemplo.gt')}>Ministerio</button>
          </div>
        )}
      </form>
    </div>
  )
}
