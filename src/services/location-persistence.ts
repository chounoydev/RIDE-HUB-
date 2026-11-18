const locationKeyPrefix = 'ridehub.location.last-known.v1'
const weatherSnapshotKeyPrefix = 'ridehub.weather.snapshot.v1'

export interface RiderPosition {
  latitude: number
  longitude: number
  accuracy: number
  speed: number | null
  heading: number | null
  recordedAt: string
}

function userKey(prefix: string, userId: string) {
  return `${prefix}.${encodeURIComponent(userId)}`
}

function isRiderPosition(value: unknown): value is RiderPosition {
  if (typeof value !== 'object' || value === null) return false
  const position = value as Record<string, unknown>
  return typeof position.latitude === 'number'
    && Number.isFinite(position.latitude)
    && position.latitude >= -90
    && position.latitude <= 90
    && typeof position.longitude === 'number'
    && Number.isFinite(position.longitude)
    && position.longitude >= -180
    && position.longitude <= 180
    && typeof position.accuracy === 'number'
    && Number.isFinite(position.accuracy)
    && (position.speed === null || (typeof position.speed === 'number' && Number.isFinite(position.speed)))
    && (position.heading === null || (typeof position.heading === 'number' && Number.isFinite(position.heading)))
    && typeof position.recordedAt === 'string'
    && Number.isFinite(Date.parse(position.recordedAt))
}

export function readLastKnownLocation(userId: string): RiderPosition | null {
  const saved = localStorage.getItem(userKey(locationKeyPrefix, userId))
  if (!saved) return null

  try {
    const position: unknown = JSON.parse(saved)
    return isRiderPosition(position) ? position : null
  } catch {
    return null
  }
}

export function saveLastKnownLocation(userId: string, position: RiderPosition) {
  localStorage.setItem(userKey(locationKeyPrefix, userId), JSON.stringify(position))
}

export function weatherSnapshotStorageKey(userId: string) {
  return userKey(weatherSnapshotKeyPrefix, userId)
}

export function clearUserLocationData(userId: string) {
  localStorage.removeItem(userKey(locationKeyPrefix, userId))
  localStorage.removeItem(weatherSnapshotStorageKey(userId))
}
