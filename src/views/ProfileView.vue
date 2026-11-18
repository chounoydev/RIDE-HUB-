<script setup lang="ts">
import { computed, ref } from 'vue'
import { IonContent, IonIcon, IonPage, onIonViewDidEnter } from '@ionic/vue'
import { alertCircleOutline, cameraOutline, logOutOutline, personOutline, shieldCheckmarkOutline } from 'ionicons/icons'
import { useRouter } from 'vue-router'
import BrandLogo from '@/components/BrandLogo.vue'
import { deleteProfileAvatar, getProfileAvatarUrl, uploadProfileAvatar } from '@/services/avatar'
import { getAuthClient, getAuthErrorMessage } from '@/services/auth'
import type { WeatherPreferences } from '@/services/weather'
import { useAuthStore } from '@/stores/auth'
import { useWeatherStore } from '@/stores/weather'

const weather = useWeatherStore()
const auth = useAuthStore()
const router = useRouter()
const accountError = ref('')
const avatarInput = ref<HTMLInputElement | null>(null)
const avatarUrl = ref('')
const avatarPreviewUrl = ref('')
const avatarError = ref('')
const avatarSuccess = ref('')
const avatarUploading = ref(false)
const avatarSource = computed(() => avatarPreviewUrl.value || avatarUrl.value)
const avatarInitial = computed(() => auth.user?.name?.trim().charAt(0).toUpperCase() || 'R')
const weatherSettings = [
  { key: 'heavyRain', label: 'Heavy rain' },
  { key: 'thunderstorm', label: 'Thunderstorms' },
  { key: 'lightning', label: 'Official lightning warnings' },
  { key: 'strongWind', label: 'Strong winds' },
  { key: 'extremeHeat', label: 'Extreme heat' },
  { key: 'severeWeather', label: 'Severe weather' },
  { key: 'floodingRisk', label: 'Official flood warnings' },
] as const

function toggleWeatherPreference(key: keyof WeatherPreferences) {
  weather.setPreference(key, !weather.preferences[key])
}

async function signOut() {
  accountError.value = ''
  try {
    await auth.signOut()
    await router.replace('/')
  } catch (error) {
    accountError.value = getAuthErrorMessage(error)
  }
}

function isOwnedAvatar(value: string | null | undefined) {
  return Boolean(value && auth.user && value.startsWith(`avatars/${auth.user.id}/`))
}

async function loadAvatar() {
  const image = auth.user?.image
  avatarError.value = ''
  if (!image) {
    avatarUrl.value = ''
    return
  }

  if (image.startsWith('avatars/')) {
    try {
      avatarUrl.value = await getProfileAvatarUrl(image)
    } catch (error) {
      avatarUrl.value = ''
      avatarError.value = getAuthErrorMessage(error)
    }
    return
  }

  if (image.startsWith('https://')) {
    avatarUrl.value = image
    return
  }

  avatarUrl.value = ''
}

async function changeAvatar(event: Event) {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  const file = input.files?.[0]
  if (!file) return

  avatarError.value = ''
  avatarSuccess.value = ''
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    avatarError.value = 'Choose a JPEG, PNG, or WebP image.'
    input.value = ''
    return
  }
  if (file.size > 4 * 1024 * 1024) {
    avatarError.value = 'Profile pictures must be 4 MB or smaller.'
    input.value = ''
    return
  }

  const previousImage = auth.user?.image
  const previewUrl = URL.createObjectURL(file)
  avatarPreviewUrl.value = previewUrl
  avatarUploading.value = true
  let uploadedKey: string | null = null
  let profileUpdated = false

  try {
    const uploaded = await uploadProfileAvatar(file)
    uploadedKey = uploaded.objectKey
    const result = await getAuthClient().updateUser({ image: uploaded.objectKey })
    if (result.error) throw result.error
    profileUpdated = true
    avatarUrl.value = uploaded.url
    avatarPreviewUrl.value = ''
    URL.revokeObjectURL(previewUrl)

    try {
      await auth.refreshSession()
    } catch {
      avatarError.value = 'Photo saved. Refresh your profile if the updated picture does not appear.'
    }
    if (!avatarError.value) avatarSuccess.value = 'Profile photo saved to your account.'

    if (isOwnedAvatar(previousImage) && previousImage !== uploaded.objectKey) {
      try {
        await deleteProfileAvatar(previousImage!)
      } catch {
        avatarError.value = 'Photo updated, but the previous image could not be removed from storage.'
        avatarSuccess.value = ''
      }
    }
  } catch (error) {
    let message = getAuthErrorMessage(error)
    if (uploadedKey && !profileUpdated) {
      try {
        await deleteProfileAvatar(uploadedKey)
      } catch {
        message = `${message} The incomplete upload could not be removed from storage.`
      }
    }
    avatarPreviewUrl.value = ''
    avatarSuccess.value = ''
    URL.revokeObjectURL(previewUrl)
    avatarError.value = message
  } finally {
    avatarUploading.value = false
    input.value = ''
  }
}

onIonViewDidEnter(() => {
  void loadAvatar()
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
        </header>

        <section class="page-header">
          <p class="eyebrow">YOUR RIDER CARD</p>
          <h1 class="page-title">Profile</h1>
        </section>

        <section class="profile-card" aria-label="Profile status">
          <div class="profile-row">
            <button
              class="profile-avatar"
              type="button"
              :disabled="avatarUploading"
              :aria-label="avatarUploading ? 'Saving profile picture' : 'Choose a profile picture'"
              @click="avatarInput?.click()"
            >
              <img v-if="avatarSource" :src="avatarSource" :alt="`${auth.user?.name || 'Rider'} profile picture`" />
              <span v-else>{{ avatarInitial }}</span>
              <span class="profile-avatar__edit"><ion-icon :icon="cameraOutline" /></span>
            </button>
            <input
              ref="avatarInput"
              class="profile-avatar-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              :disabled="avatarUploading"
              @change="changeAvatar"
            />
            <div class="profile-details">
              <h2>{{ auth.user?.name || 'RideHub rider' }}</h2>
              <p>{{ auth.user?.email }}</p>
              <button
                class="profile-photo-action"
                type="button"
                :disabled="avatarUploading"
                @click="avatarInput?.click()"
              >
                <ion-icon :icon="cameraOutline" />
                {{ avatarUploading ? 'Saving photo…' : 'Change photo' }}
              </button>
            </div>
          </div>
          <p v-if="avatarError" class="weather-error profile-avatar-error" role="alert">{{ avatarError }}</p>
          <p v-else-if="avatarUploading" class="profile-avatar-hint" role="status" aria-live="polite">
            Uploading your photo and saving it to your account…
          </p>
          <p v-else-if="avatarSuccess" class="profile-avatar-success" role="status" aria-live="polite">
            {{ avatarSuccess }}
          </p>
          <p v-else class="profile-avatar-hint">JPEG, PNG or WebP · up to 4 MB</p>
          <div class="profile-stats">
            <div><strong>—</strong><span>Rides</span></div>
            <div><strong>—</strong><span>Distance</span></div>
            <div><strong>—</strong><span>Groups</span></div>
          </div>
          <div class="account-actions">
            <RouterLink v-if="auth.isAdmin" to="/admin" class="account-link">
              <ion-icon :icon="shieldCheckmarkOutline" />
              Admin portal
            </RouterLink>
            <button type="button" class="account-link" @click="signOut">
              <ion-icon :icon="logOutOutline" />
              Sign out
            </button>
          </div>
          <p v-if="accountError" class="weather-error" role="alert">{{ accountError }}</p>
        </section>

        <section class="content-section">
          <div class="section-heading">
            <h2>Privacy comes first</h2>
          </div>
          <div class="notice-card">
            <ion-icon :icon="shieldCheckmarkOutline" />
            <div>
              <strong>Your location is never shared with riders</strong>
              <span>
                GPS is requested only after you ask. A weather check sends coordinates to the RideHub
                API and WeatherAPI.com for that lookup; the weather endpoint does not store them.
                Rider-to-rider location sharing is not connected.
              </span>
            </div>
          </div>
        </section>

        <section class="content-section" aria-labelledby="weather-settings-title">
          <div class="section-heading">
            <h2 id="weather-settings-title">Weather preferences</h2>
          </div>
          <div class="settings-card">
            <div class="setting-row">
              <div>
                <strong>Show weather alerts</strong>
                <span>Hide or show alerts from your next manual forecast check.</span>
              </div>
              <button
                class="setting-toggle"
                type="button"
                role="switch"
                :aria-checked="weather.preferences.enabled"
                aria-label="Show weather alerts"
                @click="toggleWeatherPreference('enabled')"
              >
                <span />
              </button>
            </div>
            <div
              v-for="setting in weatherSettings"
              :key="setting.key"
              class="setting-row setting-row--nested"
            >
              <div>
                <strong>{{ setting.label }}</strong>
              </div>
              <button
                class="setting-toggle"
                type="button"
                role="switch"
                :aria-checked="weather.preferences[setting.key]"
                :aria-label="setting.label"
                @click="toggleWeatherPreference(setting.key)"
              >
                <span />
              </button>
            </div>
            <p class="settings-footnote">
              Preferences are stored on this device only. Background location checks, scheduled/group
              ride monitoring, sound controls, and push notification delivery are not active yet.
            </p>
          </div>
        </section>

        <section class="content-section" aria-labelledby="sos-title">
          <div class="section-heading">
            <h2 id="sos-title">Emergency assistance</h2>
          </div>
          <div class="emergency-card" role="note">
            <div class="emergency-card__title">
              <ion-icon :icon="alertCircleOutline" />
              <div>
                <strong>SOS is unavailable</strong>
                <span>No emergency alert can be created or sent from this build.</span>
              </div>
            </div>
            <button class="sos-unavailable" type="button" disabled>
              SOS NOT ACTIVE
            </button>
            <p>
              RIDEHUB is not connected to emergency contacts or dispatch services. If you need help,
              call your local emergency number directly using your phone and network.
            </p>
          </div>
        </section>
      </main>
    </ion-content>
  </ion-page>
</template>
