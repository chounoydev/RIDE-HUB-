import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  communitiesApi,
  type CommunityChatEvent,
  type CommunityChatMessage,
  type CommunityRecord,
} from '@/services/communities'
import { useAuthStore } from '@/stores/auth'

export interface CommunityMessage {
  id: string
  senderId: string
  senderName: string
  text: string
  imageDataUrl?: string
  audioDataUrl?: string
  createdAt: string
  editedAt?: string
  localOnly?: boolean
}

export type MeetingLocation = NonNullable<CommunityRecord['meeting']>

export interface CommunityGroup extends CommunityRecord {
  messages: CommunityMessage[]
}

interface LegacyCommunityGroup {
  id: string
  name: string
  description: string
  ownerId: string
  ownerName: string
  memberIds: string[]
  memberCount: number
  createdAt: string
  logoDataUrl?: string
  themeColor?: string
  meeting?: MeetingLocation
  messages: CommunityMessage[]
}

const legacyCommunityStorageKey = 'ridehub.community.groups.v1.shared'
const messagesStorageKeyPrefix = 'ridehub.community.messages.v1.'

export const useCommunityStore = defineStore('community', () => {
  const auth = useAuthStore()
  const groups = ref<CommunityGroup[]>([])
  const loading = ref(false)
  const storageError = ref('')
  let storageUserId = ''
  let loadSequence = 0
  const messageCursors: Record<string, string> = {}
  const messageLoadSequences: Record<string, number> = {}

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  function isCommunityMessage(value: unknown): value is CommunityMessage {
    return isRecord(value)
      && typeof value.id === 'string'
      && typeof value.senderId === 'string'
      && typeof value.senderName === 'string'
      && typeof value.text === 'string'
      && typeof value.createdAt === 'string'
      && (value.editedAt === undefined || typeof value.editedAt === 'string')
      && (value.localOnly === undefined || typeof value.localOnly === 'boolean')
  }

  function isLegacyCommunityGroup(value: unknown): value is LegacyCommunityGroup {
    return isRecord(value)
      && typeof value.id === 'string'
      && typeof value.name === 'string'
      && typeof value.description === 'string'
      && typeof value.ownerId === 'string'
      && typeof value.ownerName === 'string'
      && Array.isArray(value.memberIds)
      && typeof value.memberCount === 'number'
      && typeof value.createdAt === 'string'
      && Array.isArray(value.messages)
      && value.messages.every(isCommunityMessage)
  }

  function loadLegacyGroups(): LegacyCommunityGroup[] {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(legacyCommunityStorageKey) ?? '[]')
      return Array.isArray(value) ? value.filter(isLegacyCommunityGroup) : []
    } catch (reason) {
      storageError.value = reason instanceof Error
        ? `Older community data could not be read: ${reason.message}`
        : 'Older community data could not be read from this device.'
      return []
    }
  }

  function loadLocalMessages(userId: string): Record<string, CommunityMessage[]> {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(`${messagesStorageKeyPrefix}${userId}`) ?? '{}')
      if (!isRecord(value)) return {}
      return Object.fromEntries(
        Object.entries(value)
          .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
          .map(([groupId, messages]) => [groupId, messages.filter(isCommunityMessage)]),
      )
    } catch (reason) {
      storageError.value = reason instanceof Error
        ? `Local chat history could not be read: ${reason.message}`
        : 'Local chat history could not be read from this device.'
      return {}
    }
  }

  function persistLocalMessages() {
    const userId = storageUserId
    if (!userId) return
    try {
      const messages = Object.fromEntries(
        groups.value
          .filter((group) => group.membershipStatus === 'ADMIN' || group.membershipStatus === 'APPROVED')
          .map((group) => [group.id, group.messages]),
      )
      localStorage.setItem(`${messagesStorageKeyPrefix}${userId}`, JSON.stringify(messages))
    } catch (reason) {
      storageError.value = reason instanceof Error
        ? `Chat history could not be saved on this device: ${reason.message}`
        : 'Chat history could not be saved on this device.'
    }
  }

  async function load() {
    const sequence = ++loadSequence
    const userId = auth.user?.id
    loading.value = true
    if (!userId) {
      storageUserId = ''
      groups.value = []
      for (const groupId of Object.keys(messageCursors)) delete messageCursors[groupId]
      storageError.value = ''
      loading.value = false
      return
    }

    const retainCurrentGroups = storageUserId === userId
    if (!retainCurrentGroups) {
      storageUserId = ''
      groups.value = []
      for (const groupId of Object.keys(messageCursors)) delete messageCursors[groupId]
    }
    storageError.value = ''
    const messages = loadLocalMessages(userId)
    const legacyGroups = loadLegacyGroups().filter((group) => group.ownerId === userId)
    try {
      const sharedGroups = await communitiesApi.list()
      if (sequence !== loadSequence || auth.user?.id !== userId) return

      const knownIds = new Set(sharedGroups.map((group) => group.id))
      for (const legacy of legacyGroups) {
        if (knownIds.has(legacy.id)) continue
        try {
          const imported = await communitiesApi.create({
            id: legacy.id,
            name: legacy.name,
            description: legacy.description,
            ownerName: legacy.ownerName,
            ...(legacy.logoDataUrl ? { logoDataUrl: legacy.logoDataUrl } : {}),
            ...(legacy.themeColor && /^#[\da-f]{6}$/i.test(legacy.themeColor)
              ? { themeColor: legacy.themeColor }
              : {}),
            ...(legacy.meeting ? { meeting: legacy.meeting } : {}),
          })
          sharedGroups.unshift(imported)
          knownIds.add(imported.id)
          if (!messages[legacy.id]?.length && legacy.messages.length) {
            messages[legacy.id] = legacy.messages
          }
        } catch (reason) {
          storageError.value = reason instanceof Error
            ? `A previous community could not be migrated: ${reason.message}`
            : 'A previous community could not be migrated.'
        }
        if (sequence !== loadSequence || auth.user?.id !== userId) return
      }

      storageUserId = userId
      groups.value = sharedGroups.map((group) => ({
        ...group,
        memberNames: group.memberNames ?? {},
        bannedMemberIds: group.bannedMemberIds ?? [],
        mutedMemberIds: group.mutedMemberIds ?? [],
        themeColor: /^#[\da-f]{6}$/i.test(group.themeColor) ? group.themeColor : '#ff7a1a',
        messages: group.membershipStatus === 'ADMIN' || group.membershipStatus === 'APPROVED'
          ? messages[group.id] ?? []
          : [],
      }))
      persistLocalMessages()
      loading.value = false
    } catch (reason) {
      if (sequence !== loadSequence || auth.user?.id !== userId) return
      if (!retainCurrentGroups) groups.value = []
      storageError.value = reason instanceof Error
        ? `Shared communities could not be loaded: ${reason.message}`
        : 'Shared communities could not be loaded.'
      loading.value = false
    }
  }

  watch(() => auth.user?.id, () => { void load() }, { immediate: true, flush: 'sync' })
  watch(groups, persistLocalMessages, { deep: true, flush: 'sync' })

  const memberGroups = computed(() => groups.value
    .filter((group) => group.membershipStatus === 'ADMIN' || group.membershipStatus === 'APPROVED')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt)))

  function applyRecord(record: CommunityRecord) {
    const current = groups.value.find((group) => group.id === record.id)
    const group: CommunityGroup = {
      ...record,
      memberNames: record.memberNames ?? {},
      bannedMemberIds: record.bannedMemberIds ?? [],
      mutedMemberIds: record.mutedMemberIds ?? [],
      messages: current?.messages ?? [],
    }
    const index = groups.value.findIndex((item) => item.id === record.id)
    if (index === -1) groups.value.unshift(group)
    else groups.value[index] = group
    storageError.value = ''
    return group
  }

  async function refresh() {
    await load()
  }

  async function createGroup(name: string, description: string) {
    const user = auth.user
    if (!user) throw new Error('Sign in to create a group.')
    const group = await communitiesApi.create({
      name: name.trim(),
      description: description.trim(),
      ownerName: user.name?.trim() || user.email,
    })
    return applyRecord(group)
  }

  async function joinGroup(groupId: string) {
    const user = auth.user
    if (!user) throw new Error('Sign in to request to join a group.')
    const record = await communitiesApi.requestJoin(groupId, user.name?.trim() || user.email)
    return applyRecord(record)
  }

  async function resolveJoinRequest(groupId: string, memberId: string, approve: boolean) {
    const group = await communitiesApi.resolveJoinRequest(groupId, memberId, approve)
    return applyRecord(group)
  }

  async function leaveGroup(groupId: string) {
    const group = groups.value.find((item) => item.id === groupId)
    if (!auth.user || !group) throw new Error('Group could not be found.')
    await communitiesApi.leave(groupId)
    group.membershipStatus = 'NONE'
    group.memberIds = group.memberIds.filter((id) => id !== auth.user?.id)
    group.memberCount = Math.max(0, group.memberCount - 1)
    group.messages = []
    await load()
  }

  async function deleteGroup(groupId: string) {
    const group = groups.value.find((item) => item.id === groupId)
    if (!group) throw new Error('Group could not be found.')
    if (!isOwner(group)) throw new Error('Only this group’s admin can delete the community.')
    await communitiesApi.delete(groupId)
    groups.value = groups.value.filter((item) => item.id !== groupId)
  }

  function isOwner(group: CommunityGroup) {
    return group.membershipStatus === 'ADMIN' || group.ownerId === auth.user?.id
  }

  function isMember(group: CommunityGroup) {
    return group.membershipStatus === 'ADMIN' || group.membershipStatus === 'APPROVED'
  }

  function applyMessage(group: CommunityGroup, message: CommunityChatMessage) {
    const index = group.messages.findIndex((item) => item.id === message.id)
    if (index === -1) group.messages.push(message)
    else group.messages[index] = message
    group.messages.sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    )
  }

  function applyChatEvent(group: CommunityGroup, event: CommunityChatEvent) {
    if (event.kind === 'DELETE') {
      group.messages = group.messages.filter((message) => message.id !== event.messageId)
      return
    }
    if (event.message) applyMessage(group, event.message)
  }

  async function loadMessages(groupId: string) {
    const userId = auth.user?.id
    const group = groups.value.find((item) => item.id === groupId)
    if (!userId || !group || !isMember(group)) return
    const sequence = (messageLoadSequences[groupId] ?? 0) + 1
    messageLoadSequences[groupId] = sequence
    const locallySavedMessages = [...group.messages]
    const snapshot = await communitiesApi.listMessages(groupId)
    if (
      auth.user?.id !== userId
      || messageLoadSequences[groupId] !== sequence
      || !groups.value.some((item) => item.id === groupId && isMember(item))
    ) return
    const sharedMessageIds = new Set(snapshot.messages.map((message) => message.id))
    const localOnlyMessages = locallySavedMessages
      .filter((message) => !sharedMessageIds.has(message.id))
      .map((message) => ({ ...message, localOnly: true }))
    group.messages = [...snapshot.messages, ...localOnlyMessages]
      .sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
    messageCursors[groupId] = snapshot.cursor
  }

  async function pollMessages(groupId: string) {
    const userId = auth.user?.id
    const group = groups.value.find((item) => item.id === groupId)
    if (!userId || !group || !isMember(group)) return
    if (messageCursors[groupId] === undefined) {
      await loadMessages(groupId)
      return
    }
    const updates = await communitiesApi.pollMessages(groupId, messageCursors[groupId]!)
    if (
      auth.user?.id !== userId
      || !groups.value.some((item) => item.id === groupId && isMember(item))
    ) return
    for (const event of updates.events) applyChatEvent(group, event)
    messageCursors[groupId] = updates.cursor
  }

  async function setMeeting(groupId: string, meeting: MeetingLocation) {
    const group = groups.value.find((item) => item.id === groupId)
    if (!group) throw new Error('Group could not be found.')
    if (!isOwner(group)) throw new Error('Only the group admin can change the meeting location.')
    return applyRecord(await communitiesApi.setMeeting(groupId, meeting))
  }

  async function moderateMember(
    groupId: string,
    memberId: string,
    action: 'kick' | 'ban' | 'mute' | 'unmute' | 'unban',
  ) {
    const group = groups.value.find((item) => item.id === groupId)
    if (!group) throw new Error('Group could not be found.')
    if (!isOwner(group)) throw new Error('Only this group’s admin can manage members.')
    if (memberId === group.ownerId) throw new Error('The group admin cannot be moderated.')
    return applyRecord(await communitiesApi.moderate(groupId, memberId, action))
  }

  async function updateGroup(groupId: string, updates: {
    name?: string
    description?: string
    logoDataUrl?: string | null
    themeColor?: string
  }) {
    const group = groups.value.find((item) => item.id === groupId)
    if (!group) throw new Error('Group could not be found.')
    if (!isOwner(group)) throw new Error('Only this group’s admin can edit community settings.')
    return applyRecord(await communitiesApi.update(groupId, updates))
  }

  async function sendMessage(groupId: string, text: string, imageDataUrl?: string, audioDataUrl?: string) {
    const user = auth.user
    if (!user) throw new Error('Sign in to send messages.')
    const group = groups.value.find((item) => item.id === groupId)
    if (!group) throw new Error('Group could not be found.')
    if (!isMember(group)) throw new Error('Wait for the group admin to approve your request before sending messages.')
    if (group.bannedMemberIds?.includes(user.id)) {
      throw new Error('You are not allowed to send messages in this group.')
    }
    if (group.mutedMemberIds?.includes(user.id) && !isOwner(group)) {
      throw new Error('You are muted in this group. Contact the admin for help.')
    }
    if (!text.trim() && !imageDataUrl && !audioDataUrl) return
    const message = await communitiesApi.sendMessage(groupId, {
      text: text.trim(),
      ...(imageDataUrl ? { imageDataUrl } : {}),
      ...(audioDataUrl ? { audioDataUrl } : {}),
    })
    applyMessage(group, message)
    return message
  }

  async function editMessage(groupId: string, messageId: string, text: string) {
    const user = auth.user
    const group = groups.value.find((item) => item.id === groupId)
    if (!user || !group || !isMember(group)) throw new Error('Join this group before editing messages.')
    if (group.messages.find((item) => item.id === messageId)?.localOnly) {
      throw new Error('This older message was saved only on this device and cannot be changed for the group.')
    }
    const message = await communitiesApi.editMessage(groupId, messageId, text)
    applyMessage(group, message)
    return message
  }

  async function deleteMessage(groupId: string, messageId: string) {
    const user = auth.user
    const group = groups.value.find((item) => item.id === groupId)
    if (!user || !group || !isMember(group)) throw new Error('Join this group before removing messages.')
    const message = group.messages.find((item) => item.id === messageId)
    if (!message) throw new Error('This message is no longer available.')
    if (message.localOnly) {
      throw new Error('This older message was saved only on this device and cannot be changed for the group.')
    }
    if (message.senderId !== user.id && !isOwner(group)) {
      throw new Error('You can only remove your own messages.')
    }
    await communitiesApi.deleteMessage(groupId, messageId)
    group.messages = group.messages.filter((item) => item.id !== messageId)
  }

  return {
    groups,
    memberGroups,
    loading,
    storageError,
    refresh,
    createGroup,
    joinGroup,
    resolveJoinRequest,
    leaveGroup,
    deleteGroup,
    isOwner,
    isMember,
    setMeeting,
    moderateMember,
    updateGroup,
    loadMessages,
    pollMessages,
    sendMessage,
    editMessage,
    deleteMessage,
  }
})
