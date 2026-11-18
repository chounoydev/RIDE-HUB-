import { createAvatarStorage, createNeonAuthTokenVerifier } from './avatar.js'
import { createApp } from './app.js'
import { PrismaCommunityChatRepository } from './community-chat.js'
import { PrismaCommunityRepository } from './community.js'
import { getDatabaseClient } from './db.js'
import { PrismaVoiceCallRepository } from './voice-calls.js'

export function createConfiguredApp(env: NodeJS.ProcessEnv = process.env) {
  const allowedOrigins = (env.WEB_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  const authBaseUrl = env.NEON_AUTH_BASE_URL?.trim() ?? ''
  const authJwksUrl = env.NEON_AUTH_JWKS_URL?.trim() ?? ''
  const verifyAuthToken = authBaseUrl && authJwksUrl
    ? createNeonAuthTokenVerifier(authJwksUrl, authBaseUrl)
    : undefined
  const database = getDatabaseClient(env)
  const communities = database ? new PrismaCommunityRepository(database) : undefined
  const communityChat = database ? new PrismaCommunityChatRepository(database) : undefined
  const voiceCalls = database ? new PrismaVoiceCallRepository(database) : undefined

  const storageEnvironment = {
    accessKeyId: env.AWS_ACCESS_KEY_ID?.trim() ?? '',
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY?.trim() ?? '',
    endpoint: env.AWS_ENDPOINT_URL_S3?.trim() ?? '',
    region: env.AWS_REGION?.trim() ?? '',
  }
  const storageValues = Object.values(storageEnvironment)
  const avatarStorageConfigured = storageValues.every(Boolean)
  const avatarStoragePartiallyConfigured = storageValues.some(Boolean) && !avatarStorageConfigured
  if (avatarStoragePartiallyConfigured) {
    const missing = Object.entries(storageEnvironment)
      .filter(([, value]) => !value)
      .map(([name]) => name)
    console.error(`Profile photo storage is disabled; missing ${missing.join(', ')}.`)
  }
  const avatarStorage = avatarStorageConfigured
    ? createAvatarStorage({
        ...storageEnvironment,
        bucket: 'profile-avatars',
      })
    : undefined

  if (!verifyAuthToken) {
    console.warn('Authenticated API features are disabled until NEON_AUTH_BASE_URL and NEON_AUTH_JWKS_URL are configured.')
  }
  if (!database) {
    console.warn('Shared communities are disabled until DATABASE_URL is configured.')
  }
  if (!avatarStorageConfigured) {
    console.warn('Profile photo uploads are disabled until Neon Object Storage credentials are configured.')
  }

  return createApp({
    weatherApiKey: env.WEATHER_API_KEY?.trim() ?? '',
    allowedOrigins,
    trustProxy: env.VERCEL === '1',
    verifyAuthToken,
    avatarStorage,
    communities,
    communityChat,
    voiceCalls,
  })
}
