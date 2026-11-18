<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { IonContent, IonIcon, IonPage } from '@ionic/vue'
import { arrowBackOutline, peopleOutline, refreshOutline, shieldCheckmarkOutline } from 'ionicons/icons'
import { useRouter } from 'vue-router'
import { getAuthClient, getAuthErrorMessage } from '@/services/auth'
import { useAuthStore } from '@/stores/auth'

type AdminUserRow = {
  id: string
  name: string
  email: string
  emailVerified: boolean
  createdAt: Date | string
  role?: string
}

const pageSize = 25
const auth = useAuthStore()
const router = useRouter()
const users = ref<AdminUserRow[]>([])
const totalUsers = ref(0)
const offset = ref(0)
const search = ref('')
const appliedSearch = ref('')
const loading = ref(false)
const error = ref('')

const pageNumber = computed(() => Math.floor(offset.value / pageSize) + 1)
const pageCount = computed(() => Math.max(1, Math.ceil(totalUsers.value / pageSize)))
const verifiedOnPage = computed(() => users.value.filter((user) => user.emailVerified).length)

async function loadUsers(nextOffset = 0, searchValue = appliedSearch.value) {
  loading.value = true
  error.value = ''
  try {
    const query = {
      limit: pageSize,
      offset: nextOffset,
      sortBy: 'createdAt',
      sortDirection: 'desc' as const,
      ...(searchValue
        ? { searchValue, searchField: 'email' as const, searchOperator: 'contains' as const }
        : {}),
    }
    const response = await getAuthClient().admin.listUsers({ query })
    if (response.error) throw response.error
    users.value = response.data.users
    totalUsers.value = response.data.total
    offset.value = nextOffset
  } catch (reason) {
    error.value = getAuthErrorMessage(reason)
  } finally {
    loading.value = false
  }
}

function submitSearch() {
  appliedSearch.value = search.value.trim()
  void loadUsers(0, appliedSearch.value)
}

function formatDate(value: Date | string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

async function signOut() {
  try {
    await auth.signOut()
    await router.replace('/')
  } catch (reason) {
    error.value = getAuthErrorMessage(reason)
  }
}

onMounted(() => {
  void loadUsers()
})
</script>

<template>
  <ion-page class="admin-page">
    <ion-content :fullscreen="true">
      <main class="admin-shell">
        <header class="admin-header">
          <RouterLink class="admin-brand" to="/">
            <span class="admin-brand__mark">R</span>
            <span>RIDE<span>HUB</span></span>
          </RouterLink>
          <div class="admin-header__actions">
            <span class="admin-identity">
              <span class="admin-identity__dot" />
              {{ auth.user?.name }} · Administrator
            </span>
            <button type="button" class="header-button" @click="signOut">Sign out</button>
          </div>
        </header>

        <section class="admin-intro">
          <p class="admin-eyebrow">RIDEHUB OPERATIONS</p>
          <h1>Admin portal</h1>
          <p>Review RideHub accounts and email verification status.</p>
        </section>

        <div class="admin-metrics">
          <article class="metric-card">
            <span class="metric-card__icon"><ion-icon :icon="peopleOutline" /></span>
            <div>
              <span class="metric-card__label">MATCHING ACCOUNTS</span>
              <strong>{{ totalUsers }}</strong>
            </div>
          </article>
          <article class="metric-card">
            <span class="metric-card__icon metric-card__icon--green"><ion-icon :icon="shieldCheckmarkOutline" /></span>
            <div>
              <span class="metric-card__label">VERIFIED ON THIS PAGE</span>
              <strong>{{ verifiedOnPage }}<small> / {{ users.length }}</small></strong>
            </div>
          </article>
        </div>

        <section class="accounts-panel" aria-labelledby="accounts-title">
          <div class="panel-heading">
            <div>
              <p class="admin-eyebrow">ACCOUNT MANAGEMENT</p>
              <h2 id="accounts-title">Rider accounts</h2>
            </div>
            <button
              type="button"
              class="icon-button"
              aria-label="Refresh accounts"
              :disabled="loading"
              @click="loadUsers(offset)"
            >
              <ion-icon :icon="refreshOutline" :class="{ spinning: loading }" />
            </button>
          </div>

          <form class="account-search" @submit.prevent="submitSearch">
            <label for="account-search">Search verified account email</label>
            <div>
              <input id="account-search" v-model="search" type="search" maxlength="254" placeholder="Search email address" />
              <button type="submit" :disabled="loading">Search</button>
            </div>
          </form>

          <p v-if="error" class="admin-error" role="alert">{{ error }}</p>
          <div v-if="loading && !users.length" class="admin-empty" role="status">Loading accounts…</div>
          <div v-else-if="!loading && !error && !users.length" class="admin-empty">
            {{ appliedSearch ? 'No accounts match that email.' : 'No accounts found.' }}
          </div>

          <div v-if="users.length" class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Rider</th>
                  <th scope="col">Email</th>
                  <th scope="col">Email status</th>
                  <th scope="col">Role</th>
                  <th scope="col">Joined</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="rider in users" :key="rider.id">
                  <td>
                    <span class="rider-name">{{ rider.name || 'Rider' }}</span>
                    <small class="rider-id">{{ rider.id }}</small>
                  </td>
                  <td>{{ rider.email }}</td>
                  <td>
                    <span class="status-badge" :class="rider.emailVerified ? 'status-badge--verified' : 'status-badge--pending'">
                      {{ rider.emailVerified ? 'Verified' : 'Unverified' }}
                    </span>
                  </td>
                  <td><span class="role-badge">{{ rider.role || 'user' }}</span></td>
                  <td>{{ formatDate(rider.createdAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="pagination">
            <span>{{ totalUsers ? `Page ${pageNumber} of ${pageCount}` : 'No results' }}</span>
            <div>
              <button
                type="button"
                :disabled="loading || offset === 0"
                @click="loadUsers(Math.max(0, offset - pageSize))"
              >
                Previous
              </button>
              <button
                type="button"
                :disabled="loading || offset + pageSize >= totalUsers"
                @click="loadUsers(offset + pageSize)"
              >
                Next
              </button>
            </div>
          </div>
        </section>

        <aside class="admin-notice">
          <ion-icon :icon="shieldCheckmarkOutline" />
          <p>
            Account listing is provided by Neon’s authenticated Admin API. This portal cannot elevate
            roles or grant admin access. Provision administrators through Neon Console; regular
            accounts cannot promote themselves.
          </p>
        </aside>
        <RouterLink class="return-link" to="/tabs/profile"><ion-icon :icon="arrowBackOutline" /> Return to the app</RouterLink>
      </main>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.admin-shell {
  min-height: 100%;
  padding: 0 clamp(18px, 6vw, 82px) 50px;
  color: #f3f4ef;
  background:
    radial-gradient(ellipse at 86% 0, rgba(255, 122, 26, 0.06), transparent 31%),
    #0b0f12;
}

.admin-header,
.admin-brand,
.admin-brand__mark,
.admin-header__actions,
.admin-identity,
.panel-heading,
.admin-notice,
.pagination,
.pagination > div,
.return-link {
  display: flex;
  align-items: center;
}

.admin-header {
  height: 72px;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.admin-brand {
  gap: 9px;
  color: #f5f5f1;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-decoration: none;
}

.admin-brand > span:last-child > span {
  color: #ff7a1a;
}

.admin-brand__mark {
  width: 31px;
  height: 31px;
  justify-content: center;
  border: 1px solid rgba(255, 122, 26, 0.5);
  border-radius: 10px;
  color: #ff7a1a;
  background: rgba(255, 122, 26, 0.1);
}

.admin-header__actions {
  gap: 15px;
}

.admin-identity {
  gap: 7px;
  color: #aab4b8;
  font-size: 10px;
}

.admin-identity__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #a3e635;
}

.header-button,
.pagination button,
.account-search button {
  min-height: 35px;
  padding: 0 12px;
  border: 1px solid #354047;
  border-radius: 9px;
  color: #e2e7e5;
  background: #1b2328;
  font-size: 9px;
  font-weight: 600;
  cursor: pointer;
}

.header-button:hover,
.pagination button:not(:disabled):hover,
.account-search button:not(:disabled):hover {
  border-color: rgba(255, 122, 26, 0.5);
  color: #ffae73;
}

.admin-intro {
  margin: 40px 0 23px;
}

.admin-eyebrow {
  margin: 0 0 7px;
  color: #ff9954;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.15em;
}

.admin-intro h1 {
  margin: 0;
  font-family: 'Space Grotesk', sans-serif;
  font-size: clamp(32px, 5vw, 44px);
  font-weight: 600;
  letter-spacing: -0.06em;
}

.admin-intro > p:last-child {
  margin: 8px 0 0;
  color: #94a0a5;
  font-size: 11px;
}

.admin-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.metric-card {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 93px;
  padding: 17px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 15px;
  background: #151b20;
}

.metric-card__icon {
  display: grid;
  width: 39px;
  height: 39px;
  place-items: center;
  border-radius: 12px;
  color: #ff9a54;
  background: rgba(255, 122, 26, 0.1);
  font-size: 18px;
}

.metric-card__icon--green {
  color: #a3e635;
  background: rgba(163, 230, 53, 0.09);
}

.metric-card__label,
.metric-card strong {
  display: block;
}

.metric-card__label {
  color: #859197;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.09em;
}

.metric-card strong {
  margin-top: 5px;
  color: #f4f4ef;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 23px;
  font-weight: 600;
}

.metric-card strong small {
  color: #7e8a90;
  font-family: 'DM Sans', sans-serif;
  font-size: 10px;
  font-weight: 500;
}

.accounts-panel {
  padding: clamp(16px, 3vw, 25px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 17px;
  background: #151b20;
}

.panel-heading {
  justify-content: space-between;
  margin-bottom: 18px;
}

.panel-heading h2 {
  margin: 0;
  color: #eff1ed;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 19px;
  font-weight: 600;
}

.icon-button {
  display: grid;
  width: 37px;
  height: 37px;
  place-items: center;
  border: 1px solid #354047;
  border-radius: 10px;
  color: #aab4b8;
  background: #1b2328;
  font-size: 16px;
  cursor: pointer;
}

.icon-button:disabled {
  opacity: 0.55;
}

.spinning {
  animation: spin 850ms linear infinite;
}

.account-search {
  margin-bottom: 15px;
}

.account-search label {
  display: block;
  margin-bottom: 6px;
  color: #9da8ad;
  font-size: 9px;
}

.account-search > div {
  display: flex;
  gap: 8px;
}

.account-search input {
  width: min(100%, 370px);
  min-height: 36px;
  padding: 0 11px;
  border: 1px solid #354047;
  border-radius: 9px;
  outline: 0;
  color: #edf0ec;
  background: #101619;
  font-size: 10px;
}

.account-search input:focus {
  border-color: rgba(255, 122, 26, 0.7);
}

.account-search button:disabled,
.pagination button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.admin-error {
  padding: 11px 12px;
  border: 1px solid rgba(255, 91, 91, 0.25);
  border-radius: 10px;
  color: #ffa49a;
  background: rgba(255, 91, 91, 0.06);
  font-size: 10px;
  line-height: 1.5;
}

.admin-empty {
  padding: 25px 12px;
  color: #879398;
  font-size: 10px;
  text-align: center;
}

.table-wrap {
  overflow: auto;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 11px;
}

table {
  width: 100%;
  border-collapse: collapse;
  white-space: nowrap;
}

th,
td {
  padding: 12px 13px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.055);
  text-align: left;
}

th {
  color: #7f8b91;
  background: rgba(255, 255, 255, 0.02);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

td {
  color: #c3ccce;
  font-size: 9px;
}

tr:last-child td {
  border-bottom: 0;
}

.rider-name,
.rider-id {
  display: block;
}

.rider-name {
  color: #e8ebe7;
  font-weight: 600;
}

.rider-id {
  max-width: 120px;
  overflow: hidden;
  margin-top: 3px;
  color: #68757b;
  font-size: 7px;
  text-overflow: ellipsis;
}

.status-badge,
.role-badge {
  display: inline-flex;
  padding: 5px 7px;
  border-radius: 7px;
  font-size: 8px;
  font-weight: 600;
}

.status-badge--verified {
  color: #b7e47f;
  background: rgba(163, 230, 53, 0.09);
}

.status-badge--pending {
  color: #ffbf8e;
  background: rgba(255, 122, 26, 0.09);
}

.role-badge {
  color: #c3cdd0;
  background: rgba(255, 255, 255, 0.06);
}

.pagination {
  justify-content: space-between;
  gap: 10px;
  margin-top: 13px;
  color: #879398;
  font-size: 9px;
}

.pagination > div {
  gap: 7px;
}

.pagination button {
  min-height: 31px;
}

.admin-notice {
  align-items: flex-start;
  gap: 9px;
  margin-top: 14px;
  padding: 12px 14px;
  border: 1px solid rgba(163, 230, 53, 0.14);
  border-radius: 12px;
  color: #b6d588;
  background: rgba(163, 230, 53, 0.04);
}

.admin-notice ion-icon {
  flex: 0 0 auto;
  margin-top: 1px;
  font-size: 15px;
}

.admin-notice p {
  margin: 0;
  color: #a4b690;
  font-size: 9px;
  line-height: 1.55;
}

.return-link {
  width: fit-content;
  gap: 6px;
  margin-top: 20px;
  color: #909ca1;
  font-size: 9px;
  text-decoration: none;
}

.return-link:hover {
  color: #ff9a54;
}

.return-link ion-icon {
  font-size: 14px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 590px) {
  .admin-shell {
    padding-right: 14px;
    padding-left: 14px;
  }

  .admin-header {
    height: 62px;
  }

  .admin-identity {
    max-width: 140px;
    overflow: hidden;
    font-size: 8px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .admin-header__actions {
    gap: 7px;
  }

  .header-button {
    min-height: 31px;
    padding: 0 8px;
    font-size: 8px;
  }

  .admin-metrics {
    gap: 8px;
  }

  .metric-card {
    min-height: 78px;
    gap: 8px;
    padding: 11px;
  }

  .metric-card__icon {
    width: 31px;
    height: 31px;
    font-size: 15px;
  }

  .metric-card__label {
    font-size: 7px;
  }

  .metric-card strong {
    font-size: 19px;
  }
}
</style>
