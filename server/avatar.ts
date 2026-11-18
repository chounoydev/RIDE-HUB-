import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'node:crypto'
import { createRemoteJWKSet, errors, jwtVerify } from 'jose'

export type AvatarContentType = 'image/jpeg' | 'image/png' | 'image/webp'

export interface AvatarStorage {
  upload(userId: string, body: Buffer, contentType: AvatarContentType): Promise<string>
  getUrl(userId: string, objectKey: string): Promise<string>
  delete(userId: string, objectKey: string): Promise<void>
}

interface AvatarStorageConfig {
  accessKeyId: string
  secretAccessKey: string
  endpoint: string
  region: string
  bucket: string
}

const userIdPattern = /^[A-Za-z0-9_-]{1,128}$/
const objectKeyPattern = /^avatars\/([A-Za-z0-9_-]{1,128})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i
const extensions: Record<AvatarContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export function isOwnedAvatarKey(userId: string, objectKey: string) {
  const match = objectKeyPattern.exec(objectKey)
  return userIdPattern.test(userId) && match?.[1] === userId
}

export function detectAvatarContentType(body: Buffer): AvatarContentType | null {
  if (
    body.length >= 3
    && body[0] === 0xff
    && body[1] === 0xd8
    && body[2] === 0xff
  ) return 'image/jpeg'

  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png'
  }

  if (
    body.length >= 12
    && body.toString('ascii', 0, 4) === 'RIFF'
    && body.toString('ascii', 8, 12) === 'WEBP'
  ) return 'image/webp'

  return null
}

export function createNeonAuthTokenVerifier(jwksUrl: string, authBaseUrl: string) {
  const jwks = createRemoteJWKSet(new URL(jwksUrl))
  const issuer = new URL(authBaseUrl).origin

  return async (token: string): Promise<string | null> => {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        algorithms: ['EdDSA'],
        audience: issuer,
        issuer,
      })
      return typeof payload.sub === 'string' && userIdPattern.test(payload.sub)
        ? payload.sub
        : null
    } catch (reason) {
      if (reason instanceof errors.JOSEError) return null
      throw reason
    }
  }
}

export function createAvatarStorage(config: AvatarStorageConfig): AvatarStorage {
  const endpoint = new URL(config.endpoint)
  if (endpoint.protocol !== 'https:') {
    throw new Error('Avatar storage endpoint must use HTTPS.')
  }

  const client = new S3Client({
    region: config.region,
    endpoint: endpoint.toString(),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
  })

  return {
    async upload(userId, body, contentType) {
      if (!userIdPattern.test(userId)) throw new Error('Authenticated user ID is invalid.')
      const objectKey = `avatars/${userId}/${randomUUID()}.${extensions[contentType]}`
      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
        Body: body,
        ContentType: contentType,
        CacheControl: 'private, max-age=3600',
      }))
      return objectKey
    },
    async getUrl(userId, objectKey) {
      if (!isOwnedAvatarKey(userId, objectKey)) {
        throw new Error('Profile photo key does not belong to the authenticated user.')
      }
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: config.bucket, Key: objectKey }),
        { expiresIn: 3600 },
      )
    },
    async delete(userId, objectKey) {
      if (!isOwnedAvatarKey(userId, objectKey)) {
        throw new Error('Profile photo key does not belong to the authenticated user.')
      }
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey }))
    },
  }
}
