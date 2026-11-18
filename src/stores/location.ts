import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { readLastKnownLocation, saveLastKnownLocation } from '@/services/location-persistence'
import type { RiderPosition } from '@/services/location-persistence'
import { useAuthStore } from '@/stores/auth'

export type { RiderPosition } from '@/services/location-persistence'

export const useLocationStore = defineStore('location', () => {
  const auth = useAuthStore()
  const position = ref<RiderPosition | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const watching = ref(false)
  let watchId: string | null = null
  let watchGeneration = 0

  watch(
    () => auth.user?.id,
    (userId) => {
      position.value = null
      error.value = null
      if (!userId) return

      try {
        position.value = readLastKnownLocation(userId)
      } catch (reason) {
        error.value = reason instanceof Error ? reason.message : 'Saved location could not be loaded.'
      }
    },
    { immediate: true, flush: 'sync' },
  )

  watch(
    position,
    (savedPosition) => {
      const userId = auth.user?.id
      if (!userId || !savedPosition) return

      try {
        saveLastKnownLocation(userId, savedPosition)
      } catch (reason) {
        error.value = reason instanceof Error ? reason.message : 'The latest location could not be saved.'
      }
    },
    { flush: 'sync' },
  )

  async function ensureLocationPermission() {
    if (!Capacitor.isNativePlatform()) return

    const permission = await Geolocation.checkPermissions()
    if (permission.location === 'granted') return

    const requested = await Geolocation.requestPermissions({
      permissions: ['location'],
    })
    if (requested.location !== 'granted') {
      throw new Error('Location permission was not granted.')
    }
  }

  function toRiderPosition(current: Awaited<ReturnType<typeof Geolocation.getCurrentPosition>>): RiderPosition {
    return {
      latitude: current.coords.latitude,
      longitude: current.coords.longitude,
      accuracy: current.coords.accuracy,
      speed: current.coords.speed,
      heading: current.coords.heading,
      recordedAt: new Date(current.timestamp).toISOString(),
    }
  }

  async function locate(): Promise<RiderPosition> {
    loading.value = true
    error.value = null

    try {
      await ensureLocationPermission()

      const current = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15_000,
      })

      const freshPosition = toRiderPosition(current)
      position.value = freshPosition
      return freshPosition
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unable to read the device location.'
      error.value = message
      throw new Error(message, { cause: reason })
    } finally {
      loading.value = false
    }
  }

  async function startWatching(): Promise<void> {
    if (watchId) return
    const generation = ++watchGeneration
    loading.value = true
    error.value = null

    try {
      await ensureLocationPermission()
      const id = await Geolocation.watchPosition(
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 15_000,
          interval: 4_000,
          minimumUpdateInterval: 3_000,
        },
        (current, reason?: unknown) => {
          if (generation !== watchGeneration) return
          if (reason) {
            error.value = reason instanceof Error ? reason.message : String(reason)
            return
          }
          if (!current) return
          position.value = toRiderPosition(current)
          error.value = null
        },
      )

      if (generation !== watchGeneration) {
        await Geolocation.clearWatch({ id })
        return
      }

      watchId = id
      watching.value = true
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unable to start live location updates.'
      error.value = message
      throw new Error(message, { cause: reason })
    } finally {
      loading.value = false
    }
  }

  async function stopWatching(): Promise<void> {
    watchGeneration += 1
    const id = watchId
    watchId = null
    watching.value = false
    if (!id) return

    try {
      await Geolocation.clearWatch({ id })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unable to stop live location updates.'
      error.value = message
      throw new Error(message, { cause: reason })
    }
  }

  return { position, loading, error, watching, locate, startWatching, stopWatching }
})
