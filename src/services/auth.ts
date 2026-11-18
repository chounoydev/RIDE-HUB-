import { Capacitor } from '@capacitor/core'
import { createAuthClient, type VanillaBetterAuthClient } from '@neondatabase/auth'
import { BetterAuthVanillaAdapter } from '@neondatabase/auth/vanilla/adapters'

type AuthClient = VanillaBetterAuthClient

export const isNativeApp = Capacitor.isNativePlatform()

export type AuthUser = NonNullable<
  NonNullable<Awaited<ReturnType<AuthClient['getSession']>>['data']>['user']
>

let client: AuthClient | null = null

export const authConfigured = Boolean(import.meta.env.VITE_NEON_AUTH_URL?.trim())

export function getAuthClient(): AuthClient {
  const baseUrl = import.meta.env.VITE_NEON_AUTH_URL?.trim()
  if (!baseUrl) {
    throw new Error('Neon Auth is not configured. Set VITE_NEON_AUTH_URL and restart the app.')
  }

  if (!client) {
    client = createAuthClient(baseUrl, { adapter: BetterAuthVanillaAdapter() })
  }

  return client
}

export function getAuthErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = error.message
    if (typeof message === 'string') return message
  }
  return 'The authentication service could not complete that request. Please try again.'
}
