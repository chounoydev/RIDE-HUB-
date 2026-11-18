import { randomUUID } from 'node:crypto'
import { Prisma, PrismaClient } from '@prisma/client'

export type VoiceSignalKind = 'offer' | 'answer' | 'candidate'

export interface VoiceCallParticipant {
  userId: string
  displayName: string
}

export interface VoiceCallSignal {
  sequence: string
  fromUserId: string
  kind: VoiceSignalKind
  payload: unknown
}

export interface VoiceCallState {
  callId: string
  participants: VoiceCallParticipant[]
  signals: VoiceCallSignal[]
}

export interface VoiceCallRepository {
  join(communityId: string, userId: string): Promise<VoiceCallState>
  poll(communityId: string, userId: string, callId: string, afterSequence: string): Promise<VoiceCallState>
  sendSignal(
    communityId: string,
    userId: string,
    callId: string,
    recipientId: string,
    kind: VoiceSignalKind,
    payload: unknown,
  ): Promise<void>
  leave(communityId: string, userId: string, callId: string): Promise<void>
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const userIdPattern = /^[A-Za-z0-9_-]{1,128}$/
const presenceTimeoutMs = 25_000
const signalRetentionMs = 10 * 60_000
const maxSignalBytes = 16_000

export class VoiceCallError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'VoiceCallError'
  }
}

export class PrismaVoiceCallRepository implements VoiceCallRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async join(communityId: string, userId: string): Promise<VoiceCallState> {
    requireUuid(communityId)
    requireUserId(userId)
    return this.prisma.$transaction(async (tx) => {
      await this.lockCommunity(tx, communityId)
      const { displayName } = await this.requireApprovedMember(tx, communityId, userId)
      const now = new Date()
      const cutoff = new Date(now.getTime() - presenceTimeoutMs)
      let call = await tx.communityVoiceCall.findUnique({ where: { communityId } })
      if (!call) {
        call = await tx.communityVoiceCall.create({
          data: { communityId, callId: randomUUID() },
        })
      } else {
        await tx.communityVoiceParticipant.deleteMany({
          where: { communityId, lastSeenAt: { lt: cutoff } },
        })
        const activeCount = await tx.communityVoiceParticipant.count({
          where: { communityId, lastSeenAt: { gte: cutoff } },
        })
        if (activeCount === 0) {
          await tx.communityVoiceSignal.deleteMany({ where: { communityId } })
          call = await tx.communityVoiceCall.update({
            where: { communityId },
            data: { callId: randomUUID() },
          })
        }
      }

      await tx.communityVoiceParticipant.upsert({
        where: { communityId_userId: { communityId, userId } },
        create: { communityId, userId, displayName, lastSeenAt: now },
        update: { displayName, lastSeenAt: now },
      })
      return {
        callId: call.callId,
        participants: await this.getParticipants(tx, communityId, cutoff),
        signals: [],
      }
    })
  }

  async poll(
    communityId: string,
    userId: string,
    callId: string,
    afterSequence: string,
  ): Promise<VoiceCallState> {
    requireUuid(communityId)
    requireUuid(callId)
    requireUserId(userId)
    const cursor = requireSequence(afterSequence)
    return this.prisma.$transaction(async (tx) => {
      await this.requireApprovedMember(tx, communityId, userId)
      const call = await tx.communityVoiceCall.findUnique({ where: { communityId } })
      if (!call || call.callId !== callId) {
        throw new VoiceCallError(409, 'This voice call has ended. Rejoin to start a new call.')
      }
      const participant = await tx.communityVoiceParticipant.findUnique({
        where: { communityId_userId: { communityId, userId } },
      })
      if (!participant) throw new VoiceCallError(403, 'Join the group voice call before polling it.')

      const now = new Date()
      const cutoff = new Date(now.getTime() - presenceTimeoutMs)
      await tx.communityVoiceParticipant.update({
        where: { communityId_userId: { communityId, userId } },
        data: { lastSeenAt: now },
      })
      await tx.communityVoiceParticipant.deleteMany({
        where: { communityId, userId: { not: userId }, lastSeenAt: { lt: cutoff } },
      })
      await tx.communityVoiceSignal.deleteMany({
        where: { communityId, createdAt: { lt: new Date(now.getTime() - signalRetentionMs) } },
      })
      const [participants, signals] = await Promise.all([
        this.getParticipants(tx, communityId, cutoff),
        tx.communityVoiceSignal.findMany({
          where: {
            communityId,
            callId,
            toUserId: userId,
            sequence: { gt: cursor },
          },
          orderBy: { sequence: 'asc' },
          take: 100,
        }),
      ])
      return {
        callId,
        participants,
        signals: signals.map((signal) => ({
          sequence: signal.sequence.toString(),
          fromUserId: signal.fromUserId,
          kind: signal.kind as VoiceSignalKind,
          payload: signal.payload,
        })),
      }
    })
  }

  async sendSignal(
    communityId: string,
    userId: string,
    callId: string,
    recipientId: string,
    kind: VoiceSignalKind,
    payload: unknown,
  ): Promise<void> {
    requireUuid(communityId)
    requireUuid(callId)
    requireUserId(userId)
    requireUserId(recipientId)
    const safePayload = validateSignalPayload(kind, payload)

    await this.prisma.$transaction(async (tx) => {
      await this.requireApprovedMember(tx, communityId, userId)
      const call = await tx.communityVoiceCall.findUnique({ where: { communityId } })
      if (!call || call.callId !== callId) {
        throw new VoiceCallError(409, 'This voice call has ended. Rejoin to start a new call.')
      }
      const now = new Date()
      const cutoff = new Date(now.getTime() - presenceTimeoutMs)
      const [sender, recipient] = await Promise.all([
        tx.communityVoiceParticipant.findUnique({
          where: { communityId_userId: { communityId, userId } },
        }),
        tx.communityVoiceParticipant.findUnique({
          where: { communityId_userId: { communityId, userId: recipientId } },
        }),
      ])
      if (!sender || !recipient || recipient.lastSeenAt < cutoff) {
        throw new VoiceCallError(409, 'That rider is no longer in the voice call.')
      }
      await tx.communityVoiceParticipant.update({
        where: { communityId_userId: { communityId, userId } },
        data: { lastSeenAt: now },
      })
      await tx.communityVoiceSignal.create({
        data: {
          communityId,
          callId,
          fromUserId: userId,
          toUserId: recipientId,
          kind,
          payload: safePayload,
        },
      })
    })
  }

  async leave(communityId: string, userId: string, callId: string): Promise<void> {
    requireUuid(communityId)
    requireUuid(callId)
    requireUserId(userId)
    await this.prisma.$transaction(async (tx) => {
      await this.lockCommunity(tx, communityId)
      const call = await tx.communityVoiceCall.findUnique({ where: { communityId } })
      if (!call || call.callId !== callId) return
      await tx.communityVoiceParticipant.deleteMany({
        where: { communityId, userId },
      })
      const now = new Date()
      const cutoff = new Date(now.getTime() - presenceTimeoutMs)
      await tx.communityVoiceParticipant.deleteMany({
        where: { communityId, lastSeenAt: { lt: cutoff } },
      })
      const activeCount = await tx.communityVoiceParticipant.count({
        where: { communityId, lastSeenAt: { gte: cutoff } },
      })
      if (activeCount === 0) {
        await tx.communityVoiceSignal.deleteMany({ where: { communityId } })
        await tx.communityVoiceCall.update({
          where: { communityId },
          data: { callId: randomUUID() },
        })
      }
    })
  }

  private async lockCommunity(tx: Prisma.TransactionClient, communityId: string) {
    await tx.$queryRaw`SELECT "id" FROM "Community" WHERE "id" = ${communityId}::uuid FOR UPDATE`
  }

  private async requireApprovedMember(
    tx: Prisma.TransactionClient,
    communityId: string,
    userId: string,
  ): Promise<{ displayName: string }> {
    const community = await tx.community.findUnique({
      where: { id: communityId },
      select: {
        ownerId: true,
        ownerName: true,
        members: {
          where: { userId },
          select: { status: true, displayName: true },
          take: 1,
        },
      },
    })
    if (!community) throw new VoiceCallError(404, 'Community could not be found.')
    const membership = community.members[0]
    if (community.ownerId !== userId && membership?.status !== 'APPROVED') {
      throw new VoiceCallError(403, 'Only approved community members can join the voice call.')
    }
    return { displayName: membership?.displayName || community.ownerName }
  }

  private async getParticipants(
    tx: Prisma.TransactionClient,
    communityId: string,
    cutoff: Date,
  ): Promise<VoiceCallParticipant[]> {
    return tx.communityVoiceParticipant.findMany({
      where: { communityId, lastSeenAt: { gte: cutoff } },
      select: { userId: true, displayName: true },
      orderBy: { joinedAt: 'asc' },
    })
  }
}

function requireUuid(value: string) {
  if (!uuidPattern.test(value)) throw new VoiceCallError(400, 'A valid community or call identifier is required.')
}

function requireUserId(value: string) {
  if (!userIdPattern.test(value)) throw new VoiceCallError(400, 'A valid rider identifier is required.')
}

function requireSequence(value: string): bigint {
  if (!/^\d{1,20}$/.test(value)) throw new VoiceCallError(400, 'A valid voice call cursor is required.')
  const sequence = BigInt(value)
  if (sequence > 9_223_372_036_854_775_807n) {
    throw new VoiceCallError(400, 'A valid voice call cursor is required.')
  }
  return sequence
}

function validateSignalPayload(kind: VoiceSignalKind, value: unknown): Prisma.InputJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new VoiceCallError(400, 'A valid WebRTC signal is required.')
  }
  const payload = value as Record<string, unknown>
  if (JSON.stringify(payload).length > maxSignalBytes) {
    throw new VoiceCallError(413, 'The WebRTC signal is too large.')
  }
  if (kind === 'offer' || kind === 'answer') {
    if (payload.type !== kind || typeof payload.sdp !== 'string' || payload.sdp.length > 12_000) {
      throw new VoiceCallError(400, 'A valid WebRTC session description is required.')
    }
    return { type: kind, sdp: payload.sdp }
  }
  if (kind === 'candidate') {
    const candidate = payload.candidate
    const sdpMid = payload.sdpMid
    const sdpMLineIndex = payload.sdpMLineIndex
    const usernameFragment = payload.usernameFragment
    if (
      typeof candidate !== 'string'
      || candidate.length > 2_048
      || (sdpMid !== null && sdpMid !== undefined && (typeof sdpMid !== 'string' || sdpMid.length > 256))
      || (sdpMLineIndex !== null && sdpMLineIndex !== undefined
        && (typeof sdpMLineIndex !== 'number' || !Number.isInteger(sdpMLineIndex) || sdpMLineIndex < 0))
      || (usernameFragment !== null && usernameFragment !== undefined
        && (typeof usernameFragment !== 'string' || usernameFragment.length > 256))
    ) {
      throw new VoiceCallError(400, 'A valid WebRTC ICE candidate is required.')
    }
    return {
      candidate,
      sdpMid: typeof sdpMid === 'string' ? sdpMid : null,
      sdpMLineIndex: typeof sdpMLineIndex === 'number' ? sdpMLineIndex : null,
      ...(typeof usernameFragment !== 'string'
        ? {}
        : { usernameFragment }),
    }
  }
  throw new VoiceCallError(400, 'That WebRTC signal type is not supported.')
}
