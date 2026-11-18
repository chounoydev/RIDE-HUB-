<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { IonContent, IonIcon, IonPage, onIonViewWillEnter, onIonViewWillLeave } from '@ionic/vue'
import {
  callOutline,
  chevronBackOutline,
  closeOutline,
  createOutline,
  imageOutline,
  locationOutline,
  peopleOutline,
  personRemoveOutline,
  micOffOutline,
  micOutline,
  settingsOutline,
  sendOutline,
  stopCircleOutline,
  trashOutline,
  volumeHighOutline,
  volumeMuteOutline,
} from 'ionicons/icons'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useCommunityStore } from '@/stores/community'
import { communitiesApi, type VoiceCallParticipant, type VoiceCallSignal } from '@/services/communities'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const community = useCommunityStore()
const activeGroupId = ref(typeof route.query.group === 'string' ? route.query.group : '')
const draft = ref('')
const messageList = ref<HTMLElement | null>(null)
const callActive = ref(false)
const callConnecting = ref(false)
const micMuted = ref(false)
const callError = ref('')
const voiceParticipants = ref<VoiceCallParticipant[]>([])
const remoteAudio = ref<HTMLAudioElement | null>(null)
const messageError = ref('')
const editingMessageId = ref('')
const editDraft = ref('')
const messageSending = ref(false)
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
let callCommunityId = ''
let callId = ''
let callUserId = ''
let callCursor = '0'
let callGeneration = 0
let callPollTimer: number | undefined
let callPollInFlight = false
let chatPollTimer: number | undefined
let chatPollInFlight = false
const callPeers = new Map<string, RTCPeerConnection>()
const callOfferSent = new Set<string>()
const pendingIceCandidates = new Map<string, RTCIceCandidateInit[]>()
const remoteTracks = new Map<string, Set<MediaStreamTrack>>()
const remoteAudioStream = new MediaStream()
let recorderStream: MediaStream | null = null
let mediaRecorder: MediaRecorder | null = null
let recordingChunks: Blob[] = []
let recordingTimer: number | undefined
let discardRecording = false

onIonViewWillEnter(() => {
  void community.refresh()
  startChatPolling()
})

watch([settingsName, settingsDescription, settingsThemeColor], () => {
  adminSaved.value = false
})

const activeGroup = computed(() =>
  community.memberGroups.find((group) => group.id === activeGroupId.value) ?? null,
)

watch(() => route.query.group, (groupId) => {
  if (typeof groupId === 'string') activeGroupId.value = groupId
})

watch(activeGroupId, (groupId, previousGroupId) => {
  if (previousGroupId && groupId !== previousGroupId && callActive.value) void endCall(false)
})

watch(activeGroup, (group) => {
  if (!group) {
    editingMessageId.value = ''
    return
  }
  void community.loadMessages(group.id)
    .then(() => scrollMessages())
    .catch((reason) => {
      messageError.value = reason instanceof Error ? reason.message : 'Group messages could not be loaded.'
    })
})

watch(activeGroup, () => void scrollMessages(), { deep: true })

function selectGroup(groupId: string) {
  activeGroupId.value = groupId
}

async function sendMessage(imageDataUrl?: string, audioDataUrl?: string) {
  if (!activeGroup.value || messageSending.value) return
  const groupId = activeGroup.value.id
  messageSending.value = true
  try {
    await community.sendMessage(groupId, draft.value, imageDataUrl, audioDataUrl)
    draft.value = ''
    messageError.value = ''
    void scrollMessages()
  } catch (reason) {
    messageError.value = reason instanceof Error ? reason.message : 'Message could not be sent.'
  } finally {
    messageSending.value = false
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
    await community.sendMessage(activeGroup.value.id, '', undefined, audioDataUrl)
    messageError.value = ''
    void scrollMessages()
  } catch (reason) {
    messageError.value = reason instanceof Error ? reason.message : 'Voice message could not be sent.'
  }
}

function startChatPolling() {
  if (chatPollTimer !== undefined) window.clearInterval(chatPollTimer)
  chatPollTimer = window.setInterval(() => { void pollActiveChat() }, 2_000)
}

async function pollActiveChat() {
  const group = activeGroup.value
  if (!group || chatPollInFlight) return
  chatPollInFlight = true
  try {
    await community.pollMessages(group.id)
  } catch (reason) {
    messageError.value = reason instanceof Error ? reason.message : 'New group messages could not be loaded.'
  } finally {
    chatPollInFlight = false
  }
}

function beginEditMessage(messageId: string, text: string) {
  editingMessageId.value = messageId
  editDraft.value = text
  messageError.value = ''
}

function cancelEditMessage() {
  editingMessageId.value = ''
  editDraft.value = ''
}

async function saveMessageEdit(messageId: string) {
  if (!activeGroup.value) return
  try {
    await community.editMessage(activeGroup.value.id, messageId, editDraft.value)
    cancelEditMessage()
    messageError.value = ''
  } catch (reason) {
    messageError.value = reason instanceof Error ? reason.message : 'Message could not be edited.'
  }
}

async function unsendMessage(messageId: string) {
  const group = activeGroup.value
  if (!group) return
  if (!window.confirm('Unsend this message for everyone in the group?')) return
  try {
    await community.deleteMessage(group.id, messageId)
    messageError.value = ''
  } catch (reason) {
    messageError.value = reason instanceof Error ? reason.message : 'Message could not be unsent.'
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

async function optimizeImage(file: File, maxDimensions: number[], maxBytes = 500_000): Promise<string> {
  const imageUrl = URL.createObjectURL(file)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('This image format could not be opened. Try a JPEG, PNG, or WebP image.'))
      image.src = imageUrl
    })
    for (const maxDimension of maxDimensions) {
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
        if (blob.size <= maxBytes) return await blobToDataUrl(blob)
      }
    }
    throw new Error(`The image could not be reduced below ${Math.floor(maxBytes / 1000)} KB. Try a different image.`)
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
  try {
    const dataUrl = await optimizeImage(file, [1280, 960, 720, 512])
    await sendMessage(dataUrl)
  } catch (reason) {
    messageError.value = reason instanceof Error ? reason.message : 'The image could not be prepared.'
  } finally {
    input.value = ''
  }
}

function scrollMessages() {
  void nextTick(() => {
    if (messageList.value) {
      messageList.value.scrollTop = messageList.value.scrollHeight
    }
  })
}

async function startCall() {
  if (callActive.value || !activeGroup.value) return
  callError.value = ''
  messageError.value = ''
  callActive.value = true
  callConnecting.value = true
  const generation = ++callGeneration
  const currentUserId = auth.user?.id
  if (!currentUserId) {
    callConnecting.value = false
    callError.value = 'Sign in again before joining a group voice call.'
    return
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
    callConnecting.value = false
    callError.value = 'Live voice calls are not supported by this browser.'
    callActive.value = true
    return
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    if (generation !== callGeneration) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    callStream = stream
    stream.getAudioTracks().forEach((track) => { track.enabled = !micMuted.value })
    const groupId = activeGroup.value.id
    const state = await communitiesApi.joinVoiceCall(groupId)
    if (generation !== callGeneration) {
      stream.getTracks().forEach((track) => track.stop())
      await communitiesApi.leaveVoiceCall(groupId, state.callId)
      return
    }
    callCommunityId = groupId
    callId = state.callId
    callUserId = currentUserId
    callCursor = '0'
    callConnecting.value = false
    voiceParticipants.value = state.participants
    await nextTick()
    if (remoteAudio.value) remoteAudio.value.srcObject = remoteAudioStream
    await synchronizeCallPeers(state.participants)
    callPollTimer = window.setInterval(() => { void pollVoiceCall() }, 2_000)
    await pollVoiceCall()
  } catch (reason) {
    if (generation !== callGeneration) return
    const message = reason instanceof Error
      ? reason.message
      : 'Microphone permission was not granted.'
    await endCall(false)
    callActive.value = true
    callError.value = message
  }
}

function toggleMicrophone() {
  micMuted.value = !micMuted.value
  callStream?.getAudioTracks().forEach((track) => { track.enabled = !micMuted.value })
}

async function synchronizeCallPeers(participants: VoiceCallParticipant[]) {
  const remoteIds = new Set(participants
    .map((participant) => participant.userId)
    .filter((userId) => userId !== callUserId))
  for (const [userId, peer] of callPeers) {
    if (!remoteIds.has(userId)) removeCallPeer(userId, peer)
  }
  for (const participant of participants) {
    if (participant.userId !== callUserId) await ensureCallPeer(participant.userId)
  }
}

async function ensureCallPeer(userId: string): Promise<RTCPeerConnection> {
  const existing = callPeers.get(userId)
  if (existing) return existing
  const peer = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
  })
  callPeers.set(userId, peer)
  callStream?.getAudioTracks().forEach((track) => peer.addTrack(track, callStream!))
  peer.onicecandidate = (event) => {
    if (event.candidate) void sendCallSignal(userId, 'candidate', event.candidate.toJSON())
  }
  peer.ontrack = (event) => {
    const tracks = remoteTracks.get(userId) ?? new Set<MediaStreamTrack>()
    for (const track of event.streams[0]?.getAudioTracks() ?? [event.track]) {
      if (!tracks.has(track)) {
        tracks.add(track)
        remoteAudioStream.addTrack(track)
      }
    }
    remoteTracks.set(userId, tracks)
    if (remoteAudio.value) {
      remoteAudio.value.srcObject = remoteAudioStream
      void remoteAudio.value.play().catch(() => {
        callError.value = 'Tap the screen or adjust your device volume to enable call audio.'
      })
    }
  }
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === 'failed') {
      callError.value = 'A rider could not be reached. Check the network and rejoin the call.'
    }
  }

  if (callUserId && callUserId < userId && !callOfferSent.has(userId)) {
    callOfferSent.add(userId)
    try {
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      if (peer.localDescription) {
        await sendCallSignal(userId, 'offer', {
          type: peer.localDescription.type,
          sdp: peer.localDescription.sdp,
        })
      }
    } catch (reason) {
      callError.value = reason instanceof Error ? reason.message : 'The voice connection could not be started.'
    }
  }
  return peer
}

function removeCallPeer(userId: string, peer: RTCPeerConnection) {
  peer.close()
  callPeers.delete(userId)
  callOfferSent.delete(userId)
  pendingIceCandidates.delete(userId)
  for (const track of remoteTracks.get(userId) ?? []) remoteAudioStream.removeTrack(track)
  remoteTracks.delete(userId)
}

async function sendCallSignal(
  userId: string,
  kind: 'offer' | 'answer' | 'candidate',
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit,
) {
  if (!callCommunityId || !callId || !callActive.value) return
  try {
    await communitiesApi.sendVoiceSignal(callCommunityId, callId, userId, kind, payload)
  } catch (reason) {
    callError.value = reason instanceof Error ? reason.message : 'A voice call signal could not be sent.'
  }
}

async function handleCallSignal(signal: VoiceCallSignal) {
  const peer = await ensureCallPeer(signal.fromUserId)
  if (signal.kind === 'offer') {
    await peer.setRemoteDescription(signal.payload)
    const answer = await peer.createAnswer()
    await peer.setLocalDescription(answer)
    if (peer.localDescription) {
      await sendCallSignal(signal.fromUserId, 'answer', {
        type: peer.localDescription.type,
        sdp: peer.localDescription.sdp,
      })
    }
    await applyPendingIceCandidates(signal.fromUserId, peer)
  } else if (signal.kind === 'answer') {
    await peer.setRemoteDescription(signal.payload)
    await applyPendingIceCandidates(signal.fromUserId, peer)
  } else {
    const candidate = signal.payload
    if (!peer.remoteDescription) {
      const pending = pendingIceCandidates.get(signal.fromUserId) ?? []
      pending.push(candidate)
      pendingIceCandidates.set(signal.fromUserId, pending)
    } else {
      await peer.addIceCandidate(candidate)
    }
  }
}

async function applyPendingIceCandidates(userId: string, peer: RTCPeerConnection) {
  const candidates = pendingIceCandidates.get(userId) ?? []
  pendingIceCandidates.delete(userId)
  for (const candidate of candidates) await peer.addIceCandidate(candidate)
}

async function pollVoiceCall() {
  if (callPollInFlight || !callCommunityId || !callId || !callUserId) return
  callPollInFlight = true
  const generation = callGeneration
  try {
    const state = await communitiesApi.pollVoiceCall(callCommunityId, callId, callCursor)
    if (generation !== callGeneration) return
    voiceParticipants.value = state.participants
    await synchronizeCallPeers(state.participants)
    for (const signal of state.signals) {
      try {
        await handleCallSignal(signal)
      } catch (reason) {
        callError.value = reason instanceof Error ? reason.message : 'A voice call signal could not be processed.'
      }
      if (BigInt(signal.sequence) > BigInt(callCursor)) callCursor = signal.sequence
    }
  } catch (reason) {
    if (generation === callGeneration) {
      callError.value = reason instanceof Error ? reason.message : 'The voice call connection was interrupted.'
    }
  } finally {
    callPollInFlight = false
  }
}

async function endCall(showLeaveError = true) {
  const groupId = callCommunityId
  const activeCallId = callId
  ++callGeneration
  if (callPollTimer !== undefined) window.clearInterval(callPollTimer)
  callPollTimer = undefined
  for (const [userId, peer] of callPeers) removeCallPeer(userId, peer)
  callStream?.getTracks().forEach((track) => track.stop())
  callStream = null
  callActive.value = false
  callConnecting.value = false
  micMuted.value = false
  callError.value = ''
  callCommunityId = ''
  callId = ''
  callUserId = ''
  callCursor = '0'
  voiceParticipants.value = []
  for (const track of remoteAudioStream.getTracks()) remoteAudioStream.removeTrack(track)
  if (remoteAudio.value) remoteAudio.value.srcObject = null
  if (groupId && activeCallId) {
    try {
      await communitiesApi.leaveVoiceCall(groupId, activeCallId)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'The server could not be notified that you left the call.'
      if (showLeaveError) messageError.value = message
      else console.warn(message)
    }
  }
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
  if (!window.confirm(`Delete “${group.name}” and its shared messages for every rider? This cannot be undone.`)) return
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
    adminPanelOpen.value = false
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
    const dataUrl = await optimizeImage(file, [512, 384, 256])
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
  if (chatPollTimer !== undefined) window.clearInterval(chatPollTimer)
  void endCall(false)
  cancelVoiceRecording()
})

onIonViewWillLeave(() => {
  if (chatPollTimer !== undefined) window.clearInterval(chatPollTimer)
  chatPollTimer = undefined
  if (callActive.value) void endCall(false)
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
                    group.messages.at(-1)?.localOnly
                      ? 'Older message saved on this device'
                      : group.messages.at(-1)?.text
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
            <button class="chat-header__call" type="button" aria-label="Start group voice call" @click="startCall">
              <ion-icon :icon="callOutline" />
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
            <p v-if="!activeGroup.messages.length" class="chat-messages__empty">
              No messages yet. Start the conversation.
            </p>
            <article
              v-for="message in activeGroup.messages"
              :key="message.id"
              :class="['chat-message', { 'chat-message--own': isOwnMessage(message.senderId), 'chat-message--system': message.senderId === 'system' }]"
            >
              <span v-if="message.senderId !== 'system' && !isOwnMessage(message.senderId)" class="chat-message__avatar">
                {{ message.senderName.slice(0, 1).toUpperCase() }}
              </span>
              <div class="chat-message__bubble">
                <div v-if="message.senderId !== 'system'" class="chat-message__meta">
                  <strong>{{ message.senderName }}</strong>
                  <span v-if="message.editedAt" class="chat-message__edited">Edited</span>
                </div>
                <span v-if="message.localOnly" class="chat-message__local-only">
                  Older message · saved only on this device
                </span>
                <div v-if="editingMessageId === message.id" class="chat-message__edit">
                  <textarea
                    v-model="editDraft"
                    maxlength="1000"
                    aria-label="Edit message"
                    @keydown.esc.prevent="cancelEditMessage"
                    @keydown.ctrl.enter.prevent="saveMessageEdit(message.id)"
                  />
                  <div class="chat-message__actions">
                    <button type="button" @click="saveMessageEdit(message.id)">Save</button>
                    <button type="button" @click="cancelEditMessage">Cancel</button>
                  </div>
                </div>
                <template v-else>
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
                  <div
                    v-if="!message.localOnly && message.senderId !== 'system' && (isOwnMessage(message.senderId) || community.isOwner(activeGroup))"
                    class="chat-message__actions"
                  >
                    <button
                      v-if="isOwnMessage(message.senderId) && message.text"
                      type="button"
                      aria-label="Edit message"
                      @click="beginEditMessage(message.id, message.text)"
                    >
                      <ion-icon :icon="createOutline" />
                      Edit
                    </button>
                    <button type="button" aria-label="Unsend message for everyone" @click="unsendMessage(message.id)">
                      <ion-icon :icon="trashOutline" />
                      Unsend
                    </button>
                  </div>
                </template>
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
            <button type="submit" :disabled="!draft.trim() || messageSending" aria-label="Send message">
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
          <button class="community-modal__close" type="button" aria-label="Close settings" @click="adminPanelOpen = false">
            <ion-icon :icon="closeOutline" />
          </button>
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
          <p class="community-admin-note">Community settings, moderation, and group messages are shared with approved riders.</p>
        </section>
      </div>

      <div v-if="callActive" class="ride-call" role="dialog" aria-modal="true" aria-label="Group voice call">
        <div class="ride-call__stage">
          <span class="ride-call__avatar"><ion-icon :icon="peopleOutline" /></span>
          <strong>{{ callConnecting ? 'Connecting to the group…' : `${voiceParticipants.length} rider${voiceParticipants.length === 1 ? '' : 's'} in the call` }}</strong>
          <span>{{ activeGroup?.name }}</span>
          <ul v-if="voiceParticipants.length" class="ride-call__participants">
            <li v-for="participant in voiceParticipants" :key="participant.userId">
              {{ participant.userId === auth.user?.id ? 'You' : participant.displayName }}
            </li>
          </ul>
          <audio ref="remoteAudio" autoplay playsinline aria-label="Group call audio" />
        </div>
        <div class="ride-call__top">
          <div>
            <span>LIVE VOICE CALL</span>
            <strong>{{ activeGroup?.name }}</strong>
          </div>
          <button type="button" aria-label="End call" @click="endCall()">
            <ion-icon :icon="closeOutline" />
          </button>
        </div>
        <div v-if="callError" class="ride-call__error" role="alert">{{ callError }}</div>
        <div class="ride-call__controls">
          <button
            type="button"
            :aria-label="micMuted ? 'Unmute microphone' : 'Mute microphone'"
            :aria-pressed="micMuted"
            @click="toggleMicrophone"
          >
            <ion-icon :icon="micMuted ? micOffOutline : micOutline" />
          </button>
          <button class="ride-call__hangup" type="button" aria-label="End call" @click="endCall()">
            <ion-icon :icon="callOutline" />
          </button>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>
