<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { IonContent, IonIcon, IonPage, onIonViewWillEnter } from '@ionic/vue'
import {
  callOutline,
  chevronBackOutline,
  closeOutline,
  imageOutline,
  locationOutline,
  personRemoveOutline,
  micOffOutline,
  micOutline,
  peopleOutline,
  settingsOutline,
  sendOutline,
  stopCircleOutline,
  trashOutline,
  volumeHighOutline,
  volumeMuteOutline,
  videocamOffOutline,
  videocamOutline,
} from 'ionicons/icons'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useCommunityStore } from '@/stores/community'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const community = useCommunityStore()
const activeGroupId = ref(typeof route.query.group === 'string' ? route.query.group : '')
const draft = ref('')
const messageList = ref<HTMLElement | null>(null)
const callActive = ref(false)
const micMuted = ref(false)
const cameraOff = ref(false)
const callError = ref('')
const messageError = ref('')
const adminPanelOpen = ref(false)
const adminError = ref('')
const adminSaved = ref(false)
const settingsName = ref('')
const settingsDescription = ref('')
const settingsThemeColor = ref('#ff7a1a')
const logoSaving = ref(false)
const voiceRecording = ref(false)
const voiceRecordingSeconds = ref(0)
let callStream: MediaStream | null = null
let recorderStream: MediaStream | null = null
let mediaRecorder: MediaRecorder | null = null
let recordingChunks: Blob[] = []
let recordingTimer: number | undefined
let discardRecording = false

onIonViewWillEnter(() => { void community.refresh() })

watch([settingsName, settingsDescription, settingsThemeColor], () => {
  adminSaved.value = false
})

const activeGroup = computed(() =>
  community.memberGroups.find((group) => group.id === activeGroupId.value) ?? null,
)

watch(() => route.query.group, (groupId) => {
  if (typeof groupId === 'string') activeGroupId.value = groupId
})

watch(activeGroup, () => void scrollMessages(), { deep: true })

function selectGroup(groupId: string) {
  activeGroupId.value = groupId
}

function sendMessage(imageDataUrl?: string, audioDataUrl?: string) {
  if (!activeGroup.value) return
  try {
    community.sendMessage(activeGroup.value.id, draft.value, imageDataUrl, audioDataUrl)
    draft.value = ''
    messageError.value = ''
    void scrollMessages()
  } catch (reason) {
    messageError.value = reason instanceof Error ? reason.message : 'Message could not be sent.'
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('The recording could not be prepared.'))
    reader.onerror = () => reject(new Error('The recording could not be read.'))
    reader.readAsDataURL(blob)
  })
}

async function sendVoiceMessage(blob: Blob) {
  if (!activeGroup.value) return
  try {
    const audioDataUrl = await blobToDataUrl(blob)
    community.sendMessage(activeGroup.value.id, '', undefined, audioDataUrl)
    messageError.value = ''
    void scrollMessages()
  } catch (reason) {
    messageError.value = reason instanceof Error ? reason.message : 'Voice message could not be sent.'
  }
}

function releaseVoiceRecorder() {
  if (recordingTimer !== undefined) window.clearInterval(recordingTimer)
  recordingTimer = undefined
  recorderStream?.getTracks().forEach((track) => track.stop())
  recorderStream = null
  mediaRecorder = null
  voiceRecording.value = false
}

async function startVoiceRecording() {
  messageError.value = ''
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    messageError.value = 'Voice recording is not supported by this browser.'
    return
  }
  try {
    recorderStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']
      .find((type) => MediaRecorder.isTypeSupported(type))
    mediaRecorder = mimeType
      ? new MediaRecorder(recorderStream, { mimeType, audioBitsPerSecond: 32_000 })
      : new MediaRecorder(recorderStream, { audioBitsPerSecond: 32_000 })
    recordingChunks = []
    discardRecording = false
    const recorder = mediaRecorder
    recorder.ondataavailable = (event) => {
      if (event.data.size) recordingChunks.push(event.data)
    }
    recorder.onstop = () => {
      const shouldDiscard = discardRecording
      const recording = new Blob(recordingChunks, { type: recorder.mimeType || 'audio/webm' })
      recordingChunks = []
      releaseVoiceRecorder()
      discardRecording = false
      if (shouldDiscard) return
      if (!recording.size) {
        messageError.value = 'No audio was recorded. Check your microphone and try again.'
      } else if (recording.size > 400_000) {
        messageError.value = 'That voice message is too large. Keep recordings under one minute and try again.'
      } else {
        void sendVoiceMessage(recording)
      }
    }
    recorder.onerror = () => {
      messageError.value = 'Voice recording stopped unexpectedly. Please try again.'
      discardRecording = true
      if (recorder.state === 'recording') recorder.stop()
      else releaseVoiceRecorder()
    }
    recorder.start()
    voiceRecordingSeconds.value = 0
    voiceRecording.value = true
    recordingTimer = window.setInterval(() => {
      voiceRecordingSeconds.value += 1
      if (voiceRecordingSeconds.value >= 60) stopVoiceRecording()
    }, 1000)
  } catch (reason) {
    releaseVoiceRecorder()
    messageError.value = reason instanceof Error
      ? `Microphone unavailable: ${reason.message}`
      : 'Microphone permission was not granted.'
  }
}

function stopVoiceRecording() {
  if (mediaRecorder?.state === 'recording') mediaRecorder.stop()
}

function cancelVoiceRecording() {
  if (mediaRecorder?.state === 'recording') {
    discardRecording = true
    mediaRecorder.stop()
  } else {
    releaseVoiceRecorder()
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob
      ? resolve(blob)
      : reject(new Error('The image could not be optimized.')), type, quality)
  })
}

async function optimizeLogo(file: File): Promise<string> {
  const imageUrl = URL.createObjectURL(file)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('This image format could not be opened. Try a JPEG, PNG, or WebP image.'))
      image.src = imageUrl
    })
    for (const maxDimension of [512, 384, 256]) {
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Image editing is unavailable in this browser.')
      context.fillStyle = '#192126'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      for (const quality of [0.86, 0.72, 0.58]) {
        let blob = await canvasToBlob(canvas, 'image/webp', quality)
        if (blob.type !== 'image/webp') {
          blob = await canvasToBlob(canvas, 'image/jpeg', quality)
        }
        if (blob.size <= 500_000) return await blobToDataUrl(blob)
      }
    }
    throw new Error('The image could not be reduced below 500 KB. Try a different image.')
  } finally {
    URL.revokeObjectURL(imageUrl)
  }
}

async function sendImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !activeGroup.value) return
  if (!file.type.startsWith('image/') || file.size > 4_000_000) {
    messageError.value = 'Choose an image smaller than 4 MB.'
    input.value = ''
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    if (typeof reader.result === 'string') sendMessage(reader.result)
  }
  reader.onerror = () => {
    messageError.value = 'The image could not be read. Choose another file.'
  }
  reader.readAsDataURL(file)
  input.value = ''
}

function scrollMessages() {
  void nextTick(() => {
    if (messageList.value) {
      messageList.value.scrollTop = messageList.value.scrollHeight
    }
  })
}

async function startCall() {
  callError.value = ''
  if (!navigator.mediaDevices?.getUserMedia) {
    callError.value = 'Camera and microphone calls are not supported by this browser.'
    callActive.value = true
    return
  }
  try {
    callStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    callActive.value = true
    await nextTick()
    const video = document.querySelector<HTMLVideoElement>('#ridehub-call-preview')
    if (video) {
      video.srcObject = callStream
      await video.play()
    }
  } catch (reason) {
    callActive.value = true
    callError.value = reason instanceof Error
      ? reason.message
      : 'Camera or microphone permission was not granted.'
  }
}

function toggleMicrophone() {
  micMuted.value = !micMuted.value
  callStream?.getAudioTracks().forEach((track) => { track.enabled = !micMuted.value })
}

function toggleCamera() {
  cameraOff.value = !cameraOff.value
  callStream?.getVideoTracks().forEach((track) => { track.enabled = !cameraOff.value })
}

function endCall() {
  callStream?.getTracks().forEach((track) => track.stop())
  callStream = null
  callActive.value = false
  micMuted.value = false
  cameraOff.value = false
  callError.value = ''
}

async function leaveCurrentGroup() {
  const group = activeGroup.value
  if (!group || community.isOwner(group)) return
  if (!window.confirm(`Leave ${group.name}? You can rejoin later unless the admin bans you.`)) return
  try {
    await community.leaveGroup(group.id)
    activeGroupId.value = ''
    messageError.value = ''
    void router.replace('/tabs/messages')
  } catch (reason) {
    messageError.value = reason instanceof Error ? reason.message : 'Could not leave this group.'
  }
}

async function deleteCurrentGroup() {
  const group = activeGroup.value
  if (!group || !community.isOwner(group)) return
  if (!window.confirm(`Delete “${group.name}” and its saved messages from this device? This cannot be undone.`)) return
  try {
    await community.deleteGroup(group.id)
    adminPanelOpen.value = false
    activeGroupId.value = ''
    void router.replace('/tabs/messages')
  } catch (reason) {
    adminError.value = reason instanceof Error ? reason.message : 'Community could not be deleted.'
  }
}

function openAdminPanel() {
  if (!activeGroup.value || !community.isOwner(activeGroup.value)) return
  settingsName.value = activeGroup.value.name
  settingsDescription.value = activeGroup.value.description
  settingsThemeColor.value = activeGroup.value.themeColor ?? '#ff7a1a'
  adminError.value = ''
  adminSaved.value = false
  adminPanelOpen.value = true
}

async function saveGroupSettings() {
  if (!activeGroup.value) return
  if (!settingsName.value.trim()) {
    adminError.value = 'Enter a community name before saving.'
    adminSaved.value = false
    return
  }
  try {
    await community.updateGroup(activeGroup.value.id, {
      name: settingsName.value,
      description: settingsDescription.value,
      themeColor: settingsThemeColor.value,
    })
    settingsName.value = activeGroup.value.name
    settingsDescription.value = activeGroup.value.description
    settingsThemeColor.value = activeGroup.value.themeColor ?? '#ff7a1a'
    adminError.value = ''
    adminSaved.value = true
  } catch (reason) {
    adminError.value = reason instanceof Error ? reason.message : 'Group settings could not be saved.'
    adminSaved.value = false
  }
}

async function setGroupLogo(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !activeGroup.value) return
  if (!file.type.startsWith('image/') || file.size > 15_000_000) {
    adminError.value = 'Choose an image smaller than 15 MB. It will be optimized automatically.'
    input.value = ''
    return
  }
  logoSaving.value = true
  try {
    const dataUrl = await optimizeLogo(file)
    await community.updateGroup(activeGroup.value.id, { logoDataUrl: dataUrl })
    adminError.value = ''
  } catch (reason) {
    adminError.value = reason instanceof Error ? reason.message : 'Logo could not be saved.'
  } finally {
    logoSaving.value = false
    input.value = ''
  }
}

async function clearGroupLogo() {
  if (!activeGroup.value) return
  try {
    await community.updateGroup(activeGroup.value.id, { logoDataUrl: null })
    adminError.value = ''
  } catch (reason) {
    adminError.value = reason instanceof Error ? reason.message : 'Community logo could not be removed.'
  }
}

async function moderateMember(memberId: string, action: 'kick' | 'ban' | 'mute' | 'unmute' | 'unban') {
  if (!activeGroup.value) return
  const name = activeGroup.value.memberNames?.[memberId] ?? 'this rider'
  const confirmation = action === 'ban'
    ? `Ban ${name} from this group? They will not be able to rejoin.`
    : action === 'kick'
      ? `Remove ${name} from this group? They can join again later.`
      : ''
  if (confirmation && !window.confirm(confirmation)) return
  try {
    await community.moderateMember(activeGroup.value.id, memberId, action)
    adminError.value = ''
  } catch (reason) {
    adminError.value = reason instanceof Error ? reason.message : 'Member action could not be completed.'
  }
}

const managedMembers = computed(() => {
  if (!activeGroup.value) return []
  const group = activeGroup.value
  const ids = [...new Set([...group.memberIds, ...(group.bannedMemberIds ?? [])])]
  return ids
    .filter((id) => id !== group.ownerId)
    .map((id) => ({
      id,
      name: group.memberNames?.[id] ?? `Rider ${id.slice(0, 6)}`,
      isMember: group.memberIds.includes(id),
      isBanned: group.bannedMemberIds?.includes(id) ?? false,
      isMuted: group.mutedMemberIds?.includes(id) ?? false,
    }))
})

function isOwnMessage(senderId: string) {
  return senderId === auth.user?.id
}

function formatMessageTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

onBeforeUnmount(() => {
  endCall()
  cancelVoiceRecording()
})
</script>

<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main :class="['chat-screen', { 'chat-screen--conversation': activeGroup }]">
        <aside class="chat-sidebar">
          <header class="chat-sidebar__header">
            <div>
              <p class="eyebrow">YOUR CREWS</p>
              <h1>Messages</h1>
            </div>
          </header>
          <div v-if="community.memberGroups.length" class="chat-group-list">
            <button
              v-for="group in community.memberGroups"
              :key="group.id"
              :class="['chat-group', { 'chat-group--active': activeGroupId === group.id }]"
              type="button"
              @click="selectGroup(group.id)"
            >
              <span class="chat-group__avatar">
                <img v-if="group.logoDataUrl" :src="group.logoDataUrl" alt="">
                <template v-else>{{ group.name.slice(0, 2).toUpperCase() }}</template>
              </span>
              <span class="chat-group__copy">
                <strong>{{ group.name }}</strong>
                <small>
                  {{
                    group.messages.at(-1)?.text
                      || (group.messages.at(-1)?.imageDataUrl
                        ? 'Photo shared'
                        : group.messages.at(-1)?.audioDataUrl
                          ? 'Voice message'
                          : 'No messages yet')
                  }}
                </small>
              </span>
              <span v-if="community.isOwner(group)" class="chat-group__admin">Admin</span>
            </button>
          </div>
          <div v-else class="chat-sidebar__empty">
            <ion-icon :icon="peopleOutline" />
            <strong>No groups yet</strong>
            <span>Create or join a rider community.</span>
          </div>
        </aside>

        <section
          v-if="activeGroup"
          :class="['chat-conversation', { 'chat-conversation--meeting': activeGroup.hasMeeting }]"
          :style="{ '--community-accent': activeGroup.themeColor ?? '#ff7a1a' }"
        >
          <header class="chat-header">
            <button class="chat-header__back" type="button" aria-label="Back to conversations" @click="activeGroupId = ''">
              <ion-icon :icon="chevronBackOutline" />
            </button>
            <span class="chat-header__avatar">
              <img v-if="activeGroup.logoDataUrl" :src="activeGroup.logoDataUrl" alt="">
              <template v-else>{{ activeGroup.name.slice(0, 2).toUpperCase() }}</template>
            </span>
            <div class="chat-header__title">
              <strong>{{ activeGroup.name }}</strong>
              <span>{{ activeGroup.memberCount }} member{{ activeGroup.memberCount === 1 ? '' : 's' }}</span>
            </div>
            <button class="chat-header__call" type="button" aria-label="Start group video call" @click="startCall">
              <ion-icon :icon="videocamOutline" />
            </button>
            <button
              v-if="community.isOwner(activeGroup)"
              class="chat-header__settings"
              type="button"
              aria-label="Manage community"
              @click="openAdminPanel"
            >
              <ion-icon :icon="settingsOutline" />
            </button>
            <button
              v-else
              class="chat-header__leave"
              type="button"
              @click="leaveCurrentGroup"
            >
              Leave
            </button>
          </header>

          <div v-if="activeGroup.hasMeeting" class="chat-meeting">
            <ion-icon :icon="locationOutline" />
            <div v-if="community.isOwner(activeGroup)">
              <small>MEETING LOCATION · ADMIN ONLY</small>
              <strong>{{ activeGroup.meeting?.name }}</strong>
              <span>{{ activeGroup.meeting?.address }}</span>
            </div>
            <div v-else>
              <small>GROUP MEET-UP</small>
              <strong>Meeting location is shared by the group admin</strong>
            </div>
          </div>

          <div ref="messageList" class="chat-messages" aria-live="polite">
            <article
              v-for="message in activeGroup.messages"
              :key="message.id"
              :class="['chat-message', { 'chat-message--own': isOwnMessage(message.senderId), 'chat-message--system': message.senderId === 'system' }]"
            >
              <span v-if="message.senderId !== 'system' && !isOwnMessage(message.senderId)" class="chat-message__avatar">
                {{ message.senderName.slice(0, 1).toUpperCase() }}
              </span>
              <div class="chat-message__bubble">
                <strong v-if="message.senderId !== 'system' && !isOwnMessage(message.senderId)">{{ message.senderName }}</strong>
                <img v-if="message.imageDataUrl" :src="message.imageDataUrl" alt="Shared in group">
                <p v-if="message.text">{{ message.text }}</p>
                <audio
                  v-if="message.audioDataUrl"
                  class="chat-message__audio"
                  :src="message.audioDataUrl"
                  controls
                  preload="metadata"
                  aria-label="Voice message"
                />
                <time v-if="message.senderId !== 'system'">{{ formatMessageTime(message.createdAt) }}</time>
              </div>
            </article>
          </div>

          <p v-if="messageError" class="chat-compose-error" role="alert">{{ messageError }}</p>
          <div v-if="voiceRecording" class="chat-compose chat-compose--recording">
            <span class="chat-compose__recording-status">
              <span class="chat-compose__recording-dot" />
              Recording · {{ voiceRecordingSeconds }}s
            </span>
            <button class="chat-compose__cancel-recording" type="button" @click="cancelVoiceRecording">
              Cancel
            </button>
            <button type="button" aria-label="Stop and send voice message" @click="stopVoiceRecording">
              <ion-icon :icon="stopCircleOutline" />
            </button>
          </div>
          <form v-else class="chat-compose" @submit.prevent="sendMessage()">
            <label class="chat-compose__image" aria-label="Send image">
              <ion-icon :icon="imageOutline" />
              <input type="file" accept="image/*" @change="sendImage">
            </label>
            <input v-model="draft" type="text" maxlength="1000" placeholder="Message the group">
            <button
              class="chat-compose__voice"
              type="button"
              aria-label="Record voice message"
              @click="startVoiceRecording"
            >
              <ion-icon :icon="micOutline" />
            </button>
            <button type="submit" :disabled="!draft.trim()" aria-label="Send message">
              <ion-icon :icon="sendOutline" />
            </button>
          </form>
        </section>

        <section v-else class="chat-placeholder">
          <span><ion-icon :icon="peopleOutline" /></span>
          <h2>Select a community</h2>
          <p>Choose a group to view its conversation and ride plans.</p>
        </section>
        <p v-if="community.storageError" class="community-storage-error" role="alert">{{ community.storageError }}</p>
      </main>

      <div v-if="adminPanelOpen && activeGroup && community.isOwner(activeGroup)" class="community-modal community-modal--admin" role="dialog" aria-modal="true" aria-label="Manage community">
        <section class="community-modal__card community-admin-panel">
          <button class="community-modal__close" type="button" aria-label="Close" @click="adminPanelOpen = false">×</button>
          <p class="eyebrow">COMMUNITY ADMIN</p>
          <h2>Manage {{ activeGroup.name }}</h2>
          <div class="community-logo-editor">
            <img v-if="activeGroup.logoDataUrl" :src="activeGroup.logoDataUrl" alt="Community logo">
            <span v-else class="community-logo-editor__fallback">{{ activeGroup.name.slice(0, 2).toUpperCase() }}</span>
            <label class="secondary-action">
              <ion-icon :icon="imageOutline" />
              {{ logoSaving ? 'Optimizing…' : 'Change logo' }}
              <input type="file" accept="image/*" :disabled="logoSaving" @change="setGroupLogo">
            </label>
            <button v-if="activeGroup.logoDataUrl" class="text-action" type="button" @click="clearGroupLogo">Remove</button>
            <small class="community-logo-hint">Images up to 15 MB are automatically optimized.</small>
          </div>
          <label class="community-admin-field">
            <span>Community name</span>
            <input v-model="settingsName" maxlength="60">
          </label>
          <label class="community-admin-field">
            <span>Description</span>
            <textarea v-model="settingsDescription" maxlength="240" rows="2"></textarea>
          </label>
          <label class="community-admin-field">
            <span>Chat theme color</span>
            <span class="community-theme-picker">
              <input v-model="settingsThemeColor" type="color" aria-label="Choose chat theme color">
              <span>{{ settingsThemeColor.toUpperCase() }}</span>
            </span>
          </label>
          <button class="primary-action community-admin-save" type="button" @click="saveGroupSettings">Save changes</button>
          <p v-if="adminSaved" class="community-admin-success" role="status">Changes saved for this community.</p>

          <div class="community-admin-members">
            <div class="community-admin-members__heading">
              <div>
                <p class="eyebrow">MEMBER SAFETY</p>
                <h3>Riders <span>{{ activeGroup.memberCount }}</span></h3>
              </div>
              <small>Admin controls</small>
            </div>
            <div v-if="managedMembers.length" class="community-admin-member-list">
              <article v-for="member in managedMembers" :key="member.id" class="community-admin-member">
                <span class="community-admin-member__avatar">{{ member.name.slice(0, 1).toUpperCase() }}</span>
                <div class="community-admin-member__name">
                  <strong>{{ member.name }}</strong>
                  <small>{{ member.isBanned ? 'Banned' : member.isMuted ? 'Muted' : member.isMember ? 'Member' : 'Not in group' }}</small>
                </div>
                <template v-if="member.isMember">
                  <button
                    class="community-admin-member__action"
                    type="button"
                    :aria-label="member.isMuted ? `Unmute ${member.name}` : `Mute ${member.name}`"
                    @click="moderateMember(member.id, member.isMuted ? 'unmute' : 'mute')"
                  >
                    <ion-icon :icon="member.isMuted ? volumeHighOutline : volumeMuteOutline" />
                  </button>
                  <button
                    class="community-admin-member__action community-admin-member__action--danger"
                    type="button"
                    :aria-label="`Remove ${member.name}`"
                    @click="moderateMember(member.id, 'kick')"
                  >
                    <ion-icon :icon="personRemoveOutline" />
                  </button>
                  <button
                    class="community-admin-member__action community-admin-member__action--danger"
                    type="button"
                    :aria-label="`Ban ${member.name}`"
                    @click="moderateMember(member.id, 'ban')"
                  >
                    <span>BAN</span>
                  </button>
                </template>
                <button
                  v-else-if="member.isBanned"
                  class="text-action"
                  type="button"
                  @click="moderateMember(member.id, 'unban')"
                >
                  Unban
                </button>
              </article>
            </div>
            <p v-else class="community-admin-empty">You’re the only rider here so far.</p>
          </div>
          <p v-if="adminError" class="community-admin-error" role="alert">{{ adminError }}</p>
          <div class="community-admin-danger-zone">
            <div>
              <strong>Delete community</strong>
              <small>Removes this community and its saved messages from this device.</small>
            </div>
            <button type="button" @click="deleteCurrentGroup">
              <ion-icon :icon="trashOutline" />
              Delete
            </button>
          </div>
          <p class="community-admin-note">Community settings and moderation are shared with riders. Chat messages stay on this device.</p>
        </section>
      </div>

      <div v-if="callActive" class="ride-call" role="dialog" aria-modal="true" aria-label="Group video call">
        <video id="ridehub-call-preview" autoplay muted playsinline />
        <div class="ride-call__top">
          <div>
            <span>LIVE GROUP CALL</span>
            <strong>{{ activeGroup?.name }}</strong>
          </div>
          <button type="button" aria-label="End call" @click="endCall">
            <ion-icon :icon="closeOutline" />
          </button>
        </div>
        <div v-if="callError" class="ride-call__error" role="alert">{{ callError }}</div>
        <div class="ride-call__controls">
          <button type="button" :aria-label="micMuted ? 'Unmute microphone' : 'Mute microphone'" @click="toggleMicrophone">
            <ion-icon :icon="micMuted ? micOffOutline : micOutline" />
          </button>
          <button class="ride-call__hangup" type="button" aria-label="End call" @click="endCall">
            <ion-icon :icon="callOutline" />
          </button>
          <button type="button" :aria-label="cameraOff ? 'Turn camera on' : 'Turn camera off'" @click="toggleCamera">
            <ion-icon :icon="cameraOff ? videocamOffOutline : videocamOutline" />
          </button>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>
