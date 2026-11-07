import { leerLocal, guardarLocal } from './local'

// Identificador de este dispositivo: se genera una vez y queda guardado (docs/api.md, Dispositivos).
export function idDispositivo(): string {
  let id = leerLocal<string | null>('dispositivo_id', null)
  if (!id) {
    id = crypto.randomUUID()
    guardarLocal('dispositivo_id', id)
  }
  return id
}

export const esApp = () => !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()

export function plataforma(): 'web' | 'android' | 'ios' {
  const cap = (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor
  const p = cap?.getPlatform?.()
  return p === 'android' || p === 'ios' ? p : 'web'
}

export function nombreDispositivo(): string {
  const ua = navigator.userAgent
  const so = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone o iPad' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Equipo'
  const nav = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : ''
  return esApp() ? `App Pneuma en ${so}` : [nav, so].filter(Boolean).join(' en ')
}
