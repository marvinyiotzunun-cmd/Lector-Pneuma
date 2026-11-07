import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'gt.pneuma.lector',
  appName: 'Pneuma Lector',
  webDir: 'dist',
  android: {
    // Sin depuración remota del WebView en la versión publicada.
    webContentsDebuggingEnabled: false,
  },
}

export default config
