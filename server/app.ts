import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import {
  detectAvatarContentType,
  isOwnedAvatarKey,
  type AvatarContentType,
  type AvatarStorage,
} from './avatar.js'
import { fetchWeatherSnapshot, WeatherProviderError } from './weather.js'

interface AppOptions {
  weatherApiKey: string
  allowedOrigins?: string[]
  trustProxy?: boolean
  fetchImpl?: typeof fetch
  verifyAvatarToken?: (token: string) => Promise<string | null>
  avatarStorage?: AvatarStorage
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
  app.use(express.json({ limit: '32kb' }))

  app.get('/api/health', (_request, response) => {
    response.json({
      ok: true,
      weatherConfigured: options.weatherApiKey.length > 0,
      monitoringActive: false,
      pushConfigured: false,
      avatarUploadConfigured: Boolean(options.verifyAvatarToken && options.avatarStorage),
    })
  })

  const authenticateAvatarRequest: express.RequestHandler = async (request, response, next) => {
    if (!options.verifyAvatarToken) {
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
      const userId = await options.verifyAvatarToken(match[1]!)
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
      response.status(413).json({ error: 'Profile pictures must be 4 MB or smaller.' })
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
