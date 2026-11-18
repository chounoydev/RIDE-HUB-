<script setup lang="ts">
import { IonContent, IonIcon, IonPage, onIonViewDidEnter, onIonViewDidLeave } from '@ionic/vue'
import type { GeoJSONSource, Map as MapboxMap, Marker as MapboxMarker } from 'mapbox-gl'
import { layersOutline, locateOutline, navigateOutline, searchOutline } from 'ionicons/icons'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BrandLogo from '@/components/BrandLogo.vue'
import { useAuthStore } from '@/stores/auth'
import { useLocationStore, type RiderPosition } from '@/stores/location'
import { useWeatherStore } from '@/stores/weather'

const destinationStorageKeyPrefix = 'ridehub.live-map.destination.v1'
const mapLoadTimeoutMs = 45_000

interface Place {
  id: string
  name: string
  placeName: string
  longitude: number
  latitude: number
}

interface RouteStep {
  instruction: string
  distanceMeters: number
}

interface RoutePlan {
  distanceMeters: number
  durationSeconds: number
  coordinates: [number, number][]
  steps: RouteStep[]
}

type EmergencyCategoryId =
  | 'hospital'
  | 'police'
  | 'fire_station'
  | 'pharmacy'
  | 'gas_station'
  | 'vulcanizing'

interface EmergencyCategory {
  id: EmergencyCategoryId
  label: string
  symbol: string
}

interface EmergencyPlace extends Place {
  category: EmergencyCategoryId
  distanceMeters: number | null
}

const emergencyCategories: EmergencyCategory[] = [
  { id: 'hospital', label: 'Hospitals', symbol: 'H' },
  { id: 'police', label: 'Police', symbol: 'P' },
  { id: 'fire_station', label: 'Fire stations', symbol: 'F' },
  { id: 'pharmacy', label: 'Pharmacies', symbol: '+' },
  { id: 'gas_station', label: 'Gas stations', symbol: 'G' },
  { id: 'vulcanizing', label: 'Vulcanizing shops', symbol: 'V' },
]

const auth = useAuthStore()
const location = useLocationStore()
const weather = useWeatherStore()
const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN?.trim() ?? ''
const hasMapboxToken = computed(() => mapboxToken.length > 0)
const riderName = computed(() => auth.user?.name?.trim() || 'RideHub rider')
let map: MapboxMap | null = null
let riderMarker: MapboxMarker | null = null
let destinationMarker: MapboxMarker | null = null
let mapboxMarkerConstructor: typeof import('mapbox-gl').Marker | null = null
let riderMarkerElement: HTMLDivElement | null = null
let riderMarkerName: HTMLSpanElement | null = null
let mapInitialization: Promise<void> | null = null
let mapGeneration = 0
let mapLoadTimeout: ReturnType<typeof setTimeout> | null = null
let mapResizeObserver: ResizeObserver | null = null
let isActive = false
let weatherRefreshTimer: ReturnType<typeof setInterval> | null = null
let searchGeneration = 0
let emergencySearchGeneration = 0
const mapLoading = ref(false)
const mapError = ref<string | null>(null)
const searchQuery = ref('')
const searchResults = ref<Place[]>([])
const searching = ref(false)
const searchError = ref<string | null>(null)
const isPickingDestination = ref(false)
const destinationSaved = ref(false)
const selectedPlace = ref<Place | null>(readSavedDestination())
const routePlan = ref<RoutePlan | null>(null)
const routeLoading = ref(false)
const routeError = ref<string | null>(null)
const emergencyCategory = ref<EmergencyCategoryId | null>(null)
const emergencyPlaces = ref<EmergencyPlace[]>([])
const emergencyLoading = ref(false)
const emergencyError = ref<string | null>(null)
const focusedEmergencyPlaceId = ref<string | null>(null)
const is3D = ref(true)
const isNavigating = ref(false)
const startingNavigation = ref(false)
const trackingError = ref<string | null>(null)
const speedKph = computed(() => {
  const speed = location.position?.speed
  return speed === null || speed === undefined ? null : Math.max(0, Math.round(speed * 3.6))
})

function updateRiderMarkerPresentation() {
  if (!riderMarkerElement) return
  if (riderMarkerName) riderMarkerName.textContent = riderName.value
  riderMarkerElement.setAttribute(
    'aria-label',
    `${riderName.value}, ${isNavigating.value ? 'motorcycle trip active' : 'GPS location'}`,
  )
}

function createMotorcycleGlyph(): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(namespace, 'svg')
  svg.setAttribute('viewBox', '0 0 48 64')
  svg.setAttribute('aria-hidden', 'true')

  const parts: Array<{ tag: 'rect' | 'path' | 'circle'; attributes: Record<string, string> }> = [
    { tag: 'rect', attributes: { x: '20', y: '1', width: '8', height: '15', rx: '4', fill: '#11161a', stroke: '#d1d8dd', 'stroke-width': '1.5' } },
    { tag: 'rect', attributes: { x: '18', y: '43', width: '12', height: '20', rx: '6', fill: '#11161a', stroke: '#89939a', 'stroke-width': '1.5' } },
    { tag: 'path', attributes: { d: 'M18 11 8 6M30 11l10-5M13 15h22', fill: 'none', stroke: '#d1d8dd', 'stroke-linecap': 'round', 'stroke-width': '2' } },
    { tag: 'circle', attributes: { cx: '6', cy: '5', r: '3', fill: '#222b32', stroke: '#d1d8dd', 'stroke-width': '1.5' } },
    { tag: 'circle', attributes: { cx: '42', cy: '5', r: '3', fill: '#222b32', stroke: '#d1d8dd', 'stroke-width': '1.5' } },
    { tag: 'path', attributes: { d: 'M17 13c-5 2-7 7-6 13l2 8 4 8h14l4-8 2-8c1-6-1-11-6-13-4-2-10-2-14 0Z', fill: '#3977e8', stroke: '#a9c7ff', 'stroke-width': '1.5' } },
    { tag: 'path', attributes: { d: 'M15 17c-3 2-5 6-7 10M33 17c3 2 5 6 7 10', fill: 'none', stroke: '#b8c5ce', 'stroke-linecap': 'round', 'stroke-width': '4' } },
    { tag: 'circle', attributes: { cx: '24', cy: '12', r: '5', fill: '#202a32', stroke: '#e1e6e9', 'stroke-width': '1.5' } },
    { tag: 'path', attributes: { d: 'M19 11c1-5 9-5 10 0', fill: 'none', stroke: '#8997a1', 'stroke-linecap': 'round', 'stroke-width': '2' } },
    { tag: 'path', attributes: { d: 'M17 31c3-3 11-3 14 0l3 9H14l3-9Z', fill: '#234fbb', stroke: '#a9c7ff', 'stroke-width': '1' } },
    { tag: 'rect', attributes: { x: '20', y: '38', width: '8', height: '4', rx: '2', fill: '#ff3445', stroke: '#ffd0d4', 'stroke-width': '1' } },
    { tag: 'rect', attributes: { x: '9', y: '35', width: '6', height: '3', rx: '1.5', fill: '#ffae32', stroke: '#fff0c2', 'stroke-width': '0.8' } },
    { tag: 'rect', attributes: { x: '33', y: '35', width: '6', height: '3', rx: '1.5', fill: '#ffae32', stroke: '#fff0c2', 'stroke-width': '0.8' } },
  ]

  for (const part of parts) {
    const shape = document.createElementNS(namespace, part.tag)
    for (const [attribute, value] of Object.entries(part.attributes)) {
      shape.setAttribute(attribute, value)
    }
    svg.append(shape)
  }

  return svg
}

function createFinishMarkerElement(place: Place): HTMLDivElement {
  const marker = document.createElement('div')
  marker.className = 'finish-marker'
  marker.setAttribute('role', 'img')
  marker.setAttribute('aria-label', `Finish line: ${place.name}`)

  const label = document.createElement('span')
  label.className = 'finish-marker__label'
  label.textContent = 'FINISH'

  const pole = document.createElement('span')
  pole.className = 'finish-marker__pole'
  pole.setAttribute('aria-hidden', 'true')

  const flag = document.createElement('span')
  flag.className = 'finish-marker__flag'
  flag.setAttribute('aria-hidden', 'true')
  marker.append(label, pole, flag)
  return marker
}

function syncDestinationMarker(currentMap: MapboxMap) {
  const place = selectedPlace.value
  if (!place) {
    destinationMarker?.remove()
    destinationMarker = null
    return
  }

  if (!destinationMarker) {
    if (!mapboxMarkerConstructor) return
    destinationMarker = new mapboxMarkerConstructor({
      element: createFinishMarkerElement(place),
      anchor: 'bottom',
    })
      .setLngLat([place.longitude, place.latitude])
      .addTo(currentMap)
  } else {
    destinationMarker.getElement().setAttribute('aria-label', `Finish line: ${place.name}`)
    destinationMarker.setLngLat([place.longitude, place.latitude])
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPlace(value: unknown): value is Place {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.placeName === 'string'
    && typeof value.longitude === 'number'
    && Number.isFinite(value.longitude)
    && value.longitude >= -180
    && value.longitude <= 180
    && typeof value.latitude === 'number'
    && Number.isFinite(value.latitude)
    && value.latitude >= -90
    && value.latitude <= 90
}

function readSavedDestination(): Place | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(destinationStorageKey())
    if (!stored) return null
    const value: unknown = JSON.parse(stored)
    if (!isPlace(value)) {
      searchError.value = 'The saved destination is invalid. Set a new destination to replace it.'
      return null
    }
    destinationSaved.value = true
    return value
  } catch {
    searchError.value = 'The saved destination could not be loaded from this device.'
    return null
  }
}

function persistDestination(place: Place | null): boolean {
  try {
    if (place) {
      window.localStorage.setItem(destinationStorageKey(), JSON.stringify(place))
    } else {
      window.localStorage.removeItem(destinationStorageKey())
    }
    destinationSaved.value = place !== null
    return true
  } catch {
    searchError.value = 'Destination storage is unavailable. This selection may not survive a refresh.'
    return false
  }
}

function destinationStorageKey(): string {
  const userId = auth.user?.id
  return userId
    ? `${destinationStorageKeyPrefix}.${encodeURIComponent(userId)}`
    : destinationStorageKeyPrefix
}

function parsePlace(value: unknown): Place | null {
  if (!isRecord(value) || !Array.isArray(value.center) || value.center.length < 2) return null
  const [longitude, latitude] = value.center
  if (
    typeof longitude !== 'number' || !Number.isFinite(longitude)
    || typeof latitude !== 'number' || !Number.isFinite(latitude)
  ) return null

  const placeName = typeof value.place_name === 'string' ? value.place_name : ''
  if (!placeName) return null
  return {
    id: typeof value.id === 'string' ? value.id : `${longitude},${latitude}`,
    name: typeof value.text === 'string' ? value.text : placeName,
    placeName,
    longitude,
    latitude,
  }
}

function parseEmergencyPlace(value: unknown, category: EmergencyCategoryId): EmergencyPlace | null {
  if (!isRecord(value) || !isRecord(value.geometry) || !Array.isArray(value.geometry.coordinates)) return null
  const [longitude, latitude] = value.geometry.coordinates
  if (
    typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    || typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
  ) return null

  const properties = isRecord(value.properties) ? value.properties : null
  if (!properties || typeof properties.name !== 'string' || !properties.name.trim()) return null
  const placeName = typeof properties.full_address === 'string'
    ? properties.full_address
    : typeof properties.place_formatted === 'string'
      ? properties.place_formatted
      : emergencyCategories.find((item) => item.id === category)?.label ?? 'Nearby service'

  return {
    id: typeof properties.mapbox_id === 'string'
      ? properties.mapbox_id
      : `${category}:${longitude},${latitude}`,
    name: properties.name.trim(),
    placeName,
    longitude,
    latitude,
    category,
    distanceMeters: typeof properties.distance === 'number' && Number.isFinite(properties.distance)
      ? Math.max(0, properties.distance)
      : null,
  }
}

function parseRoute(payload: unknown): RoutePlan | null {
  if (!isRecord(payload) || !Array.isArray(payload.routes) || !isRecord(payload.routes[0])) return null
  const route = payload.routes[0]
  if (
    typeof route.distance !== 'number' || !Number.isFinite(route.distance)
    || typeof route.duration !== 'number' || !Number.isFinite(route.duration)
    || !isRecord(route.geometry) || !Array.isArray(route.geometry.coordinates)
  ) return null

  const coordinates: [number, number][] = []
  for (const point of route.geometry.coordinates) {
    if (
      !Array.isArray(point) || point.length < 2
      || typeof point[0] !== 'number' || !Number.isFinite(point[0])
      || typeof point[1] !== 'number' || !Number.isFinite(point[1])
    ) return null
    coordinates.push([point[0], point[1]])
  }
  if (coordinates.length < 2) return null

  const steps: RouteStep[] = []
  if (Array.isArray(route.legs)) {
    for (const leg of route.legs) {
      if (!isRecord(leg) || !Array.isArray(leg.steps)) continue
      for (const step of leg.steps) {
        if (!isRecord(step) || !isRecord(step.maneuver)) continue
        if (typeof step.maneuver.instruction !== 'string') continue
        steps.push({
          instruction: step.maneuver.instruction,
          distanceMeters: typeof step.distance === 'number' && Number.isFinite(step.distance)
            ? step.distance
            : 0,
        })
      }
    }
  }

  return {
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    coordinates,
    steps,
  }
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60))
  return minutes >= 60
    ? `${Math.floor(minutes / 60)} hr ${minutes % 60} min`
    : `${minutes} min`
}

function routeFeatureCollection() {
  const coordinates = routePlan.value
    ? isNavigating.value ? remainingRouteCoordinates() : routePlan.value.coordinates
    : null
  return {
    type: 'FeatureCollection' as const,
    features: coordinates
      ? [{
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'LineString' as const,
            coordinates,
          },
        }]
      : [],
  }
}

function nearestRoutePosition(position: RiderPosition) {
  const coordinates = routePlan.value?.coordinates
  if (!coordinates || coordinates.length < 2) return null

  const latitudeScale = Math.cos(position.latitude * Math.PI / 180)
  let nearest: {
    segmentIndex: number
    point: [number, number]
    distanceSquared: number
    bearing: number
  } | null = null

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index]!
    const end = coordinates[index + 1]!
    const startX = (start[0] - position.longitude) * latitudeScale
    const startY = start[1] - position.latitude
    const endX = (end[0] - position.longitude) * latitudeScale
    const endY = end[1] - position.latitude
    const deltaX = endX - startX
    const deltaY = endY - startY
    const lengthSquared = deltaX * deltaX + deltaY * deltaY
    if (lengthSquared === 0) continue

    const progress = Math.max(0, Math.min(1, -(startX * deltaX + startY * deltaY) / lengthSquared))
    const projectedX = startX + progress * deltaX
    const projectedY = startY + progress * deltaY
    const distanceSquared = projectedX * projectedX + projectedY * projectedY
    if (nearest && distanceSquared >= nearest.distanceSquared) continue

    nearest = {
      segmentIndex: index,
      point: [
        position.longitude + projectedX / latitudeScale,
        position.latitude + projectedY,
      ],
      distanceSquared,
      bearing: (Math.atan2(deltaX, deltaY) * 180 / Math.PI + 360) % 360,
    }
  }

  return nearest
}

function remainingRouteCoordinates(): [number, number][] {
  const route = routePlan.value?.coordinates
  const position = location.position
  if (!route || route.length < 2 || !position) return route ?? []

  const nearest = nearestRoutePosition(position)
  if (!nearest) return route

  const remaining: [number, number][] = [[position.longitude, position.latitude]]
  const appendIfFarEnough = (coordinate: [number, number]) => {
    const previous = remaining[remaining.length - 1]!
    const latitudeScale = Math.cos(position.latitude * Math.PI / 180)
    const distance = Math.hypot(
      (coordinate[0] - previous[0]) * latitudeScale,
      coordinate[1] - previous[1],
    ) * 111_320
    if (distance > 2) remaining.push(coordinate)
  }

  appendIfFarEnough(nearest.point)
  for (const coordinate of route.slice(nearest.segmentIndex + 1)) {
    appendIfFarEnough(coordinate)
  }

  return remaining.length >= 2 ? remaining : route
}

function emergencyFeatureCollection() {
  return {
    type: 'FeatureCollection' as const,
    features: emergencyPlaces.value.map((place) => {
      const category = emergencyCategories.find((item) => item.id === place.category)
      return {
        type: 'Feature' as const,
        properties: {
          placeId: place.id,
          category: place.category,
          symbol: category?.symbol ?? '?',
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [place.longitude, place.latitude],
        },
      }
    }),
  }
}

function drawMapSelections() {
  if (!map) return
  syncDestinationMarker(map)
  if (!map.isStyleLoaded()) return
  const routeSource = map.getSource('ridehub-route') as GeoJSONSource | undefined
  const emergencySource = map.getSource('ridehub-emergency') as GeoJSONSource | undefined
  routeSource?.setData(routeFeatureCollection())
  emergencySource?.setData(emergencyFeatureCollection())
}

function configureMapLayers(currentMap: MapboxMap) {
  if (!currentMap.getSource('ridehub-osm')) {
    currentMap.addSource('ridehub-osm', {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    })
  }
  if (!currentMap.getLayer('ridehub-osm')) {
    const firstNonBackgroundLayer = currentMap.getStyle().layers?.find(layer => layer.type !== 'background')?.id
    currentMap.addLayer({
      id: 'ridehub-osm',
      type: 'raster',
      source: 'ridehub-osm',
      paint: { 'raster-fade-duration': 180, 'raster-opacity': 0.96 },
    }, firstNonBackgroundLayer)
  }

  if (!currentMap.getSource('ridehub-route')) {
    currentMap.addSource('ridehub-route', {
      type: 'geojson',
      data: routeFeatureCollection(),
    })
  }

  if (!currentMap.getLayer('ridehub-route-casing')) {
    currentMap.addLayer({
      id: 'ridehub-route-casing',
      type: 'line',
      source: 'ridehub-route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#0b0f12', 'line-width': 12, 'line-opacity': 0.96 },
    })
  }

  if (!currentMap.getLayer('ridehub-route-line')) {
    currentMap.addLayer({
      id: 'ridehub-route-line',
      type: 'line',
      source: 'ridehub-route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#ff7a1a', 'line-width': 6, 'line-opacity': 1 },
    })
  }

  if (!currentMap.getLayer('ridehub-route-glow')) {
    currentMap.addLayer({
      id: 'ridehub-route-glow',
      type: 'line',
      source: 'ridehub-route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#ff7a1a',
        'line-width': 16,
        'line-opacity': 0.42,
        'line-blur': 5,
      },
    })
  }

  if (!currentMap.getSource('ridehub-emergency')) {
    currentMap.addSource('ridehub-emergency', {
      type: 'geojson',
      data: emergencyFeatureCollection(),
    })
  }

  if (!currentMap.getSource('ridehub-terrain')) {
    currentMap.addSource('ridehub-terrain', {
      type: 'raster-dem',
      url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
      tileSize: 512,
      maxzoom: 14,
    })
  }

  if (!currentMap.getLayer('ridehub-3d-buildings') && currentMap.getSource('composite')) {
    const firstSymbolLayer = currentMap.getStyle().layers?.find(layer => layer.type === 'symbol')?.id
    currentMap.addLayer({
      id: 'ridehub-3d-buildings',
      source: 'composite',
      'source-layer': 'building',
      type: 'fill-extrusion',
      minzoom: 15,
      filter: ['==', ['get', 'extrude'], 'true'],
      paint: {
        'fill-extrusion-color': '#68757b',
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.05, ['get', 'height']],
        'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.05, ['get', 'min_height']],
        'fill-extrusion-opacity': 0.72,
      },
    }, firstSymbolLayer)
  }

  if (!currentMap.getLayer('ridehub-emergency-points')) {
    currentMap.addLayer({
      id: 'ridehub-emergency-points',
      type: 'circle',
      source: 'ridehub-emergency',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 7, 16, 10],
        'circle-color': [
          'match',
          ['get', 'category'],
          'hospital', '#ef6262',
          'police', '#5b9cff',
          'fire_station', '#ff9a45',
          'pharmacy', '#52bd88',
          'gas_station', '#5db8e8',
          'vulcanizing', '#bc88f5',
          '#ff7a1a',
        ],
        'circle-stroke-color': '#101518',
        'circle-stroke-width': 2,
      },
    })
  }

  if (!currentMap.getLayer('ridehub-emergency-symbols')) {
    currentMap.addLayer({
      id: 'ridehub-emergency-symbols',
      type: 'symbol',
      source: 'ridehub-emergency',
      layout: {
        'text-field': ['get', 'symbol'],
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Regular'],
        'text-size': 10,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#101518',
        'text-halo-width': 0.5,
      },
    })
  }

  applyMapDimension(currentMap)
  currentMap.moveLayer('ridehub-route-casing')
  currentMap.moveLayer('ridehub-route-glow')
  currentMap.moveLayer('ridehub-route-line')
  currentMap.moveLayer('ridehub-emergency-points')
  currentMap.moveLayer('ridehub-emergency-symbols')
  currentMap.setLayoutProperty(
    'ridehub-emergency-points',
    'visibility',
    isNavigating.value ? 'none' : 'visible',
  )
  currentMap.setLayoutProperty(
    'ridehub-emergency-symbols',
    'visibility',
    isNavigating.value ? 'none' : 'visible',
  )
  drawMapSelections()
}

function applyMapDimension(currentMap: MapboxMap) {
  currentMap.setPitch(is3D.value ? 60 : 0)
  currentMap.setBearing(is3D.value ? -12 : 0)
  currentMap.setTerrain(is3D.value ? { source: 'ridehub-terrain', exaggeration: 1.15 } : null)
  if (currentMap.getLayer('ridehub-3d-buildings')) {
    currentMap.setLayoutProperty('ridehub-3d-buildings', 'visibility', is3D.value ? 'visible' : 'none')
  }
}

function toggleMapDimension() {
  is3D.value = !is3D.value
  if (map?.isStyleLoaded()) {
    applyMapDimension(map)
    map.setZoom(16.5)
  }
}

async function searchPlaces() {
  const query = searchQuery.value.trim()
  if (query.length < 3) {
    searchError.value = 'Enter at least 3 characters to search for a place.'
    searchResults.value = []
    return
  }

  const generation = ++searchGeneration
  searching.value = true
  searchError.value = null
  searchResults.value = []
  try {
    const params = new URLSearchParams({
      access_token: mapboxToken,
      limit: '5',
      autocomplete: 'true',
      types: 'poi,address,place,locality,neighborhood',
      language: 'en',
    })
    if (location.position) {
      params.set('proximity', `${location.position.longitude},${location.position.latitude}`)
    }
    const response = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${params}`,
      { signal: AbortSignal.timeout(12_000) },
    )
    if (!response.ok) throw new Error(`Place search returned HTTP ${response.status}.`)
    const payload: unknown = await response.json()
    if (!isRecord(payload) || !Array.isArray(payload.features)) {
      throw new Error('The place search returned an invalid response.')
    }
    if (generation !== searchGeneration) return
    searchResults.value = payload.features
      .map(parsePlace)
      .filter((place): place is Place => place !== null)
    if (searchResults.value.length === 0) searchError.value = 'No matching places were found. Try a nearby landmark or address.'
  } catch (reason) {
    if (generation !== searchGeneration) return
    searchError.value = reason instanceof Error
      ? reason.message
      : 'Place search could not be completed. Check your connection and Mapbox token scopes.'
  } finally {
    if (generation === searchGeneration) searching.value = false
  }
}

async function searchEmergencyServices(category: EmergencyCategoryId) {
  const generation = ++emergencySearchGeneration
  emergencyCategory.value = category
  emergencyPlaces.value = []
  emergencyError.value = null
  focusedEmergencyPlaceId.value = null
  emergencyLoading.value = true
  drawMapSelections()

  if (!location.position) await getLocation()
  const position = location.position
  if (!position) {
    if (generation === emergencySearchGeneration) {
      emergencyError.value = 'Allow device location to find nearby emergency services.'
      emergencyLoading.value = false
    }
    return
  }

  const params = new URLSearchParams({
    access_token: mapboxToken,
    language: 'en',
    limit: category === 'vulcanizing' ? '10' : '12',
    proximity: `${position.longitude},${position.latitude}`,
  })
  const searchPath = category === 'vulcanizing'
    ? 'forward'
    : `category/${category}`
  if (category === 'vulcanizing') {
    params.set('q', 'vulcanizing')
    params.set('types', 'poi')
  }

  try {
    const response = await fetch(
      `https://api.mapbox.com/search/searchbox/v1/${searchPath}?${params}`,
      { signal: AbortSignal.timeout(12_000) },
    )
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Mapbox denied nearby search. Check that this public token can use the Search Box API.')
      }
      throw new Error(`Nearby service search returned HTTP ${response.status}.`)
    }

    const payload: unknown = await response.json()
    if (!isRecord(payload) || !Array.isArray(payload.features)) {
      throw new Error('Nearby service search returned an invalid response.')
    }
    if (generation !== emergencySearchGeneration) return

    emergencyPlaces.value = payload.features
      .map((feature) => parseEmergencyPlace(feature, category))
      .filter((place): place is EmergencyPlace => place !== null)
      .sort((left, right) => (left.distanceMeters ?? Number.POSITIVE_INFINITY)
        - (right.distanceMeters ?? Number.POSITIVE_INFINITY))
    if (emergencyPlaces.value.length === 0) {
      emergencyError.value = category === 'vulcanizing'
        ? 'No nearby vulcanizing shops were found. Try searching for “tire repair” or “vulcanizing” by name.'
        : 'No listed services were found nearby. Try another category or search for a place by name.'
    }
    drawMapSelections()
  } catch (reason) {
    if (generation !== emergencySearchGeneration) return
    emergencyError.value = reason instanceof Error
      ? reason.message
      : 'Nearby service search failed. Check your connection and Mapbox Search Box access.'
  } finally {
    if (generation === emergencySearchGeneration) emergencyLoading.value = false
  }
}

function clearEmergencyServices() {
  emergencySearchGeneration += 1
  emergencyCategory.value = null
  emergencyPlaces.value = []
  emergencyLoading.value = false
  emergencyError.value = null
  focusedEmergencyPlaceId.value = null
  drawMapSelections()
}

function focusEmergencyPlace(place: EmergencyPlace) {
  focusedEmergencyPlaceId.value = place.id
  map?.flyTo({ center: [place.longitude, place.latitude], zoom: 16, duration: 650 })
}

function useEmergencyPlaceAsDestination(place: EmergencyPlace) {
  choosePlace({
    id: place.id,
    name: place.name,
    placeName: place.placeName,
    longitude: place.longitude,
    latitude: place.latitude,
  })
}

function choosePlace(place: Place) {
  selectedPlace.value = place
  routePlan.value = null
  routeError.value = null
  searchError.value = null
  persistDestination(place)
  searchResults.value = []
  isPickingDestination.value = false
  if (map) map.getCanvas().style.cursor = ''
  drawMapSelections()
  if (map) {
    map.flyTo({ center: [place.longitude, place.latitude], zoom: 14, duration: 800 })
  }
  if (location.position) {
    void buildRoute()
  }
}

async function toggleMapDestinationPicking() {
  if (!hasMapboxToken.value) return
  isPickingDestination.value = !isPickingDestination.value
  searchError.value = null
  searchResults.value = []
  if (map) map.getCanvas().style.cursor = isPickingDestination.value ? 'crosshair' : ''
  if (isPickingDestination.value && !location.position) {
    await getLocation()
    if (!location.position) isPickingDestination.value = false
  }
}

function clearSelection() {
  persistDestination(null)
  selectedPlace.value = null
  routePlan.value = null
  routeError.value = null
  searchError.value = null
  searchResults.value = []
  drawMapSelections()
}

async function buildRoute() {
  const destination = selectedPlace.value
  const currentPosition = location.position
  if (!destination || !currentPosition) {
    routeError.value = 'Get a current GPS fix and select a place before requesting a route.'
    return
  }

  routeLoading.value = true
  routeError.value = null
  routePlan.value = null
  drawMapSelections()
  try {
    const coordinates = `${currentPosition.longitude},${currentPosition.latitude};${destination.longitude},${destination.latitude}`
    const params = new URLSearchParams({
      access_token: mapboxToken,
      geometries: 'geojson',
      overview: 'full',
      steps: 'true',
      language: 'en',
    })
    const response = await fetch(
      `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}?${params}`,
      { signal: AbortSignal.timeout(15_000) },
    )
    if (!response.ok) throw new Error(`Route request returned HTTP ${response.status}.`)
    const payload: unknown = await response.json()
    const plan = parseRoute(payload)
    if (!plan) throw new Error('No driving route is available between your current location and the selected place.')
    routePlan.value = plan
    drawMapSelections()

    if (map) {
      const longitudes = plan.coordinates.map(([longitude]) => longitude)
      const latitudes = plan.coordinates.map(([, latitude]) => latitude)
      const bounds: [[number, number], [number, number]] = [
        [Math.min(...longitudes), Math.min(...latitudes)],
        [Math.max(...longitudes), Math.max(...latitudes)],
      ]
      map.fitBounds(bounds, { padding: 56, maxZoom: 15, duration: 850 })
    }
  } catch (reason) {
    routeError.value = reason instanceof Error
      ? reason.message
      : 'Route could not be loaded. Check your connection and Mapbox Directions access.'
  } finally {
    routeLoading.value = false
  }
}

async function handlePlaceAction() {
  if (isNavigating.value) {
    await stopNavigation()
    return
  }
  if (startingNavigation.value || routeLoading.value) return
  await startNavigation()
}

async function startNavigation() {
  if (!selectedPlace.value || startingNavigation.value || routeLoading.value || isNavigating.value) return

  startingNavigation.value = true
  trackingError.value = null
  routeError.value = null
  try {
    if (!location.position) {
      await location.locate()
    } else {
      try {
        await location.locate()
      } catch {
        // Keep the saved GPS fix and continue; live updates can still be retried below.
      }
    }
    await buildRoute()
    if (!routePlan.value) return

    await location.startWatching()
    if (!location.watching) throw new Error('Live GPS tracking did not start.')
    is3D.value = true
    if (map?.isStyleLoaded()) applyMapDimension(map)
    isNavigating.value = true
    updateRiderMarkerPresentation()
    if (location.position) updateMapPosition(location.position)
  } catch (reason) {
    trackingError.value = reason instanceof Error
      ? reason.message
      : 'Live GPS tracking could not be started.'
  } finally {
    startingNavigation.value = false
  }
}

async function stopNavigation() {
  isNavigating.value = false
  updateRiderMarkerPresentation()
  if (map?.isStyleLoaded()) {
    map.easeTo({
      zoom: map.getZoom(),
      pitch: is3D.value ? 60 : 0,
      bearing: is3D.value ? -12 : 0,
      offset: [0, 0],
      duration: 350,
    })
  }
  try {
    await location.stopWatching()
  } catch (reason) {
    trackingError.value = reason instanceof Error
      ? reason.message
      : 'Live GPS tracking could not be stopped.'
  }
}

function handleVisibilityChange() {
  if (document.hidden) {
    stopAutomaticWeatherRefresh()
    if (isNavigating.value) {
      trackingError.value = 'Trip tracking paused because RideHub is no longer visible. Start the trip again when you return.'
      void stopNavigation()
    }
    return
  }
  if (isActive) startAutomaticWeatherRefresh()
}

function refreshWeatherForSavedLocation() {
  if (!isActive || document.hidden || !location.position) return
  void weather.checkCurrentLocation(location.position).catch(() => {
    // The weather store exposes the provider error in the Home weather panel.
  })
}

function stopAutomaticWeatherRefresh() {
  if (weatherRefreshTimer) clearInterval(weatherRefreshTimer)
  weatherRefreshTimer = null
}

function startAutomaticWeatherRefresh() {
  stopAutomaticWeatherRefresh()
  refreshWeatherForSavedLocation()
  weatherRefreshTimer = setInterval(refreshWeatherForSavedLocation, 60_000)
}

async function getLocation(): Promise<boolean> {
  try {
    await location.locate()
    return true
  } catch (reason) {
    location.error = reason instanceof Error ? reason.message : 'Location access could not be completed.'
    return false
  }
}

async function showMap(position: RiderPosition) {
  if (!mapboxToken || !isActive) return
  const container = document.getElementById('ridehub-map')
  if (!container) return

  if (map && riderMarker) {
    updateMapPosition(position)
    return
  }

  if (mapInitialization) {
    await mapInitialization
    updateMapPosition(position)
    return
  }

  const generation = mapGeneration
  mapLoading.value = true
  mapError.value = null
  const initialization = (async () => {
    try {
      const [{ default: mapboxgl }] = await Promise.all([
        import('mapbox-gl'),
        import('mapbox-gl/dist/mapbox-gl.css'),
      ])
      if (!isActive || generation !== mapGeneration || !container.isConnected) return

      mapboxMarkerConstructor = mapboxgl.Marker
      mapboxgl.accessToken = mapboxToken
      const createdMap = new mapboxgl.Map({
        container,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [position.longitude, position.latitude],
        zoom: 15.3,
        pitch: is3D.value ? 60 : 0,
        bearing: is3D.value ? -12 : 0,
        attributionControl: true,
      })
      map = createdMap
      let mapHasLoaded = false
      createdMap.getCanvas().style.cursor = isPickingDestination.value ? 'crosshair' : ''
      mapResizeObserver = new ResizeObserver(() => resizeMap(createdMap))
      mapResizeObserver.observe(container)
      createdMap.on('style.load', () => {
        if (map !== createdMap) return
        mapLoading.value = false
        mapError.value = null
        try {
          configureMapLayers(createdMap)
          resizeMap(createdMap)
        } catch (reason) {
          mapError.value = reason instanceof Error
            ? `The map loaded but its controls could not be configured: ${reason.message}`
            : 'The map loaded but some controls could not be configured.'
        }
      })
      createdMap.on('load', () => {
        if (map !== createdMap) return
        mapHasLoaded = true
        if (mapLoadTimeout) clearTimeout(mapLoadTimeout)
        mapLoadTimeout = null
        mapLoading.value = false
        mapError.value = null
        try {
          configureMapLayers(createdMap)
          resizeMap(createdMap)
        } catch (reason) {
          mapError.value = reason instanceof Error
            ? `The map loaded but its controls could not be configured: ${reason.message}`
            : 'The map loaded but some controls could not be configured.'
        }
      })
      createdMap.on('error', (event) => {
        if (map !== createdMap) return
        const status = 'status' in event.error ? event.error.status : undefined
        if (status === 429) {
          if (mapHasLoaded) return
          if (mapLoadTimeout) clearTimeout(mapLoadTimeout)
          mapLoadTimeout = null
          mapLoading.value = false
          mapError.value = 'Mapbox is temporarily limiting map requests (HTTP 429). Wait a few minutes or check your Mapbox usage limits, then try again.'
          return
        }
        if (status !== 401 && status !== 403) return
        if (mapLoadTimeout) clearTimeout(mapLoadTimeout)
        mapLoadTimeout = null
        mapLoading.value = false
        mapError.value = 'Mapbox rejected the access token. Check that the public token is active and allowed to use the satellite streets style.'
      })
      createdMap.on('click', (event) => {
        if (!isPickingDestination.value) return
        const latitude = Number(event.lngLat.lat.toFixed(6))
        const longitude = Number(event.lngLat.lng.toFixed(6))
        choosePlace({
          id: `map:${latitude},${longitude}`,
          name: 'Pinned destination',
          placeName: `Map pin · ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
          longitude,
          latitude,
        })
      })
      riderMarkerElement = document.createElement('div')
      riderMarkerElement.className = 'rider-marker'
      riderMarkerElement.setAttribute('role', 'img')
      const markerCore = document.createElement('span')
      markerCore.className = 'rider-marker__core'
      const markerGlyph = document.createElement('span')
      markerGlyph.className = 'rider-marker__glyph'
      markerGlyph.append(createMotorcycleGlyph())
      riderMarkerName = document.createElement('span')
      riderMarkerName.className = 'rider-marker__label'
      markerCore.append(markerGlyph)
      riderMarkerElement.append(riderMarkerName, markerCore)
      updateRiderMarkerPresentation()
      riderMarker = new mapboxgl.Marker({ element: riderMarkerElement, anchor: 'center' })
        .setLngLat([position.longitude, position.latitude])
        .addTo(createdMap)
      resizeMap(createdMap)
      mapLoadTimeout = setTimeout(() => {
        if (map !== createdMap || !mapLoading.value) return
        mapLoading.value = false
        mapError.value = 'The map is taking too long to load. Check your connection and retry.'
      }, mapLoadTimeoutMs)
    } catch (reason) {
      mapLoading.value = false
      mapError.value = reason instanceof Error
        ? `Map could not be initialized: ${reason.message}`
        : 'Map could not be initialized. Check your connection and Mapbox token settings.'
    }
  })()

  mapInitialization = initialization
  try {
    await initialization
  } finally {
    if (mapInitialization === initialization) mapInitialization = null
  }
}

function updateMapPosition(position: RiderPosition) {
  if (!map || !riderMarker) return
  const center: [number, number] = [position.longitude, position.latitude]
  riderMarker.setLngLat(center)
  if (!isNavigating.value) {
    resizeMap(map)
    return
  }
  const routeBearing = nearestRoutePosition(position)?.bearing
  const bearing = position.speed !== null && position.speed >= 1 && position.heading !== null
    ? position.heading
    : routeBearing ?? (is3D.value ? -12 : 0)
  map.easeTo({
    center,
    zoom: map.getZoom(),
    pitch: is3D.value ? 64 : 0,
    bearing,
    offset: [0, Math.round(map.getContainer().clientHeight * 0.17)],
    duration: 750,
  })
  drawMapSelections()
  resizeMap(map)
}

function zoomMapAroundRider(amount: number) {
  if (!map || !riderMarker) return
  map.easeTo({
    zoom: map.getZoom() + amount,
    around: riderMarker.getLngLat(),
    duration: 250,
  })
}

function resizeMap(currentMap: MapboxMap) {
  requestAnimationFrame(() => {
    if (map === currentMap && isActive) currentMap.resize()
  })
}

async function retryMap() {
  mapError.value = null
  if (!location.position) {
    await getLocation()
    return
  }

  cleanupMap()
  mapError.value = null
  await nextTick()
  await showMap(location.position)
}

watch(() => location.position, (position) => {
  updateRiderMarkerPresentation()
  if (position) {
    void weather.checkCurrentLocation(position).catch(() => {
      // The weather store exposes the provider error in the Home weather panel.
    })
    if (
      selectedPlace.value
      && !routePlan.value
      && !routeLoading.value
      && isActive
    ) {
      void buildRoute()
    }
  }
  if (position && isActive) void nextTick(() => showMap(position))
})

watch(isNavigating, (navigating) => {
  if (typeof document !== 'undefined') {
    document.body.classList.toggle('ridehub-navigating', navigating)
  }
  if (!map?.isStyleLoaded()) return
  for (const layer of ['ridehub-emergency-points', 'ridehub-emergency-symbols']) {
    if (map.getLayer(layer)) {
      map.setLayoutProperty(layer, 'visibility', navigating ? 'none' : 'visible')
    }
  }
  if (navigating && location.position) {
    void nextTick(() => {
      if (isNavigating.value && location.position) updateMapPosition(location.position)
    })
  }
})

async function refreshLocation() {
  const located = await getLocation()
  if (located && !isNavigating.value && map && location.position) {
    map.easeTo({
      center: [location.position.longitude, location.position.latitude],
      duration: 350,
    })
  }
}

function cleanupMap() {
  mapGeneration += 1
  mapInitialization = null
  mapResizeObserver?.disconnect()
  mapResizeObserver = null
  if (mapLoadTimeout) clearTimeout(mapLoadTimeout)
  mapLoadTimeout = null
  mapLoading.value = false
  riderMarker?.remove()
  destinationMarker?.remove()
  map?.remove()
  riderMarker = null
  destinationMarker = null
  mapboxMarkerConstructor = null
  riderMarkerElement = null
  riderMarkerName = null
  map = null
  routeLoading.value = false
}

onMounted(() => document.addEventListener('visibilitychange', handleVisibilityChange))

onIonViewDidEnter(() => {
  isActive = true
  startAutomaticWeatherRefresh()
  const position = location.position
  if (position) {
    void nextTick(() => showMap(position))
    if (selectedPlace.value && !routePlan.value) {
      void buildRoute()
    }
  }
})

onIonViewDidLeave(() => {
  isActive = false
  stopAutomaticWeatherRefresh()
  isPickingDestination.value = false
  if (isNavigating.value) {
    trackingError.value = 'Trip tracking stopped when you left the Live Map. Start again when you return.'
  }
  void stopNavigation()
  cleanupMap()
})

onBeforeUnmount(() => {
  stopAutomaticWeatherRefresh()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  document.body.classList.remove('ridehub-navigating')
  void stopNavigation()
  cleanupMap()
})
</script>

<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main :class="['screen', 'screen--map', { 'screen--map--navigation': isNavigating }]">
        <header class="topline">
          <div class="brand-lockup" aria-label="RideHub">
            <BrandLogo />
          </div>
          <span :class="['status-pill', { 'status-pill--active': location.position || isNavigating }]">
            <span :class="['status-dot', { 'status-dot--idle': !location.position }]" />
            {{ isNavigating ? 'TRIP ACTIVE' : location.watching ? 'GPS LIVE' : location.position ? 'LAST GPS FIX' : 'GPS ON DEMAND' }}
          </span>
        </header>

        <section class="map-heading">
          <p class="eyebrow">OUT THERE, TOGETHER</p>
          <h1 class="page-title">Live map</h1>
        </section>

        <section class="map-tools" aria-label="Destination">
          <div class="map-ride-type" aria-label="Motorcycle GPS tracking">
            <span aria-hidden="true">🏍️</span>
            <span>Motorcycle GPS</span>
          </div>
          <form v-if="hasMapboxToken" class="map-search" @submit.prevent="searchPlaces">
            <label class="sr-only" for="map-place-query">Search for a destination</label>
            <input id="map-place-query" v-model="searchQuery" type="search" autocomplete="off" placeholder="Search a place or address">
            <button class="map-search__submit" type="submit" :disabled="searching" aria-label="Search places">
              <ion-icon :icon="searchOutline" />
            </button>
          </form>
          <p v-if="searching" class="map-tool-status" role="status">Searching Mapbox places…</p>
          <p v-if="searchError" class="map-tool-error" role="alert">{{ searchError }}</p>
          <div v-if="searchResults.length" class="map-search-results" role="list">
            <button
              v-for="place in searchResults"
              :key="place.id"
              class="map-search-result"
              type="button"
              role="listitem"
              @click="choosePlace(place)"
            >
              <span class="map-search-result__icon"><ion-icon :icon="navigateOutline" /></span>
              <span><strong>{{ place.name }}</strong><small>{{ place.placeName }}</small></span>
            </button>
          </div>
          <button
            class="map-pick-toggle"
            type="button"
            :aria-pressed="isPickingDestination"
            :disabled="!hasMapboxToken"
            @click="toggleMapDestinationPicking"
          >
            {{ isPickingDestination ? 'Cancel map selection' : 'Choose destination on map' }}
          </button>
          <p v-if="isPickingDestination" class="map-pick-hint" role="status">
            {{ location.position ? 'Tap the map to save your destination.' : 'Allow location access to load the map, then tap your destination.' }}
          </p>
          <div v-if="selectedPlace" class="map-selected-place">
            <div class="map-selected-place__copy">
              <span>{{ destinationSaved ? 'DESTINATION · SAVED ON THIS DEVICE' : 'DESTINATION' }}</span>
              <strong>{{ selectedPlace.name }}</strong>
              <small>{{ selectedPlace.placeName }}</small>
            </div>
            <button
              class="map-selected-place__route"
              type="button"
              :disabled="routeLoading || startingNavigation || location.loading || !location.position || !hasMapboxToken"
              @click="handlePlaceAction"
            >
              {{
                routeLoading
                  ? 'Loading route…'
                  : startingNavigation
                    ? 'Starting ride…'
                    : isNavigating
                      ? 'End ride'
                      : 'Start ride'
              }}
            </button>
            <button class="map-selected-place__clear" type="button" aria-label="Clear selected place" @click="clearSelection">
              ×
            </button>
          </div>

          <section v-if="hasMapboxToken" class="emergency-finder" aria-labelledby="emergency-finder-title">
            <div class="emergency-finder__heading">
              <div>
                <h2 id="emergency-finder-title">Nearby services</h2>
                <p>Find emergency help, fuel, and tire repairs near you.</p>
              </div>
              <button
                v-if="emergencyCategory"
                class="emergency-finder__clear"
                type="button"
                @click="clearEmergencyServices"
              >
                Clear
              </button>
            </div>
            <div class="emergency-categories">
              <button
                v-for="category in emergencyCategories"
                :key="category.id"
                :class="['emergency-category', { 'emergency-category--active': emergencyCategory === category.id }]"
                type="button"
                :aria-pressed="emergencyCategory === category.id"
                :disabled="emergencyLoading"
                @click="searchEmergencyServices(category.id)"
              >
                <span :class="['emergency-category__symbol', `emergency-category__symbol--${category.id}`]">
                  {{ category.symbol }}
                </span>
                {{ category.label }}
              </button>
            </div>
            <p v-if="emergencyLoading" class="map-tool-status" role="status">
              Finding nearby {{ emergencyCategories.find((item) => item.id === emergencyCategory)?.label.toLowerCase() }}…
            </p>
            <p v-if="emergencyError" class="map-tool-error" role="alert">{{ emergencyError }}</p>
            <div v-if="emergencyPlaces.length" class="emergency-place-list">
              <article
                v-for="place in emergencyPlaces"
                :key="place.id"
                :class="['emergency-place', { 'emergency-place--focused': focusedEmergencyPlaceId === place.id }]"
              >
                <button
                  class="emergency-place__focus"
                  type="button"
                  :aria-label="`Show ${place.name} on the map`"
                  @click="focusEmergencyPlace(place)"
                >
                  <span :class="['emergency-category__symbol', `emergency-category__symbol--${place.category}`]">
                    {{ emergencyCategories.find((item) => item.id === place.category)?.symbol }}
                  </span>
                  <span class="emergency-place__copy">
                    <strong>{{ place.name }}</strong>
                    <small>{{ place.placeName }}</small>
                    <small v-if="place.distanceMeters !== null">About {{ formatDistance(place.distanceMeters) }} away</small>
                  </span>
                </button>
                <button
                  class="emergency-place__destination"
                  type="button"
                  :disabled="isNavigating || startingNavigation || routeLoading"
                  @click="useEmergencyPlaceAsDestination(place)"
                >
                  Use as destination
                </button>
              </article>
            </div>
            <p class="emergency-finder__note">
              Place listings by Mapbox may be incomplete or out of date. For urgent help, call your local emergency number.
            </p>
          </section>
        </section>

        <section class="map-frame" aria-label="Live map">
          <div v-if="hasMapboxToken && location.position" id="ridehub-map" class="map-canvas" />

          <div v-if="!hasMapboxToken" class="map-empty">
            <span class="quick-icon"><ion-icon :icon="navigateOutline" /></span>
            <h2>Connect your map</h2>
            <p>Add a public Mapbox access token to your local environment to load the real map.</p>
            <button class="primary-action" :disabled="location.loading" @click="getLocation">
              {{ location.loading ? 'Checking GPS…' : 'Get device location' }}
            </button>
            <p v-if="location.position" class="map-footnote">
              GPS fix received · ±{{ Math.round(location.position.accuracy) }} m
            </p>
          </div>

          <div v-else-if="!location.position" class="map-empty">
            <span class="quick-icon"><ion-icon :icon="locateOutline" /></span>
            <h2>Find your place</h2>
            <p>Allow location access to center the map on your actual device position.</p>
            <button class="primary-action" :disabled="location.loading" @click="getLocation">
              {{ location.loading ? 'Finding your location…' : 'Use current location' }}
            </button>
          </div>

          <div v-if="location.position && hasMapboxToken && !isNavigating" class="map-overlay">
            <span :class="['status-dot', { 'status-dot--idle': !location.watching }]" />
            <span>
              {{ riderName }}{{ isNavigating ? ' · motorcycle trip active' : location.watching ? ' · live GPS location' : ' · last GPS location' }}
              · ±{{ Math.round(location.position.accuracy) }} m
              <template v-if="location.watching && speedKph !== null"> · {{ speedKph }} km/h</template>
            </span>
          </div>
          <div
            v-if="location.position && hasMapboxToken"
            class="map-zoom-controls"
            role="group"
            aria-label="Map zoom controls"
          >
            <button type="button" aria-label="Zoom in around rider" @click="zoomMapAroundRider(1)">+</button>
            <button type="button" aria-label="Zoom out around rider" @click="zoomMapAroundRider(-1)">−</button>
          </div>
          <div v-if="isNavigating && selectedPlace && routePlan" class="navigation-hud">
            <div class="navigation-hud__destination">
              <span class="navigation-hud__eyebrow"><span class="status-dot" /> Ride in progress</span>
              <strong>{{ selectedPlace.name }}</strong>
              <span>{{ formatDistance(routePlan.distanceMeters) }} · {{ formatDuration(routePlan.durationSeconds) }} estimate</span>
            </div>
            <button class="navigation-hud__end" type="button" @click="handlePlaceAction">
              End ride
            </button>
          </div>
          <div v-if="isNavigating && location.position" class="navigation-live-status" aria-live="polite">
            <span class="navigation-live-status__indicator"><span class="status-dot" /> Live GPS</span>
            <span>{{ speedKph === null ? 'Speed unavailable' : `${speedKph} km/h` }} · ±{{ Math.round(location.position.accuracy) }} m</span>
          </div>
          <div v-if="isNavigating && (trackingError || location.error)" class="navigation-warning" role="alert">
            {{ trackingError || location.error }}
          </div>
          <div
            v-if="mapLoading && !mapError"
            class="map-feedback"
            role="status"
          >
            Loading map…
          </div>
          <div v-if="mapError" class="map-feedback map-feedback--error" role="alert">
            <strong>Map unavailable</strong>
            <p>{{ mapError }}</p>
            <div v-if="location.position" class="map-feedback__position">
              <span>{{ location.watching ? 'Live rider location' : 'Last saved rider location' }}</span>
              <strong>{{ location.position.latitude.toFixed(6) }}, {{ location.position.longitude.toFixed(6) }}</strong>
              <small>GPS accuracy ±{{ Math.round(location.position.accuracy) }} m</small>
            </div>
            <div v-if="selectedPlace" class="map-feedback__finish">
              <span aria-hidden="true">🏁</span>
              <div>
                <small>Finish · destination</small>
                <strong>{{ selectedPlace.name }}</strong>
                <small>{{ selectedPlace.latitude.toFixed(6) }}, {{ selectedPlace.longitude.toFixed(6) }}</small>
              </div>
            </div>
            <button class="primary-action" type="button" @click="retryMap">Try again</button>
          </div>
          <button
            v-if="location.position && hasMapboxToken && !isNavigating"
            class="map-fab map-fab--3d"
            type="button"
            :aria-label="is3D ? 'Switch to two-dimensional map' : 'Switch to three-dimensional map'"
            :aria-pressed="is3D"
            @click="toggleMapDimension"
          >
            <ion-icon :icon="layersOutline" />
            <span>{{ is3D ? '3D' : '2D' }}</span>
          </button>
          <button
            v-if="location.position && hasMapboxToken"
            class="map-fab"
            type="button"
            aria-label="Refresh device location"
            :disabled="location.loading"
            @click="refreshLocation"
          >
            <ion-icon :icon="locateOutline" />
          </button>
        </section>

        <p v-if="trackingError" class="phase-note" role="alert">
          <ion-icon :icon="locateOutline" />
          {{ trackingError }}
        </p>
        <section v-if="routeError" class="route-error" role="alert">
          <strong>Route unavailable</strong>
          <p>{{ routeError }}</p>
        </section>
        <section v-if="routePlan" class="route-card" aria-live="polite">
          <div class="route-card__heading">
            <div>
              <p class="eyebrow">ROUTE FROM YOUR CURRENT GPS FIX</p>
              <h2>{{ selectedPlace?.name }}</h2>
            </div>
            <span class="route-card__badge">{{ isNavigating ? 'LIVE GPS ACTIVE' : 'MOTOR ROAD ESTIMATE' }}</span>
          </div>
          <div class="route-metrics">
            <div><strong>{{ formatDistance(routePlan.distanceMeters) }}</strong><span>Distance</span></div>
            <div><strong>{{ formatDuration(routePlan.durationSeconds) }}</strong><span>Estimated travel time</span></div>
          </div>
          <ol v-if="routePlan.steps.length" class="route-steps">
            <li v-for="(step, index) in routePlan.steps" :key="`${index}-${step.instruction}`">
              <span>{{ index + 1 }}</span>
              <div><strong>{{ step.instruction }}</strong><small>{{ formatDistance(step.distanceMeters) }}</small></div>
            </li>
          </ol>
          <p class="route-disclaimer">Mapbox driving directions are estimates, not motorcycle-specific or turn-by-turn navigation. Follow local road signs and conditions.</p>
        </section>

        <p v-if="location.error" class="phase-note" role="alert">
          <ion-icon :icon="locateOutline" />
          {{ location.error }}
        </p>
        <p class="map-footnote">
          GPS starts only after you request it. The map labels this device's GPS marker with your signed-in name.
          An active trip follows actual foreground GPS on this device
          and stops when you leave the map or background the app. Weather checks send coordinates to the
          weather provider; Mapbox powers place search and motorcycle driving estimates. Group sharing and
          background tracking are not configured.
        </p>
      </main>
    </ion-content>
  </ion-page>
</template>
