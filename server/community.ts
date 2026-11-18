import { Prisma, PrismaClient } from '@prisma/client'

export type CommunityStatus = 'ADMIN' | 'APPROVED' | 'PENDING' | 'REJECTED' | 'BANNED' | 'NONE'
export type MembershipAction = 'kick' | 'ban' | 'mute' | 'unmute' | 'unban'

export interface MeetingLocation {
  name: string
  address: string
  latitude: number
  longitude: number
  meetingAt: string
}

export interface JoinRequest {
  userId: string
  displayName: string
  requestedAt: string
}

export interface CommunityView {
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
  meeting?: MeetingLocation
  membershipStatus: CommunityStatus
  joinRequests?: JoinRequest[]
}

export interface CommunityRepository {
  list(userId: string): Promise<CommunityView[]>
  create(userId: string, value: unknown): Promise<CommunityView>
  requestJoin(communityId: string, userId: string, value: unknown): Promise<CommunityView>
  resolveJoinRequest(communityId: string, userId: string, memberId: string, value: unknown): Promise<CommunityView>
  update(communityId: string, userId: string, value: unknown): Promise<CommunityView>
  setMeeting(communityId: string, userId: string, value: unknown): Promise<CommunityView>
  leave(communityId: string, userId: string): Promise<void>
  delete(communityId: string, userId: string): Promise<void>
  moderate(communityId: string, userId: string, value: unknown): Promise<CommunityView>
}

export class CommunityError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'CommunityError'
  }
}

const communityInclude = { members: true } satisfies Prisma.CommunityInclude
type CommunityWithMembers = Prisma.CommunityGetPayload<{ include: typeof communityInclude }>

const userIdPattern = /^[A-Za-z0-9_-]{1,128}$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const imageDataUrlPattern = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/
const maxLogoLength = 700_000

export class PrismaCommunityRepository implements CommunityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(userId: string): Promise<CommunityView[]> {
    const communities = await this.prisma.community.findMany({
      include: communityInclude,
      orderBy: { createdAt: 'desc' },
    })
    return communities.map((community) => this.toView(community, userId))
  }

  async create(userId: string, value: unknown): Promise<CommunityView> {
    const body = requireRecord(value)
    const name = requireText(body.name, 'Enter a community name.', 60)
    const description = optionalText(body.description, 'The description is too long.', 240)
    const ownerName = optionalText(body.ownerName, 'The display name is too long.', 80)
      || 'RideHub rider'
    const id = body.id === undefined ? undefined : requireUuid(body.id)
    const logoDataUrl = optionalLogo(body.logoDataUrl)
    const themeColor = optionalThemeColor(body.themeColor)
    const meeting = body.meeting === undefined ? undefined : parseMeeting(body.meeting)

    try {
      const community = await this.prisma.community.create({
        data: {
          ...(id ? { id } : {}),
          name,
          description,
          ownerId: userId,
          ownerName,
          ...(logoDataUrl ? { logoDataUrl } : {}),
          ...(themeColor ? { themeColor } : {}),
          ...(meeting ? { meeting: toMeetingJson(meeting) } : {}),
          members: {
            create: {
              userId,
              displayName: ownerName,
              status: 'APPROVED',
              approvedAt: new Date(),
            },
          },
        },
        include: communityInclude,
      })
      return this.toView(community, userId)
    } catch (reason) {
      if (reason instanceof Prisma.PrismaClientKnownRequestError && reason.code === 'P2002') {
        throw new CommunityError(409, 'A community with that identifier already exists.')
      }
      throw reason
    }
  }

  async requestJoin(communityId: string, userId: string, value: unknown): Promise<CommunityView> {
    const id = requireUuid(communityId)
    const body = requireRecord(value)
    const displayName = optionalText(body.displayName, 'The display name is too long.', 80)
      || 'RideHub rider'
    const community = await this.findById(id)
    const existing = community.members.find((member) => member.userId === userId)

    if (community.ownerId === userId || existing?.status === 'APPROVED') return this.toView(community, userId)
    if (existing?.status === 'BANNED') {
      throw new CommunityError(403, 'You are not allowed to join this community.')
    }

    await this.prisma.communityMembership.upsert({
      where: { communityId_userId: { communityId: id, userId } },
      create: {
        communityId: id,
        userId,
        displayName,
        status: 'PENDING',
      },
      update: {
        displayName,
        status: 'PENDING',
        isMuted: false,
        approvedAt: null,
      },
    })
    return this.getForUser(id, userId)
  }

  async resolveJoinRequest(
    communityId: string,
    userId: string,
    memberId: string,
    value: unknown,
  ): Promise<CommunityView> {
    const id = requireUuid(communityId)
    const targetId = requireUserId(memberId)
    const body = requireRecord(value)
    if (typeof body.approve !== 'boolean') {
      throw new CommunityError(400, 'Choose whether to approve or reject this request.')
    }
    const community = await this.findById(id)
    this.requireOwner(community, userId)
    if (targetId === userId) throw new CommunityError(400, 'The community admin cannot approve their own request.')

    const request = community.members.find((member) => member.userId === targetId)
    if (!request || request.status !== 'PENDING') {
      throw new CommunityError(404, 'This join request is no longer pending.')
    }
    await this.prisma.communityMembership.update({
      where: { communityId_userId: { communityId: id, userId: targetId } },
      data: {
        status: body.approve ? 'APPROVED' : 'REJECTED',
        approvedAt: body.approve ? new Date() : null,
      },
    })
    return this.getForUser(id, userId)
  }

  async update(communityId: string, userId: string, value: unknown): Promise<CommunityView> {
    const id = requireUuid(communityId)
    const body = requireRecord(value)
    const community = await this.findById(id)
    this.requireOwner(community, userId)

    const data: Prisma.CommunityUpdateInput = {}
    if (body.name !== undefined) data.name = requireText(body.name, 'Enter a community name.', 60)
    if (body.description !== undefined) data.description = optionalText(body.description, 'The description is too long.', 240)
    if (body.logoDataUrl !== undefined) data.logoDataUrl = optionalLogo(body.logoDataUrl) ?? null
    if (body.themeColor !== undefined) data.themeColor = requireThemeColor(body.themeColor)
    const updated = await this.prisma.community.update({
      where: { id },
      data,
      include: communityInclude,
    })
    return this.toView(updated, userId)
  }

  async setMeeting(communityId: string, userId: string, value: unknown): Promise<CommunityView> {
    const id = requireUuid(communityId)
    const community = await this.findById(id)
    this.requireOwner(community, userId)
    const meeting = parseMeeting(value)
    const updated = await this.prisma.community.update({
      where: { id },
      data: { meeting: toMeetingJson(meeting) },
      include: communityInclude,
    })
    return this.toView(updated, userId)
  }

  async leave(communityId: string, userId: string): Promise<void> {
    const id = requireUuid(communityId)
    const community = await this.findById(id)
    if (community.ownerId === userId) {
      throw new CommunityError(403, 'The community admin cannot leave. Delete the community or transfer admin access first.')
    }
    const membership = community.members.find((member) => member.userId === userId)
    if (!membership || membership.status !== 'APPROVED') {
      throw new CommunityError(403, 'You are not an approved member of this community.')
    }
    await this.prisma.communityMembership.delete({
      where: { communityId_userId: { communityId: id, userId } },
    })
  }

  async delete(communityId: string, userId: string): Promise<void> {
    const id = requireUuid(communityId)
    const community = await this.findById(id)
    this.requireOwner(community, userId)
    await this.prisma.community.delete({ where: { id } })
  }

  async moderate(
    communityId: string,
    userId: string,
    value: unknown,
  ): Promise<CommunityView> {
    const id = requireUuid(communityId)
    const body = requireRecord(value)
    const memberId = requireUserId(body.memberId)
    const action = body.action
    if (!isMembershipAction(action)) throw new CommunityError(400, 'Choose a valid member action.')
    const community = await this.findById(id)
    this.requireOwner(community, userId)
    if (memberId === community.ownerId) throw new CommunityError(400, 'The community admin cannot be moderated.')

    const member = community.members.find((item) => item.userId === memberId)
    if (!member) throw new CommunityError(404, 'This rider is not a member of the community.')

    if (action === 'kick' || action === 'ban' || action === 'unban') {
      await this.prisma.communityMembership.update({
        where: { communityId_userId: { communityId: id, userId: memberId } },
        data: {
          status: action === 'ban' ? 'BANNED' : 'REJECTED',
          isMuted: false,
          approvedAt: null,
        },
      })
    } else {
      if (member.status !== 'APPROVED') {
        throw new CommunityError(409, 'Only approved community members can be muted or unmuted.')
      }
      await this.prisma.communityMembership.update({
        where: { communityId_userId: { communityId: id, userId: memberId } },
        data: { isMuted: action === 'mute' },
      })
    }
    return this.getForUser(id, userId)
  }

  private async getForUser(communityId: string, userId: string): Promise<CommunityView> {
    const community = await this.findById(communityId)
    return this.toView(community, userId)
  }

  private async findById(id: string): Promise<CommunityWithMembers> {
    const community = await this.prisma.community.findUnique({
      where: { id },
      include: communityInclude,
    })
    if (!community) throw new CommunityError(404, 'Community could not be found.')
    return community
  }

  private requireOwner(community: CommunityWithMembers, userId: string) {
    if (community.ownerId !== userId) {
      throw new CommunityError(403, 'Only this community’s admin can perform that action.')
    }
  }

  private toView(community: CommunityWithMembers, userId: string): CommunityView {
    const owner = community.ownerId === userId
    const membership = community.members.find((member) => member.userId === userId)
    const approvedMembers = community.members.filter((member) => member.status === 'APPROVED')
    const visibleMembers = owner
      ? community.members.filter((member) => member.status !== 'PENDING')
      : approvedMembers.filter((member) => member.userId === userId)
    const memberNames = Object.fromEntries(visibleMembers.map((member) => [member.userId, member.displayName]))
    const meeting = owner ? parseStoredMeeting(community.meeting) : undefined

    return {
      id: community.id,
      name: community.name,
      description: community.description,
      ownerId: community.ownerId,
      ownerName: community.ownerName,
      memberIds: owner ? approvedMembers.map((member) => member.userId) : approvedMembers
        .filter((member) => member.userId === userId)
        .map((member) => member.userId),
      memberNames,
      bannedMemberIds: owner
        ? community.members.filter((member) => member.status === 'BANNED').map((member) => member.userId)
        : [],
      mutedMemberIds: owner
        ? approvedMembers.filter((member) => member.isMuted).map((member) => member.userId)
        : [],
      memberCount: approvedMembers.length,
      createdAt: community.createdAt.toISOString(),
      ...(community.logoDataUrl ? { logoDataUrl: community.logoDataUrl } : {}),
      themeColor: community.themeColor,
      hasMeeting: community.meeting !== null,
      ...(meeting ? { meeting } : {}),
      membershipStatus: owner ? 'ADMIN' : membership?.status ?? 'NONE',
      ...(owner
        ? {
            joinRequests: community.members
              .filter((member) => member.status === 'PENDING')
              .map((member) => ({
                userId: member.userId,
                displayName: member.displayName,
                requestedAt: member.createdAt.toISOString(),
              })),
          }
        : {}),
    }
  }
}

function isMembershipAction(value: unknown): value is MembershipAction {
  return value === 'kick' || value === 'ban' || value === 'mute' || value === 'unmute' || value === 'unban'
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CommunityError(400, 'A valid JSON request body is required.')
  }
  return value as Record<string, unknown>
}

function requireText(value: unknown, message: string, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || text.length > maxLength) throw new CommunityError(400, message)
  return text
}

function optionalText(value: unknown, message: string, maxLength: number): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' || value.trim().length > maxLength) {
    throw new CommunityError(400, message)
  }
  return value.trim()
}

function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new CommunityError(400, 'A valid community identifier is required.')
  }
  return value
}

function requireUserId(value: unknown): string {
  if (typeof value !== 'string' || !userIdPattern.test(value)) {
    throw new CommunityError(400, 'A valid rider identifier is required.')
  }
  return value
}

function optionalLogo(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (
    typeof value !== 'string'
    || value.length > maxLogoLength
    || !imageDataUrlPattern.test(value)
  ) {
    throw new CommunityError(400, 'Choose a valid JPEG, PNG, or WebP community logo smaller than 500 KB.')
  }
  return value
}

function optionalThemeColor(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  return requireThemeColor(value)
}

function requireThemeColor(value: unknown): string {
  if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) {
    throw new CommunityError(400, 'Choose a valid community theme color.')
  }
  return value
}

function parseMeeting(value: unknown): MeetingLocation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CommunityError(400, 'Enter valid meeting details.')
  }
  const meeting = value as Record<string, unknown>
  const name = requireText(meeting.name, 'Enter a meeting name.', 100)
  const address = optionalText(meeting.address, 'The meeting address is too long.', 180)
  const latitude = meeting.latitude
  const longitude = meeting.longitude
  if (
    typeof latitude !== 'number'
    || !Number.isFinite(latitude)
    || latitude < -90
    || latitude > 90
    || typeof longitude !== 'number'
    || !Number.isFinite(longitude)
    || longitude < -180
    || longitude > 180
  ) {
    throw new CommunityError(400, 'Enter valid meeting coordinates.')
  }
  const meetingAt = optionalText(meeting.meetingAt, 'The meeting time is invalid.', 40)
  return { name, address, latitude, longitude, meetingAt }
}

function parseStoredMeeting(value: Prisma.JsonValue | null): MeetingLocation | undefined {
  if (value === null) return undefined
  try {
    return parseMeeting(value)
  } catch (reason) {
    if (reason instanceof CommunityError) return undefined
    throw reason
  }
}

function toMeetingJson(meeting: MeetingLocation): Prisma.InputJsonValue {
  return {
    name: meeting.name,
    address: meeting.address,
    latitude: meeting.latitude,
    longitude: meeting.longitude,
    meetingAt: meeting.meetingAt,
  }
}
