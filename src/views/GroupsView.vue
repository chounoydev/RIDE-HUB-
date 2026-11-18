<script setup lang="ts">
import { computed, ref } from 'vue'
import { IonContent, IonIcon, IonPage, onIonViewWillEnter } from '@ionic/vue'
import {
  addOutline,
  checkmarkOutline,
  chevronForwardOutline,
  closeOutline,
  locationOutline,
  peopleOutline,
  refreshOutline,
  searchOutline,
  shieldCheckmarkOutline,
  timeOutline,
} from 'ionicons/icons'
import { useRouter } from 'vue-router'
import BrandLogo from '@/components/BrandLogo.vue'
import { useCommunityStore, type CommunityGroup } from '@/stores/community'

const router = useRouter()
const community = useCommunityStore()
const showCreate = ref(false)
const showMeeting = ref<string | null>(null)
const query = ref('')
const groupName = ref('')
const groupDescription = ref('')
const meetingName = ref('')
const meetingAddress = ref('')
const meetingAt = ref('')
const groupError = ref('')
const creatingGroup = ref(false)
const requestingGroupId = ref('')
const resolvingRequestId = ref('')
const reviewingRequestsId = ref<string | null>(null)

onIonViewWillEnter(() => { void community.refresh() })

const visibleGroups = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return community.groups
  return community.groups.filter((group) =>
    `${group.name} ${group.description}`.toLowerCase().includes(needle),
  )
})

async function createGroup() {
  if (!groupName.value.trim()) return
  creatingGroup.value = true
  groupError.value = ''
  try {
    const group = await community.createGroup(groupName.value, groupDescription.value)
    groupName.value = ''
    groupDescription.value = ''
    showCreate.value = false
    await router.push({ path: '/tabs/messages', query: { group: group.id } })
  } catch (reason) {
    groupError.value = reason instanceof Error ? reason.message : 'Community could not be created.'
  } finally {
    creatingGroup.value = false
  }
}

function openMeeting(group: CommunityGroup) {
  showMeeting.value = group.id
  meetingName.value = group.meeting?.name ?? ''
  meetingAddress.value = group.meeting?.address ?? ''
  meetingAt.value = group.meeting?.meetingAt ?? ''
}

async function saveMeeting(group: CommunityGroup) {
  if (!meetingName.value.trim()) return
  let latitude = group.meeting?.latitude ?? 10.3157
  let longitude = group.meeting?.longitude ?? 123.8854
  try {
    if (navigator.geolocation) {
      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            latitude = position.coords.latitude
            longitude = position.coords.longitude
            resolve()
          },
          () => resolve(),
          { timeout: 5000, maximumAge: 60_000 },
        )
      })
    }
  } catch {
    // Preserve the saved coordinates if location is unavailable.
  }
  try {
    await community.setMeeting(group.id, {
      name: meetingName.value.trim(),
      address: meetingAddress.value.trim(),
      latitude,
      longitude,
      meetingAt: meetingAt.value,
    })
    groupError.value = ''
    showMeeting.value = null
  } catch (reason) {
    groupError.value = reason instanceof Error ? reason.message : 'Meeting location could not be saved.'
  }
}

function openChat(group: CommunityGroup) {
  if (!community.isMember(group)) return
  groupError.value = ''
  void router.push({ path: '/tabs/messages', query: { group: group.id } })
}

async function requestToJoin(group: CommunityGroup) {
  requestingGroupId.value = group.id
  groupError.value = ''
  try {
    await community.joinGroup(group.id)
  } catch (reason) {
    groupError.value = reason instanceof Error ? reason.message : 'Your join request could not be sent.'
  } finally {
    requestingGroupId.value = ''
  }
}

async function resolveRequest(group: CommunityGroup, memberId: string, approve: boolean) {
  resolvingRequestId.value = `${group.id}:${memberId}`
  groupError.value = ''
  try {
    await community.resolveJoinRequest(group.id, memberId, approve)
  } catch (reason) {
    groupError.value = reason instanceof Error ? reason.message : 'The join request could not be updated.'
  } finally {
    resolvingRequestId.value = ''
  }
}

function formatMeeting(meetingAt: string) {
  const date = new Date(meetingAt)
  return Number.isNaN(date.getTime())
    ? 'Time to be announced'
    : date.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
</script>

<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="screen community-screen">
        <header class="topline">
          <div class="brand-lockup" aria-label="RideHub">
            <BrandLogo />
          </div>
          <div class="community-top-actions">
            <button
              class="community-refresh-button"
              type="button"
              :disabled="community.loading"
              aria-label="Refresh communities"
              @click="community.refresh()"
            >
              <ion-icon :icon="refreshOutline" />
              <span>{{ community.loading ? 'Refreshing…' : 'Refresh' }}</span>
            </button>
            <button class="community-create-button" type="button" @click="showCreate = true">
              <ion-icon :icon="addOutline" />
              <span>Create</span>
            </button>
          </div>
        </header>

        <section class="page-header">
          <p class="eyebrow">YOUR PEOPLE, YOUR PACE</p>
          <h1 class="page-title">Rider communities</h1>
          <p>Meet local crews, plan safe rides, and keep everyone connected.</p>
        </section>

        <label class="community-search">
          <ion-icon :icon="searchOutline" />
          <input v-model="query" type="search" placeholder="Search riding communities">
        </label>

        <section v-if="community.loading && community.groups.length === 0" class="empty-state community-empty">
          <span class="empty-icon"><ion-icon :icon="peopleOutline" /></span>
          <h2>Loading communities</h2>
          <p>Checking for rider groups and membership updates.</p>
        </section>

        <section v-else-if="community.groups.length === 0" class="empty-state community-empty">
          <span class="empty-icon"><ion-icon :icon="peopleOutline" /></span>
          <h2>Your crew starts here</h2>
          <p>Create a community, invite riders, and organize your next meetup.</p>
          <button class="primary-action" type="button" @click="showCreate = true">
            <ion-icon :icon="addOutline" />
            Create a group
          </button>
        </section>

        <section v-else class="community-grid">
          <article v-for="group in visibleGroups" :key="group.id" class="community-card">
            <div class="community-card__top">
              <div class="community-avatar">
                <img v-if="group.logoDataUrl" :src="group.logoDataUrl" alt="">
                <template v-else>{{ group.name.slice(0, 2).toUpperCase() }}</template>
              </div>
              <div v-if="community.isOwner(group)" class="community-owner">
                <ion-icon :icon="shieldCheckmarkOutline" />
                Admin
              </div>
            </div>
            <h2>{{ group.name }}</h2>
            <p>{{ group.description || 'A community for riders who enjoy the road together.' }}</p>
            <div class="community-card__meta">
              <span><ion-icon :icon="peopleOutline" /> {{ group.memberCount }} member{{ group.memberCount === 1 ? '' : 's' }}</span>
              <span v-if="group.hasMeeting">
                <ion-icon :icon="timeOutline" />
                {{ community.isOwner(group) ? formatMeeting(group.meeting?.meetingAt ?? '') : 'Meeting planned' }}
              </span>
            </div>

            <div v-if="group.hasMeeting" class="meeting-preview">
              <ion-icon :icon="locationOutline" />
              <div>
                <small>MEETING SPOT</small>
                <strong>{{ community.isOwner(group) ? group.meeting?.name : 'Shared by the group admin' }}</strong>
                <span v-if="community.isOwner(group)">{{ group.meeting?.address || 'Coordinates saved' }}</span>
              </div>
            </div>
            <p v-else class="meeting-empty">Meeting location has not been set.</p>

            <div class="community-card__actions">
              <button
                v-if="community.isOwner(group)"
                class="secondary-action"
                type="button"
                @click="openMeeting(group)"
              >
                <ion-icon :icon="locationOutline" />
                {{ group.hasMeeting ? 'Edit meeting' : 'Set meeting' }}
              </button>
              <button
                v-if="community.isOwner(group) && group.joinRequests?.length"
                class="secondary-action"
                type="button"
                @click="reviewingRequestsId = reviewingRequestsId === group.id ? null : group.id"
              >
                Requests · {{ group.joinRequests.length }}
              </button>
              <button
                v-if="community.isMember(group)"
                class="primary-action"
                type="button"
                @click="openChat(group)"
              >
                Open group <ion-icon :icon="chevronForwardOutline" />
              </button>
              <button
                v-else-if="group.membershipStatus === 'PENDING'"
                class="secondary-action"
                type="button"
                disabled
              >
                Waiting for approval
              </button>
              <button
                v-else-if="group.membershipStatus === 'BANNED'"
                class="secondary-action"
                type="button"
                disabled
              >
                Unable to join
              </button>
              <button
                v-else
                class="primary-action"
                type="button"
                :disabled="requestingGroupId === group.id"
                @click="requestToJoin(group)"
              >
                {{ requestingGroupId === group.id ? 'Sending…' : 'Request to join' }}
              </button>
            </div>
            <section
              v-if="reviewingRequestsId === group.id && community.isOwner(group)"
              class="community-requests"
              aria-label="Community join requests"
            >
              <h3>Join requests <span>{{ group.joinRequests?.length ?? 0 }}</span></h3>
              <article v-for="request in group.joinRequests" :key="request.userId">
                <div>
                  <strong>{{ request.displayName }}</strong>
                  <small>Waiting for admin approval</small>
                </div>
                <button
                  type="button"
                  aria-label="Approve rider"
                  :disabled="resolvingRequestId === `${group.id}:${request.userId}`"
                  @click="resolveRequest(group, request.userId, true)"
                >
                  <ion-icon :icon="checkmarkOutline" />
                </button>
                <button
                  class="community-request-reject"
                  type="button"
                  aria-label="Reject rider"
                  :disabled="resolvingRequestId === `${group.id}:${request.userId}`"
                  @click="resolveRequest(group, request.userId, false)"
                >
                  <ion-icon :icon="closeOutline" />
                </button>
              </article>
            </section>
          </article>
        </section>
        <p v-if="community.storageError" class="community-admin-error" role="alert">{{ community.storageError }}</p>
        <p v-if="groupError" class="community-admin-error" role="alert">{{ groupError }}</p>

        <div v-if="showCreate" class="community-modal" role="dialog" aria-modal="true" aria-label="Create community">
          <form class="community-modal__card" @submit.prevent="createGroup">
            <button class="community-modal__close" type="button" aria-label="Close" @click="showCreate = false">×</button>
            <p class="eyebrow">NEW COMMUNITY</p>
            <h2>Create your riding group</h2>
            <label>
              <span>Group name</span>
              <input v-model="groupName" maxlength="60" required placeholder="Weekend Riders Cebu">
            </label>
            <label>
              <span>Description</span>
              <textarea v-model="groupDescription" maxlength="240" rows="3" placeholder="What are you riding for?"></textarea>
            </label>
            <button class="primary-action" type="submit" :disabled="!groupName.trim() || creatingGroup">
              {{ creatingGroup ? 'Creating…' : 'Create group' }}
            </button>
          </form>
        </div>

        <div v-if="showMeeting" class="community-modal" role="dialog" aria-modal="true" aria-label="Set meeting location">
          <form class="community-modal__card" @submit.prevent="saveMeeting(community.groups.find((item) => item.id === showMeeting)!)">
            <button class="community-modal__close" type="button" aria-label="Close" @click="showMeeting = null">×</button>
            <p class="eyebrow">ADMIN ONLY</p>
            <h2>Set meeting location</h2>
            <label>
              <span>Meeting name</span>
              <input v-model="meetingName" maxlength="100" required placeholder="JY Square car park">
            </label>
            <label>
              <span>Address or landmark</span>
              <input v-model="meetingAddress" maxlength="180" placeholder="Building entrance, barangay">
            </label>
            <label>
              <span>Meet-up time</span>
              <input v-model="meetingAt" type="datetime-local">
            </label>
            <button class="primary-action" type="submit" :disabled="!meetingName.trim()">Save meeting</button>
          </form>
        </div>
      </main>
    </ion-content>
  </ion-page>
</template>
