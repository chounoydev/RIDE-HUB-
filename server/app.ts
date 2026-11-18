import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import {
  detectAvatarContentType,
  isOwnedAvatarKey,
  type AvatarContentType,
  type AvatarStorage,
} from './avatar.js'
import { CommunityError, type CommunityRepository } from './community.js'
import { CommunityChatError, type CommunityChatRepository } from './community-chat.js'
import { VoiceCallError, type VoiceCallRepository, type VoiceSignalKind } from './voice-calls.js'
import { fetchWeatherSnapshot, WeatherProviderError } from './weather.js'

interface AppOptions {
  weatherApiKey: string
  allowedOrigins?: string[]
  trustProxy?: boolean
  fetchImpl?: typeof fetch
  verifyAuthToken?: (token: string) => Promise<string | null>
  verifyAvatarToken?: (token: string) => Promise<string | null>
  avatarStorage?: AvatarStorage
  communities?: CommunityRepository
  communityChat?: CommunityChatRepository
  voiceCalls?: VoiceCallRepository
}

export function createApp(options: AppOptions) {
  const app = express()
  if (options.trustProxy) {
    app.set('trust proxy', 1)
  }
  const weatherLimiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(_request, response) {
      response.status(429).json({ error: 'Weather checks are temporarily rate limited. Try again shortly.' })
    },
  })
  const avatarLimiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(_request, response) {
      response.status(429).json({ error: 'Profile photo requests are temporarily rate limited. Try again shortly.' })
    },
  })
  const communityLimiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(_request, response) {
      response.status(429).json({ error: 'Community requests are temporarily rate limited. Try again shortly.' })
    },
  })
  const voiceCallLimiter = rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(_request, response) {
      response.status(429).json({ error: 'Voice call requests are temporarily rate limited. Try again shortly.' })
    },
  })
  const chatLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(_request, response) {
      response.status(429).json({ error: 'Chat requests are temporarily rate limited. Try again shortly.' })
    },
  })
  const verifyAuthToken = options.verifyAuthToken ?? options.verifyAvatarToken
  const allowedOrigins = new Set([
    'capacitor://localhost',
    'https://localhost',
    'http://localhost',
    'http://localhost:5173',
    ...(options.allowedOrigins ?? []),
  ])

  app.use((request, response, next) => {
    const origin = request.get('origin')
    if (!origin || allowedOrigins.has(origin) || isSameOrigin(origin, request)) {
      next()
      return
    }
    response.status(403).json({ error: 'Origin is not allowed by the server CORS policy.' })
  })
  app.use(cors((request, callback) => {
    callback(null, { origin: Boolean(request.get('origin')) })
  }))
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/health', (_request, response) => {
    response.json({
      ok: true,
      weatherConfigured: options.weatherApiKey.length > 0,
      monitoringActive: false,
      pushConfigured: false,
      avatarUploadConfigured: Boolean(verifyAuthToken && options.avatarStorage),
      sharedCommunitiesConfigured: Boolean(verifyAuthToken && options.communities),
      communityChatConfigured: Boolean(verifyAuthToken && options.communityChat),
      voiceCallsConfigured: Boolean(verifyAuthToken && options.voiceCalls),
    })
  })

  const authenticateCommunityRequest: express.RequestHandler = async (request, response, next) => {
    if (!verifyAuthToken) {
      response.status(503).json({
        error: 'Shared communities require NEON_AUTH_BASE_URL and NEON_AUTH_JWKS_URL on the backend.',
      })
      return
    }

    const match = /^Bearer\s+(\S+)$/i.exec(request.get('authorization') ?? '')
    if (!match) {
      response.status(401).json({ error: 'Sign in to browse or manage communities.' })
      return
    }

    try {
      const userId = await verifyAuthToken(match[1]!)
      if (!userId) {
        response.status(401).json({ error: 'Your session is invalid or expired. Sign in again and retry.' })
        return
      }
      response.locals.communityUserId = userId
      next()
    } catch (reason) {
      console.error('Could not verify community request:', reason)
      response.status(503).json({ error: 'RideHub could not verify your session. Please retry shortly.' })
    }
  }

  const requireCommunityRepository: express.RequestHandler = (_request, response, next) => {
    if (!options.communities) {
      response.status(503).json({
        error: 'Shared communities are not configured. Set DATABASE_URL on the backend and apply the database migrations.',
      })
      return
    }
    next()
  }

  const requireVoiceCallRepository: express.RequestHandler = (_request, response, next) => {
    if (!options.voiceCalls) {
      response.status(503).json({
        error: 'Group voice calls are not configured. Set DATABASE_URL and apply the database migrations.',
      })
      return
    }
    next()
  }

  const requireCommunityChatRepository: express.RequestHandler = (_request, response, next) => {
    if (!options.communityChat) {
      response.status(503).json({
        error: 'Group chat is not configured. Set DATABASE_URL and apply the database migrations.',
      })
      return
    }
    next()
  }

  app.get(
    '/api/communities/:communityId/messages',
    chatLimiter,
    authenticateCommunityRequest,
    requireCommunityChatRepository,
    async (request, response) => {
      const communityId = getRouteParam(request.params.communityId)
      const userId = getCommunityUserId(response)
      const after = request.query.after
      response.setHeader('Cache-Control', 'no-store')
      if (after === undefined) {
        response.json(await options.communityChat!.list(communityId, userId))
      } else {
        if (typeof after !== 'string') throw new CommunityChatError(400, 'A valid chat update cursor is required.')
        response.json(await options.communityChat!.poll(communityId, userId, after))
      }
    },
  )

  app.post(
    '/api/communities/:communityId/messages',
    chatLimiter,
    authenticateCommunityRequest,
    requireCommunityChatRepository,
    async (request, response) => {
      const message = await options.communityChat!.send(
        getRouteParam(request.params.communityId),
        getCommunityUserId(response),
        request.body,
      )
      response.status(201).json(message)
    },
  )

  app.patch(
    '/api/communities/:communityId/messages/:messageId',
    chatLimiter,
    authenticateCommunityRequest,
    requireCommunityChatRepository,
    async (request, response) => {
      const message = await options.communityChat!.edit(
        getRouteParam(request.params.communityId),
        getCommunityUserId(response),
        getRouteParam(request.params.messageId),
        request.body,
      )
      response.json(message)
    },
  )

  app.delete(
    '/api/communities/:communityId/messages/:messageId',
    chatLimiter,
    authenticateCommunityRequest,
    requireCommunityChatRepository,
    async (request, response) => {
      await options.communityChat!.delete(
        getRouteParam(request.params.communityId),
        getCommunityUserId(response),
        getRouteParam(request.params.messageId),
      )
      response.status(204).end()
    },
  )

  app.post(
    '/api/communities/:communityId/voice/join',
    voiceCallLimiter,
    authenticateCommunityRequest,
    requireVoiceCallRepository,
    async (request, response) => {
      const state = await options.voiceCalls!.join(
        getRouteParam(request.params.communityId),
        getCommunityUserId(response),
      )
      response.setHeader('Cache-Control', 'no-store')
      response.json(state)
    },
  )

  app.get(
    '/api/communities/:communityId/voice/state',
    voiceCallLimiter,
    authenticateCommunityRequest,
    requireVoiceCallRepository,
    async (request, response) => {
      const callId = getQueryParam(request.query.callId, 'A valid call identifier is required.')
      const afterSequence = getQueryParam(request.query.after, 'A valid voice call cursor is required.')
      const state = await options.voiceCalls!.poll(
        getRouteParam(request.params.communityId),
        getCommunityUserId(response),
        callId,
        afterSequence,
      )
      response.setHeader('Cache-Control', 'no-store')
      response.json(state)
    },
  )

  app.post(
    '/api/communities/:communityId/voice/signals',
    voiceCallLimiter,
    authenticateCommunityRequest,
    requireVoiceCallRepository,
    async (request, response) => {
      const body = isRecord(request.body) ? request.body : {}
      const callId = requireBodyText(body.callId, 'A valid call identifier is required.')
      const recipientId = requireBodyText(body.toUserId, 'A valid recipient is required.')
      const kind = requireVoiceSignalKind(body.kind)
      await options.voiceCalls!.sendSignal(
        getRouteParam(request.params.communityId),
        getCommunityUserId(response),
        callId,
        recipientId,
        kind,
        body.payload,
      )
      response.status(204).end()
    },
  )

  app.post(
    '/api/communities/:communityId/voice/leave',
    voiceCallLimiter,
    authenticateCommunityRequest,
    requireVoiceCallRepository,
    async (request, response) => {
      const body = isRecord(request.body) ? request.body : {}
      await options.voiceCalls!.leave(
        getRouteParam(request.params.communityId),
        getCommunityUserId(response),
        requireBodyText(body.callId, 'A valid call identifier is required.'),
      )
      response.status(204).end()
    },
  )

  app.get('/api/communities', communityLimiter, authenticateCommunityRequest, requireCommunityRepository, async (_request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.json(await options.communities!.list(getCommunityUserId(response)))
  })

  app.post('/api/communities', communityLimiter, authenticateCommunityRequest, requireCommunityRepository, async (request, response) => {
    const community = await options.communities!.create(
      getCommunityUserId(response),
      request.body,
    )
    response.status(201).json(community)
  })

  app.post('/api/communities/:communityId/join', communityLimiter, authenticateCommunityRequest, requireCommunityRepository, async (request, response) => {
    const community = await options.communities!.requestJoin(
      getRouteParam(request.params.communityId),
      getCommunityUserId(response),
      request.body,
    )
    response.json(community)
  })

  app.post('/api/communities/:communityId/requests/:memberId', communityLimiter, authenticateCommunityRequest, requireCommunityRepository, async (request, response) => {
    const community = await options.communities!.resolveJoinRequest(
      getRouteParam(request.params.communityId),
      getCommunityUserId(response),
      getRouteParam(request.params.memberId),
      request.body,
    )
    response.json(community)
  })

  app.patch('/api/communities/:communityId', communityLimiter, authenticateCommunityRequest, requireCommunityRepository, async (request, response) => {
    const community = await options.communities!.update(
      getRouteParam(request.params.communityId),
      getCommunityUserId(response),
      request.body,
    )
    response.json(community)
  })

  app.put('/api/communities/:communityId/meeting', communityLimiter, authenticateCommunityRequest, requireCommunityRepository, async (request, response) => {
    const community = await options.communities!.setMeeting(
      getRouteParam(request.params.communityId),
      getCommunityUserId(response),
      request.body,
    )
    response.json(community)
  })

  app.post('/api/communities/:communityId/leave', communityLimiter, authenticateCommunityRequest, requireCommunityRepository, async (request, response) => {
    await options.communities!.leave(
      getRouteParam(request.params.communityId),
      getCommunityUserId(response),
    )
    response.status(204).end()
  })

  app.delete('/api/communities/:communityId', communityLimiter, authenticateCommunityRequest, requireCommunityRepository, async (request, response) => {
    await options.communities!.delete(
      getRouteParam(request.params.communityId),
      getCommunityUserId(response),
    )
    response.status(204).end()
  })

  app.post('/api/communities/:communityId/moderation', communityLimiter, authenticateCommunityRequest, requireCommunityRepository, async (request, response) => {
    const community = await options.communities!.moderate(
      getRouteParam(request.params.communityId),
      getCommunityUserId(response),
      request.body,
    )
    response.json(community)
  })

  const authenticateAvatarRequest: express.RequestHandler = async (request, response, next) => {
    if (!verifyAuthToken) {
      response.status(503).json({
        error: 'Profile picture uploads require NEON_AUTH_BASE_URL and NEON_AUTH_JWKS_URL on the backend.',
      })
      return
    }

    const match = /^Bearer\s+(\S+)$/i.exec(request.get('authorization') ?? '')
    if (!match) {
      response.status(401).json({ error: 'Sign in to manage your profile picture.' })
      return
    }

    try {
      const userId = await verifyAuthToken(match[1]!)
      if (!userId) {
        response.status(401).json({ error: 'Your session is invalid or expired. Sign in again and retry.' })
        return
      }
      response.locals.avatarUserId = userId
      next()
    } catch (reason) {
      console.error('Could not verify profile picture request:', reason)
      response.status(503).json({ error: 'RideHub could not verify your session. Please retry shortly.' })
    }
  }

  const requireAvatarStorage: express.RequestHandler = (_request, response, next) => {
    if (!options.avatarStorage) {
      response.status(503).json({
        error: 'Profile picture storage is not configured. Provision the Neon profile-avatars bucket and AWS storage credentials.',
      })
      return
    }
    next()
  }

  app.post(
    '/api/profile/avatar',
    avatarLimiter,
    authenticateAvatarRequest,
    requireAvatarStorage,
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '4mb' }),
    async (request, response) => {
      const userId = response.locals.avatarUserId
      if (typeof userId !== 'string') {
        response.status(401).json({ error: 'Sign in to manage your profile picture.' })
        return
      }
      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
        response.status(415).json({ error: 'Choose a JPEG, PNG, or WebP image to upload.' })
        return
      }
      const contentType = request.get('content-type')
      const detectedContentType = detectAvatarContentType(request.body)
      if (
        (contentType !== 'image/jpeg' && contentType !== 'image/png' && contentType !== 'image/webp')
        || contentType !== detectedContentType
      ) {
        response.status(415).json({ error: 'The image file type could not be verified. Choose a valid JPEG, PNG, or WebP image.' })
        return
      }

      const storage = options.avatarStorage!
      let objectKey: string | null = null
      try {
        objectKey = await storage.upload(userId, request.body, contentType as AvatarContentType)
        const url = await storage.getUrl(userId, objectKey)
        response.status(201).json({ objectKey, url })
      } catch (reason) {
        if (objectKey) {
          try {
            await storage.delete(userId, objectKey)
          } catch (cleanupReason) {
            console.error('Could not remove incomplete profile photo upload:', cleanupReason)
          }
        }
        console.error('Profile photo upload failed:', reason)
        response.status(502).json({ error: 'The profile photo could not be stored. Please try again.' })
      }
    },
  )

  app.get(
    '/api/profile/avatar-url',
    avatarLimiter,
    authenticateAvatarRequest,
    requireAvatarStorage,
    async (_request, response) => {
      const userId = response.locals.avatarUserId
      const objectKey = _request.query.key
      if (typeof userId !== 'string') {
        response.status(401).json({ error: 'Sign in to view your profile picture.' })
        return
      }
      if (typeof objectKey !== 'string' || !isOwnedAvatarKey(userId, objectKey)) {
        response.status(403).json({ error: 'That profile picture is not available to this account.' })
        return
      }

      try {
        const url = await options.avatarStorage!.getUrl(userId, objectKey)
        response.setHeader('Cache-Control', 'no-store')
        response.json({ url })
      } catch (reason) {
        console.error('Profile photo URL could not be created:', reason)
        response.status(502).json({ error: 'The profile photo could not be loaded. Please retry.' })
      }
    },
  )

  app.delete(
    '/api/profile/avatar',
    avatarLimiter,
    authenticateAvatarRequest,
    requireAvatarStorage,
    async (request, response) => {
      const userId = response.locals.avatarUserId
      const objectKey = isRecord(request.body) ? request.body.objectKey : null
      if (typeof userId !== 'string') {
        response.status(401).json({ error: 'Sign in to manage your profile picture.' })
        return
      }
      if (typeof objectKey !== 'string' || !isOwnedAvatarKey(userId, objectKey)) {
        response.status(403).json({ error: 'That profile picture is not available to this account.' })
        return
      }

      try {
        await options.avatarStorage!.delete(userId, objectKey)
        response.status(204).end()
      } catch (reason) {
        console.error('Profile photo could not be deleted:', reason)
        response.status(502).json({ error: 'The previous profile photo could not be removed from storage.' })
      }
    },
  )

  app.get('/api/weather/forecast', weatherLimiter, async (request, response, next) => {
    const latitude = Number(request.query.lat)
    const longitude = Number(request.query.lon)
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      response.status(400).json({ error: 'Valid latitude and longitude are required.' })
      return
    }

    if (!options.weatherApiKey) {
      response.status(503).json({
        error: 'Weather service is not configured. Set WEATHER_API_KEY on the backend.',
      })
      return
    }

    try {
      const snapshot = await fetchWeatherSnapshot(latitude, longitude, {
        apiKey: options.weatherApiKey,
        fetchImpl: options.fetchImpl,
      })
      response.json(snapshot)
    } catch (reason) {
      if (reason instanceof WeatherProviderError) {
        response.status(reason.statusCode).json({ error: reason.message })
        return
      }
      next(reason)
    }
  })

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (
      typeof error === 'object'
      && error !== null
      && 'type' in error
      && error.type === 'entity.too.large'
    ) {
      response.status(413).json({
        error: _request.path === '/api/profile/avatar'
          ? 'Profile pictures must be 4 MB or smaller.'
          : 'The request body is too large.',
      })
      return
    }
    if (error instanceof CommunityError) {
      response.status(error.statusCode).json({ error: error.message })
      return
    }
    if (error instanceof CommunityChatError) {
      response.status(error.statusCode).json({ error: error.message })
      return
    }
    if (error instanceof VoiceCallError) {
      response.status(error.statusCode).json({ error: error.message })
      return
    }
    console.error('Unhandled API error:', error)
    response.status(500).json({ error: 'The request could not be completed.' })
  })

  return app
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getCommunityUserId(response: express.Response): string {
  const userId = response.locals.communityUserId
  if (typeof userId !== 'string') {
    throw new CommunityError(401, 'Sign in to browse or manage communities.')
  }
  return userId
}

function getRouteParam(value: string | string[] | undefined): string {
  if (typeof value !== 'string') throw new CommunityError(400, 'A valid community request path is required.')
  return value
}

function getQueryParam(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new VoiceCallError(400, message)
  }
  return value
}

function requireBodyText(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new VoiceCallError(400, message)
  }
  return value
}

function requireVoiceSignalKind(value: unknown): VoiceSignalKind {
  if (value !== 'offer' && value !== 'answer' && value !== 'candidate') {
    throw new VoiceCallError(400, 'That WebRTC signal type is not supported.')
  }
  return value
}

function isSameOrigin(origin: string, request: express.Request): boolean {
  try {
    const originUrl = new URL(origin)
    const forwardedHost = request.get('x-forwarded-host')?.split(',')[0]?.trim()
    const requestHost = forwardedHost || request.get('host')
    if (!requestHost || originUrl.host.toLowerCase() !== requestHost.toLowerCase()) {
      return false
    }

    const forwardedProtocol = request.get('x-forwarded-proto')?.split(',')[0]?.trim()
    const requestProtocol = forwardedProtocol || request.protocol
    return originUrl.protocol === `${requestProtocol}:`
  } catch {
    return false
  }
}
