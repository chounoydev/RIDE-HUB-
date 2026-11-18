<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { IonContent, IonIcon, IonPage } from '@ionic/vue'
import { eyeOffOutline, eyeOutline, shieldCheckmarkOutline } from 'ionicons/icons'
import { useRoute, useRouter } from 'vue-router'
import BrandLogo from '@/components/BrandLogo.vue'
import { getAuthClient, getAuthErrorMessage } from '@/services/auth'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const mode = computed(() => route.query.mode === 'register' ? 'register' : 'login')
const isRegister = computed(() => mode.value === 'register')
const isForgot = computed(() => route.query.mode === 'forgot')
const name = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const rememberMe = ref(true)
const passwordVisible = ref(false)
const confirmVisible = ref(false)
const recoveryCodeSent = ref(false)
const recoveryCompleted = ref(false)
const recoveryCode = ref('')
const busy = ref(false)
const error = ref('')
const success = ref(
  route.query.verified === '1' ? 'Your email is verified. Sign in to continue.' : '',
)
const authConfigured = Boolean(import.meta.env.VITE_NEON_AUTH_URL?.trim())

watch(isForgot, (isRecovery) => {
  error.value = ''
  success.value = ''
  if (!isRecovery) {
    recoveryCodeSent.value = false
    recoveryCompleted.value = false
    recoveryCode.value = ''
    password.value = ''
    confirmPassword.value = ''
  }
})

function safeRedirect(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return '/tabs/home'
  }
  return value
}

async function setMode(nextMode: 'login' | 'register') {
  error.value = ''
  success.value = ''
  recoveryCodeSent.value = false
  recoveryCompleted.value = false
  recoveryCode.value = ''
  await router.replace({
    query: { ...route.query, mode: nextMode },
  })
}

async function sendRecoveryCode() {
  error.value = ''
  success.value = ''
  if (!authConfigured) {
    error.value = 'Account access is not configured for this deployment. Please contact RideHub support.'
    return
  }
  if (!email.value.trim()) {
    error.value = 'Enter the email address associated with your RideHub account.'
    return
  }

  busy.value = true
  try {
    const response = await getAuthClient().emailOtp.sendVerificationOtp({
      email: email.value.trim().toLowerCase(),
      type: 'forget-password',
    })
    if (response.error) throw response.error
    recoveryCodeSent.value = true
    success.value = 'If an account exists for this address, a password reset code will be sent.'
  } catch (reason) {
    error.value = getAuthErrorMessage(reason)
  } finally {
    busy.value = false
  }
}

async function submit() {
  error.value = ''
  success.value = ''

  if (!authConfigured) {
    error.value = 'Account access is not configured for this deployment. Please contact RideHub support.'
    return
  }

  if (isForgot.value && !recoveryCodeSent.value) {
    await sendRecoveryCode()
    return
  }

  if (isRegister.value) {
    if (password.value.length < 8) {
      error.value = 'Use a password with at least 8 characters.'
      return
    }
    if (password.value !== confirmPassword.value) {
      error.value = 'The passwords do not match.'
      return
    }
  }

  if (isForgot.value) {
    if (!recoveryCode.value.trim()) {
      error.value = 'Enter the password reset code from your email.'
      return
    }
    if (password.value.length < 8) {
      error.value = 'Use a password with at least 8 characters.'
      return
    }
    if (password.value !== confirmPassword.value) {
      error.value = 'The passwords do not match.'
      return
    }
  }

  busy.value = true
  try {
    const client = getAuthClient()
    if (isForgot.value) {
      const response = await client.emailOtp.resetPassword({
        email: email.value.trim().toLowerCase(),
        otp: recoveryCode.value.trim(),
        password: password.value,
      })
      if (response.error) throw response.error
      recoveryCompleted.value = true
      recoveryCodeSent.value = false
      password.value = ''
      confirmPassword.value = ''
      recoveryCode.value = ''
      success.value = 'Your password has been updated. Sign in with your new password.'
      return
    }

    if (isRegister.value) {
      const response = await client.signUp.email({
        name: name.value.trim(),
        email: email.value.trim().toLowerCase(),
        password: password.value,
      })
      if (response.error) throw response.error
      auth.setPendingVerificationEmail(email.value)
      await router.push({ path: '/verify-email', query: { redirect: safeRedirect(route.query.redirect) } })
      return
    }

    const response = await client.signIn.email({
      email: email.value.trim().toLowerCase(),
      password: password.value,
      rememberMe: rememberMe.value,
    })
    if (response.error) throw response.error

    const user = await auth.refreshSession()
    if (user?.emailVerified) {
      await router.replace(safeRedirect(route.query.redirect))
      return
    }

    auth.setPendingVerificationEmail(email.value)
    await router.push({ path: '/verify-email', query: { redirect: safeRedirect(route.query.redirect) } })
  } catch (reason) {
    error.value = getAuthErrorMessage(reason)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <ion-page class="auth-page">
    <ion-content :fullscreen="true">
      <main class="auth-shell">
        <RouterLink class="auth-brand" to="/">
          <BrandLogo />
        </RouterLink>

        <div class="auth-layout">
          <section class="auth-story">
            <p class="auth-eyebrow">YOUR RIDING COMMUNITY STARTS HERE</p>
            <h1>Bring your<br />next ride <span>closer.</span></h1>
            <p>
              Create one RideHub account for the web and mobile app. Verify your inbox to help keep rider accounts tied to an email address you can access.
            </p>
            <div class="auth-trust">
              <ion-icon :icon="shieldCheckmarkOutline" />
              <span>
                Email verification is required before app access.
              </span>
            </div>
          </section>

          <section class="auth-card" aria-labelledby="auth-title">
            <RouterLink
              v-if="isForgot"
              class="auth-back-link"
              :to="{ path: '/auth', query: { mode: 'login', redirect: route.query.redirect } }"
            >
              ← Back to log in
            </RouterLink>
            <div
              v-else
              class="auth-tabs"
              role="tablist"
              aria-label="Account action"
            >
              <button
                type="button"
                role="tab"
                :aria-selected="!isRegister"
                :class="{ active: !isRegister }"
                @click="setMode('login')"
              >
                Log in
              </button>
              <button
                type="button"
                role="tab"
                :aria-selected="isRegister"
                :class="{ active: isRegister }"
                @click="setMode('register')"
              >
                Create account
              </button>
            </div>

            <div class="auth-heading">
              <p class="auth-eyebrow">
                {{ isForgot ? 'ACCOUNT RECOVERY' : isRegister ? 'JOIN THE COMMUNITY' : 'WELCOME BACK' }}
              </p>
              <h2 id="auth-title">
                {{ isForgot ? 'Reset your password' : isRegister ? 'Create your account' : 'Good to see you.' }}
              </h2>
              <p>
                {{
                  isForgot
                    ? recoveryCodeSent
                      ? 'Enter the code from your email and choose a new password.'
                      : 'We’ll email you a secure code to reset your password.'
                    : isRegister
                      ? 'A few details and a quick email check.'
                      : 'Sign in with your verified RideHub account.'
                }}
              </p>
            </div>

            <div v-if="recoveryCompleted" class="recovery-complete" role="status">
              <p class="form-message form-message--success">{{ success }}</p>
              <RouterLink
                :to="{ path: '/auth', query: { mode: 'login', redirect: route.query.redirect } }"
              >
                Back to sign in
              </RouterLink>
            </div>

            <form v-else class="auth-form" @submit.prevent="submit">
              <label v-if="isRegister">
                <span>Display name</span>
                <input
                  v-model="name"
                  type="text"
                  name="name"
                  autocomplete="name"
                  maxlength="80"
                  required
                  placeholder="How riders will know you"
                />
              </label>

              <label>
                <span>Email address</span>
                <input
                  v-model="email"
                  type="email"
                  name="email"
                  :autocomplete="isRegister ? 'email' : 'username'"
                  inputmode="email"
                  maxlength="254"
                  required
                  :readonly="isForgot && recoveryCodeSent"
                  placeholder="you@example.com"
                />
              </label>

              <label v-if="!isForgot || recoveryCodeSent">
                <span>{{ isForgot ? 'New password' : 'Password' }}</span>
                <span class="password-field">
                  <input
                    v-model="password"
                    :type="passwordVisible ? 'text' : 'password'"
                    name="password"
                    :autocomplete="isRegister || isForgot ? 'new-password' : 'current-password'"
                    minlength="8"
                    required
                    :placeholder="isForgot ? 'Choose at least 8 characters' : 'At least 8 characters'"
                  />
                  <button
                    class="visibility-toggle"
                    type="button"
                    :aria-label="passwordVisible ? 'Hide password' : 'Show password'"
                    @click="passwordVisible = !passwordVisible"
                  >
                    <ion-icon :icon="passwordVisible ? eyeOffOutline : eyeOutline" />
                  </button>
                </span>
              </label>

              <div v-if="!isRegister && !isForgot" class="auth-login-options">
                <label class="remember-option">
                  <input v-model="rememberMe" type="checkbox" name="remember-me" />
                  <span>Keep me signed in</span>
                </label>
                <RouterLink
                  class="forgot-password-link"
                  :to="{ path: '/auth', query: { mode: 'forgot', redirect: route.query.redirect } }"
                >
                  Forgot password?
                </RouterLink>
              </div>

              <label v-if="isForgot && recoveryCodeSent">
                <span>Password reset code</span>
                <input
                  v-model="recoveryCode"
                  type="text"
                  name="recovery-code"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  maxlength="12"
                  required
                  placeholder="Enter the code from your email"
                />
              </label>

              <button
                v-if="isForgot && recoveryCodeSent"
                class="recovery-resend"
                type="button"
                :disabled="busy"
                @click="sendRecoveryCode"
              >
                Send another code
              </button>

              <label v-if="isRegister || (isForgot && recoveryCodeSent)">
                <span>Confirm password</span>
                <span class="password-field">
                  <input
                    v-model="confirmPassword"
                    :type="confirmVisible ? 'text' : 'password'"
                    name="confirm-password"
                    autocomplete="new-password"
                    minlength="8"
                    required
                    placeholder="Enter your password again"
                  />
                  <button
                    class="visibility-toggle"
                    type="button"
                    :aria-label="confirmVisible ? 'Hide confirm password' : 'Show confirm password'"
                    @click="confirmVisible = !confirmVisible"
                  >
                    <ion-icon :icon="confirmVisible ? eyeOffOutline : eyeOutline" />
                  </button>
                </span>
              </label>

              <p v-if="error" class="form-message form-message--error" role="alert">{{ error }}</p>
              <p v-if="success" class="form-message form-message--success" role="status">{{ success }}</p>

              <button class="submit-button" type="submit" :disabled="busy || !authConfigured">
                <span v-if="busy" class="button-spinner" aria-hidden="true" />
                {{
                  busy
                    ? 'Please wait…'
                    : isForgot
                      ? recoveryCodeSent
                        ? 'Reset password'
                        : 'Send reset code'
                      : isRegister
                        ? 'Create account'
                        : 'Log in to RideHub'
                }}
              </button>
              <p v-if="!authConfigured" class="form-message form-message--error">
                Neon Auth URL is missing. Configure <code>VITE_NEON_AUTH_URL</code> to enable account access.
              </p>
            </form>

            <p class="auth-legal">
              By continuing, you agree to use RideHub responsibly. Email verification confirms access
              to that mailbox; it does not independently verify identity.
            </p>
          </section>
        </div>
        <footer class="auth-footer"><RouterLink to="/">← Back to RideHub</RouterLink></footer>
      </main>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.auth-shell {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  padding: 22px clamp(20px, 7vw, 100px) 25px;
  background:
    radial-gradient(ellipse at 10% 47%, rgba(255, 122, 26, 0.08), transparent 37%),
    #0b0f12;
}

.auth-brand {
  display: flex;
  align-items: center;
}

.auth-brand {
  width: fit-content;
  text-decoration: none;
}

.auth-layout {
  display: grid;
  width: min(100%, 1080px);
  flex: 1;
  grid-template-columns: minmax(0, 0.95fr) minmax(350px, 0.85fr);
  align-items: center;
  gap: clamp(35px, 8vw, 110px);
  margin: 0 auto;
  padding: 40px 0;
}

.auth-eyebrow {
  margin: 0 0 12px;
  color: #ff9a54;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.15em;
}

.auth-story h1 {
  margin: 0 0 19px;
  color: #f5f5f1;
  font-family: 'Space Grotesk', sans-serif;
  font-size: clamp(44px, 6vw, 68px);
  font-weight: 600;
  letter-spacing: -0.07em;
  line-height: 1;
}

.auth-story h1 span {
  color: #ff7a1a;
}

.auth-story > p:not(.auth-eyebrow) {
  max-width: 450px;
  margin: 0;
  color: #9ea9ad;
  font-size: 13px;
  line-height: 1.75;
}

.auth-trust {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 27px;
  color: #b7c58e;
  font-size: 10px;
}

.auth-trust ion-icon {
  color: #a3e635;
  font-size: 16px;
}

.auth-card {
  padding: clamp(20px, 3vw, 31px);
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 23px;
  background: linear-gradient(145deg, #192126, #13191d);
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.22);
}

.auth-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.15);
}

.auth-tabs--single {
  grid-template-columns: 1fr;
}

.auth-tabs button {
  min-height: 36px;
  border: 0;
  border-radius: 9px;
  color: #879398;
  background: transparent;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
}

.auth-tabs button.active {
  color: #f5f5f1;
  background: #293238;
}

.auth-back-link {
  display: inline-flex;
  margin: 3px 0 15px;
  color: #ff9a54;
  font-size: 10px;
  text-decoration: none;
}

.auth-heading {
  margin: 25px 0 20px;
}

.auth-heading .auth-eyebrow {
  margin-bottom: 7px;
}

.auth-heading h2 {
  margin: 0;
  color: #f4f4ef;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 25px;
  font-weight: 600;
  letter-spacing: -0.045em;
}

.auth-heading > p:last-child {
  margin: 6px 0 0;
  color: #96a1a6;
  font-size: 10px;
}

.auth-form,
.auth-form label {
  display: grid;
}

.auth-form {
  gap: 13px;
}

.auth-form label {
  gap: 6px;
  color: #c9d0d0;
  font-size: 10px;
  font-weight: 600;
}

.auth-form input {
  width: 100%;
  min-height: 45px;
  padding: 0 13px;
  border: 1px solid #354047;
  border-radius: 11px;
  outline: 0;
  color: #f5f5f1;
  background: #11171b;
  font-size: 11px;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.auth-form input:focus {
  border-color: rgba(255, 122, 26, 0.75);
  box-shadow: 0 0 0 3px rgba(255, 122, 26, 0.1);
}

.auth-form input::placeholder {
  color: #68757b;
}

.password-field {
  position: relative;
  display: block;
}

.password-field input {
  padding-right: 43px;
}

.auth-login-options {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.auth-form label.remember-option {
  display: inline-flex;
  min-height: 24px;
  align-items: center;
  gap: 8px;
  color: #aab4b8;
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;
}

.auth-form .remember-option input {
  width: 15px;
  min-height: 15px;
  margin: 0;
  padding: 0;
  accent-color: #ff7a1a;
  cursor: pointer;
}

.forgot-password-link,
.recovery-resend {
  flex: 0 0 auto;
  color: #ff9a54;
  font-size: 10px;
  text-decoration: none;
}

.recovery-resend {
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.recovery-resend:disabled {
  cursor: wait;
  opacity: 0.6;
}

.recovery-complete {
  display: grid;
  gap: 16px;
}

.recovery-complete a {
  color: #ff9a54;
  font-size: 11px;
  text-decoration: none;
}

.visibility-toggle {
  position: absolute;
  top: 50%;
  right: 5px;
  display: grid;
  width: 35px;
  height: 35px;
  place-items: center;
  border: 0;
  border-radius: 9px;
  color: #879398;
  background: transparent;
  cursor: pointer;
  transform: translateY(-50%);
}

.visibility-toggle:hover {
  color: #ff9a54;
}

.visibility-toggle ion-icon {
  font-size: 17px;
}

.submit-button {
  display: flex;
  min-height: 46px;
  align-items: center;
  justify-content: center;
  gap: 9px;
  margin-top: 3px;
  border: 1px solid #ff7a1a;
  border-radius: 12px;
  color: #111619;
  background: #ff7a1a;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.submit-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.button-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(17, 22, 25, 0.3);
  border-top-color: #111619;
  border-radius: 50%;
  animation: spin 700ms linear infinite;
}

.form-message {
  margin: 0;
  font-size: 10px;
  line-height: 1.5;
}

.form-message--error {
  color: #ff9e92;
}

.form-message--success {
  color: #b9e985;
}

.form-message code {
  color: #ffd1a8;
}

.auth-legal {
  margin: 15px 0 0;
  color: #7f8c91;
  font-size: 9px;
  line-height: 1.55;
}

.auth-footer {
  width: min(100%, 1080px);
  margin: 0 auto;
  padding-top: 15px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}

.auth-footer a {
  color: #89959a;
  font-size: 10px;
  text-decoration: none;
}

.auth-footer a:hover {
  color: #ff9a54;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 760px) {
  .auth-shell {
    padding-right: 18px;
    padding-left: 18px;
  }

  .auth-layout {
    grid-template-columns: 1fr;
    gap: 28px;
    padding: 35px 0;
  }

  .auth-story h1 {
    font-size: 46px;
  }

  .auth-story > p:not(.auth-eyebrow) {
    max-width: 520px;
  }
}

@media (max-width: 420px) {
  .auth-card {
    padding: 18px;
  }
}
</style>
