import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useAuthStore } from '@/stores/auth'

export interface CommunityMessage {
  id: string
  senderId: string
  senderName: string
  text: string
  imageDataUrl?: string
  audioDataUrl?: string
  createdAt: string
}

export interface MeetingLocation {
  name: string
  address: string
  latitude: number
  longitude: number
  meetingAt: string
}

export interface CommunityGroup {
  id: string
  name: string
  description: string
  ownerId: string
  ownerName: string
  memberIds: string[]
  memberNames?: Record<string, string>
  bannedMemberIds?: string[]
  mutedMemberIds?: string[]
  memberCount: number
  createdAt: string
  logoDataUrl?: string
  themeColor?: string
  meeting?: MeetingLocation
  messages: CommunityMessage[]
}

const communityStorageKey = 'ridehub.community.groups.v1.shared'

export const useCommunityStore = defineStore('community', () => {
  const auth = useAuthStore()
  const groups = ref<CommunityGroup[]>([])
  const storageError = ref('')
  let storageUserId = ''

  function isCommunityGroup(value: unknown): value is CommunityGroup {
    if (typeof value !== 'object' || value === null) return false
    const group = value as Partial<CommunityGroup>
    return typeof group.id === 'string'
      && typeof group.name === 'string'
      && typeof group.ownerId === 'string'
      && Array.isArray(group.memberIds)
      && Array.isArray(group.messages)
  }

  function load() {
    const userId = auth.user?.id
    storageUserId = ''
    if (!userId) {
      groups.value = []
      return
    }
    try {
      const value = JSON.parse(localStorage.getItem(communityStorageKey) ?? '[]')
      groups.value = Array.isArray(value)
        ? value.filter(isCommunityGroup).map((group) => ({
            ...group,
            memberNames: group.memberNames ?? {},
            bannedMemberIds: group.bannedMemberIds ?? [],
            mutedMemberIds: group.mutedMemberIds ?? [],
            themeColor: /^#[\da-f]{6}$/i.test(group.themeColor ?? '') ? group.themeColor : '#ff7a1a',
            memberCount: group.memberIds.length,
          }))
        : []
      storageUserId = userId
      storageError.value = ''
    } catch (reason) {
      groups.value = []
      storageUserId = userId
      storageError.value = reason instanceof Error
        ? `Communities could not be loaded: ${reason.message}`
        : 'Communities could not be loaded from this device.'
    }
  }

  watch(() => auth.user?.id, load, { immediate: true, flush: 'sync' })
  watch(groups, (value) => {
    if (!storageUserId) return
    try {
      localStorage.setItem(communityStorageKey, JSON.stringify(value))
      storageError.value = ''
    } catch (reason) {
      storageError.value = reason instanceof Error
        ? `Changes could not be saved on this device: ${reason.message}`
        : 'Changes could not be saved on this device.'
    }
  }, { deep: true, flush: 'sync' })

  const memberGroups = computed(() => groups.value
    .filter((group) => group.ownerId === auth.user?.id || group.memberIds.includes(auth.user?.id ?? ''))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt)))

  function createGroup(name: string, description: string) {
    const user = auth.user
    if (!user) throw new Error('Sign in to create a group.')
    const now = new Date().toISOString()
    const group: CommunityGroup = {
      id: crypto.randomUUID(),
      name: name.trim(),
      description: description.trim(),
      ownerId: user.id,
      ownerName: user.name?.trim() || user.email,
      memberIds: [user.id],
      memberNames: { [user.id]: user.name?.trim() || user.email },
      bannedMemberIds: [],
      mutedMemberIds: [],
      memberCount: 1,
      createdAt: now,
      messages: [{
        id: crypto.randomUUID(),
        senderId: 'system',
        senderName: 'RideHub',
        text: 'Group created. Welcome to the crew.',
        createdAt: now,
      }],
    }
    groups.value.unshift(group)
    return group
  }

  function joinGroup(groupId: string) {
    const user = auth.user
    if (!user) throw new Error('Sign in to join a group.')
    const group = groups.value.find((item) => item.id === groupId)
    if (!group) throw new Error('Group could not be found.')
    if (group.bannedMemberIds?.includes(user.id)) {
      throw new Error('You are not allowed to join this group.')
    }
    if (group.memberIds.includes(user.id)) return
    group.memberIds.push(user.id)
    group.memberNames ??= {}
    const memberName = user.name?.trim() || user.email
    group.memberNames[user.id] = memberName
    updateMemberCount(group)
    group.messages.push({
      id: crypto.randomUUID(),
      senderId: 'system',
      senderName: 'RideHub',
      text: `${memberName} joined ${group.name}.`,
      createdAt: new Date().toISOString(),
    })
  }

  function leaveGroup(groupId: string) {
    const user = auth.user
    if (!user) throw new Error('Sign in to leave a group.')
    const group = groups.value.find((item) => item.id === groupId)
    if (!group) throw new Error('Group could not be found.')
    if (group.ownerId === user.id) {
      throw new Error('The group admin cannot leave. Delete the community or transfer admin access first.')
    }
    group.memberIds = group.memberIds.filter((id) => id !== user.id)
    updateMemberCount(group)
  }

  function deleteGroup(groupId: string) {
    const user = auth.user
    const group = groups.value.find((item) => item.id === groupId)
    if (!user || !group) throw new Error('Group could not be found.')
    if (!isOwner(group)) throw new Error('Only this group’s admin can delete the community.')
    groups.value = groups.value.filter((item) => item.id !== groupId)
  }

  function isOwner(group: CommunityGroup) {
    return group.ownerId === auth.user?.id
  }

  function setMeeting(groupId: string, meeting: MeetingLocation) {
    const group = groups.value.find((item) => item.id === groupId)
    if (!group) throw new Error('Group could not be found.')
    if (!isOwner(group)) throw new Error('Only the group admin can change the meeting location.')
    group.meeting = meeting
  }

  function updateMemberCount(group: CommunityGroup) {
    group.memberCount = group.memberIds.length
  }

  function moderateMember(groupId: string, memberId: string, action: 'kick' | 'ban' | 'mute' | 'unmute' | 'unban') {
    const user = auth.user
    const group = groups.value.find((item) => item.id === groupId)
    if (!user || !group) throw new Error('Group could not be found.')
    if (!isOwner(group)) throw new Error('Only this group’s admin can manage members.')
    if (memberId === group.ownerId) throw new Error('The group admin cannot be moderated.')

    group.bannedMemberIds ??= []
    group.mutedMemberIds ??= []
    if (action === 'kick' || action === 'ban') {
      group.memberIds = group.memberIds.filter((id) => id !== memberId)
      group.mutedMemberIds = group.mutedMemberIds.filter((id) => id !== memberId)
      updateMemberCount(group)
    }
    if (action === 'ban' && !group.bannedMemberIds.includes(memberId)) {
      group.bannedMemberIds.push(memberId)
    }
    if (action === 'unban') {
      group.bannedMemberIds = group.bannedMemberIds.filter((id) => id !== memberId)
    }
    if (action === 'mute' && !group.mutedMemberIds.includes(memberId)) {
      group.mutedMemberIds.push(memberId)
    }
    if (action === 'unmute') {
      group.mutedMemberIds = group.mutedMemberIds.filter((id) => id !== memberId)
    }
  }

  function updateGroup(groupId: string, updates: {
    name?: string
    description?: string
    logoDataUrl?: string | null
    themeColor?: string
  }) {
    const group = groups.value.find((item) => item.id === groupId)
    if (!group) throw new Error('Group could not be found.')
    if (!isOwner(group)) throw new Error('Only this group’s admin can edit community settings.')
    if (updates.name !== undefined) group.name = updates.name.trim()
    if (updates.description !== undefined) group.description = updates.description.trim()
    if (updates.themeColor !== undefined) {
      if (!/^#[\da-f]{6}$/i.test(updates.themeColor)) {
        throw new Error('Choose a valid community theme color.')
      }
      group.themeColor = updates.themeColor
    }
    if (updates.logoDataUrl !== undefined) {
      if (updates.logoDataUrl === null) delete group.logoDataUrl
      else group.logoDataUrl = updates.logoDataUrl
    }
  }

  function sendMessage(groupId: string, text: string, imageDataUrl?: string, audioDataUrl?: string) {
    const user = auth.user
    if (!user) throw new Error('Sign in to send messages.')
    const group = groups.value.find((item) => item.id === groupId)
    if (!group) throw new Error('Group could not be found.')
    if (!group.memberIds.includes(user.id) && group.ownerId !== user.id) {
      throw new Error('Join this group before sending messages.')
    }
    if (group.bannedMemberIds?.includes(user.id)) {
      throw new Error('You are not allowed to send messages in this group.')
    }
    if (group.mutedMemberIds?.includes(user.id) && group.ownerId !== user.id) {
      throw new Error('You are muted in this group. Contact the admin for help.')
    }
    if (!text.trim() && !imageDataUrl && !audioDataUrl) return
    group.messages.push({
      id: crypto.randomUUID(),
      senderId: user.id,
      senderName: user.name?.trim() || user.email,
      text: text.trim(),
      imageDataUrl,
      audioDataUrl,
      createdAt: new Date().toISOString(),
    })
  }

  return {
    groups,
    memberGroups,
    storageError,
    createGroup,
    joinGroup,
    leaveGroup,
    deleteGroup,
    isOwner,
    setMeeting,
    moderateMember,
    updateGroup,
    sendMessage,
  }
})
