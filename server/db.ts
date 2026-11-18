import { attachDatabasePool } from '@vercel/functions'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'

interface DatabaseResources {
  connectionString: string
  client: PrismaClient
}

let resources: DatabaseResources | null = null

export function getDatabaseClient(env: NodeJS.ProcessEnv = process.env): PrismaClient | null {
  const connectionString = env.DATABASE_URL?.trim()
  if (!connectionString) return null
  if (resources?.connectionString === connectionString) return resources.client

  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  })
  pool.on('error', (reason) => {
    console.error('Unexpected error from the RideHub database pool:', reason)
  })
  if (env.VERCEL === '1') attachDatabasePool(pool)

  const client = new PrismaClient({ adapter: new PrismaPg(pool) })
  resources = { connectionString, client }
  return client
}