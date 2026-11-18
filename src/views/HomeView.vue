<script setup lang="ts">
import {
  IonContent,
  IonIcon,
  IonPage,
  onIonViewDidEnter,
  onIonViewDidLeave,
} from '@ionic/vue'
import {
  alertCircleOutline,
  arrowForwardOutline,
  cloudOutline,
  flagOutline,
  navigateOutline,
  peopleOutline,
  rainyOutline,
  radioOutline,
  shieldCheckmarkOutline,
  thunderstormOutline,
} from 'ionicons/icons'
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import BrandLogo from '@/components/BrandLogo.vue'
import { useLocationStore } from '@/stores/location'
import { useWeatherStore } from '@/stores/weather'

const router = useRouter()
const location = useLocationStore()
const weather = useWeatherStore()
const forecastStatus = computed(() => {
  if (weather.loading) return 'CHECKING'
  if (weather.error) return 'CHECK FAILED'
  if (!weather.snapshot) {
    return weather.serviceStatus?.weatherConfigured ? 'KEY SET' : 'SETUP NEEDED'
  }
  const age = Date.now() - Date.parse(weather.snapshot.updatedAt)
  return age >= 0 && age < 10 * 60 * 1000 ? 'WEATHER LIVE' : 'SAVED FORECAST'
})
const rideAdvice = computed(() => {
  const current = weather.snapshot?.current
  if (!current) return null

  const condition = current.condition.toLowerCase()
  const nextHours = weather.snapshot?.nextHours.slice(0, 3) ?? []
  const rainExpected = nextHours.some((hour) => hour.chanceOfRain >= 60 || hour.precipitationMm >= 0.5)
  const feelsLike = Math.max(current.temperatureC, current.feelsLikeC)

  if (/thunder|storm|lightning/.test(condition)) {
    return {
      title: 'Storms nearby',
      message: 'Consider delaying your ride. If a storm reaches you, pull over somewhere safe and avoid exposed areas.',
    }
  }
  if (/rain|drizzle|shower|sleet|snow|hail/.test(condition) || rainExpected) {
    return {
      title: 'Wet roads possible',
      message: 'Slow down, leave extra following distance, and brake gently. If visibility gets poor, stop somewhere safe.',
    }
  }
  if (/fog|mist/.test(condition)) {
    return {
      title: 'Low visibility',
      message: 'Use your lights, reduce speed, and leave extra distance. Pull over safely if you cannot see clearly.',
    }
  }
  if (current.gustKph >= 50 || current.windKph >= 35) {
    return {
      title: 'Strong winds',
      message: 'Gusts can affect motorcycle handling. Slow down and take extra care on bridges and open roads.',
    }
  }
  if (feelsLike >= 35) {
    return {
      title: 'Extreme heat',
      message: 'Drink water before and during your ride, take shaded breaks, and stop somewhere safe if you feel unwell.',
    }
  }
  if (feelsLike >= 30) {
    return {
      title: 'Hot conditions',
      message: 'Keep water handy, take breaks in the shade, and watch for fatigue in the heat.',
    }
  }
  if (/sunny|clear/.test(condition)) {
    return {
      title: 'Clear and sunny',
      message: 'Bright sun can cause glare. Wear eye protection and keep water handy for the ride.',
    }
  }
  return {
    title: current.condition,
    message: 'Conditions can change while you ride. Stay alert, check the road ahead, and take a break if you feel tired.',
  }
})
const shownAlerts = computed(() => weather.activeAlerts.slice(0, 3))
const historyAlerts = computed(() =>
  weather.visibleAlerts
    .filter((alert) => alert.expiresAt && Date.parse(alert.expiresAt) <= Date.now())
    .slice(0, 3),
)

let homeIsActive = false
let weatherRefreshTimer: ReturnType<typeof setInterval> | null = null

function openTab(tab: string) {
  void router.push(`/tabs/${tab}`)
}

function refreshWeatherForSavedLocation() {
  if (!homeIsActive || document.hidden || !location.position) return
  void weather.checkCurrentLocation(location.position).catch(() => {
    // The store exposes the provider error in the weather panel.
  })
}

function stopAutomaticWeatherRefresh() {
  if (weatherRefreshTimer) clearInterval(weatherRefreshTimer)
  weatherRefreshTimer = null
}

function handleVisibilityChange() {
  if (homeIsActive && !document.hidden) refreshWeatherForSavedLocation()
}

function formatTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Time unavailable'
    : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
}

onIonViewDidEnter(() => {
  homeIsActive = true
  void weather.refreshServiceStatus()
  refreshWeatherForSavedLocation()
  stopAutomaticWeatherRefresh()
  weatherRefreshTimer = setInterval(refreshWeatherForSavedLocation, 60_000)
})

onIonViewDidLeave(() => {
  homeIsActive = false
  stopAutomaticWeatherRefresh()
})

onMounted(() => document.addEventListener('visibilitychange', handleVisibilityChange))

onBeforeUnmount(() => {
  stopAutomaticWeatherRefresh()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="screen">
        <header class="topline">
          <div class="brand-lockup" aria-label="RideHub">
            <BrandLogo />
          </div>
          <button class="avatar-button" aria-label="Open profile" @click="openTab('profile')">
            <ion-icon :icon="shieldCheckmarkOutline" />
          </button>
        </header>

        <section class="greeting" aria-labelledby="home-title">
          <p class="eyebrow">YOUR NEXT RIDE STARTS HERE</p>
          <h1 id="home-title">Good roads.<br /><span>Good people.</span></h1>
          <p>Find your crew, share the road, ride safer.</p>
        </section>

        <section class="feature-card" aria-labelledby="feature-title">
          <div class="feature-label">
            <ion-icon :icon="radioOutline" />
            REAL GPS, ON DEMAND
          </div>
          <h2 id="feature-title">Your first ride<br />starts here.</h2>
          <p>Turn on your device location to see your position on the live map.</p>
          <button class="primary-action" @click="openTab('map')">
            Open live map
            <ion-icon :icon="arrowForwardOutline" />
          </button>
        </section>

        <section class="weather-section" aria-labelledby="weather-title">
          <div class="section-heading">
            <div>
              <p class="eyebrow">RIDE CONDITIONS</p>
              <h2 id="weather-title">Weather watch</h2>
            </div>
            <span class="weather-status">
              <span :class="['status-dot', { 'status-dot--idle': forecastStatus !== 'WEATHER LIVE' }]" />
              {{ forecastStatus }}
            </span>
          </div>

          <div class="weather-card">
            <div class="weather-card__intro">
              <span class="weather-icon"><ion-icon :icon="cloudOutline" /></span>
              <div>
                <strong>Weather near your Live Map location</strong>
                <span>Updates automatically while RideHub is open. Your last GPS fix is saved on this device until you sign out.</span>
              </div>
            </div>

            <p v-if="weather.error || location.error" class="weather-error" role="alert">
              {{ weather.error || location.error }}
            </p>

            <p v-if="!weather.snapshot && !location.position" class="weather-no-location">
              Open Live Map and locate once to start automatic weather updates for your area.
            </p>

            <template v-if="weather.snapshot">
              <div class="weather-overview">
                <div class="weather-overview__conditions">
                  <div class="weather-current">
                    <img
                      v-if="weather.snapshot.current.icon"
                      :src="`https:${weather.snapshot.current.icon}`"
                      alt=""
                      width="52"
                      height="52"
                    />
                    <div>
                      <strong>{{ Math.round(weather.snapshot.current.temperatureC) }}°</strong>
                      <span>{{ weather.snapshot.current.condition }} · {{ weather.snapshot.location.name }}</span>
                    </div>
                  </div>
                  <div class="weather-metrics">
                    <span>Feels {{ Math.round(weather.snapshot.current.feelsLikeC) }}°</span>
                    <span>Wind {{ Math.round(weather.snapshot.current.windKph) }} km/h</span>
                    <span>Gusts {{ Math.round(weather.snapshot.current.gustKph) }} km/h</span>
                  </div>
                </div>
                <aside v-if="rideAdvice" class="weather-advice" aria-label="Weather-related riding advice">
                  <span class="weather-advice__label">RIDE TIP</span>
                  <strong>{{ rideAdvice.title }}</strong>
                  <p>{{ rideAdvice.message }}</p>
                </aside>
              </div>
              <p class="weather-updated">
                Provider observation {{ formatTime(weather.snapshot.current.observedAt) }} · updated
                {{ formatTime(weather.snapshot.updatedAt) }}
              </p>
            </template>
          </div>

          <div class="weather-alert-list" aria-live="polite">
            <div v-if="shownAlerts.length === 0 && weather.snapshot && weather.preferences.enabled" class="weather-clear">
              <ion-icon :icon="shieldCheckmarkOutline" />
              <span>No active riding alerts returned for this check.</span>
            </div>
            <div v-else-if="!weather.preferences.enabled" class="weather-clear">
              <span>Weather alerts are turned off in Profile settings.</span>
            </div>
            <article
              v-for="alert in shownAlerts"
              :key="alert.id"
              :class="['weather-alert', `weather-alert--${alert.severity.toLowerCase()}`]"
            >
              <ion-icon :icon="alert.category === 'THUNDERSTORM' || alert.category === 'LIGHTNING' ? thunderstormOutline : alert.category === 'HEAVY_RAIN' ? rainyOutline : alertCircleOutline" />
              <div>
                <div class="weather-alert__heading">
                  <strong>{{ alert.title }}</strong>
                  <span>{{ alert.official ? 'OFFICIAL WARNING' : 'FORECAST' }}</span>
                </div>
                <p>{{ alert.description }}</p>
                <p v-if="alert.instruction" class="weather-alert__instruction">{{ alert.instruction }}</p>
                <small v-if="alert.expiresAt">Expires {{ formatTime(alert.expiresAt) }} · {{ alert.source }}</small>
              </div>
            </article>
          </div>

          <div v-if="historyAlerts.length" class="weather-history">
            <h3>Recent alert history</h3>
            <p v-for="alert in historyAlerts" :key="alert.id">
              <span>{{ alert.title }}</span>
              <small>Expired · {{ alert.source }}</small>
            </p>
          </div>

          <p class="weather-footnote">
            Refreshes automatically while the app is open, about every 10 minutes or after a significant location change. GPS is not sampled in the background.
            Flooding and lightning notices appear only when supplied by an official warning feed.
          </p>
        </section>

        <div class="home-grid">
          <section class="content-section">
            <div class="section-heading">
              <div>
                <p class="eyebrow">PLAN AHEAD</p>
                <h2>Your next ride</h2>
              </div>
            </div>
            <button class="empty-ride" type="button" @click="openTab('groups')">
              <div class="empty-icon"><ion-icon :icon="flagOutline" /></div>
              <div class="empty-ride__copy">
                <span class="empty-ride__eyebrow">UP NEXT</span>
                <strong>No ride planned yet</strong>
                <span>Find a crew and plan your next meetup.</span>
              </div>
              <div class="empty-ride__action">
                Find a crew
                <ion-icon :icon="arrowForwardOutline" />
              </div>
            </button>
          </section>

          <section class="content-section">
            <div class="section-heading">
              <div>
                <p class="eyebrow">SHORTCUTS</p>
                <h2>Quick access</h2>
              </div>
            </div>
            <div class="quick-grid">
              <button class="quick-action" @click="openTab('map')">
                <span class="quick-icon"><ion-icon :icon="navigateOutline" /></span>
                <span class="quick-action__copy">
                  <strong>Live map</strong>
                  <small>Explore nearby roads</small>
                </span>
                <ion-icon class="quick-action__arrow" :icon="arrowForwardOutline" />
              </button>
              <button class="quick-action" @click="openTab('groups')">
                <span class="quick-icon"><ion-icon :icon="peopleOutline" /></span>
                <span class="quick-action__copy">
                  <strong>Find a group</strong>
                  <small>Meet local riders</small>
                </span>
                <ion-icon class="quick-action__arrow" :icon="arrowForwardOutline" />
              </button>
              <button class="quick-action" @click="openTab('messages')">
                <span class="quick-icon"><ion-icon :icon="radioOutline" /></span>
                <span class="quick-action__copy">
                  <strong>Messages</strong>
                  <small>Chat with your crew</small>
                </span>
                <ion-icon class="quick-action__arrow" :icon="arrowForwardOutline" />
              </button>
            </div>
          </section>
        </div>
      </main>
    </ion-content>
  </ion-page>
</template>
