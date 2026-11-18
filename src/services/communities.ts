import { getAuthClient } from '@/services/auth'
import { apiBaseUrl } from '@/services/apiBase'

export type CommunityMembershipStatus = 'ADMIN' | 'APPROVED' | 'PENDING' | 'REJECTED' | 'BANNED' | 'NONE'
export type CommunityModerationAction = 'kick' | 'ban' | 'mute' | 'unmute' | 'unban'

export interface CommunityMeeting {
  name: string
  address: string
  latitude: number
  longitude: number
  meetingAt: string
}

export interface CommunityJoinRequest {
  userId: string
  displayName: string
  requestedAt: string
}

export interface CommunityRecord {
  id: string
  name: string
  description: string
  ownerId: string
  ownerName: string
  memberIds: string[]
  memberNames: Record<string, string>
  bannedMemberIds: string[]
  mutedMemberIds: string[]
  memberCount: number
  createdAt: string
  logoDataUrl?: string
  themeColor: string
  hasMeeting: boolean
  meeting?: CommunityMeeting
  membershipStatus: CommunityMembershipStatus
  joinRequests?: CommunityJoinRequest[]
}

export type VoiceSignalKind = 'offer' | 'answer' | 'candidate'

export interface VoiceCallParticipant {
  userId: string
  displayName: string
}

export type VoiceCallSignal =
  | { sequence: string; fromUserId: string; kind: 'offer'; payload: RTCSessionDescriptionInit }
  | { sequence: string; fromUserId: string; kind: 'answer'; payload: RTCSessionDescriptionInit }
  | { sequence: string; fromUserId: string; kind: 'candidate'; payload: RTCIceCandidateInit }

export interface VoiceCallState {
  callId: string
  participants: VoiceCallParticipant[]
  signals: VoiceCallSignal[]
}

export interface CommunityChatMessage {
  id: string
  senderId: string
  senderName: string
  text: string
  imageDataUrl?: string
  audioDataUrl?: string
  createdAt: string
  editedAt?: string
}

export interface CommunityChatSnapshot {
  messages: CommunityChatMessage[]
  cursor: string
}

export interface CommunityChatEvent {
  sequence: string
  kind: 'MESSAGE' | 'EDIT' | 'DELETE'
  messageId: string
  message?: CommunityChatMessage
}

export interface CommunityChatUpdates {
  events: CommunityChatEvent[]
  cursor: string
}

interface CreateCommunityInput {
  id?: string
  name: string
  description: string
  ownerName: string
  logoDataUrl?: string
  themeColor?: string
  meeting?: CommunityMeeting
}

interface CommunityUpdateInput {
  name?: string
  description?: string
  logoDataUrl?: string | null
  themeColor?: string
}

async function request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const session = await getAuthClient().getSession()
  if (session.error) {
    throw new Error(session.error.message || 'Your session could not be verified. Sign in again and retry.')
  }
  const token = session.data?.session?.token
  if (!token) throw new Error('Your session has expired. Sign in again to manage communities.')

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  }
  const options: RequestInit = { method, headers }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }

  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, options)
  } catch (reason) {
    throw new Error(
      reason instanceof Error
        ? `Cannot reach the RideHub community service: ${reason.message}`
        : 'Cannot reach the RideHub community service.',
    )
  }

  if (response.status === 204) return undefined
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : `Community service returned HTTP ${response.status}.`
    throw new Error(message)
  }
  return payload
}

function isCommunityRecord(value: unknown): value is CommunityRecord {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.description === 'string'
    && typeof value.ownerId === 'string'
    && typeof value.ownerName === 'string'
    && Array.isArray(value.memberIds)
    && isRecord(value.memberNames)
    && Array.isArray(value.bannedMemberIds)
    && Array.isArray(value.mutedMemberIds)
    && typeof value.memberCount === 'number'
    && typeof value.createdAt === 'string'
    && typeof value.themeColor === 'string'
    && typeof value.hasMeeting === 'boolean'
    && isMembershipStatus(value.membershipStatus)
}

function isMembershipStatus(value: unknown): value is CommunityMembershipStatus {
  return value === 'ADMIN'
    || value === 'APPROVED'
    || value === 'PENDING'
    || value === 'REJECTED'
    || value === 'BANNED'
    || value === 'NONE'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isVoiceSignal(value: unknown): value is VoiceCallSignal {
  if (
    !isRecord(value)
    || typeof value.sequence !== 'string'
    || typeof value.fromUserId !== 'string'
    || !isRecord(value.payload)
  ) return false
  if (value.kind === 'offer' || value.kind === 'answer') {
    return value.payload.type === value.kind && typeof value.payload.sdp === 'string'
  }
  return value.kind === 'candidate' && typeof value.payload.candidate === 'string'
}

function isVoiceCallState(value: unknown): value is VoiceCallState {
  return isRecord(value)
    && typeof value.callId === 'string'
    && Array.isArray(value.participants)
    && value.participants.every((participant) =>
      isRecord(participant)
      && typeof participant.userId === 'string'
      && typeof participant.displayName === 'string',
    )
    && Array.isArray(value.signals)
    && value.signals.every(isVoiceSignal)
}

function isCommunityChatMessage(value: unknown): value is CommunityChatMessage {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.senderId === 'string'
    && typeof value.senderName === 'string'
    && typeof value.text === 'string'
    && typeof value.createdAt === 'string'
    && (value.imageDataUrl === undefined || typeof value.imageDataUrl === 'string')
    && (value.audioDataUrl === undefined || typeof value.audioDataUrl === 'string')
    && (value.editedAt === undefined || typeof value.editedAt === 'string')
}

function isCommunityChatSnapshot(value: unknown): value is CommunityChatSnapshot {
  return isRecord(value)
    && typeof value.cursor === 'string'
    && Array.isArray(value.messages)
    && value.messages.every(isCommunityChatMessage)
}

function isCommunityChatUpdates(value: unknown): value is CommunityChatUpdates {
  return isRecord(value)
    && typeof value.cursor === 'string'
    && Array.isArray(value.events)
    && value.events.every((event) =>
      isRecord(event)
      && typeof event.sequence === 'string'
      && typeof event.messageId === 'string'
      && (event.kind === 'MESSAGE' || event.kind === 'EDIT' || event.kind === 'DELETE')
      && (event.message === undefined || isCommunityChatMessage(event.message)),
    )
}

function expectCommunity(value: unknown): CommunityRecord {
  if (!isCommunityRecord(value)) {
    throw new Error('The community service returned an invalid group.')
  }
  return value
}

export const communitiesApi = {
  async list(): Promise<CommunityRecord[]> {
    const value = await request('/communities')
    if (!Array.isArray(value) || !value.every(isCommunityRecord)) {
      throw new Error('The community service returned an invalid group list.')
    }
    return value
  },

  async create(input: CreateCommunityInput): Promise<CommunityRecord> {
    return expectCommunity(await request('/communities', 'POST', input))
  },

  async requestJoin(id: string, displayName: string): Promise<CommunityRecord> {
    return expectCommunity(await request(`/communities/${encodeURIComponent(id)}/join`, 'POST', { displayName }))
  },

  async resolveJoinRequest(id: string, memberId: string, approve: boolean): Promise<CommunityRecord> {
    return expectCommunity(await request(
      `/communities/${encodeURIComponent(id)}/requests/${encodeURIComponent(memberId)}`,
      'POST',
      { approve },
    ))
  },

  async update(id: string, input: CommunityUpdateInput): Promise<CommunityRecord> {
    return expectCommunity(await request(`/communities/${encodeURIComponent(id)}`, 'PATCH', input))
  },

  async setMeeting(id: string, meeting: CommunityMeeting): Promise<CommunityRecord> {
    return expectCommunity(await request(`/communities/${encodeURIComponent(id)}/meeting`, 'PUT', meeting))
  },

  async leave(id: string): Promise<void> {
    await request(`/communities/${encodeURIComponent(id)}/leave`, 'POST')
  },

  async delete(id: string): Promise<void> {
    await request(`/communities/${encodeURIComponent(id)}`, 'DELETE')
  },

  async moderate(id: string, memberId: string, action: CommunityModerationAction): Promise<CommunityRecord> {
    return expectCommunity(await request(
      `/communities/${encodeURIComponent(id)}/moderation`,
      'POST',
      { memberId, action },
    ))
  },

  async listMessages(id: string): Promise<CommunityChatSnapshot> {
    const value = await request(`/communities/${encodeURIComponent(id)}/messages`)
    if (!isCommunityChatSnapshot(value)) {
      throw new Error('The chat service returned an invalid message history.')
    }
    return value
  },

  async pollMessages(id: string, afterSequence: string): Promise<CommunityChatUpdates> {
    const query = new URLSearchParams({ after: afterSequence })
    const value = await request(`/communities/${encodeURIComponent(id)}/messages?${query.toString()}`)
    if (!isCommunityChatUpdates(value)) {
      throw new Error('The chat service returned invalid message updates.')
    }
    return value
  },

  async sendMessage(
    id: string,
    input: { text: string; imageDataUrl?: string; audioDataUrl?: string },
  ): Promise<CommunityChatMessage> {
    const value = await request(`/communities/${encodeURIComponent(id)}/messages`, 'POST', input)
    if (!isCommunityChatMessage(value)) throw new Error('The chat service returned an invalid message.')
    return value
  },

  async editMessage(id: string, messageId: string, text: string): Promise<CommunityChatMessage> {
    const value = await request(
      `/communities/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`,
      'PATCH',
      { text },
    )
    if (!isCommunityChatMessage(value)) throw new Error('The chat service returned an invalid message.')
    return value
  },

  async deleteMessage(id: string, messageId: string): Promise<void> {
    await request(
      `/communities/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`,
      'DELETE',
    )
  },

  async joinVoiceCall(id: string): Promise<VoiceCallState> {
    const value = await request(`/communities/${encodeURIComponent(id)}/voice/join`, 'POST', {})
    if (!isVoiceCallState(value)) throw new Error('The voice call service returned an invalid call state.')
    return value
  },

  async pollVoiceCall(id: string, callId: string, afterSequence: string): Promise<VoiceCallState> {
    const query = new URLSearchParams({ callId, after: afterSequence })
    const value = await request(
      `/communities/${encodeURIComponent(id)}/voice/state?${query.toString()}`,
    )
    if (!isVoiceCallState(value)) throw new Error('The voice call service returned an invalid call state.')
    return value
  },

  async sendVoiceSignal(
    id: string,
    callId: string,
    toUserId: string,
    kind: VoiceSignalKind,
    payload: RTCSessionDescriptionInit | RTCIceCandidateInit,
  ): Promise<void> {
    await request(`/communities/${encodeURIComponent(id)}/voice/signals`, 'POST', {
      callId,
      toUserId,
      kind,
      payload,
    })
  },

  async leaveVoiceCall(id: string, callId: string): Promise<void> {
    await request(`/communities/${encodeURIComponent(id)}/voice/leave`, 'POST', { callId })
  },
}
