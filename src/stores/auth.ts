import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { authConfigured, getAuthClient, type AuthUser } from '@/services/auth'
import { clearUserLocationData } from '@/services/location-persistence'

const pendingEmailKey = 'ridehub.pending-verification-email'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const loading = ref(false)
  const initialized = ref(false)
  const pendingVerificationEmail = ref(
    typeof window === 'undefined' ? '' : window.sessionStorage.getItem(pendingEmailKey) ?? '',
  )
  let initialization: Promise<void> | null = null

  const isAdmin = computed(
    () => (user.value as (AuthUser & { role?: string }) | null)?.role === 'admin',
  )

  async function refreshSession() {
    const response = await getAuthClient().getSession()
    if (response.error) throw response.error
    user.value = response.data?.user ?? null
    initialized.value = true
    return user.value
  }

  async function initialize() {
    if (initialized.value) return
    if (!authConfigured) {
      initialized.value = true
      return
    }
    if (initialization) return initialization

    initialization = (async () => {
      loading.value = true
      try {
        await refreshSession()
      } finally {
        loading.value = false
        initialization = null
      }
    })()

    return initialization
  }

  function setPendingVerificationEmail(email: string) {
    pendingVerificationEmail.value = email.trim().toLowerCase()
    if (typeof window !== 'undefined') {
      if (pendingVerificationEmail.value) {
        window.sessionStorage.setItem(pendingEmailKey, pendingVerificationEmail.value)
      } else {
        window.sessionStorage.removeItem(pendingEmailKey)
      }
    }
  }

  async function signOut() {
    const userId = user.value?.id
    const response = await getAuthClient().signOut()
    if (response.error) throw response.error
    if (userId) {
      try {
        clearUserLocationData(userId)
      } catch (reason) {
        console.error('Unable to clear saved location data during sign-out.', reason)
      }
    }
    user.value = null
    initialized.value = true
  }

  return {
    user,
    loading,
    initialized,
    pendingVerificationEmail,
    isAdmin,
    initialize,
    refreshSession,
    setPendingVerificationEmail,
    signOut,
  }
})
