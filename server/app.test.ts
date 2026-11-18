import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { createServer } from 'node:http'
import test from 'node:test'
import type { AddressInfo } from 'node:net'
import { exportJWK, SignJWT } from 'jose'
import { createNeonAuthTokenVerifier } from './avatar.js'
import { createApp } from './app.js'
import type { CommunityChatRepository } from './community-chat.js'
import { CommunityError, type CommunityRepository } from './community.js'

function responsePayload() {
  const nowEpoch = Math.floor(Date.now() / 3_600_000) * 3_600
  const hour = {
    time_epoch: nowEpoch + 3_600,
    time: new Date((nowEpoch + 3_600) * 1000).toISOString(),
    temp_c: 25,
    condition: { text: 'Clear', icon: '', code: 1000 },
    wind_kph: 10,
    gust_kph: 15,
    precip_mm: 0,
    chance_of_rain: 0,
    heatindex_c: 25,
  }
  return {
    location: { name: 'Test', region: '', country: 'PH', lat: 14.6, lon: 121.0 },
    current: {
      temp_c: 25,
      feelslike_c: 25,
      condition: { text: 'Clear', icon: '', code: 1000 },
      wind_kph: 10,
      gust_kph: 15,
      humidity: 50,
      last_updated: new Date().toISOString(),
    },
    forecast: { forecastday: [{ hour: [hour] }] },
    alerts: { alert: [] },
  }
}

async function listen(app: ReturnType<typeof createApp>) {
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}

test('verifies Neon Auth JWTs using the Auth URL origin as issuer and audience', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const jwk = {
    ...await exportJWK(publicKey),
    alg: 'EdDSA',
    kid: 'ridehub-avatar-test',
    use: 'sig',
  }
  const jwksServer = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ keys: [jwk] }))
  })
  await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve))
  const address = jwksServer.address() as AddressInfo
  const authBaseUrl = 'https://auth.example.test/neondb/auth'
  const issuer = new URL(authBaseUrl).origin
  const verify = createNeonAuthTokenVerifier(
    `http://127.0.0.1:${address.port}/.well-known/jwks.json`,
    authBaseUrl,
  )

  async function createToken(tokenIssuer: string) {
    return new SignJWT({ sub: 'rider-1' })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'ridehub-avatar-test' })
      .setIssuer(tokenIssuer)
      .setAudience(issuer)
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(privateKey)
  }

  try {
    assert.equal(await verify(await createToken(issuer)), 'rider-1')
    assert.equal(await verify(await createToken(authBaseUrl)), null)
  } finally {
    await new Promise<void>((resolve, reject) => {
      jwksServer.close((error) => error ? reject(error) : resolve())
    })
  }
})

test('rejects invalid coordinates before contacting the provider', async () => {
  let fetchCalled = false
  const app = createApp({
    weatherApiKey: 'test-key',
    fetchImpl: async () => {
      fetchCalled = true
      return Response.json(responsePayload())
    },
  })
  const server = await listen(app)

  try {
    const response = await fetch(`${server.url}/api/weather/forecast?lat=91&lon=121`)
    assert.equal(response.status, 400)
    assert.equal(fetchCalled, false)
  } finally {
    await server.close()
  }
})

test('reports provider setup requirements without returning sample weather', async () => {
  const server = await listen(createApp({ weatherApiKey: '' }))

  try {
    const response = await fetch(`${server.url}/api/weather/forecast?lat=14.6&lon=121`)
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {
      error: 'Weather service is not configured. Set WEATHER_API_KEY on the backend.',
    })
  } finally {
    await server.close()
  }
})

test('explains how to fix a rejected weather provider key', async () => {
  const server = await listen(createApp({
    weatherApiKey: 'rejected-test-key',
    fetchImpl: async () => new Response(null, { status: 403 }),
  }))

  try {
    const response = await fetch(`${server.url}/api/weather/forecast?lat=14.6&lon=121`)
    assert.equal(response.status, 502)
    assert.deepEqual(await response.json(), {
      error: 'WeatherAPI rejected the API key. Replace WEATHER_API_KEY in .env.local or .env, then restart the API.',
    })
  } finally {
    await server.close()
  }
})

test('reports background monitoring and push as inactive', async () => {
  const server = await listen(createApp({ weatherApiKey: 'configured-key' }))

  try {
    const response = await fetch(`${server.url}/api/health`)
    assert.deepEqual(await response.json(), {
      ok: true,
      weatherConfigured: true,
      monitoringActive: false,
      pushConfigured: false,
      avatarUploadConfigured: false,
      sharedCommunitiesConfigured: false,
      communityChatConfigured: false,
      voiceCallsConfigured: false,
    })
  } finally {
    await server.close()
  }
})

test('requires authentication before joining a group voice call', async () => {
  let joined = false
  const server = await listen(createApp({
    weatherApiKey: '',
    verifyAuthToken: async (token) => token === 'valid-token' ? 'rider-1' : null,
    voiceCalls: {
      async join() {
        joined = true
        return { callId: '00000000-0000-4000-8000-000000000001', participants: [], signals: [] }
      },
      async poll() { throw new Error('Unexpected poll request.') },
      async sendSignal() { throw new Error('Unexpected signal request.') },
      async leave() { throw new Error('Unexpected leave request.') },
    },
  }))

  try {
    const url = `${server.url}/api/communities/00000000-0000-4000-8000-000000000002/voice/join`
    const unauthenticated = await fetch(url, { method: 'POST' })
    assert.equal(unauthenticated.status, 401)
    assert.equal(joined, false)

    const authenticated = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token' },
    })
    assert.equal(authenticated.status, 200)
    assert.equal(joined, true)
  } finally {
    await server.close()
  }
})

test('requires authentication and shares persisted community chat updates', async () => {
  const requestedUsers: string[] = []
  const actions: string[] = []
  const chat: CommunityChatRepository = {
    async list(_communityId, userId) {
      requestedUsers.push(userId)
      return { messages: [], cursor: '0' }
    },
    async poll(_communityId, userId, afterSequence) {
      requestedUsers.push(userId)
      return { events: [], cursor: afterSequence }
    },
    async send(_communityId, userId, value) {
      requestedUsers.push(userId)
      assert.deepEqual(value, { text: 'Ride at sunrise?' })
      return {
        id: '00000000-0000-4000-8000-000000000003',
        senderId: userId,
        senderName: 'Alex',
        text: 'Ride at sunrise?',
        createdAt: new Date().toISOString(),
      }
    },
    async edit(_communityId, userId, messageId, value) {
      actions.push(`edit:${userId}:${messageId}`)
      assert.deepEqual(value, { text: 'Updated plan' })
      return {
        id: messageId,
        senderId: userId,
        senderName: 'Alex',
        text: 'Updated plan',
        createdAt: new Date().toISOString(),
        editedAt: new Date().toISOString(),
      }
    },
    async delete(_communityId, userId, messageId) {
      actions.push(`delete:${userId}:${messageId}`)
    },
  }
  const server = await listen(createApp({
    weatherApiKey: '',
    verifyAuthToken: async (token) => token === 'valid-token' ? 'rider-1' : null,
    communityChat: chat,
  }))
  const messagesUrl = `${server.url}/api/communities/00000000-0000-4000-8000-000000000002/messages`

  try {
    const unauthenticated = await fetch(messagesUrl)
    assert.equal(unauthenticated.status, 401)
    assert.deepEqual(requestedUsers, [])

    const snapshot = await fetch(messagesUrl, {
      headers: { Authorization: 'Bearer valid-token' },
    })
    assert.equal(snapshot.status, 200)
    assert.deepEqual(await snapshot.json(), { messages: [], cursor: '0' })

    const updates = await fetch(`${messagesUrl}?after=0`, {
      headers: { Authorization: 'Bearer valid-token' },
    })
    assert.equal(updates.status, 200)
    assert.deepEqual(await updates.json(), { events: [], cursor: '0' })

    const sent = await fetch(messagesUrl, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'Ride at sunrise?' }),
    })
    assert.equal(sent.status, 201)
    const sentPayload = await sent.json()
    assert.ok(typeof sentPayload === 'object' && sentPayload !== null && 'senderName' in sentPayload)
    assert.equal(sentPayload.senderName, 'Alex')

    const messageId = '00000000-0000-4000-8000-000000000003'
    const edited = await fetch(`${messagesUrl}/${messageId}`, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'Updated plan' }),
    })
    assert.equal(edited.status, 200)
    const editedPayload = await edited.json()
    assert.ok(typeof editedPayload === 'object' && editedPayload !== null && 'text' in editedPayload)
    assert.equal(editedPayload.text, 'Updated plan')

    const deleted = await fetch(`${messagesUrl}/${messageId}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-token' },
    })
    assert.equal(deleted.status, 204)
    assert.deepEqual(requestedUsers, ['rider-1', 'rider-1', 'rider-1'])
    assert.deepEqual(actions, [`edit:rider-1:${messageId}`, `delete:rider-1:${messageId}`])
  } finally {
    await server.close()
  }
})

test('requires a valid auth token before listing shared communities', async () => {
  const requestedUsers: string[] = []
  const communities: CommunityRepository = {
    list: async (userId) => {
      requestedUsers.push(userId)
      return []
    },
    create: async () => { throw new Error('Not used by this test.') },
    requestJoin: async () => { throw new Error('Not used by this test.') },
    resolveJoinRequest: async () => { throw new Error('Not used by this test.') },
    update: async () => { throw new Error('Not used by this test.') },
    setMeeting: async () => { throw new Error('Not used by this test.') },
    leave: async () => { throw new Error('Not used by this test.') },
    delete: async () => { throw new Error('Not used by this test.') },
    moderate: async () => { throw new Error('Not used by this test.') },
  }
  const server = await listen(createApp({
    weatherApiKey: '',
    verifyAuthToken: async (token) => token === 'valid-token' ? 'rider-1' : null,
    communities,
  }))

  try {
    const unauthenticated = await fetch(`${server.url}/api/communities`)
    assert.equal(unauthenticated.status, 401)
    assert.deepEqual(requestedUsers, [])

    const response = await fetch(`${server.url}/api/communities`, {
      headers: { Authorization: 'Bearer valid-token' },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), [])
    assert.deepEqual(requestedUsers, ['rider-1'])
  } finally {
    await server.close()
  }
})

test('returns server-side community authorization errors to the caller', async () => {
  const communities: CommunityRepository = {
    list: async () => [],
    create: async () => { throw new Error('Not used by this test.') },
    requestJoin: async () => { throw new Error('Not used by this test.') },
    resolveJoinRequest: async () => { throw new CommunityError(403, 'Only this community’s admin can perform that action.') },
    update: async () => { throw new Error('Not used by this test.') },
    setMeeting: async () => { throw new Error('Not used by this test.') },
    leave: async () => { throw new Error('Not used by this test.') },
    delete: async () => { throw new Error('Not used by this test.') },
    moderate: async () => { throw new Error('Not used by this test.') },
  }
  const server = await listen(createApp({
    weatherApiKey: '',
    verifyAuthToken: async () => 'rider-2',
    communities,
  }))

  try {
    const response = await fetch(
      `${server.url}/api/communities/00000000-0000-4000-8000-000000000001/requests/rider-3`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ approve: true }),
      },
    )
    assert.equal(response.status, 403)
    assert.deepEqual(await response.json(), {
      error: 'Only this community’s admin can perform that action.',
    })
  } finally {
    await server.close()
  }
})

test('allows same-origin requests without listing the deployment domain', async () => {
  const server = await listen(createApp({ weatherApiKey: '' }))

  try {
    const response = await fetch(`${server.url}/api/health`, {
      headers: { Origin: server.url },
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('access-control-allow-origin'), server.url)
  } finally {
    await server.close()
  }
})

test('allows the Android Capacitor WebView origin', async () => {
  const server = await listen(createApp({ weatherApiKey: '' }))

  try {
    const response = await fetch(`${server.url}/api/health`, {
      headers: { Origin: 'https://localhost' },
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://localhost')
  } finally {
    await server.close()
  }
})

test('rejects cross-origin requests that are not configured', async () => {
  const server = await listen(createApp({ weatherApiKey: '' }))

  try {
    const response = await fetch(`${server.url}/api/health`, {
      headers: { Origin: 'https://untrusted.example' },
    })
    assert.equal(response.status, 403)
    assert.deepEqual(await response.json(), {
      error: 'Origin is not allowed by the server CORS policy.',
    })
  } finally {
    await server.close()
  }
})

test('accepts Vercel forwarded client addresses through one trusted proxy hop', async () => {
  const server = await listen(createApp({ weatherApiKey: '', trustProxy: true }))

  try {
    const response = await fetch(`${server.url}/api/weather/forecast?lat=14.6&lon=121`, {
      headers: { 'X-Forwarded-For': '203.0.113.10' },
    })
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {
      error: 'Weather service is not configured. Set WEATHER_API_KEY on the backend.',
    })
  } finally {
    await server.close()
  }
})

test('requires a bearer token before managing profile photos', async () => {
  let verifierCalled = false
  const server = await listen(createApp({
    weatherApiKey: '',
    verifyAvatarToken: async () => {
      verifierCalled = true
      return 'rider-1'
    },
    avatarStorage: {
      upload: async () => 'avatars/rider-1/00000000-0000-0000-0000-000000000000.jpg',
      getUrl: async () => 'https://storage.example/photo',
      delete: async () => {},
    },
  }))

  try {
    const response = await fetch(`${server.url}/api/profile/avatar-url?key=avatars/rider-1/00000000-0000-0000-0000-000000000000.jpg`)
    assert.equal(response.status, 401)
    assert.equal(verifierCalled, false)
  } finally {
    await server.close()
  }
})

test('rejects profile photo data that does not match its declared image type', async () => {
  let uploadCalled = false
  const server = await listen(createApp({
    weatherApiKey: '',
    verifyAvatarToken: async () => 'rider-1',
    avatarStorage: {
      upload: async () => {
        uploadCalled = true
        return 'avatars/rider-1/00000000-0000-0000-0000-000000000000.jpg'
      },
      getUrl: async () => 'https://storage.example/photo',
      delete: async () => {},
    },
  }))

  try {
    const response = await fetch(`${server.url}/api/profile/avatar`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'image/jpeg' },
      body: 'not an image',
    })
    assert.equal(response.status, 415)
    assert.equal(uploadCalled, false)
  } finally {
    await server.close()
  }
})

test('rejects profile photos larger than 4 MB', async () => {
  let uploadCalled = false
  const server = await listen(createApp({
    weatherApiKey: '',
    verifyAvatarToken: async () => 'rider-1',
    avatarStorage: {
      upload: async () => {
        uploadCalled = true
        return 'avatars/rider-1/00000000-0000-0000-0000-000000000000.jpg'
      },
      getUrl: async () => 'https://storage.example/photo',
      delete: async () => {},
    },
  }))

  try {
    const response = await fetch(`${server.url}/api/profile/avatar`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'image/jpeg' },
      body: Buffer.alloc(4 * 1024 * 1024 + 1),
    })
    assert.equal(response.status, 413)
    assert.deepEqual(await response.json(), {
      error: 'Profile pictures must be 4 MB or smaller.',
    })
    assert.equal(uploadCalled, false)
  } finally {
    await server.close()
  }
})

test('prevents a signed profile photo URL from being created for another user', async () => {
  let getUrlCalled = false
  const server = await listen(createApp({
    weatherApiKey: '',
    verifyAvatarToken: async () => 'rider-1',
    avatarStorage: {
      upload: async () => 'avatars/rider-1/00000000-0000-0000-0000-000000000000.jpg',
      getUrl: async () => {
        getUrlCalled = true
        return 'https://storage.example/photo'
      },
      delete: async () => {},
    },
  }))

  try {
    const response = await fetch(`${server.url}/api/profile/avatar-url?key=avatars/rider-2/00000000-0000-0000-0000-000000000000.jpg`, {
      headers: { Authorization: 'Bearer valid-token' },
    })
    assert.equal(response.status, 403)
    assert.equal(getUrlCalled, false)
  } finally {
    await server.close()
  }
})

test('uploads valid profile photo bytes for the authenticated rider', async () => {
  const objectKey = 'avatars/rider-1/00000000-0000-0000-0000-000000000000.jpg'
  let uploadedUserId = ''
  const server = await listen(createApp({
    weatherApiKey: '',
    verifyAvatarToken: async (token) => token === 'valid-token' ? 'rider-1' : null,
    avatarStorage: {
      upload: async (userId) => {
        uploadedUserId = userId
        return objectKey
      },
      getUrl: async (_userId, key) => `https://storage.example/${key}`,
      delete: async () => {},
    },
  }))

  try {
    const response = await fetch(`${server.url}/api/profile/avatar`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'image/jpeg' },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
    })
    assert.equal(response.status, 201)
    assert.equal(uploadedUserId, 'rider-1')
    assert.deepEqual(await response.json(), {
      objectKey,
      url: `https://storage.example/${objectKey}`,
    })
  } finally {
    await server.close()
  }
})

test('returns a live provider response through the API proxy', async () => {
  const app = createApp({
    weatherApiKey: 'private-test-key',
    fetchImpl: async (input) => {
      assert.match(String(input), /api\.weatherapi\.com/)
      assert.match(String(input), /alerts=yes/)
      return Response.json(responsePayload())
    },
  })
  const server = await listen(app)

  try {
    const response = await fetch(`${server.url}/api/weather/forecast?lat=14.6&lon=121`)
    const snapshot = await response.json() as { provider: string; location: { latitude: number }; alerts: unknown[] }
    assert.equal(response.status, 200)
    assert.equal(snapshot.provider, 'WeatherAPI.com')
    assert.equal(snapshot.location.latitude, 14.6)
    assert.deepEqual(snapshot.alerts, [])
  } finally {
    await server.close()
  }
})
