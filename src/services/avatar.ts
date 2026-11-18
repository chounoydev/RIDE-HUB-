import { getAuthClient } from '@/services/auth'

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL?.trim() || '/api').replace(/\/$/, '')

interface AvatarUploadResponse {
  objectKey: string
  url: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function getAccessToken() {
  const result = await getAuthClient().getSession()
  if (result.error) {
    throw new Error(result.error.message || 'Your session could not be verified. Sign in again and retry.')
  }

  const token = result.data?.session?.token
  if (!token) {
    throw new Error('Your session has expired. Sign in again to update your profile picture.')
  }
  return token
}

async function parseResponse(response: Response) {
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : `Profile service returned HTTP ${response.status}.`
    throw new Error(message)
  }
  return payload
}

export async function uploadProfileAvatar(file: File): Promise<AvatarUploadResponse> {
  const token = await getAccessToken()
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}/profile/avatar`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': file.type,
      },
      body: file,
    })
  } catch (reason) {
    throw new Error(
      reason instanceof Error
        ? `Cannot reach the RideHub profile service: ${reason.message}`
        : 'Cannot reach the RideHub profile service.',
    )
  }

  const payload = await parseResponse(response)
  if (!isRecord(payload) || typeof payload.objectKey !== 'string' || typeof payload.url !== 'string') {
    throw new Error('The profile service returned an invalid upload response.')
  }
  return { objectKey: payload.objectKey, url: payload.url }
}

export async function getProfileAvatarUrl(objectKey: string): Promise<string> {
  const token = await getAccessToken()
  const query = new URLSearchParams({ key: objectKey })
  const response = await fetch(`${apiBaseUrl}/profile/avatar-url?${query}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  const payload = await parseResponse(response)
  if (!isRecord(payload) || typeof payload.url !== 'string') {
    throw new Error('The profile service returned an invalid image URL.')
  }
  return payload.url
}

export async function deleteProfileAvatar(objectKey: string): Promise<void> {
  const token = await getAccessToken()
  const response = await fetch(`${apiBaseUrl}/profile/avatar`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ objectKey }),
  })
  await parseResponse(response)
}
