import { apiBaseUrl } from './apiBase'

export type WeatherAlertCategory =
  | 'HEAVY_RAIN'
  | 'THUNDERSTORM'
  | 'LIGHTNING'
  | 'STRONG_WIND'
  | 'EXTREME_HEAT'
  | 'SEVERE_WEATHER'
  | 'FLOODING_RISK'
  | 'OTHER'

export type WeatherAlertSeverity = 'MINOR' | 'MODERATE' | 'SEVERE' | 'EXTREME'

export interface WeatherAlert {
  id: string
  category: WeatherAlertCategory
  severity: WeatherAlertSeverity
  title: string
  description: string
  instruction: string
  effectiveAt: string | null
  expiresAt: string | null
  official: boolean
  source: string
}

export interface WeatherSnapshot {
  provider: 'WeatherAPI.com'
  updatedAt: string
  location: {
    name: string
    region: string
    country: string
    latitude: number
    longitude: number
  }
  current: {
    temperatureC: number
    feelsLikeC: number
    condition: string
    icon: string
    windKph: number
    gustKph: number
    humidity: number
    observedAt: string
  }
  nextHours: Array<{
    time: string
    temperatureC: number
    condition: string
    icon: string
    chanceOfRain: number
    precipitationMm: number
    windGustKph: number
    heatIndexC: number
  }>
  alerts: WeatherAlert[]
}

export interface WeatherPreferences {
  enabled: boolean
  heavyRain: boolean
  thunderstorm: boolean
  lightning: boolean
  strongWind: boolean
  extremeHeat: boolean
  severeWeather: boolean
  floodingRisk: boolean
}

export interface WeatherServiceStatus {
  ok: boolean
  weatherConfigured: boolean
  monitoringActive: boolean
  pushConfigured: boolean
  avatarUploadConfigured?: boolean
}

async function getJson<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, { headers: { Accept: 'application/json' } })
  } catch (reason) {
    throw new Error(
      reason instanceof Error ? `Cannot reach the RideHub weather service: ${reason.message}` : 'Cannot reach the RideHub weather service.',
    )
  }

  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? body.error
      : `Weather service returned HTTP ${response.status}.`
    throw new Error(message)
  }
  return body as T
}

export function getWeatherForecast(latitude: number, longitude: number) {
  const query = new URLSearchParams({ lat: String(latitude), lon: String(longitude) })
  return getJson<WeatherSnapshot>(`/weather/forecast?${query}`)
}

export function getWeatherServiceStatus() {
  return getJson<WeatherServiceStatus>('/health')
}
