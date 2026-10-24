import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import Monograma from '../marca/Monograma'

export default function Entrar() {
  const [modo, setModo] = useState<'entrar' | 'registro'>('entrar')
  const [correo, setCorreo] = useState('')
  const [clave, setClave] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setOcupado(true)
    setMensaje('')
    const { error } = modo === 'entrar'
      ? await supabase.auth.signInWithPassword({ email: correo, password: clave })
      : await supabase.auth.signUp({ email: correo, password: clave })
    setOcupado(false)
    if (error) setMensaje(error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : error.message)
    else if (modo === 'registro') setMensaje('Te enviamos un correo para confirmar tu cuenta.')
  }

  return (
    <div className="entrar">
      <form onSubmit={enviar}>
        <div className="marca"><Monograma className="monograma" titulo="Publicaciones Pneuma" /><h1><small>Publicaciones</small>Pneuma</h1></div>
        <p>{modo === 'entrar' ? 'Entra con la cuenta que usaste para comprar tus libros.' : 'Crea tu cuenta de lector.'}</p>
        <label htmlFor="correo">Correo</label>
        <input id="correo" type="email" autoComplete="email" required value={correo} onChange={(e) => setCorreo(e.target.value)} />
        <label htmlFor="clave">Contraseña</label>
        <input id="clave" type="password" autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'} minLength={8} required
          value={clave} onChange={(e) => setClave(e.target.value)} />
        {mensaje && <p className="mensaje" role="alert">{mensaje}</p>}
        <button className="btn" disabled={ocupado}>{modo === 'entrar' ? 'Entrar' : 'Crear cuenta'}</button>
        <button type="button" className="enlace" onClick={() => setModo(modo === 'entrar' ? 'registro' : 'entrar')}>
          {modo === 'entrar' ? '¿No tienes cuenta? Créala aquí' : 'Ya tengo cuenta'}
        </button>
      </form>
    </div>
  )
}
