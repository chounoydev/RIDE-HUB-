import { Capacitor } from '@capacitor/core'

const nativeApiBaseUrl = 'https://ride-hub-alpha.vercel.app/api'

export const apiBaseUrl = (
  import.meta.env.VITE_API_BASE_URL?.trim()
  || (Capacitor.isNativePlatform() ? nativeApiBaseUrl : '/api')
).replace(/\/+$/, '')
