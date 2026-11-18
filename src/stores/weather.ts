import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type {
  WeatherAlert,
  WeatherAlertCategory,
  WeatherPreferences,
  WeatherServiceStatus,
  WeatherSnapshot,
} from '@/services/weather'
import { getWeatherForecast, getWeatherServiceStatus } from '@/services/weather'
import type { RiderPosition } from '@/stores/location'
import { useAuthStore } from '@/stores/auth'
import { weatherSnapshotStorageKey } from '@/services/location-persistence'

const preferencesKey = 'ridehub.weather.preferences.v1'
const historyKey = 'ridehub.weather.history.v1'
const automaticRefreshIntervalMs = 10 * 60 * 1000
const automaticRefreshDistanceMeters = 5_000

const defaultPreferences: WeatherPreferences = {
  enabled: true,
  heavyRain: true,
  thunderstorm: true,
  lightning: true,
  strongWind: true,
  extremeHeat: true,
  severeWeather: true,
  floodingRisk: true,
}

function readPreferences(): WeatherPreferences {
  let saved: unknown
  try {
    saved = JSON.parse(localStorage.getItem(preferencesKey) ?? 'null')
  } catch {
    return { ...defaultPreferences }
  }
  if (typeof saved !== 'object' || saved === null) return { ...defaultPreferences }

  const get = (key: keyof WeatherPreferences) => {
    const value = (saved as Record<string, unknown>)[key]
    return typeof value === 'boolean' ? value : defaultPreferences[key]
  }
  return {
    enabled: get('enabled'),
    heavyRain: get('heavyRain'),
    thunderstorm: get('thunderstorm'),
    lightning: get('lightning'),
    strongWind: get('strongWind'),
    extremeHeat: get('extremeHeat'),
    severeWeather: get('severeWeather'),
    floodingRisk: get('floodingRisk'),
  }
}

function readHistory(): WeatherAlert[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(historyKey) ?? '[]')
    if (!Array.isArray(saved)) return []
    return saved.filter((item): item is WeatherAlert => {
      return typeof item === 'object'
        && item !== null
        && typeof item.id === 'string'
        && typeof item.title === 'string'
        && typeof item.category === 'string'
        && typeof item.expiresAt !== 'undefined'
    })
  } catch {
    return []
  }
}

const categoryPreference: Record<WeatherAlertCategory, keyof WeatherPreferences> = {
  HEAVY_RAIN: 'heavyRain',
  THUNDERSTORM: 'thunderstorm',
  LIGHTNING: 'lightning',
  STRONG_WIND: 'strongWind',
  EXTREME_HEAT: 'extremeHeat',
  SEVERE_WEATHER: 'severeWeather',
  FLOODING_RISK: 'floodingRisk',
  OTHER: 'severeWeather',
}

function signature(alert: WeatherAlert) {
  return JSON.stringify([alert.title, alert.description, alert.severity, alert.instruction, alert.expiresAt])
}

function isWeatherSnapshot(value: unknown): value is WeatherSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const snapshot = value as Record<string, unknown>
  if (snapshot.provider !== 'WeatherAPI.com' || typeof snapshot.updatedAt !== 'string') return false
  if (!Number.isFinite(Date.parse(snapshot.updatedAt))) return false
  if (typeof snapshot.location !== 'object' || snapshot.location === null) return false
  if (typeof snapshot.current !== 'object' || snapshot.current === null) return false
  const savedLocation = snapshot.location as Record<string, unknown>
  const current = snapshot.current as Record<string, unknown>
  return typeof savedLocation.name === 'string'
    && typeof savedLocation.latitude === 'number'
    && Number.isFinite(savedLocation.latitude)
    && typeof savedLocation.longitude === 'number'
    && Number.isFinite(savedLocation.longitude)
    && typeof current.temperatureC === 'number'
    && Number.isFinite(current.temperatureC)
    && typeof current.feelsLikeC === 'number'
    && Number.isFinite(current.feelsLikeC)
    && typeof current.condition === 'string'
    && typeof current.icon === 'string'
    && typeof current.windKph === 'number'
    && Number.isFinite(current.windKph)
    && typeof current.gustKph === 'number'
    && Number.isFinite(current.gustKph)
    && typeof current.observedAt === 'string'
    && Array.isArray(snapshot.alerts)
    && Array.isArray(snapshot.nextHours)
}

function readSnapshot(userId: string): WeatherSnapshot | null {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(weatherSnapshotStorageKey(userId)) ?? 'null')
    return isWeatherSnapshot(saved) ? saved : null
  } catch {
    return null
  }
}

function distanceMeters(first: { latitude: number; longitude: number }, second: { latitude: number; longitude: number }) {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const latitudeDelta = radians(second.latitude - first.latitude)
  const longitudeDelta = radians(second.longitude - first.longitude)
  const arc = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude)) * Math.sin(longitudeDelta / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc))
}

export const useWeatherStore = defineStore('weather', () => {
  const auth = useAuthStore()
  const snapshot = ref<WeatherSnapshot | null>(auth.user?.id ? readSnapshot(auth.user.id) : null)
  const history = ref<WeatherAlert[]>(readHistory())
  const preferences = ref<WeatherPreferences>(readPreferences())
  const serviceStatus = ref<WeatherServiceStatus | null>(null)
  const loading = ref(false)
  const statusLoading = ref(false)
  const error = ref<string | null>(null)
  const statusError = ref<string | null>(null)
  let currentRequest: Promise<WeatherAlert[]> | null = null

  watch(
    () => auth.user?.id,
    (userId) => {
      snapshot.value = userId ? readSnapshot(userId) : null
      error.value = null
    },
    { immediate: true, flush: 'sync' },
  )

  const visibleAlerts = computed(() => {
    if (!preferences.value.enabled) return []
    return history.value.filter((alert) => preferences.value[categoryPreference[alert.category]])
  })

  const activeAlerts = computed(() => {
    const now = Date.now()
    return visibleAlerts.value.filter((alert) => !alert.expiresAt || Date.parse(alert.expiresAt) > now)
  })

  function setPreference<K extends keyof WeatherPreferences>(key: K, value: WeatherPreferences[K]) {
    preferences.value[key] = value
    localStorage.setItem(preferencesKey, JSON.stringify(preferences.value))
  }

  async function refreshServiceStatus() {
    statusLoading.value = true
    statusError.value = null
    try {
      serviceStatus.value = await getWeatherServiceStatus()
    } catch (reason) {
      statusError.value = reason instanceof Error ? reason.message : 'Weather service status is unavailable.'
    } finally {
      statusLoading.value = false
    }
  }

  async function checkCurrentLocation(position: RiderPosition, options: { force?: boolean } = {}) {
    if (currentRequest) return currentRequest

    if (!options.force && snapshot.value) {
      const age = Date.now() - Date.parse(snapshot.value.updatedAt)
      const distance = distanceMeters(position, snapshot.value.location)
      if (age >= 0 && age < automaticRefreshIntervalMs && distance < automaticRefreshDistanceMeters) {
        return []
      }
    }

    const userId = auth.user?.id
    loading.value = true
    error.value = null
    const request = (async () => {
      try {
        const result = await getWeatherForecast(position.latitude, position.longitude)
        if (auth.user?.id !== userId) return []

        snapshot.value = result
        if (userId) {
          localStorage.setItem(weatherSnapshotStorageKey(userId), JSON.stringify(result))
        }

        const previous = new Map(history.value.map((alert) => [alert.id, signature(alert)]))
        const newlyRelevant = result.alerts.filter((alert) => {
          return preferences.value.enabled
            && preferences.value[categoryPreference[alert.category]]
            && previous.get(alert.id) !== signature(alert)
        })
        const combined = new Map(history.value.map((alert) => [alert.id, alert]))
        for (const alert of result.alerts) {
          if (!alert.expiresAt || Date.parse(alert.expiresAt) > Date.now()) {
            combined.set(alert.id, alert)
          }
        }
        history.value = [...combined.values()]
          .sort((a, b) => Date.parse(b.effectiveAt ?? '') - Date.parse(a.effectiveAt ?? ''))
          .slice(0, 100)
        localStorage.setItem(historyKey, JSON.stringify(history.value))
        return newlyRelevant
      } catch (reason) {
        error.value = reason instanceof Error ? reason.message : 'Weather could not be loaded.'
        throw reason
      } finally {
        loading.value = false
      }
    })()
    currentRequest = request
    try {
      return await request
    } finally {
      if (currentRequest === request) currentRequest = null
    }
  }

  return {
    snapshot,
    history,
    preferences,
    serviceStatus,
    loading,
    statusLoading,
    error,
    statusError,
    visibleAlerts,
    activeAlerts,
    setPreference,
    refreshServiceStatus,
    checkCurrentLocation,
  }
})
