import { useEffect, useState } from 'react'
import { fuente, red } from '../lib/fuente-activa'
import { ErrorApi } from '../lib/fuente'
import { idDispositivo } from '../lib/dispositivo'
import type { Obra } from '../lib/tipos'
import { descargar, licenciaDe, quitar, vigente, type Licencia } from './sin-conexion'

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-GT', { day: 'numeric', month: 'short' })

export default function BotonDescarga({ obra, avisar }: { obra: Obra; avisar: (t: string) => void }) {
  const [lic, setLic] = useState<Licencia | null | undefined>(undefined)
  const [activa, setActiva] = useState(true)
  const [progreso, setProgreso] = useState<[number, number] | null>(null)

  useEffect(() => {
    licenciaDe(obra.id).then(async (l) => {
      setLic(l ?? null)
      if (l) setActiva(await vigente(l))
    })
  }, [obra.id])

  if (obra.acceso === 'muestra' || lic === undefined) return null

  async function bajar() {
    setProgreso([0, 1])
    try {
      const info = await fuente.obra(obra.id)
      const l = await descargar(red, info, obra, idDispositivo(), (a, b) => setProgreso([a, b]))
      setLic(l)
      setActiva(true)
      avisar('Libro descargado para leer sin conexión')
    } catch (e) {
      avisar(e instanceof ErrorApi && e.codigo === 'limite_sin_conexion' ? e.message : 'No se pudo descargar. Revisa tu conexión.')
    }
    setProgreso(null)
  }

  if (progreso) return <span className="descarga">Descargando {Math.round((progreso[0] / progreso[1]) * 100)} %</span>
  if (!lic) return <button className="descarga enlace" onClick={bajar}>Descargar para leer sin conexión</button>
  if (lic.descargadas < lic.total_paginas) return <button className="descarga enlace" onClick={bajar}>Terminar descarga</button>
  return (
    <span className="descarga">
      {activa ? `Sin conexión hasta el ${fecha(lic.vence_en)}` : 'El permiso sin conexión venció'}
      {' · '}
      {!activa && <button className="enlace" onClick={bajar}>Renovar</button>}
      {activa && <button className="enlace" onClick={async () => { await quitar(red, obra.id); setLic(null); avisar('Descarga quitada') }}>Quitar</button>}
    </span>
  )
}
