<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { IonContent, IonIcon, IonPage } from '@ionic/vue'
import { mailOutline, refreshOutline } from 'ionicons/icons'
import { useRoute, useRouter } from 'vue-router'
import BrandLogo from '@/components/BrandLogo.vue'
import { getAuthClient, getAuthErrorMessage } from '@/services/auth'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const email = ref(auth.pendingVerificationEmail)
const code = ref('')
const busy = ref(false)
const resending = ref(false)
const error = ref('')
const notice = ref('')
const configured = computed(() => Boolean(import.meta.env.VITE_NEON_AUTH_URL?.trim()))

function safeRedirect(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return '/tabs/home'
  }
  return value
}

async function verifyEmail() {
  error.value = ''
  notice.value = ''
  if (!configured.value) {
    error.value = 'Email verification is not configured for this deployment.'
    return
  }
  if (!email.value.trim() || !code.value.trim()) {
    error.value = 'Enter your email address and the verification code.'
    return
  }

  busy.value = true
  try {
    const result = await getAuthClient().emailOtp.verifyEmail({
      email: email.value.trim().toLowerCase(),
      otp: code.value.trim(),
    })
    if (result.error) throw result.error
    auth.setPendingVerificationEmail('')

    try {
      const user = await auth.refreshSession()
      if (user?.emailVerified) {
        await router.replace(safeRedirect(route.query.redirect))
        return
      }
    } catch {
      notice.value = 'Email verified, but your session could not be restored. Please sign in.'
    }

    if (!notice.value) notice.value = 'Email verified. Sign in to continue to RideHub.'
    await router.replace({ path: '/auth', query: { mode: 'login', verified: '1' } })
  } catch (reason) {
    error.value = getAuthErrorMessage(reason)
  } finally {
    busy.value = false
  }
}

async function resendCode() {
  error.value = ''
  notice.value = ''
  if (!configured.value) {
    error.value = 'Email verification is not configured for this deployment.'
    return
  }
  if (!email.value.trim()) {
    error.value = 'Enter the email address used to create your account.'
    return
  }

  resending.value = true
  try {
    const result = await getAuthClient().emailOtp.sendVerificationOtp({
      email: email.value.trim().toLowerCase(),
      type: 'email-verification',
    })
    if (result.error) throw result.error
    auth.setPendingVerificationEmail(email.value)
    notice.value = 'A new verification code was requested. Check your inbox and spam folder.'
  } catch (reason) {
    error.value = getAuthErrorMessage(reason)
  } finally {
    resending.value = false
  }
}

onMounted(async () => {
  if (!configured.value) return
  try {
    const user = await auth.refreshSession()
    if (user?.emailVerified) await router.replace(safeRedirect(route.query.redirect))
  } catch (reason) {
    error.value = getAuthErrorMessage(reason)
  }
})
</script>

<template>
  <ion-page class="verify-page">
    <ion-content :fullscreen="true">
      <main class="verify-shell">
        <RouterLink class="verify-brand" to="/">
          <BrandLogo />
        </RouterLink>
        <section class="verify-card">
          <div class="verify-icon"><ion-icon :icon="mailOutline" /></div>
          <p class="verify-kicker">ONE QUICK CHECK</p>
          <h1>Verify your email.</h1>
          <p class="verify-intro">
            Enter the code sent to your inbox. This confirms you can access the email address used
            for your RideHub account.
          </p>

          <form class="verify-form" @submit.prevent="verifyEmail">
            <label>
              <span>Email address</span>
              <input
                v-model="email"
                type="email"
                autocomplete="email"
                inputmode="email"
                maxlength="254"
                required
                placeholder="you@example.com"
                @change="auth.setPendingVerificationEmail(email)"
              />
            </label>
            <label>
              <span>Verification code</span>
              <input
                v-model="code"
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="12"
                required
                placeholder="Enter the code from your email"
              />
            </label>
            <p v-if="error" class="message message--error" role="alert">{{ error }}</p>
            <p v-if="notice" class="message message--success" role="status">{{ notice }}</p>
            <button class="verify-submit" type="submit" :disabled="busy || !configured">
              {{ busy ? 'Checking code…' : 'Verify email' }}
            </button>
          </form>
          <button class="resend-button" type="button" :disabled="resending || !configured" @click="resendCode">
            <ion-icon :icon="refreshOutline" />
            {{ resending ? 'Requesting a new code…' : 'Resend verification code' }}
          </button>
          <p v-if="!configured" class="message message--error">
            Neon Auth is not configured. Set <code>VITE_NEON_AUTH_URL</code> to enable email verification.
          </p>
          <p class="verify-footnote">
            Email verification confirms mailbox access, not a person’s legal identity. RideHub does
            not use this step as proof of identity.
          </p>
        </section>
        <RouterLink class="back-link" to="/auth?mode=login">← Back to sign in</RouterLink>
      </main>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.verify-shell {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  align-items: center;
  padding: 23px 20px 30px;
  background:
    radial-gradient(ellipse at 50% 40%, rgba(255, 122, 26, 0.07), transparent 42%),
    #0b0f12;
}

.verify-brand {
  display: flex;
  align-items: center;
}

.verify-brand {
  align-self: flex-start;
  text-decoration: none;
}

.verify-card {
  width: min(100%, 450px);
  margin: auto;
  padding: clamp(23px, 6vw, 38px);
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 23px;
  background: linear-gradient(145deg, #192126, #13191d);
}

.verify-icon {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  margin-bottom: 22px;
  border: 1px solid rgba(255, 122, 26, 0.25);
  border-radius: 15px;
  color: #ff9a54;
  background: rgba(255, 122, 26, 0.1);
  font-size: 22px;
}

.verify-kicker {
  margin: 0 0 8px;
  color: #ff9a54;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.15em;
}

.verify-card h1 {
  margin: 0;
  color: #f4f4ef;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 29px;
  font-weight: 600;
  letter-spacing: -0.05em;
}

.verify-intro {
  margin: 9px 0 23px;
  color: #9ba6ab;
  font-size: 11px;
  line-height: 1.65;
}

.verify-form,
.verify-form label {
  display: grid;
}

.verify-form {
  gap: 12px;
}

.verify-form label {
  gap: 6px;
  color: #c9d0d0;
  font-size: 10px;
  font-weight: 600;
}

.verify-form input {
  min-height: 45px;
  padding: 0 13px;
  border: 1px solid #354047;
  border-radius: 11px;
  outline: 0;
  color: #f5f5f1;
  background: #11171b;
  font-size: 11px;
}

.verify-form input:focus {
  border-color: rgba(255, 122, 26, 0.75);
  box-shadow: 0 0 0 3px rgba(255, 122, 26, 0.1);
}

.verify-form input::placeholder {
  color: #68757b;
}

.verify-submit {
  min-height: 45px;
  margin-top: 3px;
  border: 1px solid #ff7a1a;
  border-radius: 12px;
  color: #111619;
  background: #ff7a1a;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.verify-submit:disabled,
.resend-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.resend-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: 100%;
  min-height: 40px;
  margin-top: 10px;
  border: 0;
  color: #ff9a54;
  background: transparent;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
}

.resend-button ion-icon {
  font-size: 15px;
}

.message {
  margin: 0;
  font-size: 10px;
  line-height: 1.5;
}

.message--error {
  color: #ff9e92;
}

.message--success {
  color: #b9e985;
}

.message code {
  color: #ffd1a8;
}

.verify-footnote {
  margin: 15px 0 0;
  color: #7f8c91;
  font-size: 9px;
  line-height: 1.55;
}

.back-link {
  margin-top: 22px;
  color: #89959a;
  font-size: 10px;
  text-decoration: none;
}

.back-link:hover {
  color: #ff9a54;
}
</style>
