<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { IonContent, IonIcon, IonPage } from '@ionic/vue'
import QRCode from 'qrcode'
import { arrowForwardOutline, compassOutline, peopleOutline, shieldCheckmarkOutline } from 'ionicons/icons'
import BrandLogo from '@/components/BrandLogo.vue'
import { isNativeApp } from '@/services/auth'

type StoreKey = 'android' | 'ios'
type StoreLink = { key: StoreKey; name: string; url: string | null; invalid: boolean }

const configuredIosUrl = import.meta.env.VITE_IOS_DOWNLOAD_URL?.trim()

function storeLink(key: StoreKey, name: string, value?: string, allowSameOriginPath = false): StoreLink {
  const raw = value?.trim() ?? ''
  if (!raw) return { key, name, url: null, invalid: false }
  if (
    allowSameOriginPath
    && raw.startsWith('/')
    && !raw.startsWith('//')
    && !raw.includes('\\')
    && !raw.split('/').includes('..')
  ) {
    return { key, name, url: raw, invalid: false }
  }
  try {
    const parsed = new URL(raw)
    if (parsed.protocol === 'https:') return { key, name, url: parsed.toString(), invalid: false }
  } catch {
    // Invalid store links are shown as configuration errors below.
  }
  return { key, name, url: null, invalid: true }
}

function testFlightLink(value?: string): StoreLink {
  const link = storeLink('ios', 'iOS', value)
  if (!link.url) return link

  const parsed = new URL(link.url)
  if (parsed.hostname !== 'testflight.apple.com' || !parsed.pathname.startsWith('/join/')) {
    return { ...link, url: null, invalid: true }
  }
  return link
}

const stores: StoreLink[] = [
  storeLink(
    'android',
    'Android',
    import.meta.env.VITE_ANDROID_DOWNLOAD_URL?.trim() || '/downloads/ridehub-android.apk',
    true,
  ),
  testFlightLink(configuredIosUrl),
]
const qrCodes = ref<Partial<Record<StoreKey, string>>>({})
const qrErrors = ref<Partial<Record<StoreKey, string>>>({})
const notice = ref('')
const accountPath = isNativeApp ? '/auth?mode=login' : '/auth?mode=register'

onMounted(async () => {
  if (new URLSearchParams(window.location.search).get('notice') === 'admin-only') {
    notice.value = 'The admin portal is restricted to authorized RideHub administrators.'
  }

  for (const store of stores) {
    if (!store.url) continue
    try {
      qrCodes.value[store.key] = await QRCode.toDataURL(new URL(store.url, window.location.origin).toString(), {
        width: 168,
        margin: 1,
        color: { dark: '#f5f5f1', light: '#151b20' },
      })
    } catch {
      qrErrors.value[store.key] = 'The store QR code could not be generated.'
    }
  }
})
</script>

<template>
  <ion-page class="landing-page">
    <ion-content :fullscreen="true">
      <div class="site-shell">
        <header class="site-header">
          <a class="site-brand" href="/" aria-label="RideHub home">
            <BrandLogo />
          </a>
          <nav class="site-nav" aria-label="Main navigation">
            <a href="#purpose">Purpose</a>
            <a href="#features">What it does</a>
            <a href="#download">Get the app</a>
          </nav>
          <div class="site-header__actions">
            <RouterLink class="text-link" to="/auth?mode=login">Log in</RouterLink>
            <RouterLink v-if="!isNativeApp" class="button button--small" to="/auth?mode=register">
              Join RideHub
            </RouterLink>
          </div>
        </header>

        <p v-if="notice" class="site-notice" role="status">{{ notice }}</p>

        <main>
          <section class="hero">
            <div class="hero__copy">
              <p class="eyebrow"><span class="live-dot" /> MADE FOR THE NEXT MILE</p>
              <h1>Better rides.<br /><span>Stronger together.</span></h1>
              <p class="hero__lead">
                RideHub is a motorcycle community built to help riders find their people, plan rides,
                stay informed about the weather, and make every journey feel a little less solo.
              </p>
              <div class="hero__actions">
                <RouterLink class="button" :to="accountPath">
                  {{ isNativeApp ? 'Log in to RideHub' : 'Create your rider account' }}
                  <ion-icon :icon="arrowForwardOutline" />
                </RouterLink>
                <a class="button button--quiet" href="#purpose">Discover RideHub</a>
              </div>
              <p class="hero__fineprint">One verified account for the website and RideHub app.</p>
            </div>
            <div class="hero-art" aria-label="RideHub riding community illustration">
              <div class="hero-art__orbit hero-art__orbit--one" />
              <div class="hero-art__orbit hero-art__orbit--two" />
              <div class="hero-art__sun" />
              <div class="hero-art__road" />
              <div class="hero-art__bike">
                <span class="bike-wheel bike-wheel--left" />
                <span class="bike-wheel bike-wheel--right" />
                <span class="bike-frame" />
                <span class="bike-tank" />
                <span class="bike-handle" />
              </div>
              <div class="hero-art__label"><span class="live-dot" /> YOUR CREW, YOUR ROUTE</div>
            </div>
          </section>

          <section id="purpose" class="purpose-section">
            <div class="section-kicker">WHY RIDEHUB EXISTS</div>
            <div class="purpose-grid">
              <h2>Riding is better<br />when no one is left behind.</h2>
              <div class="purpose-copy">
                <p>
                  RideHub brings the practical parts of riding together in one rider-first space:
                  community, ride planning, location-aware tools, and clear safety information.
                </p>
                <p>
                  It is designed to help local riders meet, organize, and look out for one another—
                  without pretending a phone app can replace good judgment, road awareness, or
                  emergency services.
                </p>
              </div>
            </div>
          </section>

          <section id="features" class="features-section">
            <div class="section-heading">
              <div>
                <div class="section-kicker">BUILT AROUND THE RIDE</div>
                <h2>One home for your riding life.</h2>
              </div>
              <span class="section-caption">Purposeful tools, designed to grow with the community.</span>
            </div>
            <div class="feature-grid">
              <article class="feature-tile">
                <div class="feature-tile__icon"><ion-icon :icon="peopleOutline" /></div>
                <p class="feature-tile__number">01 / COMMUNITY</p>
                <h3>Find your people.</h3>
                <p>Build your rider profile and connect around shared routes, bikes, and local rides.</p>
                <span class="feature-status">COMMUNITY FEATURES IN DEVELOPMENT</span>
              </article>
              <article class="feature-tile feature-tile--accent">
                <div class="feature-tile__icon"><ion-icon :icon="compassOutline" /></div>
                <p class="feature-tile__number">02 / AWARENESS</p>
                <h3>Ride with context.</h3>
                <p>Check current conditions when you choose, and keep weather advisories in view.</p>
                <span class="feature-status">ON-DEMAND WEATHER CHECK AVAILABLE</span>
              </article>
              <article class="feature-tile">
                <div class="feature-tile__icon"><ion-icon :icon="shieldCheckmarkOutline" /></div>
                <p class="feature-tile__number">03 / CONTROL</p>
                <h3>Your location, your call.</h3>
                <p>Location access is requested only when you start a location-based action.</p>
                <span class="feature-status">NO BACKGROUND TRACKING</span>
              </article>
            </div>
          </section>

          <section class="build-note">
            <span class="build-note__icon"><ion-icon :icon="shieldCheckmarkOutline" /></span>
            <div>
              <strong>Honest by design.</strong>
              <p>
                RideHub is actively being built. Background rider tracking, group ride coordination,
                push alerts, and SOS assistance are not active in this version. SOS is intentionally
                unavailable; use your phone to contact local emergency services when needed.
              </p>
            </div>
          </section>

          <section id="download" class="download-section">
            <div class="download-copy">
              <div class="section-kicker">TAKE RIDEHUB WITH YOU</div>
              <h2>Your account travels<br />with your app.</h2>
              <p>
                {{
                  isNativeApp
                    ? 'Create and verify your account on the RideHub website, then sign in here using the same credentials.'
                    : 'Create an account here, verify your email, then use the same credentials to sign in to the RideHub app.'
                }}
              </p>
              <RouterLink class="text-link" :to="accountPath">
                {{ isNativeApp ? 'Log in to your account' : 'Create your account' }} <span>→</span>
              </RouterLink>
            </div>
            <div class="store-grid">
              <article v-for="store in stores" :key="store.key" class="store-card">
                <div class="store-card__head">
                  <div>
                    <span class="section-kicker">RIDEHUB FOR</span>
                    <h3>{{ store.name }}</h3>
                  </div>
                  <span class="store-card__badge">
                    {{ store.key === 'ios' ? (store.url ? 'TESTFLIGHT' : 'COMING SOON') : store.url ? 'AVAILABLE' : 'COMING SOON' }}
                  </span>
                </div>
                <div v-if="store.url" class="store-card__qr">
                  <img
                    v-if="qrCodes[store.key]"
                    :src="qrCodes[store.key]"
                    :alt="store.key === 'ios' ? 'RideHub TestFlight invitation QR code' : `${store.name} download QR code`"
                  />
                  <span v-else-if="qrErrors[store.key]" role="alert">{{ qrErrors[store.key] }}</span>
                  <span v-else class="qr-placeholder">Preparing secure download QR…</span>
                </div>
                <div v-else class="store-card__qr store-card__qr--empty">
                  <span>
                    {{
                      store.invalid
                        ? store.key === 'ios'
                          ? 'A valid TestFlight invitation URL is required.'
                          : 'A valid HTTPS download link is required.'
                        : store.key === 'ios'
                          ? 'The TestFlight invitation will appear here after the iOS app is published.'
                          : 'The official store link will appear here when the app is published.'
                    }}
                  </span>
                </div>
                <a
                  v-if="store.url"
                  class="button button--store"
                  :href="store.url"
                  :download="store.key === 'android' ? 'RideHub.apk' : undefined"
                  :target="store.key === 'ios' ? '_blank' : undefined"
                  :rel="store.key === 'ios' ? 'noopener noreferrer' : undefined"
                >
                  {{ store.key === 'android' ? 'Download Android APK' : 'Join on TestFlight' }}
                  <ion-icon :icon="arrowForwardOutline" />
                </a>
                <span v-else class="store-card__disabled">
                  {{
                    store.invalid
                      ? store.key === 'ios'
                        ? 'Set a valid TestFlight invitation link.'
                        : 'Check the configured HTTPS download link.'
                      : store.key === 'ios'
                        ? 'TestFlight release not published yet'
                        : 'Official download link not published yet'
                  }}
                </span>
              </article>
            </div>
          </section>
        </main>

        <footer class="site-footer">
          <a class="site-brand" href="/" aria-label="RideHub home">
            <BrandLogo />
          </a>
          <p>Ride together. Look out for each other.</p>
          <RouterLink to="/auth?mode=login">Member sign in</RouterLink>
        </footer>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.site-shell {
  --site-ink: #f5f5f1;
  --site-muted: #9aa5aa;
  --site-line: rgba(235, 241, 238, 0.1);
  min-height: 100%;
  padding: 0 clamp(20px, 6vw, 88px);
  color: var(--site-ink);
  background:
    radial-gradient(ellipse at 82% 13%, rgba(255, 122, 26, 0.09), transparent 30%),
    #0b0f12;
}

.site-header,
.site-brand,
.site-header__actions,
.site-nav,
.hero__actions,
.section-heading,
.store-card__head,
.site-footer {
  display: flex;
  align-items: center;
}

.site-header {
  width: min(100%, 1280px);
  height: 82px;
  justify-content: space-between;
  margin: 0 auto;
  border-bottom: 1px solid var(--site-line);
}

.site-brand {
  text-decoration: none;
}

.site-nav {
  gap: clamp(16px, 3vw, 42px);
}

.site-nav a,
.site-footer > a:last-child,
.text-link {
  color: #b6c0c3;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  transition: color 160ms ease;
}

.site-nav a:hover,
.site-footer > a:last-child:hover,
.text-link:hover {
  color: #ff9a54;
}

.site-header__actions {
  gap: 18px;
}

.button {
  display: inline-flex;
  min-height: 48px;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 0 18px;
  border: 1px solid #ff7a1a;
  border-radius: 13px;
  color: #121619;
  background: #ff7a1a;
  font-size: 12px;
  font-weight: 700;
  text-decoration: none;
  transition: transform 160ms ease, filter 160ms ease;
}

.button:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

.button ion-icon {
  font-size: 16px;
}

.button--small {
  min-height: 39px;
  padding: 0 14px;
  border-radius: 11px;
  font-size: 11px;
}

.button--quiet {
  border-color: #39434a;
  color: var(--site-ink);
  background: rgba(255, 255, 255, 0.035);
}

.site-notice {
  max-width: 1280px;
  margin: 14px auto -18px;
  padding: 12px 15px;
  border: 1px solid rgba(255, 122, 26, 0.28);
  border-radius: 12px;
  color: #ffc08e;
  background: rgba(255, 122, 26, 0.08);
  font-size: 12px;
}

.hero,
.purpose-section,
.features-section,
.download-section,
.site-footer {
  width: min(100%, 1280px);
  margin-right: auto;
  margin-left: auto;
}

.hero {
  display: grid;
  min-height: 610px;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 0.92fr);
  align-items: center;
  gap: 40px;
  padding: 58px 0 70px;
}

.hero__copy {
  position: relative;
  z-index: 1;
}

.eyebrow,
.section-kicker,
.feature-tile__number {
  color: #ff9b58;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.15em;
}

.eyebrow {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 0 0 19px;
}

.live-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #a3e635;
  box-shadow: 0 0 12px rgba(163, 230, 53, 0.7);
}

h1,
h2,
h3,
p {
  margin-top: 0;
}

.hero h1 {
  margin-bottom: 21px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: clamp(44px, 7vw, 78px);
  font-weight: 600;
  letter-spacing: -0.07em;
  line-height: 0.98;
}

.hero h1 span {
  color: #ff7a1a;
}

.hero__lead {
  max-width: 500px;
  margin-bottom: 24px;
  color: #aeb8bb;
  font-size: clamp(14px, 1.4vw, 16px);
  line-height: 1.75;
}

.hero__actions {
  flex-wrap: wrap;
  gap: 10px;
}

.hero__fineprint {
  margin: 13px 0 0;
  color: #778389;
  font-size: 10px;
}

.hero-art {
  position: relative;
  min-height: 395px;
  overflow: hidden;
  border: 1px solid rgba(255, 122, 26, 0.18);
  border-radius: 34px;
  background:
    linear-gradient(180deg, rgba(16, 23, 27, 0.06), rgba(11, 15, 18, 0.3)),
    radial-gradient(ellipse at 48% 47%, #28343a, #131a1f 72%);
}

.hero-art__orbit {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 360px;
  height: 160px;
  border: 1px solid rgba(255, 122, 26, 0.18);
  border-radius: 50%;
  transform: translate(-50%, -50%) rotate(-24deg);
}

.hero-art__orbit--two {
  width: 430px;
  height: 210px;
  border-color: rgba(255, 255, 255, 0.07);
  transform: translate(-50%, -50%) rotate(28deg);
}

.hero-art__sun {
  position: absolute;
  top: 22%;
  right: 20%;
  width: 102px;
  height: 102px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 157, 84, 0.6), rgba(255, 122, 26, 0.02) 70%);
  filter: blur(1px);
}

.hero-art__road {
  position: absolute;
  right: -15%;
  bottom: -41%;
  left: -15%;
  height: 78%;
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 50% 50% 0 0;
  background: linear-gradient(180deg, rgba(35, 44, 49, 0.8), #11171b 65%);
  transform: rotate(-10deg);
}

.hero-art__road::after {
  position: absolute;
  top: 1%;
  left: 49%;
  width: 2px;
  height: 95%;
  background: repeating-linear-gradient(to bottom, rgba(255, 255, 255, 0.4) 0 14px, transparent 14px 31px);
  content: '';
}

.hero-art__bike {
  position: absolute;
  z-index: 1;
  top: 42%;
  left: 50%;
  width: 220px;
  height: 116px;
  filter: drop-shadow(0 13px 24px rgba(0, 0, 0, 0.42));
  transform: translate(-50%, -50%);
}

.bike-wheel {
  position: absolute;
  bottom: 1px;
  width: 57px;
  height: 57px;
  border: 7px solid #778187;
  border-radius: 50%;
  background: #11171b;
  box-shadow: inset 0 0 0 2px #252f34;
}

.bike-wheel--left {
  left: 14px;
}

.bike-wheel--right {
  right: 12px;
}

.bike-frame {
  position: absolute;
  bottom: 31px;
  left: 46px;
  width: 127px;
  height: 52px;
  border: 7px solid #ff7a1a;
  border-top: 0;
  border-radius: 8px 8px 25px 20px;
  transform: skewX(-17deg);
}

.bike-tank {
  position: absolute;
  top: 24px;
  left: 76px;
  width: 62px;
  height: 32px;
  border-radius: 14px 26px 8px 10px;
  background: linear-gradient(145deg, #ff9a54, #d94f0a);
  transform: rotate(-8deg);
}

.bike-handle {
  position: absolute;
  top: 22px;
  right: 27px;
  width: 45px;
  height: 22px;
  border-top: 4px solid #b8c0c2;
  border-right: 4px solid #b8c0c2;
  border-radius: 0 13px 0 0;
  transform: rotate(-11deg);
}

.hero-art__label {
  position: absolute;
  z-index: 2;
  right: 18px;
  bottom: 17px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 11px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  color: #d6dddc;
  background: rgba(11, 15, 18, 0.78);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.purpose-section {
  padding: 42px 0 76px;
  border-top: 1px solid var(--site-line);
}

.purpose-grid {
  display: grid;
  grid-template-columns: 1fr 0.85fr;
  align-items: start;
  gap: 56px;
  margin-top: 20px;
}

.purpose-grid h2,
.section-heading h2,
.download-copy h2 {
  margin-bottom: 0;
  font-family: 'Space Grotesk', sans-serif;
  font-size: clamp(29px, 4vw, 44px);
  font-weight: 600;
  letter-spacing: -0.055em;
  line-height: 1.08;
}

.purpose-copy p,
.download-copy > p {
  margin-bottom: 12px;
  color: var(--site-muted);
  font-size: 13px;
  line-height: 1.75;
}

.features-section {
  padding: 43px 0 58px;
  border-top: 1px solid var(--site-line);
}

.section-heading {
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 23px;
}

.section-heading h2 {
  margin-top: 10px;
  font-size: clamp(27px, 3.2vw, 36px);
}

.section-caption {
  max-width: 225px;
  color: #859197;
  font-size: 11px;
  line-height: 1.5;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 13px;
}

.feature-tile {
  min-height: 246px;
  padding: 22px;
  border: 1px solid var(--site-line);
  border-radius: 20px;
  background: linear-gradient(150deg, #182126, #12181c);
}

.feature-tile--accent {
  border-color: rgba(255, 122, 26, 0.24);
  background:
    radial-gradient(ellipse at 100% 0, rgba(255, 122, 26, 0.1), transparent 55%),
    linear-gradient(150deg, #1d2428, #151b20);
}

.feature-tile__icon {
  display: grid;
  width: 41px;
  height: 41px;
  place-items: center;
  border-radius: 13px;
  color: #ff9a54;
  background: rgba(255, 122, 26, 0.1);
  font-size: 20px;
}

.feature-tile__number {
  margin: 19px 0 7px;
  color: #7e8b91;
  font-size: 8px;
}

.feature-tile h3,
.store-card h3 {
  margin-bottom: 8px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.03em;
}

.feature-tile > p:not(.feature-tile__number) {
  min-height: 40px;
  margin-bottom: 16px;
  color: #9aa5aa;
  font-size: 11px;
  line-height: 1.55;
}

.feature-status {
  color: #a3e635;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.build-note {
  display: flex;
  align-items: flex-start;
  gap: 13px;
  width: min(100%, 1280px);
  margin: 0 auto 66px;
  padding: 17px;
  border: 1px solid rgba(255, 122, 26, 0.2);
  border-radius: 16px;
  color: #e5e3dd;
  background: rgba(255, 122, 26, 0.045);
}

.build-note__icon {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 11px;
  color: #ff9a54;
  background: rgba(255, 122, 26, 0.1);
}

.build-note strong {
  font-size: 12px;
}

.build-note p {
  margin: 4px 0 0;
  color: #9fa9ad;
  font-size: 10px;
  line-height: 1.6;
}

.download-section {
  display: grid;
  grid-template-columns: minmax(230px, 0.72fr) minmax(0, 1fr);
  gap: 45px;
  padding: 49px 0 66px;
  border-top: 1px solid var(--site-line);
}

.download-copy h2 {
  margin-top: 14px;
  font-size: clamp(30px, 4vw, 43px);
}

.download-copy > p {
  margin: 15px 0 16px;
}

.text-link {
  color: #ff9a54;
}

.text-link span {
  padding-left: 4px;
}

.store-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.store-card {
  display: flex;
  min-height: 300px;
  flex-direction: column;
  padding: 17px;
  border: 1px solid var(--site-line);
  border-radius: 17px;
  background: #151b20;
}

.store-card__head {
  justify-content: space-between;
  gap: 8px;
}

.store-card__head .section-kicker {
  color: #859197;
  font-size: 8px;
}

.store-card h3 {
  margin: 4px 0 0;
}

.store-card__badge {
  padding: 5px 7px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 7px;
  color: #a2adb1;
  font-size: 7px;
  font-weight: 700;
  letter-spacing: 0.05em;
}

.store-card__qr {
  display: grid;
  width: 168px;
  height: 168px;
  align-self: center;
  place-items: center;
  margin: 15px 0;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 13px;
  background: #151b20;
}

.store-card__qr img {
  display: block;
  width: 100%;
  height: 100%;
}

.store-card__qr--empty {
  padding: 16px;
  color: #7f8b91;
  background:
    linear-gradient(45deg, rgba(255, 255, 255, 0.025) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.025) 75%),
    #151b20;
  background-size: 16px 16px;
  text-align: center;
  font-size: 10px;
  line-height: 1.6;
}

.qr-placeholder {
  color: #8d999e;
  font-size: 10px;
}

.button--store {
  min-height: 39px;
  margin-top: auto;
  padding: 0 9px;
  border-radius: 10px;
  font-size: 9px;
}

.store-card__disabled {
  margin-top: auto;
  color: #778389;
  font-size: 9px;
  text-align: center;
}

.site-footer {
  min-height: 78px;
  justify-content: space-between;
  gap: 15px;
  border-top: 1px solid var(--site-line);
}

.site-footer p {
  margin: 0;
  color: #7f8b91;
  font-size: 10px;
}

@media (max-width: 860px) {
  .site-nav {
    display: none;
  }

  .hero {
    min-height: 540px;
    grid-template-columns: 1fr 0.82fr;
    gap: 22px;
  }

  .hero-art {
    min-height: 345px;
  }

  .download-section {
    grid-template-columns: 1fr;
    gap: 25px;
  }
}

@media (max-width: 620px) {
  .site-shell {
    padding-right: 18px;
    padding-left: 18px;
  }

  .site-header {
    height: 68px;
  }

  .site-header__actions {
    gap: 11px;
  }

  .site-header__actions .text-link {
    font-size: 10px;
  }

  .site-header__actions .button {
    min-height: 35px;
    padding: 0 10px;
    font-size: 9px;
  }

  .hero {
    grid-template-columns: 1fr;
    gap: 26px;
    padding: 54px 0 50px;
  }

  .hero h1 {
    font-size: clamp(46px, 14vw, 66px);
  }

  .hero-art {
    min-height: 260px;
  }

  .hero-art__bike {
    top: 44%;
    transform: translate(-50%, -50%) scale(0.82);
  }

  .purpose-section {
    padding: 33px 0 47px;
  }

  .purpose-grid {
    grid-template-columns: 1fr;
    gap: 15px;
  }

  .section-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .section-caption {
    max-width: 100%;
  }

  .feature-grid {
    grid-template-columns: 1fr;
  }

  .feature-tile {
    min-height: 0;
  }

  .feature-tile > p:not(.feature-tile__number) {
    min-height: 0;
  }

  .store-grid {
    grid-template-columns: 1fr;
  }

  .store-card {
    min-height: 278px;
  }

  .site-footer {
    align-items: flex-start;
    flex-direction: column;
    justify-content: center;
    padding: 17px 0;
  }
}
</style>
