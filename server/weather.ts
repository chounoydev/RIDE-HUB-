import { createHash } from 'node:crypto'

interface ProviderHour {
  time_epoch: number
  time: string
  temp_c: number
  condition: { text: string; icon: string; code: number }
  wind_kph: number
  gust_kph: number
  precip_mm: number
  chance_of_rain: number
  heatindex_c: number
}

interface ProviderAlert {
  headline: string
  severity: string
  urgency: string
  areas: string
  event: string
  effective: string
  expires: string
  desc: string
  instruction: string
}

interface ProviderResponse {
  location: {
    name: string
    region: string
    country: string
    lat: number
    lon: number
  }
  current: {
    temp_c: number
    feelslike_c: number
    condition: { text: string; icon: string; code: number }
    wind_kph: number
    gust_kph: number
    humidity: number
    last_updated: string
  }
  forecast: {
    forecastday: Array<{ hour: ProviderHour[] }>
  }
  alerts?: { alert?: ProviderAlert[] }
}

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

export class WeatherProviderError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message)
    this.name = 'WeatherProviderError'
  }
}

const THUNDERSTORM_CODES = new Set([1087, 1273, 1276, 1279, 1282])
const ALERT_SOURCE = 'WeatherAPI.com'

function stableId(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

function normalizeSeverity(severity: string): WeatherAlertSeverity {
  switch (severity.toLowerCase()) {
    case 'extreme':
      return 'EXTREME'
    case 'severe':
      return 'SEVERE'
    case 'moderate':
      return 'MODERATE'
    default:
      return 'MINOR'
  }
}

function classifyOfficialAlert(alert: ProviderAlert): WeatherAlertCategory {
  const wording = `${alert.event} ${alert.headline} ${alert.desc}`.toLowerCase()
  if (wording.includes('flood')) return 'FLOODING_RISK'
  if (wording.includes('lightning')) return 'LIGHTNING'
  if (wording.includes('thunderstorm') || wording.includes('thunder storm')) return 'THUNDERSTORM'
  if (wording.includes('rain') || wording.includes('downpour')) return 'HEAVY_RAIN'
  if (wording.includes('wind') || wording.includes('gust')) return 'STRONG_WIND'
  if (wording.includes('heat') || wording.includes('high temperature')) return 'EXTREME_HEAT'
  if (['severe', 'extreme'].includes(alert.severity.toLowerCase())) return 'SEVERE_WEATHER'
  return 'OTHER'
}

function isoOrNull(value: string) {
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString()
}

function providerAlertToWeatherAlert(alert: ProviderAlert): WeatherAlert {
  const category = classifyOfficialAlert(alert)
  const effectiveAt = isoOrNull(alert.effective)
  const expiresAt = isoOrNull(alert.expires)
  return {
    id: stableId(`${alert.event}|${effectiveAt ?? ''}|${alert.areas}`),
    category,
    severity: normalizeSeverity(alert.severity),
    title: alert.headline || alert.event || 'Official weather warning',
    description: alert.desc || alert.event,
    instruction: alert.instruction || '',
    effectiveAt,
    expiresAt,
    official: true,
    source: ALERT_SOURCE,
  }
}

function createForecastAlerts(hours: ProviderHour[], now: Date): WeatherAlert[] {
  const nowEpoch = Math.floor(now.getTime() / 1000)
  const horizon = nowEpoch + 12 * 60 * 60
  const candidates = hours.filter((hour) => hour.time_epoch >= nowEpoch && hour.time_epoch <= horizon)
  const alerts: WeatherAlert[] = []
  const add = (
    category: WeatherAlertCategory,
    title: string,
    description: string,
    instruction: string,
    hour: ProviderHour,
    severity: WeatherAlertSeverity,
  ) => {
    alerts.push({
      id: stableId(`${category}|${hour.time_epoch}`),
      category,
      severity,
      title,
      description,
      instruction,
      effectiveAt: new Date(hour.time_epoch * 1000).toISOString(),
      expiresAt: new Date((hour.time_epoch + 60 * 60) * 1000).toISOString(),
      official: false,
      source: ALERT_SOURCE,
    })
  }

  const rain = candidates.find((hour) => hour.precip_mm >= 7.5)
  if (rain) {
    add(
      'HEAVY_RAIN',
      'Heavy rain forecast',
      `${rain.precip_mm.toFixed(1)} mm of rain is forecast near ${rain.time}.`,
      'Consider delaying the ride or finding a safe place to stop.',
      rain,
      rain.precip_mm >= 15 ? 'SEVERE' : 'MODERATE',
    )
  }

  const thunderstorm = candidates.find((hour) => THUNDERSTORM_CODES.has(hour.condition.code))
  if (thunderstorm) {
    add(
      'THUNDERSTORM',
      'Thunderstorm forecast',
      `${thunderstorm.condition.text} is forecast near ${thunderstorm.time}.`,
      'Find a safe place to stop and avoid exposed areas.',
      thunderstorm,
      'SEVERE',
    )
  }

  const wind = candidates.find((hour) => hour.gust_kph >= 60)
  if (wind) {
    add(
      'STRONG_WIND',
      'Strong winds forecast',
      'Wind gusts of at least 60 km/h are forecast.',
      'Reduce speed and consider postponing the ride.',
      wind,
      wind.gust_kph >= 80 ? 'SEVERE' : 'MODERATE',
    )
  }

  const heat = candidates.find((hour) => hour.heatindex_c >= 41)
  if (heat) {
    add(
      'EXTREME_HEAT',
      'Extreme heat forecast',
      `The forecast heat index reaches ${Math.round(heat.heatindex_c)}°C.`,
      'Take frequent breaks, hydrate, and avoid riding during peak heat.',
      heat,
      heat.heatindex_c >= 46 ? 'SEVERE' : 'MODERATE',
    )
  }

  return alerts
}

export function normalizeWeatherResponse(payload: ProviderResponse, now = new Date()): WeatherSnapshot {
  const cutoff = Math.floor(now.getTime() / 1000) + 24 * 60 * 60
  const forecastHours = payload.forecast.forecastday.flatMap((day) => day.hour)
  const nextHours = forecastHours
    .filter((hour) => hour.time_epoch >= Math.floor(now.getTime() / 1000) && hour.time_epoch <= cutoff)
    .slice(0, 24)
    .map((hour) => ({
      time: new Date(hour.time_epoch * 1000).toISOString(),
      temperatureC: hour.temp_c,
      condition: hour.condition.text,
      icon: hour.condition.icon,
      chanceOfRain: hour.chance_of_rain,
      precipitationMm: hour.precip_mm,
      windGustKph: hour.gust_kph,
      heatIndexC: hour.heatindex_c,
    }))

  const officialAlerts = (payload.alerts?.alert ?? [])
    .filter((alert) => !alert.expires || (Date.parse(alert.expires) > now.getTime()))
    .map(providerAlertToWeatherAlert)
  const forecastAlerts = createForecastAlerts(forecastHours, now)
  const alerts = [...officialAlerts, ...forecastAlerts].sort((a, b) => {
    const severity = { MINOR: 0, MODERATE: 1, SEVERE: 2, EXTREME: 3 }
    return severity[b.severity] - severity[a.severity]
  })

  return {
    provider: ALERT_SOURCE,
    updatedAt: now.toISOString(),
    location: {
      name: payload.location.name,
      region: payload.location.region,
      country: payload.location.country,
      latitude: payload.location.lat,
      longitude: payload.location.lon,
    },
    current: {
      temperatureC: payload.current.temp_c,
      feelsLikeC: payload.current.feelslike_c,
      condition: payload.current.condition.text,
      icon: payload.current.condition.icon,
      windKph: payload.current.wind_kph,
      gustKph: payload.current.gust_kph,
      humidity: payload.current.humidity,
      observedAt: payload.current.last_updated,
    },
    nextHours,
    alerts,
  }
}

export async function fetchWeatherSnapshot(
  latitude: number,
  longitude: number,
  options: { apiKey: string; fetchImpl?: typeof fetch; now?: Date },
): Promise<WeatherSnapshot> {
  const url = new URL('https://api.weatherapi.com/v1/forecast.json')
  url.search = new URLSearchParams({
    key: options.apiKey,
    q: `${latitude},${longitude}`,
    days: '2',
    alerts: 'yes',
    aqi: 'no',
  }).toString()

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(10_000) })
  } catch (reason) {
    const timedOut = reason instanceof Error
      && (reason.name === 'TimeoutError' || /timed out|timeout/i.test(reason.message))
    throw new WeatherProviderError(
      timedOut
        ? 'The weather provider did not respond within 10 seconds. Check the internet connection and retry.'
        : reason instanceof Error
          ? `Weather provider request failed: ${reason.message}`
          : 'Weather provider request failed.',
      502,
    )
  }

  if (!response.ok) {
    throw new WeatherProviderError(
      response.status === 401 || response.status === 403
        ? 'WeatherAPI rejected the API key. Replace WEATHER_API_KEY in .env.local or .env, then restart the API.'
        : `Weather provider returned HTTP ${response.status}.`,
      502,
    )
  }

  let payload: ProviderResponse
  try {
    payload = (await response.json()) as ProviderResponse
  } catch {
    throw new WeatherProviderError('Weather provider returned invalid JSON.', 502)
  }
  if (!payload.location || !payload.current || !payload.forecast?.forecastday) {
    throw new WeatherProviderError('Weather provider returned an incomplete forecast.', 502)
  }

  return normalizeWeatherResponse(payload, options.now)
}
