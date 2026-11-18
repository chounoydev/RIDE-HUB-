import { Prisma, PrismaClient } from '@prisma/client'

export interface ChatMessage {
  id: string
  senderId: string
  senderName: string
  text: string
  imageDataUrl?: string
  audioDataUrl?: string
  createdAt: string
  editedAt?: string
}

export interface ChatEvent {
  sequence: string
  kind: 'MESSAGE' | 'EDIT' | 'DELETE'
  messageId: string
  message?: ChatMessage
}

export interface ChatSnapshot {
  messages: ChatMessage[]
  cursor: string
}

export interface ChatUpdates {
  events: ChatEvent[]
  cursor: string
}

export interface CommunityChatRepository {
  list(communityId: string, userId: string): Promise<ChatSnapshot>
  poll(communityId: string, userId: string, afterSequence: string): Promise<ChatUpdates>
  send(communityId: string, userId: string, value: unknown): Promise<ChatMessage>
  edit(communityId: string, userId: string, messageId: string, value: unknown): Promise<ChatMessage>
  delete(communityId: string, userId: string, messageId: string): Promise<void>
}

export class CommunityChatError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'CommunityChatError'
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const userIdPattern = /^[A-Za-z0-9_-]{1,128}$/
const imageDataUrlPattern = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/
const audioDataUrlPattern = /^data:audio\/(?:webm|mp4|ogg)(?:;codecs=[a-z0-9._-]+)?;base64,[A-Za-z0-9+/]+={0,2}$/i
const maxImageLength = 700_000
const maxAudioLength = 600_000
const maxEventsPerPoll = 200

type Membership = {
  isAdmin: boolean
  isMuted: boolean
  displayName: string
}

type PrismaChatMessage = Prisma.CommunityChatMessageGetPayload<Record<string, never>>

export class PrismaCommunityChatRepository implements CommunityChatRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(communityId: string, userId: string): Promise<ChatSnapshot> {
    const id = requireUuid(communityId)
    await this.requireMembership(id, userId)
    const latestEvent = await this.prisma.communityChatEvent.aggregate({
      where: { communityId: id },
      _max: { sequence: true },
    })
    const messages = await this.prisma.communityChatMessage.findMany({
      where: { communityId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    return {
      messages: messages.map(toChatMessage),
      cursor: (latestEvent._max.sequence ?? 0n).toString(),
    }
  }

  async poll(communityId: string, userId: string, afterSequence: string): Promise<ChatUpdates> {
    const id = requireUuid(communityId)
    await this.requireMembership(id, userId)
    const after = parseCursor(afterSequence)
    const events = await this.prisma.communityChatEvent.findMany({
      where: { communityId: id, sequence: { gt: after } },
      orderBy: { sequence: 'asc' },
      take: maxEventsPerPoll,
    })
    const messageIds = [...new Set(
      events.filter((event) => event.kind !== 'DELETE').map((event) => event.messageId),
    )]
    const messages = messageIds.length
      ? await this.prisma.communityChatMessage.findMany({
          where: { communityId: id, id: { in: messageIds } },
        })
      : []
    const messagesById = new Map(messages.map((message) => [message.id, toChatMessage(message)]))
    const lastEventSequence = events.at(-1)?.sequence ?? after

    return {
      events: events.map((event) => ({
        sequence: event.sequence.toString(),
        kind: parseEventKind(event.kind),
        messageId: event.messageId,
        ...(messagesById.has(event.messageId)
          ? { message: messagesById.get(event.messageId)! }
          : {}),
      })),
      cursor: lastEventSequence.toString(),
    }
  }

  async send(communityId: string, userId: string, value: unknown): Promise<ChatMessage> {
    const id = requireUuid(communityId)
    const membership = await this.requireMembership(id, userId)
    if (membership.isMuted && !membership.isAdmin) {
      throw new CommunityChatError(403, 'You are muted in this group. Contact the admin for help.')
    }
    const content = parseMessageContent(value)
    if (!content.text && !content.imageDataUrl && !content.audioDataUrl) {
      throw new CommunityChatError(400, 'Add a message, photo, or voice recording before sending.')
    }

    return this.prisma.$transaction(async (transaction) => {
      await lockCommunity(transaction, id)
      const message = await transaction.communityChatMessage.create({
        data: {
          communityId: id,
          senderId: userId,
          senderName: membership.displayName,
          ...content,
        },
      })
      await transaction.communityChatEvent.create({
        data: { communityId: id, messageId: message.id, kind: 'MESSAGE' },
      })
      return toChatMessage(message)
    })
  }

  async edit(
    communityId: string,
    userId: string,
    messageId: string,
    value: unknown,
  ): Promise<ChatMessage> {
    const id = requireUuid(communityId)
    await this.requireMembership(id, userId)
    const messageUuid = requireUuid(messageId)
    const content = parseMessageContent(value)
    if (content.imageDataUrl || content.audioDataUrl) {
      throw new CommunityChatError(400, 'Only the text of a message can be edited.')
    }

    return this.prisma.$transaction(async (transaction) => {
      await lockCommunity(transaction, id)
      const message = await transaction.communityChatMessage.findFirst({
        where: { id: messageUuid, communityId: id },
      })
      if (!message) throw new CommunityChatError(404, 'This message is no longer available.')
      if (message.senderId !== userId) {
        throw new CommunityChatError(403, 'You can only edit your own messages.')
      }
      if (!content.text && !message.imageDataUrl && !message.audioDataUrl) {
        throw new CommunityChatError(400, 'A text-only message cannot be left empty.')
      }
      const editedAt = new Date()
      const updated = await transaction.communityChatMessage.update({
        where: { id: messageUuid },
        data: { text: content.text, editedAt },
      })
      await transaction.communityChatEvent.create({
        data: { communityId: id, messageId: messageUuid, kind: 'EDIT' },
      })
      return toChatMessage(updated)
    })
  }

  async delete(communityId: string, userId: string, messageId: string): Promise<void> {
    const id = requireUuid(communityId)
    const membership = await this.requireMembership(id, userId)
    const messageUuid = requireUuid(messageId)

    await this.prisma.$transaction(async (transaction) => {
      await lockCommunity(transaction, id)
      const message = await transaction.communityChatMessage.findFirst({
        where: { id: messageUuid, communityId: id },
      })
      if (!message) throw new CommunityChatError(404, 'This message is no longer available.')
      if (message.senderId !== userId && !membership.isAdmin) {
        throw new CommunityChatError(403, 'You can only unsend your own messages.')
      }
      await transaction.communityChatEvent.create({
        data: { communityId: id, messageId: messageUuid, kind: 'DELETE' },
      })
      await transaction.communityChatMessage.delete({ where: { id: messageUuid } })
    })
  }

  private async requireMembership(communityId: string, userId: string): Promise<Membership> {
    requireUserId(userId)
    const community = await this.prisma.community.findUnique({
      where: { id: communityId },
      select: { ownerId: true, ownerName: true },
    })
    if (!community) throw new CommunityChatError(404, 'Community could not be found.')
    if (community.ownerId === userId) {
      return { isAdmin: true, isMuted: false, displayName: community.ownerName }
    }

    const membership = await this.prisma.communityMembership.findUnique({
      where: { communityId_userId: { communityId, userId } },
      select: { displayName: true, status: true, isMuted: true },
    })
    if (!membership || membership.status !== 'APPROVED') {
      throw new CommunityChatError(403, 'Only approved group members can view or send messages.')
    }
    return {
      isAdmin: false,
      isMuted: membership.isMuted,
      displayName: membership.displayName,
    }
  }
}

async function lockCommunity(
  transaction: Prisma.TransactionClient,
  communityId: string,
) {
  await transaction.$queryRaw`SELECT "id" FROM "Community" WHERE "id" = ${communityId}::uuid FOR UPDATE`
}

function parseMessageContent(value: unknown) {
  if (!isRecord(value)) throw new CommunityChatError(400, 'A valid message body is required.')
  const text = typeof value.text === 'string' ? value.text.trim() : ''
  if (text.length > 1000) throw new CommunityChatError(400, 'Messages must be 1,000 characters or fewer.')
  const imageDataUrl = parseMedia(value.imageDataUrl, imageDataUrlPattern, maxImageLength, 'image')
  const audioDataUrl = parseMedia(value.audioDataUrl, audioDataUrlPattern, maxAudioLength, 'audio')
  if (imageDataUrl && audioDataUrl) {
    throw new CommunityChatError(400, 'Send a photo and a voice recording as separate messages.')
  }
  return {
    text,
    ...(imageDataUrl ? { imageDataUrl } : {}),
    ...(audioDataUrl ? { audioDataUrl } : {}),
  }
}

function parseMedia(
  value: unknown,
  pattern: RegExp,
  maxLength: number,
  kind: 'image' | 'audio',
): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > maxLength || !pattern.test(value)) {
    throw new CommunityChatError(400, `The ${kind} message is invalid or too large. Try a smaller ${kind}.`)
  }
  return value
}

function parseCursor(value: string): bigint {
  if (!/^\d{1,20}$/.test(value)) {
    throw new CommunityChatError(400, 'A valid chat update cursor is required.')
  }
  return BigInt(value)
}

function parseEventKind(value: string): ChatEvent['kind'] {
  if (value === 'MESSAGE' || value === 'EDIT' || value === 'DELETE') return value
  throw new CommunityChatError(500, 'The chat service returned an unknown update type.')
}

function toChatMessage(message: PrismaChatMessage): ChatMessage {
  return {
    id: message.id,
    senderId: message.senderId,
    senderName: message.senderName,
    text: message.text,
    ...(message.imageDataUrl ? { imageDataUrl: message.imageDataUrl } : {}),
    ...(message.audioDataUrl ? { audioDataUrl: message.audioDataUrl } : {}),
    createdAt: message.createdAt.toISOString(),
    ...(message.editedAt ? { editedAt: message.editedAt.toISOString() } : {}),
  }
}

function requireUuid(value: string): string {
  if (!uuidPattern.test(value)) throw new CommunityChatError(400, 'A valid chat identifier is required.')
  return value
}

function requireUserId(value: string): string {
  if (!userIdPattern.test(value)) throw new CommunityChatError(400, 'A valid rider identifier is required.')
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
